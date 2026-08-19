const { SSO_BASE_URL, getAppBaseUrl } = require('./ssoClient');

const cleanUrl = (url = '') => url.trim().replace(/\/+$/, '');

const parseAppsFromEnv = () => {
  const raw = process.env.SSO_APP_LINKS || '';

  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url, description, icon] = entry.split('|').map((part) => part && part.trim());
      if (!name || !url) return null;

      return {
        name,
        url,
        description,
        icon,
      };
    })
    .filter(Boolean);
};

const buildDefaultApps = (req) => {
  const defaults = [];
  const currentBase = getAppBaseUrl(req);

  if (SSO_BASE_URL) {
    defaults.push({
      name: 'Portal SSO',
      url: SSO_BASE_URL,
      description: 'Kelola sesi & akun SSO',
      icon: 'ti ti-lock',
    });
  }

  if (currentBase) {
    defaults.push({
      name: 'S.UNJANI',
      url: currentBase,
      description: 'Shortlink & QR',
      icon: 'ti ti-link',
    });
  }

  const ourSisfoUrl = process.env.OURSISFO_APP_URL || process.env.OURSISFO_BASE_URL;
  if (ourSisfoUrl) {
    defaults.push({
      name: 'OurSISFO',
      url: ourSisfoUrl,
      description: 'Halaman utama OurSISFO',
      icon: 'ti ti-world',
    });
  }

  const noregUrl = process.env.NOREG_APP_URL;
  if (noregUrl) {
    defaults.push({
      name: 'Noreg',
      url: noregUrl,
      description: 'Registrasi yang terhubung SSO',
      icon: 'ti ti-id',
    });
  }

  return defaults;
};

const dedupeAndFilter = (apps, currentBase) => {
  const seen = new Set();
  const current = cleanUrl(currentBase);

  return apps
    .filter(Boolean)
    .map((app) => ({
      ...app,
      url: cleanUrl(app.url),
      icon: app.icon || 'ti ti-external-link',
    }))
    .filter((app) => app.name && app.url)
    .filter((app) => {
      const key = `${app.name}|${app.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((app) => app.url && app.url !== current);
};

const normalizeUserApps = (apps = []) =>
  apps
    .filter(Boolean)
    .map((app) => ({
      name: app.name || app.title || app.clientName,
      url: app.url || app.homeUrl || app.link || '',
      description: app.description || app.desc || '',
      icon: app.icon || app.iconClass || '',
    }))
    .filter((app) => app.name && app.url);

const getSsoAppLinks = (req, { userApps = [], tokenApps = [], includeCurrent = false } = {}) => {
  const fromEnv = parseAppsFromEnv();
  const defaults = buildDefaultApps(req);
  const currentBase = getAppBaseUrl(req);
  const merged = [
    ...fromEnv,
    ...normalizeUserApps(tokenApps),
    ...normalizeUserApps(userApps),
    ...defaults,
  ];

  return dedupeAndFilter(merged, includeCurrent ? null : currentBase);
};

module.exports = {
  getSsoAppLinks,
};
