const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { resolveFromAssets } = require('../utils/paths');

const ensureQrDir = async () => {
  const dir = resolveFromAssets('qr-codes');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const sanitizeHex = (value, fallback) => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#?[0-9a-fA-F]{3,8}$/.test(trimmed.replace('#', ''))
    ? (trimmed.startsWith('#') ? trimmed : `#${trimmed}`)
    : fallback;
};

const buildColors = (options = {}) => {
  const foreground = sanitizeHex(options.foregroundColor, '#111827');
  const bg = sanitizeHex(options.backgroundColor, '#ffffff');
  const alpha = typeof options.backgroundAlpha === 'number' ? Math.min(Math.max(options.backgroundAlpha, 0), 1) : 1;
  const background = alpha < 1 ? `${bg}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : bg;
  return { foreground, background };
};

const createSlug = (value) => value || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const buildFileMeta = async (slug) => {
  const qrDir = await ensureQrDir();
  const fileName = `${slug}.png`;
  const filePath = path.join(qrDir, fileName);
  return {
    fileName,
    filePath,
    fileUrl: `/assets/qr-codes/${fileName}`,
  };
};

const parsePreviewDataUrl = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer };
};

/**
 * Generate QR image buffer using basic styling (color, margin, logo, frame text).
 * Shape/eye styles are stored but not rendered by qrcode lib; a more advanced
 * renderer can later replace this function using the same payload.
 */
const generateQrBuffer = async ({ text, options = {}, logoPath }) => {
  const size = Number.parseInt(options.size, 10) || 600;
  const margin = Number.parseInt(options.margin, 10);
  const errorCorrectionLevel = options.errorCorrection || 'H';
  const { foreground, background } = buildColors(options);

  const qrBuffer = await QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel,
    margin: Number.isFinite(margin) ? margin : 4,
    width: size,
    color: {
      dark: foreground,
      light: background,
    },
  });

  let image = sharp(qrBuffer).resize(size, size, { fit: 'contain' });

  if (logoPath) {
    try {
      const logoSizeFraction = options.logoSize && options.logoSize > 0 && options.logoSize < 1 ? options.logoSize : 0.2;
      const logoMargin = Number.isFinite(options.logoMargin) ? options.logoMargin : 8;
      const logoResize = Math.round(size * logoSizeFraction);
      const logoBuffer = await sharp(logoPath).resize(logoResize, logoResize, { fit: 'contain' }).png().toBuffer();
      const compositeLogo = { input: logoBuffer, gravity: 'center' };
      if (logoMargin > 0) {
        compositeLogo.top = logoMargin;
        compositeLogo.left = logoMargin;
      }
      image = image.composite([compositeLogo]);
    } catch (err) {
      // If logo processing fails, continue with QR only
      console.error('Failed to add logo to QR:', err.message || err);
    }
  }

  const framePadding = Number.isFinite(options.framePadding) ? options.framePadding : 16;
  const frameText = options.frameText ? options.frameText.toString() : '';
  const frameColor = sanitizeHex(options.frameColor, '#ffffff');

  if (options.frameStyle !== 'none' || frameText) {
    const textSize = Number.isFinite(options.frameTextSize) ? options.frameTextSize : 18;
    const totalPadTop = framePadding;
    const totalPadBottom = frameText ? framePadding + textSize + 12 : framePadding;
    const totalPadLeft = framePadding;
    const totalPadRight = framePadding;

    const { width, height } = await image.metadata();
    const svgText = frameText
      ? `<svg width="${width + totalPadLeft + totalPadRight}" height="${textSize + 12}">
          <style>
            .label { fill: #111827; font-family: ${options.frameTextFont || 'Inter, Arial, sans-serif'}; font-size: ${textSize}px; font-weight: 600; }
          </style>
          <text x="50%" y="${textSize}" text-anchor="middle" class="label">${frameText}</text>
        </svg>`
      : null;

    const overlays = [];
    if (svgText) {
      overlays.push({
        input: Buffer.from(svgText),
        top: height + totalPadTop,
        left: 0,
      });
    }

    image = image
      .extend({
        top: totalPadTop,
        bottom: totalPadBottom,
        left: totalPadLeft,
        right: totalPadRight,
        background: frameColor,
      })
      .composite(overlays);
  }

  return image.png().toBuffer();
};

const generateAndSaveQr = async ({ text, options = {}, logoPath }) => {
  const slug = createSlug(options.slug);
  const fileMeta = await buildFileMeta(slug);
  const buffer = await generateQrBuffer({ text, options, logoPath });
  await fs.writeFile(fileMeta.filePath, buffer);
  return {
    ...fileMeta,
  };
};

const savePreviewFromDataUrl = async ({ dataUrl, slug }) => {
  const parsed = parsePreviewDataUrl(dataUrl);
  if (!parsed || !parsed.buffer?.length) {
    throw new Error('Preview QR tidak valid.');
  }

  const safeSlug = createSlug(slug);
  const fileMeta = await buildFileMeta(safeSlug);

  let bufferToWrite = parsed.buffer;
  try {
    // Normalisasi ke PNG untuk konsistensi file output
    bufferToWrite = await sharp(parsed.buffer).png().toBuffer();
  } catch (err) {
    // Jika gagal konversi, gunakan buffer asli agar tidak blok penyimpanan
    console.error('Failed to normalize preview image:', err.message || err);
  }

  await fs.writeFile(fileMeta.filePath, bufferToWrite);
  return {
    ...fileMeta,
  };
};

module.exports = {
  generateAndSaveQr,
  savePreviewFromDataUrl,
};
