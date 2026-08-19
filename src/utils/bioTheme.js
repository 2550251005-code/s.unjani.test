const ALLOWED_PRESETS = ['unjani', 'sunset', 'ocean', 'midnight'];
const ALLOWED_BACKGROUND_MODES = ['gradient', 'solid'];
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const PRESET_THEMES = {
  unjani: {
    preset: 'unjani',
    backgroundMode: 'gradient',
    backgroundSolid: '#0a241c',
    gradientFrom: '#0f2e25',
    gradientTo: '#0a241c',
    buttonColor: '#155f49',
    buttonTextColor: '#ffffff',
  },
  sunset: {
    preset: 'sunset',
    backgroundMode: 'gradient',
    backgroundSolid: '#31112d',
    gradientFrom: '#ff6b35',
    gradientTo: '#4a154b',
    buttonColor: '#ffd166',
    buttonTextColor: '#1b1b1b',
  },
  ocean: {
    preset: 'ocean',
    backgroundMode: 'gradient',
    backgroundSolid: '#102542',
    gradientFrom: '#0f4c81',
    gradientTo: '#1c2541',
    buttonColor: '#5bc0be',
    buttonTextColor: '#0b132b',
  },
  midnight: {
    preset: 'midnight',
    backgroundMode: 'gradient',
    backgroundSolid: '#111827',
    gradientFrom: '#0f172a',
    gradientTo: '#312e81',
    buttonColor: '#22d3ee',
    buttonTextColor: '#0b1120',
  },
};

const DEFAULT_THEME = PRESET_THEMES.unjani;

const normalizePreset = (value) => {
  const preset = (value || '').toString().trim().toLowerCase();
  return ALLOWED_PRESETS.includes(preset) ? preset : DEFAULT_THEME.preset;
};

const normalizeBackgroundMode = (value) => {
  const mode = (value || '').toString().trim().toLowerCase();
  return ALLOWED_BACKGROUND_MODES.includes(mode) ? mode : DEFAULT_THEME.backgroundMode;
};

const sanitizeHexColor = (value, fallback) => {
  const raw = (value || '').toString().trim();
  if (!HEX_COLOR_PATTERN.test(raw)) {
    return fallback;
  }
  return raw.toLowerCase();
};

const getPresetTheme = (preset) => {
  const normalizedPreset = normalizePreset(preset);
  return {
    ...PRESET_THEMES[normalizedPreset],
  };
};

const sanitizeBioThemeInput = (body = {}) => {
  const preset = normalizePreset(body.themePreset);
  const presetTheme = getPresetTheme(preset);
  const backgroundMode = normalizeBackgroundMode(body.themeBackgroundMode);

  return {
    preset,
    backgroundMode,
    backgroundSolid: sanitizeHexColor(body.themeBackgroundSolid, presetTheme.backgroundSolid),
    gradientFrom: sanitizeHexColor(body.themeGradientFrom, presetTheme.gradientFrom),
    gradientTo: sanitizeHexColor(body.themeGradientTo, presetTheme.gradientTo),
    buttonColor: sanitizeHexColor(body.themeButtonColor, presetTheme.buttonColor),
    buttonTextColor: sanitizeHexColor(body.themeButtonTextColor, presetTheme.buttonTextColor),
  };
};

const resolveBioTheme = (themeFromDb = {}) => {
  const preset = normalizePreset(themeFromDb?.preset);
  const presetTheme = getPresetTheme(preset);
  const modeFallback = presetTheme.backgroundMode || DEFAULT_THEME.backgroundMode;
  const backgroundMode = normalizeBackgroundMode(themeFromDb?.backgroundMode || modeFallback);

  return {
    preset,
    backgroundMode,
    backgroundSolid: sanitizeHexColor(themeFromDb?.backgroundSolid, presetTheme.backgroundSolid),
    gradientFrom: sanitizeHexColor(themeFromDb?.gradientFrom, presetTheme.gradientFrom),
    gradientTo: sanitizeHexColor(themeFromDb?.gradientTo, presetTheme.gradientTo),
    buttonColor: sanitizeHexColor(themeFromDb?.buttonColor, presetTheme.buttonColor),
    buttonTextColor: sanitizeHexColor(themeFromDb?.buttonTextColor, presetTheme.buttonTextColor),
  };
};

module.exports = {
  ALLOWED_PRESETS,
  DEFAULT_THEME,
  sanitizeHexColor,
  getPresetTheme,
  sanitizeBioThemeInput,
  resolveBioTheme,
};
