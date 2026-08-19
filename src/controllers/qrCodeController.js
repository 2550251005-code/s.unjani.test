const asyncHandler = require('express-async-handler');
const fs = require('fs/promises');
const QrCode = require('../models/QrCode');
const { generateAndSaveQr, savePreviewFromDataUrl } = require('../services/qrCodeGenerator');
const { resolveFromAssets } = require('../utils/paths');

const normalizeString = (value, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback;

const toNumber = (val, fallback) => {
  const num = Number.parseFloat(val);
  return Number.isFinite(num) ? num : fallback;
};

const buildOptions = (body, logoPath) => {
  const {
    size,
    resolution,
    margin,
    errorCorrection,
    style,
    innerEyeStyle,
    outerEyeStyle,
    foregroundType,
    foregroundColor,
    backgroundColor,
    backgroundAlpha,
    frameStyle,
    frameColor,
    frameText,
    frameTextFont,
    frameTextSize,
    framePadding,
    logoSize,
    logoMargin,
  } = body;

  return {
    size: toNumber(size, 600),
    resolution: toNumber(resolution, 600),
    margin: toNumber(margin, 4),
    errorCorrection: ['L', 'M', 'Q', 'H'].includes(errorCorrection) ? errorCorrection : 'H',
    style: normalizeString(style, 'square'),
    innerEyeStyle: normalizeString(innerEyeStyle, 'square'),
    outerEyeStyle: normalizeString(outerEyeStyle, 'square'),
    foregroundType: ['color', 'gradient'].includes(foregroundType) ? foregroundType : 'color',
    foregroundColor: normalizeString(foregroundColor, '#111827'),
    backgroundColor: normalizeString(backgroundColor, '#ffffff'),
    backgroundAlpha: toNumber(backgroundAlpha, 1),
    frameStyle: normalizeString(frameStyle, 'none'),
    frameColor: normalizeString(frameColor, '#ffffff'),
    frameText: normalizeString(frameText, ''),
    frameTextFont: normalizeString(frameTextFont, 'Inter, Arial, sans-serif'),
    frameTextSize: toNumber(frameTextSize, 18),
    framePadding: toNumber(framePadding, 16),
    logoPath: logoPath || '',
    logoSize: toNumber(logoSize, 0.2),
    logoMargin: toNumber(logoMargin, 8),
  };
};

const DEFAULT_OPTIONS = {
  size: 600,
  resolution: 600,
  margin: 4,
  errorCorrection: 'H',
  style: 'square',
  innerEyeStyle: 'square',
  outerEyeStyle: 'square',
  foregroundType: 'color',
  foregroundColor: '#111827',
  backgroundColor: '#ffffff',
  backgroundAlpha: 1,
  frameStyle: 'none',
  frameColor: '#ffffff',
  frameText: '',
  frameTextFont: 'Inter, Arial, sans-serif',
  frameTextSize: 18,
  framePadding: 16,
  logoPath: '',
  logoSize: 0.2,
  logoMargin: 8,
};

const mapResponse = (record) => {
  const opts = { ...DEFAULT_OPTIONS, ...(record.options || {}) };
  return {
    id: record._id,
    name: record.name,
    url: record.url,
    fileUrl: record.fileUrl,
    fileName: record.fileName,
    options: opts,
    role: record.role,
    owner: record.owner,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

const formatDate = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const removeQrFile = async (fileName) => {
  if (!fileName) return;
  const filePath = resolveFromAssets('qr-codes', fileName);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Gagal menghapus file QR:', err.message || err);
    }
  }
};

const createQrCode = asyncHandler(async (req, res) => {
  const name = normalizeString(req.body.name);
  const url = normalizeString(req.body.url);
  if (!name || !url) {
    return res.status(400).json({ error: 'Nama dan URL wajib diisi.' });
  }

  const logoPath = req.file ? req.file.path : '';
  const previewDataUrl = normalizeString(req.body.previewImage);
  const options = buildOptions(req.body, logoPath);
  options.slug = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const createPageTarget = req.user.role === 'admin' ? '/admin/qrcodes/create' : '/users/qrcodes/create';
  let generated;

  if (previewDataUrl) {
    try {
      generated = await savePreviewFromDataUrl({
        dataUrl: previewDataUrl,
        slug: options.slug,
      });
    } catch (err) {
      console.error('Failed to save preview image:', err);
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ error: 'Preview QR tidak valid. Silakan generate ulang.' });
      }
      req.flash('error_msg', 'Preview QR tidak valid. Silakan generate ulang.');
      return res.redirect(createPageTarget);
    }
  } else {
    generated = await generateAndSaveQr({
      text: url,
      options,
      logoPath: logoPath || undefined,
    });
  }

  const payload = await QrCode.create({
    name,
    url,
    fileName: generated.fileName,
    fileUrl: generated.fileUrl,
    options,
    owner: req.user.id,
    role: req.user.role === 'admin' ? 'admin' : 'user',
  });

  const data = mapResponse(payload);
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(201).json({ data });
  }

  req.flash('success_msg', 'QR Code berhasil dibuat.');
  const redirectTarget = req.user.role === 'admin' ? '/admin/qrcodes' : '/users/qrcodes';
  return res.redirect(redirectTarget);
});

const listAdminData = asyncHandler(async (req, res) => {
  const records = await QrCode.find({}).sort({ createdAt: -1 }).lean();
  return res.json({ data: records.map(mapResponse) });
});

const listUserData = asyncHandler(async (req, res) => {
  const records = await QrCode.find({ owner: req.user.id }).sort({ createdAt: -1 }).lean();
  return res.json({ data: records.map(mapResponse) });
});

const getOne = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = await QrCode.findById(id).lean();
  if (!record) {
    return res.status(404).json({ error: 'QR Code tidak ditemukan.' });
  }
  if (req.user.role !== 'admin' && record.owner.toString() !== req.user.id.toString()) {
    return res.status(403).json({ error: 'Tidak memiliki akses ke QR Code ini.' });
  }
  return res.json({ data: mapResponse(record) });
});

const renderAdminPage = asyncHandler(async (req, res) => {
  const records = await QrCode.find({}).sort({ createdAt: -1 }).lean();
  const qrcodes = records.map((item) => ({
    ...mapResponse(item),
    createdAtLabel: formatDate(item.createdAt),
  }));
  res.render('admin/qrcodes', {
    user: req.user,
    title: 'admin qrcodes',
    qrcodes,
    success_msg: req.flash('success_msg'),
    error_msg: req.flash('error_msg'),
  });
});

const renderUserPage = asyncHandler(async (req, res) => {
  const records = await QrCode.find({ owner: req.user.id }).sort({ createdAt: -1 }).lean();
  const qrcodes = records.map((item) => ({
    ...mapResponse(item),
    createdAtLabel: formatDate(item.createdAt),
  }));
  res.render('user/qrcodes', {
    user: req.user,
    title: 'qrcodes',
    qrcodes,
    defaults: DEFAULT_OPTIONS,
    success_msg: req.flash('success_msg'),
    error_msg: req.flash('error_msg'),
  });
});

const renderAdminCreatePage = asyncHandler(async (req, res) => {
  res.render('admin/qrcodes-add', {
    user: req.user,
    title: 'admin qrcodes add',
    defaults: DEFAULT_OPTIONS,
    success_msg: req.flash('success_msg'),
    error_msg: req.flash('error_msg'),
  });
});

const renderUserCreatePage = asyncHandler(async (req, res) => {
  res.render('user/qrcodes-add', {
    user: req.user,
    title: 'qrcodes add',
    defaults: DEFAULT_OPTIONS,
    success_msg: req.flash('success_msg'),
    error_msg: req.flash('error_msg'),
  });
});

const updateQrCode = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const name = normalizeString(req.body.name);
  const url = normalizeString(req.body.url);

  if (!name || !url) {
    return res.status(400).json({ error: 'Nama dan URL wajib diisi.' });
  }

  const record = await QrCode.findById(id);
  if (!record) {
    return res.status(404).json({ error: 'QR Code tidak ditemukan.' });
  }
  if (req.user.role !== 'admin' && record.owner.toString() !== req.user.id.toString()) {
    return res.status(403).json({ error: 'Tidak memiliki akses ke QR Code ini.' });
  }

  const options = { ...DEFAULT_OPTIONS, ...(record.options || {}) };
  const slug = record.fileName ? record.fileName.replace(/\.png$/i, '') : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const generated = await generateAndSaveQr({
    text: url,
    options: { ...options, slug },
    logoPath: options.logoPath || undefined,
  });

  if (record.fileName && record.fileName !== generated.fileName) {
    await removeQrFile(record.fileName);
  }

  record.name = name;
  record.url = url;
  record.fileName = generated.fileName;
  record.fileUrl = generated.fileUrl;
  record.options = options;
  await record.save();

  return res.json({ success_msg: 'QR Code berhasil diperbarui.', data: mapResponse(record) });
});

const deleteQrCode = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = await QrCode.findById(id);
  if (!record) {
    return res.status(404).json({ error: 'QR Code tidak ditemukan.' });
  }
  if (req.user.role !== 'admin' && record.owner.toString() !== req.user.id.toString()) {
    return res.status(403).json({ error: 'Tidak memiliki akses ke QR Code ini.' });
  }

  await QrCode.deleteOne({ _id: id });
  await removeQrFile(record.fileName);

  return res.json({ success_msg: 'QR Code berhasil dihapus.' });
});

module.exports = {
  createQrCode,
  listAdminData,
  listUserData,
  getOne,
  renderAdminPage,
  renderUserPage,
  renderAdminCreatePage,
  renderUserCreatePage,
  updateQrCode,
  deleteQrCode,
};
