const {
  createAuthorizeRequest,
  isSsoEnabled,
  SSO_COOKIE_NAME,
  SSO_BASE_URL,
} = require('../utils/ssoClient');
const { fetchCurrentUser } = require('../services/ssoUsers');

const COOKIE_NAME = SSO_COOKIE_NAME || 'jwt';

const wantsJson = (req) => req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));

const getTokenFromRequest = (req) => {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  return null;
};

const getAbsoluteReturnTo = (req) => {
  if (!req || !req.get) return '/';
  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}${req.originalUrl || '/'}`;
};

const buildSsoForceResetUrl = (req) => {
  if (!SSO_BASE_URL) return '/login';
  try {
    const url = new URL('/force-reset', SSO_BASE_URL);
    url.searchParams.set('returnTo', getAbsoluteReturnTo(req));
    return url.toString();
  } catch (err) {
    return '/login';
  }
};

const redirectToLogin = (req, res, message) => {
  if (!isSsoEnabled()) {
    const configMsg = 'SSO belum dikonfigurasi dengan benar di aplikasi ini.';
    if (wantsJson(req)) {
      return res.status(503).json({
        errors: [{ msg: configMsg }],
      });
    }
    req.flash('error_msg', configMsg);
    return res.status(503).redirect('/login');
  }

  const authorizeRequest = createAuthorizeRequest(req, { returnTo: req.originalUrl || '/' });
  const ssoUrl = authorizeRequest?.authorizeUrl;

  if (message) {
    req.flash('error_msg', message);
  }

  if (wantsJson(req)) {
    return res.status(401).json({
      errors: [{ msg: message || 'Unauthorized' }],
      redirectTo: ssoUrl || '/login',
    });
  }

  return res.redirect(ssoUrl || '/login');
};

module.exports = {
  ensureAuthenticated: async function (req, res, next) {
    const token = getTokenFromRequest(req);

    if (!token) {
      return redirectToLogin(req, res, 'No token, authorization denied');
    }

    try {
      const currentUser = await fetchCurrentUser(token);

      if (!currentUser || !currentUser.id) {
        res.clearCookie(COOKIE_NAME);
        return redirectToLogin(req, res, 'Akun tidak ditemukan di SSO.');
      }

      const role = currentUser.role || 'user';
      req.user = {
        id: currentUser.id,
        name: currentUser.name || '-',
        role,
      };
      req.currentUser = currentUser;

      if (currentUser.forcePasswordReset) {
        const redirectTo = buildSsoForceResetUrl(req);
        if (wantsJson(req)) {
          return res.status(403).json({
            errors: [{ msg: 'Password harus diperbarui sebelum melanjutkan.' }],
            redirectTo,
          });
        }
        return res.redirect(redirectTo);
      }

      return next();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        res.clearCookie(COOKIE_NAME);
        return redirectToLogin(req, res, 'Token tidak valid atau sesi habis.');
      }

      if (wantsJson(req)) {
        return res.status(503).json({
          errors: [{ msg: 'SSO sedang tidak tersedia. Coba lagi beberapa saat.' }],
        });
      }

      req.flash('error_msg', 'SSO sedang tidak tersedia. Coba lagi beberapa saat.');
      return res.status(503).redirect('/login');
    }
  },

  forwardAuthenticated: async function (req, res, next) {
    const token = getTokenFromRequest(req);

    if (!token) {
      return next();
    }

    try {
      const currentUser = await fetchCurrentUser(token);
      if (!currentUser || !currentUser.id) {
        res.clearCookie(COOKIE_NAME);
        return next();
      }

      req.currentUser = currentUser;
      req.user = {
        id: currentUser.id,
        name: currentUser.name || '-',
        role: currentUser.role || 'user',
      };

      if (currentUser.forcePasswordReset) {
        return res.redirect(buildSsoForceResetUrl(req));
      }

      if ((currentUser.role || 'user') === 'admin') {
        return res.redirect('/admin/');
      }
      return res.redirect('/users/');
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        res.clearCookie(COOKIE_NAME);
      }
      return next();
    }
  },

  ensureAdmin: async function (req, res, next) {
    if (req.currentUser && req.currentUser.role === 'admin') {
      return next();
    }
    return res.redirect('/users/');
  },

  ensureUser: async function (req, res, next) {
    if (req.currentUser && req.currentUser.role === 'user') {
      return next();
    }
    return res.redirect('/admin/');
  },
};

