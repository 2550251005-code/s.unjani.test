/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const keys = require('../src/config/keys');
const User = require('../src/models/User');
const Link = require('../src/models/Link');
const Stat = require('../src/models/Stat');
const Bio = require('../src/models/Bio');
const WhatsNew = require('../src/models/WhatsNew');
const Segmen = require('../src/models/Segmen');
const QrCode = require('../src/models/QrCode');
const LegacyUserMap = require('../src/models/LegacyUserMap');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');

const SSO_BASE_URL = (process.env.SSO_BASE_URL || '').trim();
const SSO_MIGRATION_TOKEN = (process.env.SSO_MIGRATION_TOKEN || '').trim();
const SSO_MIGRATION_SHARED_SECRET =
  (process.env.SSO_MIGRATION_SHARED_SECRET ||
    process.env.SEGMENT_SHARED_SECRET ||
    process.env.SEGMENT_ENCRYPTION_SECRET ||
    '').trim();

const normalizeEmail = (value = '') => value.toString().trim().toLowerCase();
const normalizeNomorInduk = (value = '') => value.toString().replace(/\D/g, '');

const headers = () => {
  const out = {};
  if (SSO_MIGRATION_TOKEN) {
    out.Authorization = `Bearer ${SSO_MIGRATION_TOKEN}`;
  }
  if (!SSO_MIGRATION_TOKEN && SSO_MIGRATION_SHARED_SECRET) {
    out['x-segment-shared-secret'] = SSO_MIGRATION_SHARED_SECRET;
  }
  return out;
};

const fetchSsoUsers = async () => {
  if (!SSO_BASE_URL) {
    throw new Error('SSO_BASE_URL belum diisi.');
  }

  const url = new URL('/api/users', SSO_BASE_URL);
  url.searchParams.set('limit', '500');

  const response = await axios.get(url.toString(), {
    headers: headers(),
    timeout: 10000,
    withCredentials: true,
  });

  return Array.isArray(response?.data?.users) ? response.data.users : [];
};

const buildMapping = (legacyUsers, ssoUsers) => {
  const emailMap = new Map();
  const nomorIndukMap = new Map();

  ssoUsers.forEach((user) => {
    const id = (user.id || user._id || '').toString();
    if (!id) return;
    const email = normalizeEmail(user.email);
    const nomorInduk = normalizeNomorInduk(user.nomorInduk);
    if (email && !emailMap.has(email)) {
      emailMap.set(email, user);
    }
    if (nomorInduk && !nomorIndukMap.has(nomorInduk)) {
      nomorIndukMap.set(nomorInduk, user);
    }
  });

  const mapped = [];
  const unmatched = [];

  legacyUsers.forEach((legacy) => {
    const legacyId = legacy._id.toString();
    const email = normalizeEmail(legacy.email);
    const nomorInduk = normalizeNomorInduk(legacy.nomorInduk);

    const picked = (email && emailMap.get(email)) || (nomorInduk && nomorIndukMap.get(nomorInduk)) || null;
    if (!picked) {
      unmatched.push({
        legacyUserId: legacyId,
        email: legacy.email || '',
        nomorInduk: legacy.nomorInduk || '',
      });
      return;
    }

    const ssoUserId = (picked.id || picked._id || '').toString();
    if (!ssoUserId) {
      unmatched.push({
        legacyUserId: legacyId,
        email: legacy.email || '',
        nomorInduk: legacy.nomorInduk || '',
      });
      return;
    }

    mapped.push({
      legacyUserId: legacyId,
      ssoUserId,
      email: picked.email || legacy.email || '',
      nomorInduk: picked.nomorInduk || legacy.nomorInduk || '',
    });
  });

  return { mapped, unmatched };
};

const migrateField = async (Model, field, mapped) => {
  let matched = 0;
  let modified = 0;

  for (const item of mapped) {
    const result = await Model.updateMany(
      { [field]: item.legacyUserId },
      { $set: { [field]: item.ssoUserId } },
    );
    matched += result.matchedCount || 0;
    modified += result.modifiedCount || 0;
  }

  return { matched, modified };
};

const dryRunField = async (Model, field, mapped) => {
  const legacyIds = mapped.map((item) => item.legacyUserId);
  if (!legacyIds.length) return 0;
  return Model.countDocuments({ [field]: { $in: legacyIds } });
};

const run = async () => {
  if (!SSO_MIGRATION_TOKEN && !SSO_MIGRATION_SHARED_SECRET) {
    throw new Error(
      'Isi SSO_MIGRATION_TOKEN (disarankan) atau SSO_MIGRATION_SHARED_SECRET untuk akses API user SSO.',
    );
  }

  await mongoose.connect(keys.mongoURI);
  console.log('[INFO] MongoDB connected');

  const [legacyUsers, ssoUsers] = await Promise.all([User.find({}).lean(), fetchSsoUsers()]);
  console.log(`[INFO] Legacy users: ${legacyUsers.length}`);
  console.log(`[INFO] SSO users fetched: ${ssoUsers.length}`);

  const { mapped, unmatched } = buildMapping(legacyUsers, ssoUsers);
  console.log(`[INFO] Mapped users: ${mapped.length}`);
  console.log(`[INFO] Unmatched users: ${unmatched.length}`);

  if (unmatched.length) {
    console.log('[WARN] Sample unmatched users (max 20):');
    unmatched.slice(0, 20).forEach((item) => console.log(item));
  }

  const targets = [
    { label: 'Link.user_id', model: Link, field: 'user_id' },
    { label: 'Link.updateBy', model: Link, field: 'updateBy' },
    { label: 'Stat.userID', model: Stat, field: 'userID' },
    { label: 'Bio.createdBy', model: Bio, field: 'createdBy' },
    { label: 'WhatsNew.createdBy', model: WhatsNew, field: 'createdBy' },
    { label: 'Segmen.createBy', model: Segmen, field: 'createBy' },
    { label: 'Segmen.editBy', model: Segmen, field: 'editBy' },
    { label: 'QrCode.owner', model: QrCode, field: 'owner' },
  ];

  if (!isApply) {
    console.log('[MODE] DRY RUN');
    for (const target of targets) {
      const count = await dryRunField(target.model, target.field, mapped);
      console.log(`[DRY] ${target.label}: ${count} docs kandidat update`);
    }
    await mongoose.disconnect();
    console.log('[DONE] Dry run selesai');
    return;
  }

  console.log('[MODE] APPLY');

  if (mapped.length) {
    const mapOps = mapped.map((item) => ({
      updateOne: {
        filter: { legacyUserId: item.legacyUserId },
        update: {
          $set: {
            ssoUserId: item.ssoUserId,
            email: normalizeEmail(item.email),
            nomorInduk: item.nomorInduk || '',
            source: 'migration',
            note: 'auto-mapped by email/nomorInduk',
          },
        },
        upsert: true,
      },
    }));
    await LegacyUserMap.bulkWrite(mapOps, { ordered: false });
    console.log(`[APPLY] legacy_user_maps upserted: ${mapOps.length}`);
  }

  for (const target of targets) {
    const result = await migrateField(target.model, target.field, mapped);
    console.log(
      `[APPLY] ${target.label}: matched=${result.matched}, modified=${result.modified}`,
    );
  }

  await mongoose.disconnect();
  console.log('[DONE] Migration apply selesai');
};

run().catch(async (err) => {
  console.error('[ERROR]', err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
