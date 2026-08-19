const fs = require('fs');
const path = require('path');
const validator = require('validator');
const { resolveFromAssets } = require('./paths');

function sanitizeAlias(value) {
  if (!value) {
    return '';
  }

  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureProtocol(url) {
  if (!url) {
    return '';
  }

  const trimmed = url.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function buildLinkPayload(linkLabels, linkUrls) {
  const labels = Array.isArray(linkLabels)
    ? linkLabels
    : typeof linkLabels === 'string'
      ? [linkLabels]
      : [];
  const urls = Array.isArray(linkUrls)
    ? linkUrls
    : typeof linkUrls === 'string'
      ? [linkUrls]
      : [];

  const length = Math.max(labels.length, urls.length);
  const payload = [];

  for (let i = 0; i < length; i++) {
    const label = (labels[i] || '').trim();
    const rawUrl = (urls[i] || '').trim();

    if (!label || !rawUrl) {
      continue;
    }

    const normalizedUrl = ensureProtocol(rawUrl);

    if (!validator.isURL(normalizedUrl, { require_protocol: true })) {
      continue;
    }

    payload.push({
      label,
      url: normalizedUrl,
    });
  }

  return payload;
}

function removeUploadedFile(fileName) {
  if (!fileName) {
    return;
  }

  const uploadDir = resolveFromAssets('uploads');
  const filePath = path.join(uploadDir, fileName);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Gagal menghapus file:', error);
    }
  }
}

module.exports = {
  sanitizeAlias,
  buildLinkPayload,
  removeUploadedFile,
};
