const crypto = require('crypto');

const SECRET_SOURCE =
  process.env.SEGMENT_ENCRYPTION_SECRET ||
  process.env.SEGMENT_SHARED_SECRET ||
  process.env.JWT_SECRET || // align with SSO fallback
  process.env.SSO_CLIENT_SECRET ||
  'sunjani-segmen-fallback';

const buildKey = () => crypto.createHash('sha256').update(String(SECRET_SOURCE)).digest();

function encryptPayload(payload = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', buildKey(), iv);
  const serialized = JSON.stringify({
    ...payload,
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });

  let encrypted = cipher.update(serialized, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');

  return {
    payload: encrypted,
    iv: iv.toString('base64'),
    tag,
  };
}

function decryptPayload(data) {
  if (!data || !data.payload || !data.iv || !data.tag) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      buildKey(),
      Buffer.from(data.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));

    let decrypted = decipher.update(data.payload, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

module.exports = {
  encryptPayload,
  decryptPayload,
};
