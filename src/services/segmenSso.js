const axios = require('axios');
const { SSO_BASE_URL } = require('../utils/ssoClient');
const { encryptPayload, decryptPayload } = require('../utils/securePayload');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const SEGMENT_SSO_BASE_URL = process.env.SEGMENT_SSO_BASE_URL || SSO_BASE_URL || '';
const SEGMENT_SSO_TIMEOUT = parseInt(process.env.SEGMENT_SSO_TIMEOUT || '8000', 10);
const VALUE_MODES = new Set(['id', 'nama', 'singkatan']);
const normalizeValueMode = (value) => {
  const mode = (value || '').toString().trim().toLowerCase();
  return VALUE_MODES.has(mode) ? mode : 'id';
};
const SEGMENT_VALUE_MODE = normalizeValueMode(
  process.env.SEGMENT_SSO_VALUE_MODE || 'nama'
);

const ENDPOINTS = {
  unitkerja: process.env.SEGMENT_SSO_UNITKERJA_ENDPOINT || '/api/master/unitkerja',
  homebase: process.env.SEGMENT_SSO_HOMEBASE_ENDPOINT || '/api/master/homebase',
  subhomebase: process.env.SEGMENT_SSO_SUBHOMEBASE_ENDPOINT || '/api/master/subhomebase',
};

const FALLBACKS = {
  unitkerja: [],
  homebase: [],
  subhomebase: [],
};

// --- Local Mongo fallback (direct read to SSO DB) ---
let ssoDbConnection = null;
const getSsoDb = async () => {
  if (ssoDbConnection) return ssoDbConnection;

  let uri =
    process.env.SEGMENT_SSO_MONGO_URI ||
    process.env.SSO_MONGO_URI ||
    process.env.MONGO_URI;

  // If not provided, try reading ../sso/.env to reuse SSO's Mongo URI
  if (!uri) {
    const envPath = path.join(__dirname, '../../../sso/.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^MONGO_URI=(.*)$/m);
      if (match && match[1]) {
        uri = match[1].trim();
      }
    }
  }

  if (!uri) return null;
  ssoDbConnection = await mongoose.createConnection(uri).asPromise();
  return ssoDbConnection;
};

const schemas = {
  unitkerja: new mongoose.Schema(
    { nama: String, singkatan: String },
    { collection: 'unitkerjas' }
  ),
  homebase: new mongoose.Schema(
    {
      nama: String,
      singkatan: String,
      unitKerja: { type: mongoose.Schema.Types.ObjectId, ref: 'UnitKerja' },
    },
    { collection: 'homebases' }
  ),
  subhomebase: new mongoose.Schema(
    {
      nama: String,
      singkatan: String,
      homebase: { type: mongoose.Schema.Types.ObjectId, ref: 'Homebase' },
    },
    { collection: 'subhomebases' }
  ),
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildExactMatchFilter = (value) => {
  const escaped = escapeRegex(value);
  const regex = new RegExp(`^${escaped}$`, 'i');
  return { $or: [{ nama: regex }, { singkatan: regex }] };
};
const resolveReferenceId = async (Model, value) => {
  const normalized = (value || '').toString().trim();
  if (!normalized) return '';
  if (mongoose.isValidObjectId(normalized)) return normalized;
  const match = await Model.findOne(buildExactMatchFilter(normalized)).select('_id').lean();
  return match?._id?.toString() || '';
};
const pickValue = (item, mode) => {
  if (!item) return '';
  if (mode === 'nama') return item.nama || item.singkatan || item._id;
  if (mode === 'singkatan') return item.singkatan || item.nama || item._id;
  return item._id || item.nama || item.singkatan || '';
};
const pickText = (item, mode) => {
  if (!item) return '';
  if (mode === 'id') return item.nama || item.singkatan || item._id;
  return pickValue(item, mode);
};

const buildSearchFilter = (search) =>
  search && search.trim()
    ? {
        $or: [
          { nama: { $regex: search, $options: 'i' } },
          { singkatan: { $regex: search, $options: 'i' } },
        ],
      }
    : {};

async function fetchFromMongo(type, search = '', filters = {}, valueMode = SEGMENT_VALUE_MODE) {
  const conn = await getSsoDb();
  if (!conn) return [];

  const models = {
    unitkerja: conn.model('UnitKerja', schemas.unitkerja),
    homebase: conn.model('Homebase', schemas.homebase),
    subhomebase: conn.model('SubHomebase', schemas.subhomebase),
  };

  const normalizedMode = normalizeValueMode(valueMode);
  const filter = buildSearchFilter(search);
  const { unitKerja, homebase } = filters;
  if (type === 'homebase' && unitKerja) {
    const resolvedUnitKerja = await resolveReferenceId(models.unitkerja, unitKerja);
    if (resolvedUnitKerja) {
      filter.unitKerja = resolvedUnitKerja;
    }
  }
  if (type === 'subhomebase' && homebase) {
    const resolvedHomebase = await resolveReferenceId(models.homebase, homebase);
    if (resolvedHomebase) {
      filter.homebase = resolvedHomebase;
    }
  }
  if (type === 'unitkerja') {
    const records = await models.unitkerja.find(filter).sort({ nama: 1 }).limit(100).lean();
    const items = records.map((item) => ({
      id: pickValue(item, normalizedMode),
      text: pickText(item, normalizedMode),
      nama: item.nama || '',
      singkatan: item.singkatan || '',
    }));
    return normalizeItems(items);
  }

  if (type === 'homebase') {
    const records = await models.homebase
      .find(filter)
      .populate('unitKerja')
      .sort({ nama: 1 })
      .limit(100)
      .lean();
    const items = records.map((item) => ({
      id: pickValue(item, normalizedMode),
      text: pickText(item, normalizedMode),
      nama: item.nama || '',
      singkatan: item.singkatan || '',
    }));
    return normalizeItems(items);
  }

  if (type === 'subhomebase') {
    const records = await models.subhomebase
      .find(filter)
      .populate({ path: 'homebase', populate: { path: 'unitKerja' } })
      .sort({ nama: 1 })
      .limit(100)
      .lean();
    const items = records.map((item) => ({
      id: pickValue(item, normalizedMode),
      text: pickText(item, normalizedMode),
      nama: item.nama || '',
      singkatan: item.singkatan || '',
    }));
    return normalizeItems(items);
  }

  return [];
}
// --- end local Mongo fallback ---

function normalizeItems(items = []) {
  const list = Array.isArray(items) ? items : [items];
  return list
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string' || typeof item === 'number') {
        return { id: String(item), text: String(item) };
      }

      const id =
        item.id ||
        item._id ||
        item.kode ||
        item.code ||
        item.value ||
        item.name ||
        item.nama;
      const text =
        item.text ||
        item.nama ||
        item.name ||
        item.label ||
        item.deskripsi ||
        item.description ||
        id;

      if (!id || !text) return null;
      const normalized = { id: String(id), text: String(text) };
      if (item.nama) normalized.nama = String(item.nama);
      if (item.singkatan) normalized.singkatan = String(item.singkatan);
      return normalized;
    })
    .filter(Boolean);
}

function filterFallback(type, search = '') {
  const pool = FALLBACKS[type] || [];
  const keyword = (search || '').toLowerCase();
  const filtered = keyword
    ? pool.filter((item) => item.toLowerCase().includes(keyword))
    : pool;
  return normalizeItems(filtered);
}

function extractResponseData(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw.items && Array.isArray(raw.items)) return raw.items;
  if (raw.results && Array.isArray(raw.results)) return raw.results;
  if (raw.data && Array.isArray(raw.data)) return raw.data;
  if (raw.data && typeof raw.data === 'object') return raw.data;
  return raw;
}

async function fetchSegmenOptions(type, search = '', authToken, filters = {}, options = {}) {
  const normalizedType = (type || '').toLowerCase();
  const endpoint = ENDPOINTS[normalizedType];
  const valueMode = normalizeValueMode(options.valueMode || SEGMENT_VALUE_MODE);

  if (!SEGMENT_SSO_BASE_URL || !endpoint) {
    return filterFallback(normalizedType, search);
  }

  const url = new URL(endpoint, SEGMENT_SSO_BASE_URL).toString();
  const payload = encryptPayload({
    search,
    unitKerja: filters.unitKerja,
    homebase: filters.homebase,
    valueMode,
  });
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (process.env.SEGMENT_ENCRYPTION_SECRET || process.env.SEGMENT_SHARED_SECRET) {
    // fallback: use shared secret header to bypass JWT requirement on SSO
    headers['x-segment-shared-secret'] =
      process.env.SEGMENT_SHARED_SECRET || process.env.SEGMENT_ENCRYPTION_SECRET;
  }

  try {
    const response = await axios.post(url, payload, {
      headers,
      timeout: SEGMENT_SSO_TIMEOUT,
    });

    const decrypted = decryptPayload(response.data);
    const raw = decrypted?.data || decrypted || response.data;
    const items = extractResponseData(raw);

    const normalized = normalizeItems(items);
    return normalized;
  } catch (err) {
    const status = err.response?.status;
    const messageFromSso = err.response?.data?.message || err.response?.data?.error;

    // Fallback ke DB langsung jika tersedia
    try {
      const mongoResults = await fetchFromMongo(normalizedType, search, filters, valueMode);
      if (mongoResults.length) return mongoResults;
    } catch (mongoErr) {
      // ignore and continue to default fallback
    }

    if (status === 401 || status === 403) {
      const error = new Error(messageFromSso || 'Tidak diizinkan mengakses master SSO');
      error.status = status;
      throw error;
    }

    // Log kegagalan lain agar tidak diam-diam hilang
    console.error('Segmen SSO request failed:', messageFromSso || err.message || err);
    return filterFallback(normalizedType, search);
  }
}

module.exports = {
  fetchSegmenOptions,
};
