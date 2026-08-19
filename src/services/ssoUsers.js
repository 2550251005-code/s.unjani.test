const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { SSO_BASE_URL } = require('../utils/ssoClient');

const DEFAULT_TIMEOUT = parseInt(process.env.SSO_USERS_TIMEOUT || '6000', 10);
const DEFAULT_AVATAR_PATH = '/public/assets/images/profile/user-1.jpg';

const trim = (value) => (value == null ? '' : String(value).trim());
const normalizePathFragment = (value = '') => trim(value).replace(/\\/g, '/').replace(/^\/+/, '');
const toAbsoluteSsoUrl = (value = '') => {
  const normalized = trim(value);
  if (!normalized || !SSO_BASE_URL) return '';
  try {
    return new URL(normalized, SSO_BASE_URL).toString();
  } catch (err) {
    return '';
  }
};
const resolveUploadedPhotoUrl = (value = '') => {
  const normalized = normalizePathFragment(value);
  if (!normalized.startsWith('uploads/profile/')) {
    return '';
  }
  return toAbsoluteSsoUrl(`/${normalized}`);
};

const normalizeUser = (raw = {}) => {
  const source = raw.user ? raw.user : raw;
  const id = trim(source.id || source._id);
  const role = (trim(source.role || 'user') || 'user').toLowerCase();
  const foto = trim(source.foto || '');
  const fotoUrlRaw = trim(source.fotoUrl || source.avatarUrl || '');
  const fotoUrl = /^https?:\/\//i.test(fotoUrlRaw)
    ? fotoUrlRaw
    : toAbsoluteSsoUrl(fotoUrlRaw) || resolveUploadedPhotoUrl(foto);
  const avatarUrl = fotoUrl || DEFAULT_AVATAR_PATH;

  return {
    id,
    _id: id,
    name: trim(source.name || '-'),
    email: trim(source.email || ''),
    role,
    nomorInduk: trim(source.nomorInduk || ''),
    type: trim(source.type || 'Tendik') || 'Tendik',
    jabatan: source.jabatan || {},
    jabatanFungsional: trim(source.jabatanFungsional || ''),
    dosenProdi: trim(source.dosenProdi || ''),
    foto,
    fotoUrl,
    avatarUrl,
    applications: Array.isArray(source.applications) ? source.applications : [],
    forcePasswordReset: Boolean(source.forcePasswordReset),
    emailVerified: source.emailVerified,
    timeStamp: source.timeStamp || source.createdAt || null,
  };
};

const toHeaders = (token) => {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const request = async ({ method = 'get', url, token, params, data, headers }) => {
  if (!SSO_BASE_URL) {
    throw new Error('SSO_BASE_URL belum dikonfigurasi');
  }

  const response = await axios({
    method,
    url,
    headers: {
      ...toHeaders(token),
      ...(headers || {}),
    },
    params,
    data,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true,
  });

  return response.data;
};

const fetchCurrentUser = async (token) => {
  const url = new URL('/api/users/me', SSO_BASE_URL).toString();
  const data = await request({ url, token });
  return normalizeUser(data);
};

const fetchUserById = async (token, id) => {
  const userId = trim(id);
  if (!userId) return null;

  const url = new URL(`/api/users/${encodeURIComponent(userId)}`, SSO_BASE_URL).toString();
  const data = await request({ url, token });
  return normalizeUser(data);
};

const fetchUsersByIds = async (token, ids = []) => {
  const unique = Array.from(new Set((ids || []).map(trim).filter(Boolean)));
  if (!unique.length) return {};

  const cache = {};
  await Promise.all(
    unique.map(async (id) => {
      try {
        const user = await fetchUserById(token, id);
        cache[id] = user;
      } catch (err) {
        cache[id] = null;
      }
    }),
  );

  return cache;
};

const updateCurrentUserProfile = async (token, payload = {}) => {
  const url = new URL('/api/users/me/profile', SSO_BASE_URL).toString();
  const data = await request({
    method: 'patch',
    url,
    token,
    data: payload,
  });
  return normalizeUser(data);
};

const changeCurrentUserPassword = async (token, payload = {}) => {
  const url = new URL('/api/users/me/password', SSO_BASE_URL).toString();
  const data = await request({
    method: 'patch',
    url,
    token,
    data: payload,
  });
  return normalizeUser(data);
};

const updateCurrentUserPhoto = async (token, file) => {
  if (!file) {
    throw new Error('File foto tidak ditemukan');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API tidak tersedia di runtime ini');
  }

  const url = new URL('/api/users/me/photo', SSO_BASE_URL).toString();
  const fileBuffer = file.buffer || await fs.promises.readFile(file.path);
  const fileName = trim(file.originalname || path.basename(file.path || '') || 'photo.jpg');
  const mimeType = trim(file.mimetype || 'application/octet-stream');

  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer], { type: mimeType }), fileName);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: toHeaders(token),
    body: formData,
  });

  let data = {};
  try {
    data = await response.json();
  } catch (err) {
    data = {};
  }

  if (!response.ok) {
    const message = trim(data?.message || '') || 'Gagal memperbarui foto profil di SSO.';
    const error = new Error(message);
    error.response = {
      status: response.status,
      data,
    };
    throw error;
  }

  return normalizeUser(data);
};

module.exports = {
  normalizeUser,
  fetchCurrentUser,
  fetchUserById,
  fetchUsersByIds,
  updateCurrentUserProfile,
  changeCurrentUserPassword,
  updateCurrentUserPhoto,
};
