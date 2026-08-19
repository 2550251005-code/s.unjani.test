const asyncHandler = require("express-async-handler");
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const QRCode = require('qrcode');
const sharp = require('sharp');
const axios = require('axios');
const fsX = require('fs-extra');
const { sanitizeAlias, buildLinkPayload, removeUploadedFile } = require('../utils/bio');
const { resolveBioTheme, sanitizeBioThemeInput } = require('../utils/bioTheme');
const { resolveFromAssets } = require('../utils/paths');

const fs = require('fs');
const path = require('path');


const ENQUIRE_TYPES = {
    1: 'Account registration',
    2: 'Shortlink usage',
    3: 'Bug or error reporting',
    4: 'Feature addition request'
};

dotenv.config();

// Load model

function parseTags(raw) {
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSegmenLabel(item) {
    const parts = [item.unitKerja, item.homebase, item.subhomebase]
        .filter((value) => value && !isEmptySegmenValue(value));
    const detail = parts.length ? ` - ${parts.join(' / ')}` : '';
    return `${item.nama || 'Segmen'}${detail}`;
}

const Link = require("../models/Link");
const Stat = require("../models/Stat");
const Feedback = require("../models/Feedback");
const WhatsNew = require("../models/WhatsNew");
const Bio = require("../models/Bio");
const Segmen = require("../models/Segmen");
const TeamMember = require("../models/TeamMember");
const { fetchSegmenOptions } = require('../services/segmenSso');
const { fetchUsersByIds } = require('../services/ssoUsers');
const {
    buildUserSegmenProfiles,
    isSegmenAllowedForProfile,
    isEmptySegmenValue,
} = require('../utils/segmenAccess');
const { SSO_COOKIE_NAME, SSO_BASE_URL, getAppBaseUrl } = require('../utils/ssoClient');
const {
    parsePeriod,
    getOverviewAnalytics,
    getLinkAnalytics,
} = require('../services/analyticsService');

const SSO_ADMIN_USERS_PATH = process.env.SSO_ADMIN_USERS_PATH || '/admin/users';

const buildSsoAdminUsersUrl = () => {
    if (!SSO_BASE_URL) return '/';
    try {
        return new URL(SSO_ADMIN_USERS_PATH, SSO_BASE_URL).toString();
    } catch (err) {
        return '/';
    }
};

const getTokenFromRequest = (req) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    const cookies = req.cookies || {};
    return cookies[SSO_COOKIE_NAME] || cookies.jwt || cookies.token || null;
};

const resolveUserNameMap = async (req, ids = []) => {
    const token = getTokenFromRequest(req);
    if (!token) return {};
    return fetchUsersByIds(token, ids);
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'helpdesk.sisfo@unjani.ac.id',
        pass: 'UNJANI123456',
    },
});



async function generateQRCodeWithLogo(text, logoPath, outputPath) {
    try {
        // Bersihkan text dari spasi dan karakter whitespace
        const cleanedText = String(text).replace(/\s+/g, '').trim();
        
        // Validasi text tidak kosong setelah dibersihkan
        if (!cleanedText) {
            throw new Error('Text untuk QR Code tidak boleh kosong setelah dibersihkan dari spasi');
        }

        // Buat folder jika belum ada
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, {
                recursive: true
            });
        }

        // Buat QR Code sebagai buffer gambar PNG menggunakan text yang sudah dibersihkan
        const qrCodeBuffer = await QRCode.toBuffer(cleanedText, {
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
        console.log(`Text yang diencode: ${cleanedText}`); // Log untuk debugging
    } catch (error) {
        console.error('Error saat membuat QR code dengan logo:', error);
        throw error; // Re-throw error agar bisa ditangani oleh caller
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


// Dashboard
exports.index = asyncHandler(async (req, res, next) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const dailyRange = 7;
    const dailyLabels = buildDailyLabels(dailyRange);
    const dailyStart = new Date();
    dailyStart.setDate(dailyStart.getDate() - (dailyRange - 1));

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
        Stat.countDocuments({}),
        Link.countDocuments({}),
        Link.countDocuments({ status: true }),
        Link.countDocuments({ status: false }),
        Link.countDocuments({ segmen: { $ne: null } }),
        Link.countDocuments({ $or: [{ segmen: null }, { segmen: { $exists: false } }] }),
        Link.find({})
            .sort({ _id: -1 })
            .limit(10)
            .populate('segmen', 'nama unitKerja homebase subhomebase'),
        Stat.find({})
            .sort({ _id: -1 })
            .limit(10),
        Link.aggregate([
            { $match: { segmen: { $ne: null } } },
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
            { $match: { alias: { $ne: '' } } },
            { $group: { _id: '$alias', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]),
        Stat.aggregate([
            { $match: { timeStamp: { $gte: dailyStart } } },
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
        ? await Link.find({ alias: { $in: topAliases } })
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
    const statAliases = statistik.map((item) => item.alias).filter(Boolean);
    const statLinks = statAliases.length
        ? await Link.find({ alias: { $in: statAliases } })
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
    const ownerIds = [
        ...new Set(
            [
                ...dataLinks.map((item) => item.user_id),
                ...statistik.map((item) => item.userID),
            ].filter(Boolean),
        ),
    ];
    const ownerMap = await resolveUserNameMap(req, ownerIds);
    const links = [];
    for (const link of dataLinks) {
        const ownerKey = link.user_id ? link.user_id.toString() : '';
        const owner = ownerMap[ownerKey] || null;
        let click = await Stat.find({
            alias: link.alias
        }).countDocuments();
        const segmenLabel = link.segmen ? buildSegmenLabel(link.segmen) : '';
        const segmenSlug = normalizeSegmenSlug(link.segmen?.nama || '');
        const shortUrl = segmenSlug
            ? `https://s.unjani.ac.id/${segmenSlug}/${link.alias}`
            : `https://s.unjani.ac.id/${link.alias}`;
        const shortPath = shortUrl.replace(/^https?:\/\//, '');

        links.push({
            title: 'dashboard',
            link: link.link,
            alias: link.alias,
            shortUrl,
            shortPath,
            segmenLabel,
            user: owner?.name || 'unknown',
            deskripsi: link.deskripsi,
            referer: link.referer,
            password: link.password,
            status: link.status,
            dateExpired: link.dateExpired,
            favicon: link.favicon,
            qrCode: link.qrCode,
            updateBy: link.updateBy,
            updateAt: link.updateAt,
            timeStamp: link.timeStamp,
            click: click
        });
    }

    // console.log("🚀 ~ exports.index=asyncHandler ~ links:", links);

    const stats = [];
    let no = 0;
    for (const item of statistik) {
        const ownerKey = item.userID ? item.userID.toString() : '';
        const owner = ownerMap[ownerKey] || null;
        const userName = owner?.name || 'unknown';

        stats.push({
            alias: item.alias,
            shortUrl: statShortUrlMap[item.alias] || `https://s.unjani.ac.id/${item.alias}`,
            shortPath: (statShortUrlMap[item.alias] || `https://s.unjani.ac.id/${item.alias}`)
                .replace(/^https?:\/\//, ''),
            name: userName,
            ip: item.ip,
            negara: item.negara,
            kota: item.kota,
            referer: item.referer,
            os: item.os,
            browser: item.browser,
            bahasa: item.bahasa || '',
            timeStamp: timeAgo(item.timeStamp)
        });

        no++;

        if (no == 10) {
            continue; // Ini akan skip ke iterasi berikutnya
        }
    }
    res.render("admin/index", {
        user,
        title: "admin dashboard",
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
    })
});

// 1. Links
exports.links = asyncHandler(async (req, res, next) => {
    const user = req.currentUser;
    ensureAdmin(req, res);
    const statistik = await Stat.find({}).sort({
        _id: -1
    }).limit(10);
    const ownerIds = [...new Set(statistik.map((item) => item.userID).filter(Boolean))];
    const ownerMap = await resolveUserNameMap(req, ownerIds);
    const stats = [];
    let no = 0;
    for (const item of statistik) {
        const ownerKey = item.userID ? item.userID.toString() : '';
        const owner = ownerMap[ownerKey] || null;
        const userName = owner?.name || 'unknown';

        stats.push({
            alias: item.alias,
            name: userName,
            ip: item.ip,
            negara: item.negara,
            kota: item.kota,
            referer: item.referer,
            os: item.os,
            browser: item.browser,
            bahasa: item.bahasa || '',
            timeStamp: timeAgo(item.timeStamp)
        });

        no++;

        if (no == 10) {
            continue; // Ini akan skip ke iterasi berikutnya
        }
    }

    const links = await Link.find({}).sort({
        _id: -1
    }).limit(10);;
    res.render("admin/links", {
        title: "admin links",
        user,
        links,
        stats
    });
});

exports.linkAdd = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    res.render("admin/linkadd", {
        title: "Tambah Link",
        user
    });
});

exports.linkAddSegmenOptions = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
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


// 1.b Bio Pages
exports.bios = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const records = await Bio.find({}).sort({ createdAt: -1 }).lean();
    const creatorIds = [...new Set(records.map((bio) => bio.createdBy).filter(Boolean))];
    const ownerMap = await resolveUserNameMap(req, creatorIds);

    const options = { dateStyle: 'medium', timeStyle: 'short' };
    const bios = records.map((bio, index) => ({
        ...bio,
        number: index + 1,
        formattedDate: new Date(bio.createdAt).toLocaleString('id-ID', options),
        ownerName: ownerMap[bio.createdBy?.toString()]?.name || 'Tidak diketahui'
    }));

    res.render("admin/bios", {
        title: "admin bios",
        user,
        bios
    });
});

exports.createBioForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    res.render("admin/bio-form", {
        title: "admin bios",
        user,
        mode: "create",
        bio: {
            title: "",
            alias: "",
            logo: "",
            links: [{ label: "", url: "" }],
            theme: resolveBioTheme(),
        }
    });
});

exports.editBioForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const bio = await Bio.findById(req.params.id).lean();

    if (!bio) {
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/admin/bios');
    }

    if (!bio.links || bio.links.length === 0) {
        bio.links = [{ label: "", url: "" }];
    }
    bio.theme = resolveBioTheme(bio.theme);

    res.render("admin/bio-form", {
        title: "admin bios",
        user,
        mode: "edit",
        bio
    });
});

exports.createBio = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { title, alias, linkLabels = [], linkUrls = [] } = req.body;
    const theme = sanitizeBioThemeInput(req.body);

    const normalizedAlias = sanitizeAlias(alias || '');
    if (!title || !normalizedAlias) {
        req.flash('error_msg', 'Judul dan alias wajib diisi');
        return res.redirect('/admin/bios/create');
    }

    const links = buildLinkPayload(linkLabels, linkUrls);
    if (links.length === 0) {
        req.flash('error_msg', 'Tambahkan minimal satu link');
        return res.redirect('/admin/bios/create');
    }

    const existingBio = await Bio.findOne({ alias: normalizedAlias });
    const existingLink = await Link.findOne({ alias: normalizedAlias });

    if (existingBio || existingLink) {
        req.flash('error_msg', 'Alias sudah digunakan');
        return res.redirect('/admin/bios/create');
    }

    const bio = new Bio({
        title: title.trim(),
        alias: normalizedAlias,
        logo: req.file ? req.file.filename : '',
        links,
        theme,
        createdBy: req.user.id
    });

    await bio.save();

    req.flash('success_msg', 'Bio berhasil dibuat');
    res.redirect('/admin/bios');
});

exports.updateBio = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { title, alias, linkLabels = [], linkUrls = [] } = req.body;
    const theme = sanitizeBioThemeInput(req.body);
    const bio = await Bio.findById(req.params.id);

    if (!bio) {
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/admin/bios');
    }

    const normalizedAlias = sanitizeAlias(alias || '');
    if (!title || !normalizedAlias) {
        req.flash('error_msg', 'Judul dan alias wajib diisi');
        return res.redirect(`/admin/bios/${req.params.id}/edit`);
    }

    const links = buildLinkPayload(linkLabels, linkUrls);
    if (links.length === 0) {
        req.flash('error_msg', 'Tambahkan minimal satu link');
        return res.redirect(`/admin/bios/${req.params.id}/edit`);
    }

    if (normalizedAlias !== bio.alias) {
        const aliasTaken = await Bio.findOne({ alias: normalizedAlias });
        const aliasUsedByLink = await Link.findOne({ alias: normalizedAlias });

        if (aliasTaken || aliasUsedByLink) {
            req.flash('error_msg', 'Alias sudah digunakan');
            return res.redirect(`/admin/bios/${req.params.id}/edit`);
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
    res.redirect('/admin/bios');
});


exports.whatsnew = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    const entries = await WhatsNew.find({}).sort({ createdAt: -1 }).lean();
    const formatted = entries.map((item, index) => ({
        ...item,
        number: index + 1,
        formattedDate: new Date(item.createdAt).toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }),
        tags: item.tags || []
    }));

    res.render('admin/whatsnew', {
        user,
        title: 'admin whatsnew',
        entries: formatted
    });
});

exports.createWhatsNewForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    res.render('admin/whatsnew-form', {
        user,
        title: 'admin whatsnew',
        mode: 'create',
        entry: {
            title: '',
            description: '',
            type: 'added',
            version: '',
            tags: []
        }
    });
});

exports.createWhatsNew = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { title, description, type, version = '', tags = '' } = req.body;

    if (!title || !description) {
        req.flash('error_msg', 'Judul dan deskripsi wajib diisi');
        return res.redirect('/admin/whatsnew/create');
    }

    await WhatsNew.create({
        title: title.trim(),
        description: description.trim(),
        type: (type || 'added'),
        version: version.trim(),
        tags: parseTags(tags),
        createdBy: req.user.id
    });

    req.flash('success_msg', 'Info pembaruan berhasil ditambahkan');
    res.redirect('/admin/whatsnew');
});

exports.editWhatsNewForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const entry = await WhatsNew.findById(req.params.id).lean();

    if (!entry) {
        req.flash('error_msg', 'Info pembaruan tidak ditemukan');
        return res.redirect('/admin/whatsnew');
    }

    res.render('admin/whatsnew-form', {
        user,
        title: 'admin whatsnew',
        mode: 'edit',
        entry: {
            ...entry,
            tags: (entry.tags || []).join(', ')
        }
    });
});

exports.updateWhatsNew = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { title, description, type, version = '', tags = '' } = req.body;
    const entry = await WhatsNew.findById(req.params.id);

    if (!entry) {
        req.flash('error_msg', 'Info pembaruan tidak ditemukan');
        return res.redirect('/admin/whatsnew');
    }

    if (!title || !description) {
        req.flash('error_msg', 'Judul dan deskripsi wajib diisi');
        return res.redirect(`/admin/whatsnew/${req.params.id}/edit`);
    }

    entry.title = title.trim();
    entry.description = description.trim();
    entry.type = type || 'added';
    entry.version = version.trim();
    entry.tags = parseTags(tags);
    entry.updatedAt = new Date();

    await entry.save();

    req.flash('success_msg', 'Info pembaruan berhasil diperbarui');
    res.redirect('/admin/whatsnew');
});


exports.resetUserPassword = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    return res.status(410).json({
        errors: [{ msg: 'Reset password user dipusatkan di SSO-SISFO.' }],
        redirectTo: buildSsoAdminUsersUrl(),
    });
});

exports.deleteWhatsNew = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const entry = await WhatsNew.findById(req.params.id);

    if (!entry) {
        req.flash('error_msg', 'Info pembaruan tidak ditemukan');
        return res.redirect('/admin/whatsnew');
    }

    await WhatsNew.deleteOne({ _id: req.params.id });
    req.flash('success_msg', 'Info pembaruan berhasil dihapus');
    res.redirect('/admin/whatsnew');
});

// 1.d Team Members
exports.teams = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    const records = await TeamMember.find({})
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

    const teams = records.map((item, index) => ({
        ...item,
        number: index + 1,
        photoUrl: item.photo ? `/assets/uploads/${item.photo}` : '/public/assets/images/frontend-pages/who.jpg',
        formattedDate: new Date(item.createdAt).toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'short'
        })
    }));

    res.render('admin/teams', {
        user,
        title: 'admin teams',
        teams
    });
});

exports.createTeamForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    res.render('admin/team-form', {
        user,
        title: 'admin teams',
        mode: 'create',
        entry: {
            name: '',
            position: '',
            photo: '',
            sortOrder: 0,
            isActive: true
        }
    });
});

exports.createTeam = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { name, position, sortOrder = 0 } = req.body;
    const parsedSortOrder = Number.parseInt(sortOrder, 10);

    if (!name || !position) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Nama dan jabatan wajib diisi');
        return res.redirect('/admin/teams/create');
    }

    await TeamMember.create({
        name: name.trim(),
        position: position.trim(),
        photo: req.file ? req.file.filename : '',
        sortOrder: Number.isNaN(parsedSortOrder) ? 0 : parsedSortOrder,
        isActive: Boolean(req.body.isActive),
        createdBy: req.user.id
    });

    req.flash('success_msg', 'Anggota tim berhasil ditambahkan');
    res.redirect('/admin/teams');
});

exports.editTeamForm = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const entry = await TeamMember.findById(req.params.id).lean();

    if (!entry) {
        req.flash('error_msg', 'Data tim tidak ditemukan');
        return res.redirect('/admin/teams');
    }

    res.render('admin/team-form', {
        user,
        title: 'admin teams',
        mode: 'edit',
        entry
    });
});

exports.updateTeam = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { name, position, sortOrder = 0 } = req.body;
    const entry = await TeamMember.findById(req.params.id);
    const parsedSortOrder = Number.parseInt(sortOrder, 10);

    if (!entry) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Data tim tidak ditemukan');
        return res.redirect('/admin/teams');
    }

    if (!name || !position) {
        if (req.file) {
            removeUploadedFile(req.file.filename);
        }
        req.flash('error_msg', 'Nama dan jabatan wajib diisi');
        return res.redirect(`/admin/teams/${req.params.id}/edit`);
    }

    if (req.file) {
        removeUploadedFile(entry.photo);
        entry.photo = req.file.filename;
    }

    entry.name = name.trim();
    entry.position = position.trim();
    entry.sortOrder = Number.isNaN(parsedSortOrder) ? 0 : parsedSortOrder;
    entry.isActive = Boolean(req.body.isActive);
    entry.updatedAt = new Date();

    await entry.save();

    req.flash('success_msg', 'Data tim berhasil diperbarui');
    res.redirect('/admin/teams');
});

exports.deleteTeam = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const entry = await TeamMember.findById(req.params.id);

    if (!entry) {
        req.flash('error_msg', 'Data tim tidak ditemukan');
        return res.redirect('/admin/teams');
    }

    removeUploadedFile(entry.photo);
    await TeamMember.deleteOne({ _id: req.params.id });
    req.flash('success_msg', 'Data tim berhasil dihapus');
    res.redirect('/admin/teams');
});

// 1.e Segmen
const SEGMENT_NAME_RULE = /^[A-Za-z0-9]+$/;
const SEGMENT_VALUE_MODES = new Set(['id', 'nama', 'singkatan']);
const normalizeSegmenValueMode = (value) => {
    const mode = (value || '').toString().trim().toLowerCase();
    return SEGMENT_VALUE_MODES.has(mode) ? mode : 'id';
};
const SEGMENT_VALUE_MODE = normalizeSegmenValueMode(
    process.env.SEGMENT_SSO_VALUE_MODE || 'nama'
);

function validateSegmenInput({ nama, unitKerja, homebase, subhomebase }) {
    const errors = [];

    if (!nama || !SEGMENT_NAME_RULE.test(String(nama).trim())) {
        errors.push({ msg: 'Nama hanya boleh huruf atau angka tanpa karakter khusus' });
    }

    if (!unitKerja) {
        errors.push({ msg: 'Unit Kerja wajib diisi' });
    }

    // Homebase dan Subhomebase sekarang opsional

    return errors;
}

function resolveSegmenToken(req) {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const cookies = req.cookies || {};
    const cookieToken = cookies[SSO_COOKIE_NAME] || cookies.token || cookies.jwt;
    return bearerToken || cookieToken || null;
}

function buildSegmenValueMap(items = [], mode = 'id') {
    const map = new Map();
    items.forEach((item) => {
        if (!item || !item.id) return;
        const label =
            mode === 'singkatan'
                ? item.singkatan || item.text || item.id
                : item.nama || item.text || item.id;
        map.set(String(item.id), String(label));
    });
    return map;
}

function normalizeSegmenValue(value, map) {
    if (!value) return value;
    const key = String(value);
    return map.get(key) || value;
}

exports.segmen = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    let segmenList = await Segmen.find({}).sort({ timeStamp: -1 }).lean();
    if (segmenList.length && SEGMENT_VALUE_MODE !== 'id') {
        const token = resolveSegmenToken(req);
        try {
            const [unitOptions, homeOptions, subOptions] = await Promise.all([
                fetchSegmenOptions('unitkerja', '', token, {}, { valueMode: 'id' }),
                fetchSegmenOptions('homebase', '', token, {}, { valueMode: 'id' }),
                fetchSegmenOptions('subhomebase', '', token, {}, { valueMode: 'id' }),
            ]);
            const unitMap = buildSegmenValueMap(unitOptions, SEGMENT_VALUE_MODE);
            const homeMap = buildSegmenValueMap(homeOptions, SEGMENT_VALUE_MODE);
            const subMap = buildSegmenValueMap(subOptions, SEGMENT_VALUE_MODE);

            segmenList = segmenList.map((item) => ({
                ...item,
                unitKerja: normalizeSegmenValue(item.unitKerja, unitMap),
                homebase: normalizeSegmenValue(item.homebase, homeMap),
                subhomebase: normalizeSegmenValue(item.subhomebase, subMap),
            }));
        } catch (err) {
            // fallback to raw values if mapping fails
        }
    }

    res.render('admin/segemen', {
        user,
        title: 'admin segmen',
        segmenList,
    });
});

exports.createSegmen = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);

    const { nama, unitKerja, homebase, subhomebase } = req.body;
    const trimmedName = nama ? nama.trim() : '';
    const payload = {
        nama: trimmedName,
        unitKerja,
        homebase,
        subhomebase,
    };

    const errors = validateSegmenInput(payload);
    if (errors.length) {
        return res.status(400).json({ errors });
    }

    const duplicate = await Segmen.findOne({ nama: trimmedName });
    if (duplicate) {
        return res.status(409).json({ errors: [{ msg: 'Nama segmen sudah digunakan' }] });
    }

    const segmen = await Segmen.create({
        ...payload,
        createBy: req.user.id,
        editBy: req.user.id,
        timeStamp: new Date(),
        timeUpdate: new Date(),
    });

    return res.status(201).json({ success: true, segmen });
});

exports.updateSegmen = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { nama, unitKerja, homebase, subhomebase } = req.body;

    const trimmedName = nama ? nama.trim() : '';
    const payload = { nama: trimmedName, unitKerja, homebase, subhomebase };
    const errors = validateSegmenInput(payload);
    if (errors.length) {
        return res.status(400).json({ errors });
    }

    const segmen = await Segmen.findById(req.params.id);
    if (!segmen) {
        return res.status(404).json({ errors: [{ msg: 'Segmen tidak ditemukan' }] });
    }

    if (trimmedName !== segmen.nama) {
        const duplicate = await Segmen.findOne({ nama: trimmedName });
        if (duplicate) {
            return res.status(409).json({ errors: [{ msg: 'Nama segmen sudah digunakan' }] });
        }
    }

    segmen.nama = trimmedName;
    segmen.unitKerja = unitKerja;
    segmen.homebase = homebase;
    segmen.subhomebase = subhomebase;
    segmen.editBy = req.user.id;
    segmen.timeUpdate = new Date();

    await segmen.save();
    return res.json({ success: true, segmen });
});

exports.deleteSegmen = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const segmen = await Segmen.findById(req.params.id);
    if (!segmen) {
        return res.status(404).json({ errors: [{ msg: 'Segmen tidak ditemukan' }] });
    }

    await Segmen.deleteOne({ _id: req.params.id });
    return res.json({ success: true });
});

exports.segmenOptions = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const { type } = req.params;
    const search = req.query.search || '';
    const unitKerja = req.query.unitKerja || '';
    const homebase = req.query.homebase || '';
    const token = resolveSegmenToken(req);

    const allowedTypes = ['unitkerja', 'homebase', 'subhomebase'];
    if (!allowedTypes.includes((type || '').toLowerCase())) {
        return res.status(400).json({ errors: [{ msg: 'Tipe opsi tidak dikenal' }] });
    }

    try {
        const results = await fetchSegmenOptions(
            type.toLowerCase(),
            search,
            token,
            { unitKerja, homebase }
        );
        return res.json({ results });
    } catch (err) {
        const statusCode = err.status || 502;
        const message = err.message || 'Gagal mengambil data master dari SSO';
        return res.status(statusCode).json({ errors: [{ msg: message }] });
    }
});

exports.deleteBio = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const bio = await Bio.findById(req.params.id);

    if (!bio) {
        req.flash('error_msg', 'Bio tidak ditemukan');
        return res.redirect('/admin/bios');
    }

    removeUploadedFile(bio.logo);
    await Bio.deleteOne({ _id: req.params.id });

    req.flash('success_msg', 'Bio berhasil dihapus');
    res.redirect('/admin/bios');
});


// 1.1 Link Detail
exports.link = asyncHandler(async (req, res, next) => {
    const user = req.currentUser;
    ensureAdmin(req, res);

    const link = await Link.findOne({ alias: req.params.id })
        .populate('segmen', 'nama unitKerja homebase subhomebase');

    const segmenName = link?.segmen?.nama || '';
    const segmenSlug = normalizeSegmenSlug(segmenName);
    const shortUrl = segmenSlug
        ? `https://s.unjani.ac.id/${segmenSlug}/${link.alias}`
        : `https://s.unjani.ac.id/${link.alias}`;
    const shortPath = shortUrl.replace(/^https?:\/\//, '');
    const shortUrlEncoded = encodeURIComponent(shortUrl);
    res.render("admin/linkdetail", {
        title: "admin link",
        user,
        link,
        shortUrl,
        shortPath,
        shortUrlEncoded,
        segmenLabel: segmenName || ''
    });
});

// 2. Links
exports.stats = asyncHandler(async (req, res, next) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    // Ambil data links dan statistik secara paralel untuk efisiensi
    const [links, statistik] = await Promise.all([
        Link.find({}).lean(), // Gunakan lean() untuk mempercepat
        Stat.find({})
        .sort({
            _id: -1
        })
        .select("alias ip negara kota referer os browser bahasa timeStamp") // Ambil hanya field yang diperlukan
        .lean()
    ]);

    // Ubah data menjadi array yang lebih ringan dengan map()
    const stats = statistik.map(item => ({
        alias: item.alias,
        ip: item.ip,
        negara: item.negara,
        kota: item.kota,
        referer: item.referer,
        os: item.os,
        browser: item.browser,
        bahasa: item.bahasa || '',
        timeStamp: timeAgo(item.timeStamp),
        waktu: item.timeStamp
    }));

    // Hitung data chart dengan lebih efisien
    const chartCliks = countAccessesPerMonth(statistik);
    const chartLinks = getDataChartLinks(links);

    // Reverse data langsung dalam satu langkah
    res.render("admin/stats", {
        user,
        title: "admin stats",
        links,
        chartCliks: chartCliks.reverse(),
        chartLinks,
        stats // Data statistik yang telah diproses
    });
});

exports.genQRCode = asyncHandler(async (req, res) => {
    let { alias } = req.params;

    try {
        // Bersihkan alias dari spasi
        let temp_alias = alias.replace(/\s+/g, '').trim();
        
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
        const existingLink = await Link.findOne({ alias: temp_alias });
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
            ? `https://s.unjani.ac.id/${segmenSlug}/${temp_alias}`
            : `https://s.unjani.ac.id/${temp_alias}`;

        // 5. Generate QR Code dengan URL yang bersih
        await generateQRCodeWithLogo(
            shortUrl, // Hapus spasi yang tidak perlu
            logoPath,
            qrPath
        );

        // 6. Download favicon menggunakan URL asli dari database
        const favicon = await downloadFavicon(existingLink.link, temp_alias);

        // 7. Update database dengan validasi
        const updatedLink = await Link.findOneAndUpdate(
            { alias: temp_alias },
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

// 2. Analitics
exports.analytics = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const periodDays = parsePeriod(req.query.period);
    const analytics = await getOverviewAnalytics({
        scope: 'admin',
        periodDays,
        appBaseUrl: getAppBaseUrl(req),
    });

    res.render("admin/analytics", {
        user,
        title: "admin analytics",
        analytics,
        filterAction: '/admin/analytics',
    });
});

// 2.1 Analitic
exports.analytic = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    const user = req.currentUser;
    const periodDays = parsePeriod(req.query.period);
    const analytics = await getLinkAnalytics({
        scope: 'admin',
        alias: req.params.id,
        periodDays,
        appBaseUrl: getAppBaseUrl(req),
    });

    if (!analytics) {
        req.flash('error_msg', 'Data analytics link tidak ditemukan.');
        return res.redirect('/admin/links');
    }

    res.render("admin/analytic", {
        user,
        title: "admin analytics",
        analytics,
        filterAction: `/admin/analytic/${encodeURIComponent(analytics.link.alias)}`,
    });
});

// 3. Users
exports.users = asyncHandler(async (req, res, next) => {
    ensureAdmin(req, res);
    return res.redirect(buildSsoAdminUsersUrl());
});

// 3.1. Add User
exports.user = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    return res.status(410).json({
        errors: [{ msg: 'Kelola user dipusatkan di SSO-SISFO.' }],
        redirectTo: buildSsoAdminUsersUrl(),
    });
});

// 3.2. Update User
exports.updateUser = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    return res.status(410).json({
        errors: [{ msg: 'Kelola user dipusatkan di SSO-SISFO.' }],
        redirectTo: buildSsoAdminUsersUrl(),
    });
});

// 2.3 Delete User
exports.delUser = asyncHandler(async (req, res) => {
    ensureAdmin(req, res);
    return res.status(410).json({
        errors: [{ msg: 'Kelola user dipusatkan di SSO-SISFO.' }],
        redirectTo: buildSsoAdminUsersUrl(),
    });
});

// 4. Feedback
exports.feedback = asyncHandler(async (req, res, next) => {
    ensureAdmin(req, res);
    const user = req.currentUser;

    // 2. Ambil data feedback dari database
    const feedbacks = await Feedback.find({})
        .sort({
            _id: -1
        })
        .lean(); // Gunakan .lean() untuk mendapatkan plain object

    // 3. Transform data untuk menambahkan label jenis pertanyaan
    const feedbacksWithLabels = feedbacks.map(feedback => ({
        ...feedback,
        enquireLabel: ENQUIRE_TYPES[feedback.enquire] || 'Unknown Type'
    }));


    res.render("admin/feedback", {
        title: "admin feedback",
        feedbacks: feedbacksWithLabels,
        user,
    });
});

function toSentenceCase(str) {
    // Pisahkan string menjadi array kalimat berdasarkan titik (.)
    let sentences = str.split(" ");
    let hasil = []

    // Iterasi melalui setiap kalimat dan ubah huruf pertama menjadi besar
    for (const sentence of sentences) {
        // Mengubah huruf pertama menjadi besar
        hasil.push(sentence[0].toUpperCase() + sentence.substring(1).toLowerCase());
    }

    // Gabungkan kembali kalimat-kalimat yang telah diubah menjadi satu string
    let result = hasil.join(" ");

    return result;
}

function sendEmail(card) {
    let tahun = new Date().getFullYear();

    let labelNomorInduk = ''
    let labelUnitKerja = ''
    if (card.role === 'mahasiswa') {
        labelNomorInduk = 'NIM'
        labelUnitKerja = 'Program Studi'
    } else if (card.role === 'tendik') {
        labelUnitKerja = 'Unit Kerja'
        labelNomorInduk = 'NIP'
    } else if (card.role === 'dosen') {
        labelUnitKerja = 'Homebase'
        labelNomorInduk = 'NID'
    }
    const mailOptions = {
        from: 'helpdesk.sisfo@unjani.ac.id',
        to: 'wildan.pratama.work@gmail.com , wildan.pratama@unjani.ac.id , zikri.fadilah@unjani.ac.id, bennysasotyo@gmail.com',
        subject: "Notifikasi",
        text: '',
        html: `<table class="body-wrap" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; width: 100%; background-color: transparent; margin: 0;">
                                <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                    <td style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0;" valign="top"></td>
                                    <td class="container" width="600" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; vertical-align: top; display: block !important; max-width: 600px !important; clear: both !important; margin: 0 auto;" valign="top">
                                        <div class="content" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; max-width: 600px; display: block; margin: 0 auto; padding: 20px;">
                                            <table class="main" width="100%" cellpadding="0" cellspacing="0" itemprop="action" itemscope itemtype="http://schema.org/ConfirmAction" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; border-radius: 3px; margin: 0; border: none;">
                                                <tr style="font-family: 'Roboto', sans-serif; font-size: 14px; margin: 0;">
                                                    <td class="content-wrap" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; color: #495057; font-size: 14px; vertical-align: top; margin: 0;padding: 30px;border-radius: 7px; background-color: #fff; border: 1px solid #e9ebec;" valign="top">
                                                        <meta itemprop="name" content="Confirm Email" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;" />
                                                        <table width="100%" cellpadding="0" cellspacing="0" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                                            <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                                                <td class="content-block" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0; padding: 0 0 20px;" valign="top">
                                                                    <div style="text-align: center;margin-bottom: 15px;">
                                                                        <img src="https://helpdesk.sisfo.unjani.ac.id/assets/images/brands/brand.png" alt="" height="50">
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                            <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                                                <td class="content-block" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; line-height: 1.5; font-size: 24px; vertical-align: top; margin: 0; padding: 0 0 10px;text-align: center; font-weight: 500;" valign="top">
                                                                    Pengajuan Kartu Akses Parkir
                                                                </td>
                                                            </tr>
                                                            <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                                                <td class="content-block" style="font-family: 'Roboto', sans-serif; color: #878a99; line-height: 1.5; box-sizing: border-box; font-size: 15px; vertical-align: top; margin: 0; padding: 0 0 24px; text-align: center;" valign="top">
                                                                    Nama : ` + card.namaLengkap + `<br> 
                                                                    ` + labelNomorInduk + ` : ` + card.nomorInduk + `<br>
                                                                    ` + labelUnitKerja + ` : ` + card.prodiUnit + ` 
                                                                </td>
                                                            </tr>
                                                            <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0;">
                                                                <td class="content-block" itemprop="handler" itemscope itemtype="http://schema.org/HttpActionHandler" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0; padding: 0 0 24px; text-align: center;" valign="top">
                                                                    <a href="#" itemprop="url" style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: .8125rem;font-weight: 400; color: #FFF; text-decoration: none;text-align: center; cursor: pointer; display: inline-block; border-radius: .25rem; text-transform: capitalize; background-color: #0ab39c; margin: 0; border-color: #0ab39c; border-style: solid; border-width: 1px; padding: .5rem .9rem;" onMouseOver="this.style.background='#099885'" onMouseOut="this.style.background='#0ab39c'">` + card.role + `</a>
                                                                </td>
                                                            </tr>

                                                            <tr style="font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; margin: 0; border-top: 1px solid #e9ebec;">
                                                                <td class="content-block" style="color: #878a99; text-align: center;font-family: 'Roboto', sans-serif; box-sizing: border-box; font-size: 14px; vertical-align: top; margin: 0; padding: 0; padding-top: 15px" valign="top">
                                                                    Jika terjadi kesalahan silahkan konfirmasi ke admin.
                                                                </td>
                                                            </tr>
                                                        </table>
                                                    </td>
                                                </tr>
                                            </table>
                                            <div style="text-align: center; margin: 0px auto;">
                                                <ul style="list-style: none;display: flex; justify-content: space-evenly; padding-top: 25px;margin-bottom: 20px; padding-left: 0px; font-family: 'Roboto', sans-serif;">
                                                    <li>
                                                        <a href="#" style="color: #495057;">Help Center</a>
                                                    </li>
                                                    <li>
                                                        <a href="#" style="color: #495057;">Support 24/7</a>
                                                    </li>
                                                    <li>
                                                        <a href="#" style="color: #495057;">Account</a>
                                                    </li>
                                                </ul>
                                                <p style="font-family: 'Roboto', sans-serif; font-size: 14px;color: #98a6ad; margin: 0px;">` + tahun + ` Apps Sisfo. Design & Develop by <a href="mailto:wildan.pratama.work@gmail.com">Wildan Pratama, S.Kom.</a></p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </table>`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).send('Error while sending email: ' + error.toString());
        }
        res.status(200).send('Email sent: ' + info.response);
    });
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

async function ensureAdmin(req, res) {
    const role = req.currentUser?.role || req.user?.role;
    if (role !== 'admin') {
        req.flash('error_msg', 'Anda tidak punya Akses');
        return res.redirect('/'); // Pastikan eksekusi berhenti di sini
    }
    return true;
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




