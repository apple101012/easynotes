const { invoke } = window.__TAURI__.core;

const THEME_STORAGE_KEY = 'easynotes.themes';
const ACTIVE_THEME_KEY = 'easynotes.activeTheme';

export const ANTINOTE_THEME_KEYS = [
  'name', 'isDarkTheme',
  'background', 'backgroundFade',
  'typeMain', 'typeSubtle', 'typeSubtlePlus', 'typeHighlight',
  'typeLight', 'typeSuperlight', 'typeHyperLight', 'typeReverse',
  'accent1Main', 'accent1Secondary', 'accent1Tertiary',
  'accent2Main', 'accent2Secondary',
  'accent3Main', 'accent3Secondary',
  'accent4Main', 'accent4Secondary',
  'accent5Main', 'accent5Secondary',
  'gridSuperlight', 'gridClear', 'gridBold'
];

export const DEFAULT_THEMES = [
  {
    name: 'Easy Light',
    isDarkTheme: false,
    background: '#fbfaf7',
    backgroundFade: '#f1eee8',
    typeMain: '#23272a',
    typeSubtle: '#6c716f',
    typeSubtlePlus: '#55756f',
    typeHighlight: '#e4eee9',
    typeLight: '#8a908d',
    typeSuperlight: '#d8ddd8',
    typeHyperLight: '#f4f1eb',
    typeReverse: '#ffffff',
    accent1Main: '#3e7f74',
    accent1Secondary: '#315f59',
    accent1Tertiary: '#264d49',
    accent2Main: '#4a7da8',
    accent2Secondary: '#365f82',
    accent3Main: '#77935a',
    accent3Secondary: '#5c7147',
    accent4Main: '#c08a43',
    accent4Secondary: '#956831',
    accent5Main: '#c25b50',
    accent5Secondary: '#98453d',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false
  },
  {
    name: 'Easy Dark',
    isDarkTheme: true,
    background: '#181b1d',
    backgroundFade: '#202529',
    typeMain: '#edf1ee',
    typeSubtle: '#a9b4ae',
    typeSubtlePlus: '#82c2b6',
    typeHighlight: '#253d3b',
    typeLight: '#75827d',
    typeSuperlight: '#2b3233',
    typeHyperLight: '#202629',
    typeReverse: '#151719',
    accent1Main: '#70c0b2',
    accent1Secondary: '#55998f',
    accent1Tertiary: '#427b73',
    accent2Main: '#84aede',
    accent2Secondary: '#668ab3',
    accent3Main: '#a6c779',
    accent3Secondary: '#7f9d5b',
    accent4Main: '#e1ad5b',
    accent4Secondary: '#b98943',
    accent5Main: '#e0766c',
    accent5Secondary: '#b05850',
    gridSuperlight: '#00000000',
    gridClear: '#00000000',
    gridBold: '#00000000',
    gridEnabled: false
  }
];

export function validateEasyNotesTheme(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Theme must be a JSON object.');
  }

  if (!value.name || typeof value.name !== 'string') {
    throw new Error('Theme is missing a string "name" field.');
  }

  const theme = { ...DEFAULT_THEMES[0], ...value };
  theme.gridEnabled = typeof value.gridEnabled === 'boolean'
    ? value.gridEnabled
    : hasVisibleGrid(value);
  theme.isTranslucent = typeof value.isTranslucent === 'boolean'
    ? value.isTranslucent
    : hasAlpha(theme.background) || hasAlpha(theme.backgroundFade);

  for (const key of ANTINOTE_THEME_KEYS) {
    if (key === 'name') continue;
    if (key === 'isDarkTheme') {
      theme[key] = Boolean(theme[key]);
      continue;
    }
    if (typeof theme[key] !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(theme[key])) {
      throw new Error(`Theme field "${key}" must be a hex color.`);
    }
  }

  return theme;
}

export async function loadThemes() {
  const fileThemes = await loadThemesFromDisk();
  const legacyThemes = loadLegacyLocalStorageThemes();
  return mergeThemes(DEFAULT_THEMES, legacyThemes, fileThemes);
}

export async function saveImportedTheme(theme) {
  const validated = validateEasyNotesTheme(theme);
  await invoke('save_theme_file', {
    name: validated.name,
    json: JSON.stringify(validated, null, 2)
  });
}

async function loadThemesFromDisk() {
  try {
    const files = await invoke('list_theme_files');
    return files.map((file) => validateEasyNotesTheme(JSON.parse(file.json)));
  } catch (error) {
    console.warn('Could not load themes from disk:', error);
    return [];
  }
}

function loadLegacyLocalStorageThemes() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.map(validateEasyNotesTheme) : [];
  } catch (error) {
    console.warn('Could not load legacy localStorage themes:', error);
    return [];
  }
}

export function getActiveThemeName() {
  return localStorage.getItem(ACTIVE_THEME_KEY) || DEFAULT_THEMES[0].name;
}

export function setActiveThemeName(name) {
  localStorage.setItem(ACTIVE_THEME_KEY, name);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  const mapped = mapThemeToCss(theme);
  Object.entries(mapped).forEach(([key, value]) => root.style.setProperty(key, value));
  root.dataset.theme = theme.isDarkTheme ? 'dark' : 'light';
  root.dataset.grid = theme.gridEnabled ? 'on' : 'off';
  root.dataset.translucent = theme.isTranslucent ? 'on' : 'off';
}

export function mergeThemes(...groups) {
  const byName = new Map();
  groups.flat().forEach((theme) => byName.set(theme.name, validateEasyNotesTheme(theme)));
  return [...byName.values()];
}

function hasAlpha(color) {
  return /^#[0-9a-fA-F]{8}$/.test(color) && color.slice(7).toLowerCase() !== 'ff';
}

function hasVisibleGrid(theme) {
  const gridKeys = ['gridSuperlight', 'gridClear', 'gridBold'];
  return gridKeys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(theme, key)) return false;
    const color = theme[key];
    if (typeof color !== 'string') return false;
    if (/^#[0-9a-fA-F]{8}$/.test(color) && color.slice(7).toLowerCase() === '00') return false;
    return stripAlpha(color).toLowerCase() !== stripAlpha(String(theme.background || '')).toLowerCase();
  });
}

function stripAlpha(color) {
  return /^#[0-9a-fA-F]{8}$/.test(color) ? color.slice(0, 7) : color;
}

function mapThemeToCss(theme) {
  return {
    '--theme-background': theme.background,
    '--theme-background-fade': theme.backgroundFade,
    '--theme-type-main': theme.typeMain,
    '--theme-type-subtle': theme.typeSubtle,
    '--theme-type-subtle-plus': theme.typeSubtlePlus,
    '--theme-type-highlight': theme.typeHighlight,
    '--theme-type-light': theme.typeLight,
    '--theme-type-superlight': theme.typeSuperlight,
    '--theme-type-hyperlight': theme.typeHyperLight,
    '--theme-type-reverse': theme.typeReverse,
    '--theme-accent-main': theme.accent1Main,
    '--theme-accent-secondary': theme.accent1Secondary,
    '--theme-accent-tertiary': theme.accent1Tertiary,
    '--theme-danger': theme.accent5Main,
    '--theme-control-text': theme.isDarkTheme ? theme.typeMain : theme.typeReverse,
    '--theme-grid-superlight': theme.gridSuperlight,
    '--theme-grid-clear': theme.gridClear,
    '--theme-grid-bold': theme.gridBold,

    '--theme-accent-2-main': theme.accent2Main,
    '--theme-accent-2-secondary': theme.accent2Secondary,
    '--theme-accent-3-main': theme.accent3Main,
    '--theme-accent-3-secondary': theme.accent3Secondary,
    '--theme-accent-4-main': theme.accent4Main,
    '--theme-accent-4-secondary': theme.accent4Secondary,
    '--theme-accent-5-main': theme.accent5Main,
    '--theme-accent-5-secondary': theme.accent5Secondary
  };
}
