const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fsX = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const mongoose = require('mongoose');
const { resolveFromAssets } = require('../utils/paths');
const {
    isSsoEnabled,
    createAuthorizeRequest,
    consumePkceVerifier,
    exchangeCodeForToken,
    buildCookieOptions,
    resolveReturnTo,
    SSO_COOKIE_NAME,
    SSO_BASE_URL,
    getAppBaseUrl,
} = require('../utils/ssoClient');
const {
    fetchCurrentUser,
    updateCurrentUserProfile,
    changeCurrentUserPassword,
    updateCurrentUserPhoto,
} = require('../services/ssoUsers');
const {
    parsePeriod,
    getOverviewAnalytics,
    getLinkAnalytics,
} = require('../services/analyticsService');

async function generateQRCodeWithLogo(text, logoPath, outputPath) {
    try {
        // Buat folder jika belum ada
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {
                recursive: true
            });
        }

        // Buat QR Code sebagai buffer gambar PNG
        const qrCodeBuffer = await QRCode.toBuffer(text, {
            errorCorrectionLevel: 'H', // Gunakan tingkat koreksi error tinggi agar tetap dapat discan
            type: 'image/png',
            width: 300,
            margin: 2
        });

        // Baca logo dan ubah ukurannya menggunakan sharp
        const logo = await sharp(logoPath)
            .resize({
                width: 100,
                height: 100
            }) // Sesuaikan ukuran logo agar pas di tengah
            .toBuffer();

        // Gabungkan QR code dan logo menggunakan sharp
        const finalImage = await sharp(qrCodeBuffer)
            .composite([{
                input: logo,
                gravity: 'center'
            }]) // Tempatkan logo di tengah
            .toBuffer();

        // Simpan hasil gambar ke file
        await sharp(finalImage).toFile(outputPath);

        console.log(`QR code dengan logo berhasil disimpan di ${outputPath}`);
    } catch (error) {
        console.error('Error saat membuat QR code dengan logo:', error);
    }
}

function normalizeSegmenSlug(value) {
    return (value || '').toString().trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

function buildDailyLabels(days, date = new Date()) {
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
        const current = new Date(date);
        current.setDate(date.getDate() - i);
        const day = String(current.getDate()).padStart(2, '0');
        const month = String(current.getMonth() + 1).padStart(2, '0');
        labels.push(`${day}/${month}`);
    }
    return labels;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSegmenLabel(item) {
    const parts = [item.unitKerja, item.homebase, item.subhomebase]
        .filter((val) => val && !isEmptySegmenValue(val));
    const detail = parts.length ? ` - ${parts.join(' / ')}` : '';
    return `${item.nama || 'Segmen'}${detail}`;
}

// Load Model
const Link = require("../models/Link");
const Stat = require("../models/Stat");
const Bio = require("../models/Bio");
const Segmen = require("../models/Segmen");
const { sanitizeAlias, buildLinkPayload, removeUploadedFile } = require('../utils/bio');
const { resolveBioTheme, sanitizeBioThemeInput } = require('../utils/bioTheme');
const {
    buildUserSegmenProfiles,
    isSegmenAllowedForProfile,
    isEmptySegmenValue,
    isSegmenAllowedForUser
} = require('../utils/segmenAccess');


const buildSsoUrl = (path, req) => {
    if (!SSO_BASE_URL) return '/login';
    try {
        const url = new URL(path, SSO_BASE_URL);
        if (req) {
            const origin = `${req.protocol}://${req.get('host')}`;
            url.searchParams.set('returnTo', `${origin}${req.originalUrl || '/users'}`);
        }
        return url.toString();
    } catch (err) {
        return '/login';
    }
};

const getTokenFromRequest = (req) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice('Bearer '.length);
    }
    const cookies = req.cookies || {};
    return cookies[SSO_COOKIE_NAME] || cookies.jwt || cookies.token || null;
};

const resolveApiErrorMessage = (error, fallback) => {
    const apiMessage = error?.response?.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
        return apiMessage.trim();
    }
    const errors = error?.response?.data?.errors;
    if (Array.isArray(errors) && errors.length && errors[0]?.msg) {
        return String(errors[0].msg);
    }
    return fallback;
};

const cleanupTempUpload = async (file) => {
    if (!file?.path) {
        return;
    }
    try {
        await fsX.remove(file.path);
    } catch (err) {
        // ignore temp file cleanup errors
    }
};

const redirectToSso = (req, res, fallback = '/users') => {
    if (!isSsoEnabled()) {
        return false;
    }

    const authorize = createAuthorizeRequest(req, {
        returnTo: resolveReturnTo(req) || fallback
    });
    if (authorize?.authorizeUrl) {
        res.redirect(authorize.authorizeUrl);
        return true;
    }

    return false;
};

// Login View
exports.login = asyncHandler((req, res) => {
    if (redirectToSso(req, res)) {
        return;
    }

    res.status(503).render('auth/login', {
        errors: [{ msg: 'SSO belum dikonfigurasi dengan benar. Hubungi administrator.' }],
    });
});

exports.doLogin = asyncHandler(async (req, res, next) => {
    if (!isSsoEnabled()) {
        req.flash('error_msg', 'SSO belum dikonfigurasi di aplikasi.');
        return res.status(503).redirect('/login');
    }
    if (redirectToSso(req, res)) {
        return;
    }
    req.flash('error_msg', 'Gagal mengarahkan ke SSO. Coba lagi beberapa saat.');
    return res.status(503).redirect('/login');
});

exports.ssoCallback = asyncHandler(async (req, res) => {
    if (!isSsoEnabled()) {
        req.flash('error_msg', 'SSO belum dikonfigurasi di aplikasi.');
        return res.redirect('/login');
    }

    const {
        code,
        state,
        error,
        error_description: errorDescription
    } = req.query;

    if (error) {
        req.flash('error_msg', errorDescription || error);
        return res.redirect('/login');
    }

    if (!code) {
        req.flash('error_msg', 'Kode otorisasi SSO tidak ditemukan.');
        return res.redirect('/login');
    }

    const pkceRequest = consumePkceVerifier(req, state, '/users');
    if (!pkceRequest || !pkceRequest.codeVerifier) {
        req.flash('error_msg', 'State login SSO tidak valid atau sudah kadaluarsa. Silakan login ulang.');
        return res.redirect('/login');
    }

    let tokenResponse;
    try {
        tokenResponse = await exchangeCodeForToken({
            code,
            req,
            codeVerifier: pkceRequest.codeVerifier
        });
    } catch (err) {
        console.error('SSO token exchange failed:', err.message || err);
        req.flash('error_msg', 'Gagal menukar kode SSO.');
        return res.redirect('/login');
    }

    const accessToken = tokenResponse?.access_token;
    if (!accessToken) {
        req.flash('error_msg', 'Token SSO tidak ditemukan.');
        return res.redirect('/login');
    }

    let user;
    try {
        user = await fetchCurrentUser(accessToken);
    } catch (err) {
        req.flash('error_msg', 'Gagal mengambil profil user dari SSO.');
        return res.redirect('/login');
    }

    if (!user || !user.id) {
        req.flash('error_msg', 'Akun Anda tidak ditemukan di SSO.');
        return res.redirect('/login');
    }

    res.cookie(SSO_COOKIE_NAME, accessToken, buildCookieOptions(tokenResponse?.expires_in));

    const role = user.role || 'user';
    const redirectPath = pkceRequest.returnTo || (role === 'admin' ? '/admin' : '/users');

    if (user.forcePasswordReset) {
        return res.redirect(buildSsoUrl('/force-reset', req));
    }

    return res.redirect(redirectPath);
});

// Register
exports.doRegister = asyncHandler(async (req, res) => {
    if (!SSO_BASE_URL) {
        return res.status(410).json({ errors: [{ msg: 'Registrasi dipusatkan di SSO, tetapi URL SSO belum dikonfigurasi.' }] });
    }
    const registerUrl = buildSsoUrl('/register');
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(410).json({
            errors: [{ msg: 'Registrasi dipusatkan di SSO-SISFO.' }],
            redirectTo: registerUrl,
        });
    }
    req.flash('error_msg', 'Registrasi dipusatkan di SSO-SISFO.');
    return res.redirect(registerUrl);
});

// Logout

exports.logout = asyncHandler((req, res) => {
    try {
        res.clearCookie(SSO_COOKIE_NAME); // Hapus cookie 'jwt'
        req.flash('success_msg', 'You are logged out');
        res.redirect('/');
    } catch (error) {
        console.log("ðŸš€ ~ router.get ~ error:", error)
    }

});

// Dashboard
exports.dashboard = asyncHandler(async (req, res) => {
    const user = req.currentUser;
    const dailyRange = 7;
    const dailyLabels = buildDailyLabels(dailyRange);
    const dailyStart = new Date();
    dailyStart.setDate(dailyStart.getDate() - (dailyRange - 1));

    // Parallel fetch of base data
    const [
        jumlahClicks,
        jumlahLinks,
        jumlahAktif,
        jumlahNonaktif,
        jumlahSegmen,
        jumlahTanpaSegmen,
        dataLinks,
        statistik,
        topSegmenAgg,
        topLinkAgg,
        dailyAgg
    ] = await Promise.all([
        Stat.countDocuments({
            userID: req.user.id
        }),
        Link.countDocuments({
            user_id: req.user.id
        }),
        Link.countDocuments({
            user_id: req.user.id,
            status: true
        }),
        Link.countDocuments({
            user_id: req.user.id,
            status: false
        }),
        Link.countDocuments({
            user_id: req.user.id,
            segmen: { $ne: null }
        }),
        Link.countDocuments({
            user_id: req.user.id,
            $or: [{ segmen: null }, { segmen: { $exists: false } }]
        }),
        Link.find({
            user_id: req.user.id
        })
        .select('link alias deskripsi referer password status dateExpired favicon qrCode updateBy updateAt timeStamp segmen')
        .sort({
            _id: -1
        })
        .limit(10)
        .populate('segmen', 'nama unitKerja homebase subhomebase'),
        Stat.find({
            userID: req.user.id
        })
        .select('alias ip negara kota referer os browser bahasa timeStamp')
        .sort({
            _id: -1
        })
        .limit(10),
        Link.aggregate([
            { $match: { user_id: req.user.id, segmen: { $ne: null } } },
            { $group: { _id: '$segmen', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'segmens',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'segmen'
                }
            },
            { $unwind: { path: '$segmen', preserveNullAndEmptyArrays: true } }
        ]),
        Stat.aggregate([
            { $match: { userID: req.user.id, alias: { $ne: '' } } },
            { $group: { _id: '$alias', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]),
        Stat.aggregate([
            { $match: { userID: req.user.id, timeStamp: { $gte: dailyStart } } },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%d/%m',
                            date: '$timeStamp',
                            timezone: 'Asia/Jakarta'
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ])
    ]);

    const dailyMap = dailyAgg.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
    }, {});
    const dailyClicks = dailyLabels.map((label) => ({
        label,
        count: dailyMap[label] || 0
    }));

    const topSegmen = topSegmenAgg.map((item) => {
        const segmen = item.segmen || {};
        return {
            id: item._id ? item._id.toString() : '',
            count: item.count || 0,
            label: segmen.nama ? buildSegmenLabel(segmen) : 'Segmen tidak ditemukan'
        };
    });

    const topAliases = topLinkAgg.map((item) => item._id).filter(Boolean);
    const topLinkRecords = topAliases.length
        ? await Link.find({ alias: { $in: topAliases }, user_id: req.user.id })
            .select('alias link segmen')
            .populate('segmen', 'nama unitKerja homebase subhomebase')
            .lean()
        : [];
    const topLinkMap = topLinkRecords.reduce((acc, link) => {
        const segmenLabel = link.segmen ? buildSegmenLabel(link.segmen) : '';
        const segmenSlug = normalizeSegmenSlug(link.segmen?.nama || '');
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${link.alias}`
            : `https://s.unjani.ac.id/${link.alias}`;
        acc[link.alias] = {
            shortUrl,
            shortPath: shortUrl.replace(/^https?:\/\//, ''),
            link: link.link,
            segmenLabel
        };
        return acc;
    }, {});
    const topLinks = topLinkAgg.map((item) => {
        const alias = item._id || '';
        const detail = topLinkMap[alias] || {};
        const shortUrl = detail.shortUrl || (alias ? `https://s.unjani.ac.id/${alias}` : '');
        return {
            alias,
            count: item.count || 0,
            shortUrl,
            shortPath: shortUrl ? shortUrl.replace(/^https?:\/\//, '') : '',
            link: detail.link || '',
            segmenLabel: detail.segmenLabel || ''
        };
    });

    // Optimize click count lookup
    const aliases = dataLinks.map(link => link.alias);
    const clickCounts = await Stat.aggregate([{
            $match: {
                alias: {
                    $in: aliases
                }
            }
        },
        {
            $group: {
                _id: '$alias',
                count: {
                    $sum: 1
                }
            }
        }
    ]);
    const clickMap = clickCounts.reduce((acc, curr) => ({
        ...acc,
        [curr._id]: curr.count
    }), {});

    // Prepare links data
    const links = dataLinks.map(link => {
        const segmenLabel = link.segmen ? buildSegmenLabel(link.segmen) : '';
        const segmenSlug = normalizeSegmenSlug(link.segmen?.nama || '');
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${link.alias}`
            : `https://s.unjani.ac.id/${link.alias}`;
        const shortPath = shortUrl.replace(/^https?:\/\//, '');

        return {
            ...link.toObject(),
            user: req.user.name,
            click: clickMap[link.alias] || 0,
            shortUrl,
            shortPath,
            segmenLabel
        };
    });

    const statAliases = statistik.map((item) => item.alias).filter(Boolean);
    const statLinks = statAliases.length
        ? await Link.find({ alias: { $in: statAliases }, user_id: req.user.id })
            .select('alias segmen')
            .populate('segmen', 'nama')
            .lean()
        : [];
    const statShortUrlMap = statLinks.reduce((acc, item) => {
        const segmenSlug = normalizeSegmenSlug(item.segmen?.nama || '');
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${item.alias}`
            : `https://s.unjani.ac.id/${item.alias}`;
        acc[item.alias] = shortUrl;
        return acc;
    }, {});

    // Prepare statistics data
    const stats = statistik.map(item => {
        const shortUrl = statShortUrlMap[item.alias] || `https://s.unjani.ac.id/${item.alias}`;
        return {
            ...item.toObject(),
            name: req.user.name,
            bahasa: item.bahasa || '',
            timeStamp: timeAgo(item.timeStamp),
            shortUrl,
            shortPath: shortUrl.replace(/^https?:\/\//, '')
        };
    });

    res.render("user/index", {
        user,
        title: "Dashboard",
        jumlahClicks,
        jumlahLinks,
        jumlahAktif,
        jumlahNonaktif,
        jumlahSegmen,
        jumlahTanpaSegmen,
        topSegmen,
        topLinks,
        dailyClicks,
        links,
        stats
    });
});


// Link
// 1. Link View
exports.links = asyncHandler(async (req, res) => {
    const user = req.currentUser;

    // Fetch recent statistics with necessary fields
    const statistik = await Stat.find({
            userID: req.user.id
        })
        .select('alias ip negara kota referer os browser bahasa timeStamp')
        .sort({
            _id: -1
        })
        .limit(10);

    // Prepare statistics data
    const stats = statistik.map(item => ({
        alias: item.alias,
        name: req.user.name,
        ip: item.ip,
        negara: item.negara,
        kota: item.kota,
        referer: item.referer,
        os: item.os,
        browser: item.browser,
        bahasa: item.bahasa || '',
        timeStamp: timeAgo(item.timeStamp)
    }));

    res.render("user/links", {
        user,
        title: "Links",
        stats
    });
});

exports.linkAddSegmenOptions = asyncHandler(async (req, res) => {
    const search = req.query.search || '';
    const currentUser = req.currentUser;
    const profiles = buildUserSegmenProfiles(currentUser || req.user);
    if (!profiles.length) {
        return res.json({ results: [] });
    }

    const unitKerjaFilters = [];
    const unitKerjaKeys = new Set();
    profiles.forEach((profile) => {
        const rawValue = profile.raw?.unitKerja || '';
        const key = rawValue.toLowerCase();
        if (!rawValue || unitKerjaKeys.has(key)) return;
        unitKerjaKeys.add(key);
        unitKerjaFilters.push({ unitKerja: new RegExp(`^${escapeRegex(rawValue)}$`, 'i') });
    });

    const filters = [];
    if (unitKerjaFilters.length) {
        filters.push({ $or: unitKerjaFilters });
    }
    if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        filters.push({
            $or: [
                { nama: regex },
                { unitKerja: regex },
                { homebase: regex },
                { subhomebase: regex }
            ]
        });
    }

    const query = filters.length ? { $and: filters } : {};
    const records = await Segmen.find(query).sort({ nama: 1 }).limit(100).lean();
    const filtered = records.filter((item) =>
        profiles.some((profile) => isSegmenAllowedForProfile(item, profile))
    );
    const results = filtered.map((item) => ({
        id: item._id.toString(),
        text: buildSegmenLabel(item),
        nama: item.nama || ''
    }));

    return res.json({ results });
});

exports.addLink = asyncHandler(async (req, res) => {
    const {
        link,
        alias: inputAlias,
        expired,
        referer,
        password,
        deskripsi,
        segmen
    } = req.body;
    const listAlias = ['admin', 'users', 'about', 'apps', 'contact', 'feedback','bio'];

    // Validasi link dan referer
    if (!link?.trim()) {
        req.flash('error', 'Masukkan URL yang benar!');
        return res.json({ error: 'Masukkan URL' });
    }

    if (!referer?.trim()) {
        req.flash('error', 'URL harus diisi!');
        return res.json({ error: 'Pilih URL' });
    }

    if (!isValidURL(link)) {
        req.flash('error', 'Masukkan URL yang benar!');
        return res.json({ error: 'Masukkan URL yang benar' });
    }

    // Bersihkan alias dari spasi dan karakter tidak perlu
    let alias = inputAlias?.replace(/\s+/g, '').trim(); // Hapus semua spasi
    const validAliasPattern = /^[a-zA-Z0-9\-_.]+$/;

    // Validasi alias
    if (alias) {
        if (alias.length <= 3) {
            return res.json({ error: 'Alias minimal 3 huruf' });
        }
        if (!validAliasPattern.test(alias)) {
            return res.json({ error: 'Alias tidak valid!' });
        }
        if (listAlias.includes(alias)) {
            return res.json({ error: 'Alias sudah digunakan!' });
        }
    } else {
        // Generate alias otomatis jika tidak ada
        let linked;
        do {
            alias = getRandomString();
            linked = await Link.findOne({ alias });
        } while (linked || listAlias.includes(alias));
    }

    // Cek duplikasi alias di database
    const existingAlias = await Link.findOne({ alias });
    if (existingAlias) {
        req.flash('error', 'Alias sudah digunakan!');
        return res.json({ error: 'Alias sudah digunakan' });
    }

    const segmenId = (segmen || '').toString().trim();
    let segmenRecord = null;
    if (segmenId) {
        if (!mongoose.isValidObjectId(segmenId)) {
            return res.json({ error: 'Segmen tidak valid' });
        }
        segmenRecord = await Segmen.findById(segmenId).lean();
        if (!segmenRecord) {
            return res.json({ error: 'Segmen tidak ditemukan' });
        }
        const currentUser = req.currentUser;
        if (!isSegmenAllowedForUser(segmenRecord, currentUser || req.user)) {
            return res.json({ error: 'Segmen tidak sesuai dengan data user' });
        }
    }

    // Persiapan data
    const hashedPassword = await hashPassword(password);
    const normalizedLink = checkAndAddProtocol(link);
    const favicon = await downloadFavicon(normalizedLink, alias);

    // Pastikan direktori QR code tersedia
    const qrDir = resolveFromAssets('images', 'qr');
    if (!fs.existsSync(qrDir)) {
        fs.mkdirSync(qrDir, { recursive: true });
    }

    const segmenSlug = segmenRecord?.nama ? normalizeSegmenSlug(segmenRecord.nama) : '';
    const shortUrl = segmenSlug
        ? `https://s.unjani.ac.id/${segmenSlug}/${alias}`
        : `https://s.unjani.ac.id/${alias}`;

    // Generate QR Code dengan logo
    generateQRCodeWithLogo(
        shortUrl,
        resolveFromAssets('images', 'logos', 'logo qr.png'),
        resolveFromAssets('qr', `${alias}.png`)
    );

    // Simpan ke database
    const newLink = new Link({
        link: normalizedLink,
        alias,
        user_id: req.user.id,
        dateExpired: expired,
        referer,
        password: hashedPassword,
        deskripsi,
        favicon,
        updateBy: req.user.id,
        qrCode: `${alias}.png`,
        segmen: segmenRecord?._id || null,
    });

    try {
        const savedLink = await newLink.save();
        req.flash('success_msg', 'Link berhasil diringkas');
        res.json(savedLink);
    } catch (error) {
        console.error('Gagal menyimpan link:', error);
        req.flash('error_msg', 'Gagal membuat short link!');
        res.redirect('/');
    }
});

exports.genQRCode = asyncHandler(async (req, res) => {
    let { alias } = req.params;

    try {
        // Bersihkan alias dari spasi
        alias = alias.replace(/\s+/g, '').trim();
        
        // Validasi alias tidak kosong setelah dibersihkan
        if (!alias) {
            return res.status(400).json({ 
                error: 'Alias tidak valid setelah dibersihkan dari spasi' 
            });
        }

        // 1. Pastikan direktori tujuan ada
        const qrDir = resolveFromAssets('qr');
        if (!fs.existsSync(qrDir)) {
            fs.mkdirSync(qrDir, { recursive: true });
        }

        // 2. Konstruksi path file dengan aman
        const logoPath = resolveFromAssets('images', 'logos', 'logo qr.png');
        const qrFilename = `${alias}.png`;
        const qrPath = path.join(qrDir, qrFilename);

        // 3. Validasi file logo ada
        if (!fs.existsSync(logoPath)) {
            return res.status(500).json({ 
                error: 'File logo tidak ditemukan' 
            });
        }

        // 4. Cari data link untuk mendapatkan URL asli
        const existingLink = await Link.findOne({ alias: alias });
        if (!existingLink) {
            return res.status(404).json({ error: 'Alias tidak ditemukan' });
        }

        let segmenName = '';
        if (existingLink.segmen) {
            const segmenRecord = await Segmen.findById(existingLink.segmen).lean();
            segmenName = segmenRecord?.nama || '';
        }
        const segmenSlug = normalizeSegmenSlug(segmenName);
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${alias}`
            : `https://s.unjani.ac.id/${alias}`;

        // 5. Generate QR Code dengan URL yang bersih
        await generateQRCodeWithLogo(
            shortUrl, // Hapus spasi yang tidak perlu
            logoPath,
            qrPath
        );

        // 6. Download favicon menggunakan URL asli dari database
        const favicon = await downloadFavicon(existingLink.link, alias);

        // 7. Update database dengan validasi
        const updatedLink = await Link.findOneAndUpdate(
            { alias: alias },
            { 
                qrCode: qrFilename,
                favicon: favicon 
            },
            { new: true }
        );

        if (!updatedLink) {
            // Hapus file QR yang baru dibuat jika tidak ada link yang diperbarui
            if (fs.existsSync(qrPath)) {
                fs.unlinkSync(qrPath);
            }
            return res.status(404).json({ error: 'Gagal update data link' });
        }

        res.status(200).json({ 
            message: 'QR Code berhasil dibuat',
            qrCodeUrl: `/assets/qr/${qrFilename}`,
            alias: alias
        });

    } catch (error) {
        console.error('Error membuat QR Code:', error);
        
        // 8. Penanganan kesalahan spesifik
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return res.status(500).json({ 
                error: 'Tidak memiliki izin untuk menulis file' 
            });
        }
        
        res.status(500).json({ 
            error: 'Gagal membuat QR Code', 
            details: error.message 
        });
    }
});


exports.delLink = asyncHandler(async (req, res) => {

    try {
        const deleted = await Link.findOneAndDelete({
            alias: req.body.alias,
        });
        return res.status(200).json({
            success_msg: "Berhasil dihapus!"
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            error: "Kesalahan server!"
        });
    }
});


exports.bios = asyncHandler(async (req, res) => {
    const user = req.currentUser;
    const records = await Bio.find({
        createdBy: req.user.id
    }).sort({
        createdAt: -1
    }).lean();

    const options = { dateStyle: 'medium', timeStyle: 'short' };
    const bios = records.map((bio, index) => ({
        ...bio,
        number: index + 1,
        formattedDate: new Date(bio.createdAt).toLocaleString('id-ID', options)
    }));

    res.render('user/bios', {
        user,
        title: 'bio',
        bios
    });
});

exports.createBioForm = asyncHandler(async (req, res) => {
    const user = req.currentUser;

    res.render('user/bio-form', {
        user,
        title: 'bio',
        mode: 'create',
        bio: {
            title: '',
            alias: '',
            logo: '',
            links: [{ label: '', url: '' }],
            theme: resolveBioTheme(),
        }
    });
});

exports.createBio = asyncHandler(async (req, res) => {
    const { title, alias, linkLabels = [], linkUrls = [] } = req.body;
    const theme = sanitizeBioThemeInput(req.body);

    const normalizedAlias = sanitizeAlias(alias || '');

    if (!title || !normalizedAlias) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Judul dan alias wajib diisi');
        return res.redirect('/users/bios/create');
    }

    const links = buildLinkPayload(linkLabels, linkUrls);

    if (!links.length) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Tambahkan minimal satu link yang valid');
        return res.redirect('/users/bios/create');
    }

    const existingBio = await Bio.findOne({ alias: normalizedAlias });
    const existingLink = await Link.findOne({ alias: normalizedAlias });

    if (existingBio || existingLink) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Alias sudah digunakan');
        return res.redirect('/users/bios/create');
    }

    await Bio.create({
        title: title.trim(),
        alias: normalizedAlias,
        logo: req.file ? req.file.filename : '',
        links,
        theme,
        createdBy: req.user.id
    });

    req.flash('success_msg', 'Bio berhasil dibuat');
    res.redirect('/users/bios');
});

exports.editBioForm = asyncHandler(async (req, res) => {
    const user = req.currentUser;
    const bio = await Bio.findOne({
        _id: req.params.id,
        createdBy: req.user.id
    }).lean();

    if (!bio) {
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/users/bios');
    }

    if (!bio.links || !bio.links.length) {
        bio.links = [{ label: '', url: '' }];
    }
    bio.theme = resolveBioTheme(bio.theme);

    res.render('user/bio-form', {
        user,
        title: 'bio',
        mode: 'edit',
        bio
    });
});

exports.updateBio = asyncHandler(async (req, res) => {
    const { title, alias, linkLabels = [], linkUrls = [] } = req.body;
    const theme = sanitizeBioThemeInput(req.body);
    const bio = await Bio.findOne({
        _id: req.params.id,
        createdBy: req.user.id
    });

    if (!bio) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/users/bios');
    }

    const normalizedAlias = sanitizeAlias(alias || '');

    if (!title || !normalizedAlias) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Judul dan alias wajib diisi');
        return res.redirect(`/users/bios/${req.params.id}/edit`);
    }

    const links = buildLinkPayload(linkLabels, linkUrls);

    if (!links.length) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Tambahkan minimal satu link yang valid');
        return res.redirect(`/users/bios/${req.params.id}/edit`);
    }

    if (normalizedAlias !== bio.alias) {
        const aliasTaken = await Bio.findOne({ alias: normalizedAlias });
        const aliasUsedByLink = await Link.findOne({ alias: normalizedAlias });

        if ((aliasTaken && aliasTaken._id.toString() !== bio._id.toString()) || aliasUsedByLink) {
            if (req.file) {
                removeUploadedFile(req.file.filename);
            }
            req.flash('error_msg', 'Alias sudah digunakan');
            return res.redirect(`/users/bios/${req.params.id}/edit`);
        }

        bio.alias = normalizedAlias;
    }

    if (req.file) {
        removeUploadedFile(bio.logo);
        bio.logo = req.file.filename;
    }

    bio.title = title.trim();
    bio.links = links;
    bio.theme = theme;
    bio.updatedAt = new Date();

    await bio.save();

    req.flash('success_msg', 'Bio berhasil diperbarui');
    res.redirect('/users/bios');
});

exports.deleteBio = asyncHandler(async (req, res) => {
    const bio = await Bio.findOne({
        _id: req.params.id,
        createdBy: req.user.id
    });

    if (!bio) {
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/users/bios');
    }

    removeUploadedFile(bio.logo);
    await Bio.deleteOne({
        _id: req.params.id,
        createdBy: req.user.id
    });

    req.flash('success_msg', 'Bio berhasil dihapus');
    res.redirect('/users/bios');
});

exports.link = asyncHandler(async (req, res) => {
    const user = req.currentUser;

    let link = await Link.findOne({
        alias: req.params.alias
    }).populate('segmen', 'nama unitKerja homebase subhomebase');

    const segmenName = link?.segmen?.nama || '';
    const segmenSlug = normalizeSegmenSlug(segmenName);
    const shortUrl = segmenSlug
        ? `https://s.unjani.ac.id/${segmenSlug}/${link.alias}`
        : `https://s.unjani.ac.id/${link.alias}`;
    const shortPath = shortUrl.replace(/^https?:\/\//, '');
    const shortUrlEncoded = encodeURIComponent(shortUrl);

    res.render("user/link", {
        user,
        title: "links",
        link,
        shortUrl,
        shortPath,
        shortUrlEncoded,
        segmenLabel: segmenName || ''
    })
});

exports.updlink = asyncHandler(async (req, res) => {
    const user = req.currentUser;

    let link = await Link.findOne({
        alias: req.params.alias
    }).populate('segmen', 'nama unitKerja homebase subhomebase');

    const profiles = buildUserSegmenProfiles(user);
    let segmenOptions = [];
    if (profiles.length) {
        const unitKerjaFilters = [];
        const unitKerjaKeys = new Set();
        profiles.forEach((profile) => {
            const rawValue = profile.raw?.unitKerja || '';
            const key = rawValue.toLowerCase();
            if (!rawValue || unitKerjaKeys.has(key)) return;
            unitKerjaKeys.add(key);
            unitKerjaFilters.push({ unitKerja: new RegExp(`^${escapeRegex(rawValue)}$`, 'i') });
        });

        const filters = [];
        if (unitKerjaFilters.length) {
            filters.push({ $or: unitKerjaFilters });
        }

        const query = filters.length ? { $and: filters } : {};
        const records = await Segmen.find(query).sort({ nama: 1 }).limit(100).lean();
        const filtered = records.filter((item) =>
            profiles.some((profile) => isSegmenAllowedForProfile(item, profile))
        );
        segmenOptions = filtered.map((item) => ({
            id: item._id.toString(),
            label: buildSegmenLabel(item)
        }));
    }

    if (link?.segmen?._id) {
        const currentId = link.segmen._id.toString();
        const exists = segmenOptions.some((option) => option.id === currentId);
        if (!exists) {
            segmenOptions.unshift({
                id: currentId,
                label: buildSegmenLabel(link.segmen)
            });
        }
    }

    res.render("user/updlink", {
        user,
        title: "links",
        link,
        segmenOptions
    })
});

exports.updLink = asyncHandler(async (req, res) => {
    try {
        let {
            slug,
            link,
            alias,
            expired,
            referer,
            password,
            deskripsi,
            segmen
        } = req.body;

        if (!link || link.trim() === '') {
            return res.status(400).json({
                error: "Masukan URL yang benar!"
            });
        }

        if (!referer || referer.trim() === '') {
            return res.status(400).json({
                error: "Pilih Redirect yang benar!"
            });
        }

        if (!isValidURL(link)) {
            return res.status(400).json({
                error: "URL tidak valid!"
            });
        }

        if (alias && alias.length <= 3) {
            return res.status(400).json({
                error: "Alias minimal 3 huruf!"
            });
        }
        let compare = null;
        try {
            // Cari link berdasarkan alias
            const links = await Link.findOne({
                alias
            });

            // Cari link berdasarkan _id (slug)
            compare = await Link.findOne({
                _id: slug
            }).populate('segmen', 'nama');

            // Jika alias sudah ada dan ID-nya berbeda dengan slug
            if (links && (!compare || links._id.toString() !== compare._id.toString())) {
                return res.status(400).json({
                    error: "Alias sudah digunakan!"
                });
            }

            // Jika alias belum ada
            if (!links) {
                console.log('Alias belum ada');
            }

            // Lanjutkan logika lain jika diperlukan
        } catch (error) {
            console.error("Terjadi kesalahan:", error);
            return res.status(500).json({
                error: "Internal Server Error"
            });
        }
        if (!alias || alias.trim() === '') {
            let linked;
            do {
                alias = getRandomString();
                linked = await Link.findOne({
                    alias
                });
            } while (linked);
        }

        const validAliasPattern = /^[a-zA-Z0-9\-\_\.]+$/;
        if (!validAliasPattern.test(alias)) {
            return res.status(400).json({
                error: "Alias tidak valid!"
            });
        }

        const hasSegmenField = Object.prototype.hasOwnProperty.call(req.body, 'segmen');
        let segmenRecord = null;
        let segmenId = compare?.segmen?._id || null;
        let segmenName = compare?.segmen?.nama || '';
        if (hasSegmenField) {
            const segmenRaw = String(segmen || '').trim();
            if (segmenRaw) {
                if (!mongoose.isValidObjectId(segmenRaw)) {
                    return res.status(400).json({ error: "Segmen tidak valid!" });
                }
                segmenRecord = await Segmen.findById(segmenRaw).lean();
                if (!segmenRecord) {
                    return res.status(400).json({ error: "Segmen tidak ditemukan!" });
                }
                const currentUser = req.currentUser;
                if (!isSegmenAllowedForUser(segmenRecord, currentUser || req.user)) {
                    return res.status(400).json({ error: "Segmen tidak sesuai dengan data user!" });
                }
                segmenId = segmenRecord._id;
                segmenName = segmenRecord.nama || '';
            } else {
                segmenId = null;
                segmenName = '';
            }
        }
        const segmenSlug = normalizeSegmenSlug(segmenName);
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${alias}`
            : `https://s.unjani.ac.id/${alias}`;

        link = checkAndAddProtocol(link);
        const favicon = await downloadFavicon(link, alias);

        const qrDir = resolveFromAssets('images', 'qr');
        if (!fs.existsSync(qrDir)) {
            fs.mkdirSync(qrDir, {
                recursive: true
            });
        }

        generateQRCodeWithLogo(
            shortUrl,
            resolveFromAssets('images', 'logos', 'logo qr.png'),
            resolveFromAssets('qr', `${alias}.png`)
        );

        const updatePayload = {
            link,
            alias,
            dateExpired: expired,
            referer,
            password,
            deskripsi,
            favicon,
            updateBy: req.user.id,
            qrCode: alias + '.png'
        };
        if (hasSegmenField) {
            updatePayload.segmen = segmenId;
        }

        const update = await Link.findOneAndUpdate({
            _id: slug
        }, updatePayload);

        if (!update) {
            return res.status(500).json({
                error: "Gagal memperbarui link!"
            });
        }

        return res.status(200).json({
            success: `Link https://${update.alias} berhasil diperbarui!`
        });

    } catch (error) {
        console.error("ðŸš€ ~ Error:", error);
        return res.status(500).json({
            error: "Kesalahan server!"
        });
    }
});


exports.changeStatusLink = asyncHandler(async (req, res) => {
    try {
        // Validasi input
        if (!req.body.alias || !req.body.status) {
            return res.status(400).json({
                error: "Alias dan status harus ada!"
            });
        }


        let msg;
        if (req.body.status === 'true') {
            msg = 'Link Berhasil dihidupkan';
        } else {
            msg = 'Link Berhasil dimatikan';
        }


        // Update data di database
        const update = await Link.findOneAndUpdate({
            alias: req.body.alias
        }, {
            status: req.body.status
        });

        if (!update) {
            return res.status(404).json({
                error: "Link tidak ditemukan!"
            });
        }

        // Kirim response sukses
        return res.status(200).json({
            success_msg: msg
        });
    } catch (error) {
        console.log("ðŸš€ ~ exports.updLink=asyncHandler ~ error:", error);
        return res.status(500).json({
            error: "Kesalahan server!"
        });
    }
});

exports.forceResetView = asyncHandler(async (req, res) => {
    req.flash('error_msg', 'Reset password dipusatkan di SSO-SISFO.');
    return res.redirect(buildSsoUrl('/force-reset', req));
});

exports.forceResetPassword = asyncHandler(async (req, res) => {
    return res.status(410).json({
        errors: [{ msg: 'Reset password dipusatkan di SSO-SISFO.' }],
        redirectTo: buildSsoUrl('/force-reset', req),
    });
});
exports.changePassword = asyncHandler(async (req, res) => {
    req.flash('error_msg', 'Perubahan password dipusatkan di SSO-SISFO.');
    return res.redirect(buildSsoUrl('/force-reset', req));
});

exports.unlockLink = asyncHandler(async (req, res) => {
    try {
        // Validasi input
        if (!req.params.alias) {
            return res.status(400).json({
                error: "Alias dan status harus ada!"
            });
        }
        let msg = (req.body.status) ? 'Link Berhasil dimatikan' : 'Link Berhasil dimatikan'

        // Update data di database
        const update = await Link.findOneAndUpdate({
            alias: req.body.alias
        }, {
            password: ''
        });

        if (!update) {
            return res.status(404).json({
                error: "Link tidak ditemukan!"
            });
        }

        // Kirim response sukses
        return res.redirect('/users/links');

    } catch (error) {
        console.log("ðŸš€ ~ exports.updLink=asyncHandler ~ error:", error);

        return res.redirect('/users/links');
    }
});



exports.analytics = asyncHandler(async (req, res) => {
    const user = req.currentUser;
    const periodDays = parsePeriod(req.query.period);
    const analytics = await getOverviewAnalytics({
        scope: 'user',
        userId: req.user.id,
        periodDays,
        appBaseUrl: getAppBaseUrl(req),
    });

    res.render("user/analytics", {
        user,
        title: "analytics",
        analytics,
        filterAction: '/users/analytics',
    });
});

exports.analytic = asyncHandler(async (req, res) => {
    const user = req.currentUser;
    const periodDays = parsePeriod(req.query.period);
    const analytics = await getLinkAnalytics({
        scope: 'user',
        userId: req.user.id,
        alias: req.params.id,
        periodDays,
        appBaseUrl: getAppBaseUrl(req),
    });

    if (!analytics) {
        req.flash('error_msg', 'Data analytics link tidak ditemukan atau bukan milik Anda.');
        return res.redirect('/users/links');
    }

    res.render("user/analytic", {
        user,
        title: "analytics",
        analytics,
        filterAction: `/users/analytic/${encodeURIComponent(analytics.link.alias)}`,
    });
});

// 4. Profile
exports.profile = asyncHandler(async (req, res, next) => {
    const user = req.currentUser;
    const [totalLinks, totalAccess, totalBios] = await Promise.all([
        Link.countDocuments({ user_id: req.user.id }),
        Stat.countDocuments({ userID: req.user.id }),
        Bio.countDocuments({ createdBy: req.user.id }),
    ]);

    res.render("user/profile", {
        user,
        title: "profile",
        profileStats: {
            totalLinks,
            totalAccess,
            totalBios,
        },
    });
});

exports.updateProfile = asyncHandler(async (req, res) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        req.flash('error_msg', 'Sesi login tidak ditemukan. Silakan login ulang.');
        return res.redirect('/login');
    }

    const payload = {
        name: (req.body.name || '').toString().trim(),
        jabatanFungsional: (req.body.jabatanFungsional || '').toString().trim(),
        dosenProdi: (req.body.dosenProdi || '').toString().trim(),
    };

    if (!payload.name) {
        req.flash('error_msg', 'Nama wajib diisi.');
        return res.redirect('/users/profile');
    }

    try {
        await updateCurrentUserProfile(token, payload);
        req.flash('success_msg', 'Profil berhasil diperbarui.');
        return res.redirect('/users/profile');
    } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            res.clearCookie(SSO_COOKIE_NAME);
            req.flash('error_msg', 'Sesi login Anda habis. Silakan login ulang.');
            return res.redirect('/login');
        }

        req.flash('error_msg', resolveApiErrorMessage(error, 'Gagal memperbarui profil.'));
        return res.redirect('/users/profile');
    }
});

exports.updateProfilePassword = asyncHandler(async (req, res) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        req.flash('error_msg', 'Sesi login tidak ditemukan. Silakan login ulang.');
        return res.redirect('/login');
    }

    const payload = {
        currentPassword: (req.body.currentPassword || '').toString(),
        newPassword: (req.body.newPassword || '').toString(),
        confirmPassword: (req.body.confirmPassword || '').toString(),
    };

    if (!payload.currentPassword || !payload.newPassword || !payload.confirmPassword) {
        req.flash('error_msg', 'Current password, password baru, dan konfirmasi wajib diisi.');
        return res.redirect('/users/profile');
    }

    if (payload.newPassword.length < 6) {
        req.flash('error_msg', 'Password baru minimal 6 karakter.');
        return res.redirect('/users/profile');
    }

    if (payload.newPassword !== payload.confirmPassword) {
        req.flash('error_msg', 'Konfirmasi password tidak sesuai.');
        return res.redirect('/users/profile');
    }

    try {
        await changeCurrentUserPassword(token, payload);
        req.flash('success_msg', 'Password berhasil diperbarui.');
        return res.redirect('/users/profile');
    } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            res.clearCookie(SSO_COOKIE_NAME);
            req.flash('error_msg', 'Sesi login Anda habis. Silakan login ulang.');
            return res.redirect('/login');
        }

        req.flash('error_msg', resolveApiErrorMessage(error, 'Gagal memperbarui password.'));
        return res.redirect('/users/profile');
    }
});

exports.updateProfilePhoto = asyncHandler(async (req, res) => {
    const token = getTokenFromRequest(req);
    if (!token) {
        await cleanupTempUpload(req.file);
        req.flash('error_msg', 'Sesi login tidak ditemukan. Silakan login ulang.');
        return res.redirect('/login');
    }

    if (!req.file) {
        req.flash('error_msg', 'File foto wajib diunggah.');
        return res.redirect('/users/profile');
    }

    try {
        await updateCurrentUserPhoto(token, req.file);
        req.flash('success_msg', 'Foto profil berhasil diperbarui.');
        return res.redirect('/users/profile');
    } catch (error) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            res.clearCookie(SSO_COOKIE_NAME);
            req.flash('error_msg', 'Sesi login Anda habis. Silakan login ulang.');
            return res.redirect('/login');
        }

        req.flash('error_msg', resolveApiErrorMessage(error, 'Gagal memperbarui foto profil.'));
        return res.redirect('/users/profile');
    } finally {
        await cleanupTempUpload(req.file);
    }
});

exports.changePassword = exports.updateProfilePassword;
exports.changepass = exports.updateProfilePassword;

function isValidURL(url) {
    const pattern = new RegExp('^(https?:\\/\\/)?' + // protokol opsional (http atau https)
        '((([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,6})|' + // domain dengan extension (misalnya .com, .org)
        '([0-9]{1,3}\\.){3}[0-9]{1,3})' + // atau IP address
        '(\\:[0-9]{1,5})?' + // port opsional
        '(\\/[-a-zA-Z0-9@:%._\\+~#?&//=]*)?' + // path opsional
        '(\\?[;&a-zA-Z0-9%_\\+.~#?&//=]*)?' + // query string opsional
        '(\\#[-a-zA-Z0-9@:%_\\+.~#?&//=]*)?$', // fragment opsional
        'i'); // flag case-insensitive
    return pattern.test(url);
}

function getRandomString() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456-_';
    const minLength = 3;
    const maxLength = 10;

    // Menentukan panjang string secara acak
    const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

    let randomString = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters[randomIndex];
    }

    return randomString;
}

function checkAndAddProtocol(link) {
    // Cek apakah link sudah dimulai dengan "http://" atau "https://"
    if (!/^https?:\/\//i.test(link)) {
        // Jika tidak, tambahkan "https://"
        link = 'https://' + link;
    }
    return link;
}

async function hashPassword(password) {
    if (password) {
        try {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            console.log("ðŸš€ ~ bcrypt.hash ~ password:", password);
            console.log("ðŸš€ ~ bcrypt.hash ~ hash:", hash);
            return hash;
        } catch (err) {
            console.log(err);
            throw new Error("Hashing password failed");
        }
    }
    return ""; // Jika password kosong
}

async function downloadFavicon(websiteUrl, alias) {
    try {
        const faviconUrl = `${websiteUrl}/favicon.ico`;
        const response = await axios({
            url: faviconUrl,
            method: 'GET',
            responseType: 'stream'
        });

        // Menyiapkan folder dan nama file (gunakan alias sebagai nama file untuk favicon)
        const folderPath = resolveFromAssets('images', 'favico');
        const filePath = path.join(folderPath, `${alias}.ico`);

        // Pastikan folder target ada
        await fsX.ensureDir(folderPath);

        // Simpan favicon ke file
        const writer = fsX.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Favicon berhasil disimpan ke ${filePath}`);
                resolve(`${alias}.ico`); // Kembalikan nama file favicon
            });
            writer.on('error', (err) => {
                console.error('Terjadi kesalahan saat menyimpan favicon:', err);
                reject(err);
            });
        });
    } catch (error) {
        console.error('Terjadi kesalahan saat mengambil favicon:', error.message);
        return null;
    }
}

function timeAgo(date) {
    const now = new Date();
    const givenDate = new Date(date);

    // Hitung selisih waktu dalam milidetik
    const diffTime = Math.abs(now - givenDate);

    // Ubah selisih waktu menjadi hari
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Kembalikan hasil dalam format "X Days ago"
    return `${diffDays} Days ago`;
}




