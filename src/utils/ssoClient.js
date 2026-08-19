const axios = require('axios');
const crypto = require('crypto');

const DEFAULT_PORT = process.env.PORT || 8235;
const SSO_BASE_URL = process.env.SSO_BASE_URL || process.env.SSO_HOST || '';
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || process.env.SSO_CLIENTID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SSO_REDIRECT_PATH = process.env.SSO_REDIRECT_PATH || '/auth/sso/callback';
const SSO_COOKIE_NAME = 'jwt';
const trustedOriginsRaw = process.env.SSO_TRUSTED_ORIGINS || '';
const PKCE_SESSION_KEY = 'ssoPkce';
const PKCE_TTL_MS = Math.max(parseInt(process.env.SSO_PKCE_TTL_MS || '600000', 10), 60000);

const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));
const toOrigin = (value = '') => {
  try {
    return new URL(value).origin.toLowerCase();
  } catch (err) {
    return '';
  }
};

const sanitizeReturnTo = (value, fallback = '/users') => {
  const safeFallback =
    typeof fallback === 'string' && fallback.startsWith('/') && !fallback.startsWith('//')
      ? fallback
      : '/users';
  if (typeof value !== 'string') return safeFallback;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return safeFallback;
  return trimmed;
};

const isDashboardState = (state) => (state || '').toString().trim().toLowerCase() === 'dashboard';

const resolveTrustedOrigins = () => {
  const configured = trustedOriginsRaw
    .split(',')
    .map((item) => item.trim())
    .map((item) => toOrigin(item))
    .filter(Boolean);
  const ssoOrigin = toOrigin(SSO_BASE_URL);
  return unique([ssoOrigin, ...configured]);
};

const getRequestOrigin = (req) => {
  const candidates = [req?.headers?.origin, req?.headers?.referer, req?.headers?.referrer];
  for (const candidate of candidates) {
    const origin = toOrigin(candidate || '');
    if (origin) return origin;
  }
  return '';
};

const isTrustedSsoOrigin = (req) => {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) return false;
  return resolveTrustedOrigins().includes(requestOrigin);
};

const isSsoEnabled = () =>
  Boolean(SSO_BASE_URL && SSO_CLIENT_ID && SSO_CLIENT_SECRET);

const getAppBaseUrl = (req) => {
  if (process.env.SSO_APP_BASE_URL) return process.env.SSO_APP_BASE_URL;
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (req && req.protocol && req.get) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return `http://localhost:${DEFAULT_PORT}`;
};

const getRedirectUri = (req) => process.env.SSO_REDIRECT_URI || `${getAppBaseUrl(req)}${SSO_REDIRECT_PATH}`;

const buildAuthorizeUrl = (req, state, options = {}) => {
  if (!isSsoEnabled()) return null;
  try {
    const url = new URL('/oauth/authorize', SSO_BASE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', SSO_CLIENT_ID);
    url.searchParams.set('redirect_uri', getRedirectUri(req));
    const codeChallenge = (options.codeChallenge || '').toString().trim();
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  } catch (err) {
    return null;
  }
};

const exchangeCodeForToken = async ({ code, req, codeVerifier }) => {
  const verifier = (codeVerifier || '').toString().trim();
  if (!verifier) {
    throw new Error('PKCE code_verifier tidak ditemukan');
  }

  const tokenUrl = `${SSO_BASE_URL}/oauth/token`;
  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(req),
    client_id: SSO_CLIENT_ID,
    client_secret: SSO_CLIENT_SECRET,
    code_verifier: verifier,
  });

  const response = await axios.post(tokenUrl, payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    withCredentials: true,
  });

  return response.data;
};

const encodeState = (payload = {}) => Buffer.from(JSON.stringify(payload)).toString('base64url');
const decodeState = (state) => {
  if (!state || typeof state !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
};

const cleanupPkceSession = (req) => {
  if (!req?.session) return;

  const store = req.session[PKCE_SESSION_KEY];
  if (!store || typeof store !== 'object') {
    req.session[PKCE_SESSION_KEY] = {};
    return;
  }

  const now = Date.now();
  Object.entries(store).forEach(([nonce, entry]) => {
    const createdAt = Number(entry?.createdAt || 0);
    if (!createdAt || now - createdAt > PKCE_TTL_MS || !entry?.codeVerifier) {
      delete store[nonce];
    }
  });
};

const createPkcePair = () => {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
  };
};

const createAuthorizeRequest = (req, options = {}) => {
  if (!isSsoEnabled()) return null;

  const returnTo = sanitizeReturnTo(options.returnTo || '/users', '/users');
  const nonce = crypto.randomBytes(16).toString('base64url');
  const pkce = createPkcePair();
  const state = encodeState({
    returnTo,
    nonce,
  });

  if (req?.session) {
    cleanupPkceSession(req);
    if (!req.session[PKCE_SESSION_KEY] || typeof req.session[PKCE_SESSION_KEY] !== 'object') {
      req.session[PKCE_SESSION_KEY] = {};
    }
    req.session[PKCE_SESSION_KEY][nonce] = {
      codeVerifier: pkce.codeVerifier,
      createdAt: Date.now(),
      returnTo,
    };
  }

  const authorizeUrl = buildAuthorizeUrl(req, state, {
    codeChallenge: pkce.codeChallenge,
  });

  if (!authorizeUrl) return null;
  return {
    authorizeUrl,
    state,
    nonce,
    returnTo,
  };
};

const consumePkceVerifier = (req, state, fallback = '/users') => {
  if (!req?.session) return null;
  cleanupPkceSession(req);

  const decodedState = decodeState(state);
  if (!decodedState || typeof decodedState !== 'object') return null;

  const nonce = (decodedState.nonce || '').toString().trim();
  if (!nonce) return null;

  const store = req.session[PKCE_SESSION_KEY];
  if (!store || typeof store !== 'object') return null;

  const entry = store[nonce];
  if (!entry || !entry.codeVerifier) return null;

  delete store[nonce];
  return {
    nonce,
    codeVerifier: entry.codeVerifier,
    returnTo: sanitizeReturnTo(decodedState.returnTo || entry.returnTo || fallback, fallback),
  };
};

const parseReturnTo = (state, fallback = '/users') => {
  const safeFallback = sanitizeReturnTo(fallback, '/users');
  if (isDashboardState(state)) {
    return safeFallback;
  }

  const decoded = decodeState(state);
  if (decoded && typeof decoded.returnTo === 'string' && decoded.returnTo.trim()) {
    return sanitizeReturnTo(decoded.returnTo, safeFallback);
  }

  if (state) {
    return sanitizeReturnTo(state, safeFallback);
  }

  return safeFallback;
};

const buildCookieOptions = (expiresInSeconds) => {
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };

  if (expiresInSeconds && Number.isFinite(expiresInSeconds)) {
    opts.maxAge = expiresInSeconds * 1000;
  }

  return opts;
};

const resolveReturnTo = (req) =>
  sanitizeReturnTo(
    req?.query?.returnTo ||
      req?.query?.redirect ||
      req?.query?.next ||
      (req?.body && req.body.returnTo) ||
      req?.get?.('Referer') ||
      req?.get?.('Referrer') ||
      '/users',
    '/users',
  );

module.exports = {
  SSO_BASE_URL,
  SSO_CLIENT_ID,
  SSO_CLIENT_SECRET,
  SSO_COOKIE_NAME,
  SSO_REDIRECT_PATH,
  isSsoEnabled,
  buildAuthorizeUrl,
  createAuthorizeRequest,
  consumePkceVerifier,
  exchangeCodeForToken,
  encodeState,
  decodeState,
  sanitizeReturnTo,
  isDashboardState,
  isTrustedSsoOrigin,
  parseReturnTo,
  buildCookieOptions,
  resolveReturnTo,
  getRedirectUri,
  getAppBaseUrl,
};
