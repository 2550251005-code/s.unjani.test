const normalizeValue = (value) => (value || '').toString().trim();
const normalizeKey = (value) => normalizeValue(value).toLowerCase();

const isEmptySegmenValue = (value) => {
  const normalized = normalizeKey(value);
  return !normalized || normalized === '-' || normalized === 'null' || normalized === 'undefined';
};

const buildUserSegmenProfiles = (user) => {
  const profiles = [];
  const struktural = user?.jabatan?.struktural;
  if (normalizeValue(struktural?.unitKerja)) {
    profiles.push({
      unitKerja: normalizeKey(struktural.unitKerja),
      homebase: normalizeKey(struktural.homeBase),
      subhomebase: normalizeKey(struktural.subHomeBase),
      raw: {
        unitKerja: normalizeValue(struktural.unitKerja),
        homebase: normalizeValue(struktural.homeBase),
        subhomebase: normalizeValue(struktural.subHomeBase),
      },
    });
  }

  const akademik = user?.jabatan?.akademik;
  if (normalizeValue(akademik?.unitKerja)) {
    profiles.push({
      unitKerja: normalizeKey(akademik.unitKerja),
      homebase: normalizeKey(akademik.homeBase),
      subhomebase: normalizeKey(akademik.subHomeBase || ''),
      raw: {
        unitKerja: normalizeValue(akademik.unitKerja),
        homebase: normalizeValue(akademik.homeBase),
        subhomebase: normalizeValue(akademik.subHomeBase || ''),
      },
    });
  }

  if (!profiles.length) {
    const fallbackUnit = normalizeValue(user?.unitKerja);
    if (fallbackUnit) {
      profiles.push({
        unitKerja: normalizeKey(fallbackUnit),
        homebase: normalizeKey(user?.homebase || user?.homeBase),
        subhomebase: normalizeKey(user?.subHomeBase || user?.subhomebase),
        raw: {
          unitKerja: fallbackUnit,
          homebase: normalizeValue(user?.homebase || user?.homeBase),
          subhomebase: normalizeValue(user?.subHomeBase || user?.subhomebase),
        },
      });
    }
  }

  return profiles;
};

const isSegmenAllowedForProfile = (segmen, profile) => {
  if (!segmen || !profile) return false;
  if (normalizeKey(segmen.unitKerja) !== profile.unitKerja) return false;
  if (!isEmptySegmenValue(segmen.homebase) && normalizeKey(segmen.homebase) !== profile.homebase) {
    return false;
  }
  if (!isEmptySegmenValue(segmen.subhomebase) && normalizeKey(segmen.subhomebase) !== profile.subhomebase) {
    return false;
  }
  return true;
};

const isSegmenAllowedForUser = (segmen, user) => {
  const profiles = buildUserSegmenProfiles(user);
  if (!profiles.length) return false;
  return profiles.some((profile) => isSegmenAllowedForProfile(segmen, profile));
};

module.exports = {
  normalizeValue,
  normalizeKey,
  isEmptySegmenValue,
  buildUserSegmenProfiles,
  isSegmenAllowedForProfile,
  isSegmenAllowedForUser,
};
