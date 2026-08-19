const axios = require('axios');
const { SSO_BASE_URL } = require('../utils/ssoClient');

const mapSsoAppToLink = (app = {}) => {
  const url =
    app.homeUrl ||
    (Array.isArray(app.allowedOrigins) && app.allowedOrigins.find(Boolean)) ||
    (Array.isArray(app.redirectUris) && app.redirectUris.find(Boolean)) ||
    '';

  if (!url) return null;

  return {
    name: app.name || url,
    url,
    description: app.description || '',
    icon: app.icon || 'ti ti-apps',
  };
};

const fetchAccessibleApps = async ({ token }) => {
  if (!SSO_BASE_URL || !token) return [];

  try {
    const url = new URL('/api/apps', SSO_BASE_URL).toString();
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
      withCredentials: true,
    });

    const apps = response?.data?.applications || [];
    return apps.map(mapSsoAppToLink).filter(Boolean);
  } catch (err) {
    return [];
  }
};

module.exports = {
  fetchAccessibleApps,
};
