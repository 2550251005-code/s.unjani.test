const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fsX = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const { resolveFromAssets } = require('../utils/paths');

const Link = require('../models/Link');
const { fetchCurrentUser } = require('../services/ssoUsers');

const RESERVED_ALIAS = ['admin', 'users', 'about', 'apps', 'contact', 'feedback'];

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
};

const resolveRequestUser = async (req) => {
  const bearer = getBearerToken(req);
  if (bearer) {
    const user = await fetchCurrentUser(bearer);
    if (user && user.id) {
      return { id: user.id, mode: 'bearer', token: bearer, user };
    }
  }
  return null;
};

exports.createLink = asyncHandler(async (req, res) => {
  try {
    let { link, alias, expired, referer, password, deskripsi } = req.body;
    const owner = await resolveRequestUser(req);

    if (!owner) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Gunakan Authorization Bearer token dari SSO.',
      });
    }

    if (!link || !link.trim()) {
      return res.status(400).json({ error: 'Masukan URL' });
    }

    if (!referer || !referer.trim()) {
      referer = 'direct';
    }

    if (!isValidURL(link)) {
      return res.status(400).json({ error: 'Masukan URL yang benar' });
    }

    if (alias && alias.length <= 3) {
      return res.status(400).json({ error: 'Alias minimal 3 huruf' });
    }

    if (!alias || !alias.trim()) {
      let linked;
      do {
        alias = getRandomString();
        linked = await Link.findOne({ alias });
      } while (linked || RESERVED_ALIAS.includes(alias));
    }

    alias = alias.trim();
    const validAliasPattern = /^[a-zA-Z0-9\-_.]+$/;
    if (!validAliasPattern.test(alias)) {
      return res.status(400).json({ error: 'Alias tidak valid!' });
    }

    if (RESERVED_ALIAS.includes(alias)) {
      return res.status(409).json({ error: 'Alias sudah digunakan' });
    }

    const existingLink = await Link.findOne({ alias });
    if (existingLink) {
      return res.status(409).json({ error: 'Alias sudah digunakan' });
    }

    const hashPass = await hashPassword(password);
    link = checkAndAddProtocol(link);
    const favicon = await downloadFavicon(link, alias);

    const qrDir = resolveFromAssets('images', 'qr');
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }

    const shortUrl = `https://s.unjani.ac.id/${alias}`;
    await generateQRCodeWithLogo(
      shortUrl,
      resolveFromAssets('images', 'logos', 'logo qr.png'),
      resolveFromAssets('qr', `${alias}.png`),
    );

    const shortLink = new Link({
      link,
      alias,
      user_id: owner.id,
      dateExpired: expired,
      referer,
      password: hashPass,
      deskripsi,
      favicon,
      updateBy: owner.id,
      qrCode: `${alias}.png`,
    });

    await shortLink.save();

    return res.status(201).json({
      message: 'Shortlink berhasil dibuat',
      authMode: owner.mode,
      shortlink: shortUrl,
    });
  } catch (error) {
    console.error('Error dalam createLink:', error);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server',
      details: error.message,
    });
  }
});

async function generateQRCodeWithLogo(text, logoPath, outputPath) {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const qrCodeBuffer = await QRCode.toBuffer(text, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 300,
    margin: 2,
  });

  const logo = await sharp(logoPath)
    .resize({ width: 75, height: 75 })
    .toBuffer();

  const finalImage = await sharp(qrCodeBuffer)
    .composite([{ input: logo, gravity: 'center' }])
    .toBuffer();

  await sharp(finalImage).toFile(outputPath);
}

function isValidURL(url) {
  const pattern = new RegExp(
    '^(https?:\\/\\/)?' +
      '((([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,6})|' +
      '([0-9]{1,3}\\.){3}[0-9]{1,3})' +
      '(\\:[0-9]{1,5})?' +
      '(\\/[-a-zA-Z0-9@:%._\\+~#?&//=]*)?' +
      '(\\?[;&a-zA-Z0-9%_\\+.~#?&//=]*)?' +
      '(\\#[-a-zA-Z0-9@:%_\\+.~#?&//=]*)?$',
    'i',
  );
  return pattern.test(url);
}

function getRandomString() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456-_';
  const minLength = 3;
  const maxLength = 10;
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

  let randomString = '';
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomString += characters[randomIndex];
  }

  return randomString;
}

function checkAndAddProtocol(link) {
  if (!/^https?:\/\//i.test(link)) {
    return `https://${link}`;
  }
  return link;
}

async function hashPassword(password) {
  if (!password) return '';
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function downloadFavicon(websiteUrl, alias) {
  try {
    const faviconUrl = `${websiteUrl}/favicon.ico`;
    const response = await axios({
      url: faviconUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 5000,
    });

    const folderPath = resolveFromAssets('images', 'favico');
    const filePath = path.join(folderPath, `${alias}.ico`);
    await fsX.ensureDir(folderPath);

    const writer = fsX.createWriteStream(filePath);
    response.data.pipe(writer);

    return await new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(`${alias}.ico`));
      writer.on('error', (err) => reject(err));
    });
  } catch (error) {
    console.error('Terjadi kesalahan saat mengambil favicon:', error.message);
    return null;
  }
}
