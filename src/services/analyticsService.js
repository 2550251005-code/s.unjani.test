const Link = require('../models/Link');
const Stat = require('../models/Stat');

const PERIOD_OPTIONS = [7, 30, 90];
const DEFAULT_PERIOD = 30;
const TIMEZONE = 'Asia/Jakarta';
const TOP_LINKS_LIMIT = 10;
const RECENT_ACTIVITY_LIMIT = 20;

const parsePeriod = (periodRaw) => {
  const parsed = Number.parseInt(String(periodRaw || ''), 10);
  return PERIOD_OPTIONS.includes(parsed) ? parsed : DEFAULT_PERIOD;
};

const buildDateRange = (periodDays, now = new Date()) => {
  const normalizedPeriod = parsePeriod(periodDays);
  const endAt = new Date(now);
  const startAt = new Date(now);
  startAt.setHours(0, 0, 0, 0);
  startAt.setDate(startAt.getDate() - (normalizedPeriod - 1));
  return { startAt, endAt };
};

const normalizeBaseUrl = (value) =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '');

const buildShortUrl = (baseUrl, alias) => {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedAlias = String(alias || '').trim();
  if (!normalizedBase || !normalizedAlias) return '';
  return `${normalizedBase}/${normalizedAlias}`;
};

const shortPathFromUrl = (url) => String(url || '').replace(/^https?:\/\//i, '');

const normalizeDimensionValue = (value) => {
  const raw = value == null ? '' : String(value).trim();
  return raw || 'Unknown';
};

const pad = (value) => String(value).padStart(2, '0');

const buildDailyLabels = (periodDays, now = new Date()) => {
  const normalizedPeriod = parsePeriod(periodDays);
  const labels = [];
  for (let i = normalizedPeriod - 1; i >= 0; i -= 1) {
    const current = new Date(now);
    current.setDate(now.getDate() - i);
    labels.push(`${pad(current.getDate())}/${pad(current.getMonth() + 1)}`);
  }
  return labels;
};

const buildMonthlyLabels = (months = 12, now = new Date()) => {
  const labels = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    labels.push(`${pad(current.getUTCMonth() + 1)}/${current.getUTCFullYear()}`);
  }
  return labels;
};

const toSeriesByLabels = (labels, rows = []) => {
  const map = (rows || []).reduce((acc, row) => {
    acc[row._id] = row.count || 0;
    return acc;
  }, {});
  return labels.map((label) => map[label] || 0);
};

const normalizeScope = (scopeRaw) => (scopeRaw === 'admin' ? 'admin' : 'user');

const resolveScopeFilters = ({ scope, userId }) => {
  const scopeNormalized = normalizeScope(scope);
  if (scopeNormalized === 'user' && !userId) {
    throw new Error('userId wajib diisi untuk scope user.');
  }

  if (scopeNormalized === 'admin') {
    return {
      linkFilter: {},
      statFilter: {},
      scope: scopeNormalized,
    };
  }

  const userIdString = String(userId);
  return {
    linkFilter: { user_id: userIdString },
    statFilter: { userID: userIdString },
    scope: scopeNormalized,
  };
};

const buildPeriodStatFilter = (baseFilter, startAt, endAt) => ({
  ...baseFilter,
  timeStamp: { $gte: startAt, $lte: endAt },
});

const buildMonthlyStatFilter = (baseFilter, now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() - 11);
  return {
    ...baseFilter,
    timeStamp: { $gte: start, $lte: now },
  };
};

const aggregateUniqueVisitors = async (matchFilter) => {
  const rows = await Stat.aggregate([
    { $match: matchFilter },
    { $group: { _id: '$ip' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
};

const aggregateTimeSeries = async ({ matchFilter, format }) =>
  Stat.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: {
          $dateToString: {
            format,
            date: '$timeStamp',
            timezone: TIMEZONE,
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

const aggregateDimension = async ({ matchFilter, field, limit }) => {
  const rows = await Stat.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    label: normalizeDimensionValue(row._id),
    count: row.count || 0,
  }));
};

const getOverviewAnalytics = async ({
  scope,
  userId,
  periodDays,
  appBaseUrl,
}) => {
  const normalizedPeriod = parsePeriod(periodDays);
  const { startAt, endAt } = buildDateRange(normalizedPeriod);
  const dailyLabels = buildDailyLabels(normalizedPeriod, endAt);
  const monthlyLabels = buildMonthlyLabels(12, endAt);
  const baseUrl = normalizeBaseUrl(appBaseUrl);

  const { linkFilter, statFilter, scope: resolvedScope } = resolveScopeFilters({
    scope,
    userId,
  });

  const periodStatFilter = buildPeriodStatFilter(statFilter, startAt, endAt);
  const monthlyStatFilter = buildMonthlyStatFilter(statFilter, endAt);

  const [
    totalLinks,
    totalAccess,
    uniqueVisitors,
    dailyRows,
    monthlyRows,
    topLinksRaw,
    browsers,
    cities,
    countries,
    recentRaw,
  ] = await Promise.all([
    Link.countDocuments(linkFilter),
    Stat.countDocuments(periodStatFilter),
    aggregateUniqueVisitors(periodStatFilter),
    aggregateTimeSeries({ matchFilter: periodStatFilter, format: '%d/%m' }),
    aggregateTimeSeries({ matchFilter: monthlyStatFilter, format: '%m/%Y' }),
    Stat.aggregate([
      { $match: { ...periodStatFilter, alias: { $nin: ['', null] } } },
      {
        $group: {
          _id: '$alias',
          count: { $sum: 1 },
          lastAccess: { $max: '$timeStamp' },
        },
      },
      { $sort: { count: -1, lastAccess: -1 } },
      { $limit: TOP_LINKS_LIMIT },
    ]),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'browser', limit: 10 }),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'kota', limit: 10 }),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'negara', limit: 10 }),
    Stat.find(periodStatFilter).sort({ timeStamp: -1 }).limit(RECENT_ACTIVITY_LIMIT).lean(),
  ]);

  const topAliases = topLinksRaw.map((item) => item._id).filter(Boolean);
  const linkDocs = topAliases.length
    ? await Link.find({
        ...(resolvedScope === 'user' ? linkFilter : {}),
        alias: { $in: topAliases },
      })
        .select('alias link')
        .lean()
    : [];
  const linkByAlias = linkDocs.reduce((acc, item) => {
    if (!acc[item.alias]) {
      acc[item.alias] = item;
    }
    return acc;
  }, {});

  const detailBasePath = resolvedScope === 'admin' ? '/admin/analytic' : '/users/analytic';
  const topLinks = topLinksRaw.map((item) => {
    const alias = item._id;
    const linkDoc = linkByAlias[alias] || {};
    const shortUrl = buildShortUrl(baseUrl, alias);
    return {
      alias,
      count: item.count || 0,
      lastAccess: item.lastAccess || null,
      targetUrl: linkDoc.link || '',
      shortUrl,
      shortPath: shortPathFromUrl(shortUrl),
      detailUrl: `${detailBasePath}/${encodeURIComponent(alias)}?period=${normalizedPeriod}`,
    };
  });

  const recentActivity = recentRaw.map((item) => {
    const shortUrl = buildShortUrl(baseUrl, item.alias);
    return {
      alias: item.alias,
      userID: item.userID,
      ip: normalizeDimensionValue(item.ip),
      negara: normalizeDimensionValue(item.negara),
      kota: normalizeDimensionValue(item.kota),
      browser: normalizeDimensionValue(item.browser),
      os: normalizeDimensionValue(item.os),
      referer: normalizeDimensionValue(item.referer),
      bahasa: normalizeDimensionValue(item.bahasa),
      timeStamp: item.timeStamp || null,
      shortUrl,
      shortPath: shortPathFromUrl(shortUrl),
    };
  });

  const avgAccessPerLink = totalLinks > 0
    ? Number((totalAccess / totalLinks).toFixed(2))
    : 0;

  return {
    periodDays: normalizedPeriod,
    periodOptions: PERIOD_OPTIONS,
    kpis: {
      totalLinks,
      totalAccess,
      uniqueVisitors,
      avgAccessPerLink,
    },
    charts: {
      daily: {
        labels: dailyLabels,
        data: toSeriesByLabels(dailyLabels, dailyRows),
      },
      monthly: {
        labels: monthlyLabels,
        data: toSeriesByLabels(monthlyLabels, monthlyRows),
      },
    },
    topLinks,
    breakdowns: {
      browsers,
      cities,
      countries,
    },
    recentActivity,
    emptyState: totalLinks === 0 && totalAccess === 0,
  };
};

const getLinkAnalytics = async ({
  scope,
  userId,
  alias,
  periodDays,
  appBaseUrl,
}) => {
  const normalizedAlias = String(alias || '').trim();
  if (!normalizedAlias) {
    return null;
  }

  const normalizedPeriod = parsePeriod(periodDays);
  const { startAt, endAt } = buildDateRange(normalizedPeriod);
  const dailyLabels = buildDailyLabels(normalizedPeriod, endAt);
  const monthlyLabels = buildMonthlyLabels(12, endAt);
  const baseUrl = normalizeBaseUrl(appBaseUrl);

  const { linkFilter, statFilter } = resolveScopeFilters({ scope, userId });
  const link = await Link.findOne({
    ...linkFilter,
    alias: normalizedAlias,
  })
    .select('alias link user_id deskripsi')
    .lean();

  if (!link) {
    return null;
  }

  const linkID = String(link._id);
  const statForLink = { ...statFilter, linkID };
  const periodStatFilter = buildPeriodStatFilter(statForLink, startAt, endAt);
  const monthlyStatFilter = buildMonthlyStatFilter(statForLink, endAt);

  const [
    totalAccess,
    uniqueVisitors,
    lastAccessRow,
    dailyRows,
    monthlyRows,
    browsers,
    cities,
    countries,
    recentRaw,
  ] = await Promise.all([
    Stat.countDocuments(periodStatFilter),
    aggregateUniqueVisitors(periodStatFilter),
    Stat.findOne(statForLink).sort({ timeStamp: -1 }).select('timeStamp').lean(),
    aggregateTimeSeries({ matchFilter: periodStatFilter, format: '%d/%m' }),
    aggregateTimeSeries({ matchFilter: monthlyStatFilter, format: '%m/%Y' }),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'browser', limit: 10 }),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'kota', limit: 10 }),
    aggregateDimension({ matchFilter: periodStatFilter, field: 'negara', limit: 10 }),
    Stat.find(periodStatFilter).sort({ timeStamp: -1 }).limit(RECENT_ACTIVITY_LIMIT).lean(),
  ]);

  const shortUrl = buildShortUrl(baseUrl, link.alias);
  const recentActivity = recentRaw.map((item) => ({
    alias: item.alias,
    ip: normalizeDimensionValue(item.ip),
    negara: normalizeDimensionValue(item.negara),
    kota: normalizeDimensionValue(item.kota),
    browser: normalizeDimensionValue(item.browser),
    os: normalizeDimensionValue(item.os),
    referer: normalizeDimensionValue(item.referer),
    bahasa: normalizeDimensionValue(item.bahasa),
    timeStamp: item.timeStamp || null,
  }));

  return {
    periodDays: normalizedPeriod,
    periodOptions: PERIOD_OPTIONS,
    link: {
      alias: link.alias,
      targetUrl: link.link || '',
      description: link.deskripsi || '',
      shortUrl,
      shortPath: shortPathFromUrl(shortUrl),
    },
    kpis: {
      totalAccess,
      uniqueVisitors,
      lastAccess: lastAccessRow?.timeStamp || null,
    },
    charts: {
      daily: {
        labels: dailyLabels,
        data: toSeriesByLabels(dailyLabels, dailyRows),
      },
      monthly: {
        labels: monthlyLabels,
        data: toSeriesByLabels(monthlyLabels, monthlyRows),
      },
    },
    breakdowns: {
      browsers,
      cities,
      countries,
    },
    recentActivity,
    emptyState: totalAccess === 0,
  };
};

module.exports = {
  PERIOD_OPTIONS,
  DEFAULT_PERIOD,
  parsePeriod,
  buildDateRange,
  getOverviewAnalytics,
  getLinkAnalytics,
};
