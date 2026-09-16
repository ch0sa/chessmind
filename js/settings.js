/**
 * @file settings.js
 * @description Manages user preferences and settings for ChessMind with localStorage persistence.
 * @module settings
 */

/**
 * Storage key used in browser localStorage.
 */
export const STORAGE_KEY = 'chessmind-settings';

/**
 * Default configuration values for ChessMind.
 */
export const DEFAULTS = {
  theme: 'dark',
  depth: 20,
  multiPV: 3,
  threads: Math.max(1, Math.floor(((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) / 2)),
  ttsEnabled: false,
  ttsVoice: null,
  ttsRate: 1.0,
  liteMode: false,
  boardOrientation: 'white',
  showCoordinates: true,
  pieceSet: 'cburnett',
  voiceEngine: 'webspeech',  // 'webspeech' or 'whisper'
  autoAnalyze: false,
  showEvalBar: true,
  highlightBestMove: true,
  animationSpeed: 200,
};

/**
 * Internal in-memory cache of the current settings.
 * @type {Object | null}
 */
let cachedSettings = null;

/**
 * Fallback in-memory storage if window.localStorage is unavailable (e.g. disabled or SSR).
 * @type {Map<string, string>}
 */
const memoryStorage = new Map();

/**
 * Safely retrieve an item from localStorage with memory fallback.
 * @param {string} key 
 * @returns {string | null}
 */
function getStorageItem(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (err) {
    console.warn('[ChessMind Settings] localStorage read error:', err);
  }
  return memoryStorage.get(key) ?? null;
}

/**
 * Safely write an item to localStorage with memory fallback.
 * @param {string} key 
 * @param {string} value 
 * @returns {boolean} True if write succeeded
 */
function setStorageItem(key, value) {
  let success = false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      success = true;
    }
  } catch (err) {
    console.warn('[ChessMind Settings] localStorage write error:', err);
  }
  memoryStorage.set(key, value);
  return success;
}

/**
 * Safely delete an item from localStorage.
 * @param {string} key 
 */
function removeStorageItem(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('[ChessMind Settings] localStorage remove error:', err);
  }
  memoryStorage.delete(key);
}

/**
 * Creates a clean shallow clone of an object.
 * @param {Object} obj 
 * @returns {Object}
 */
function clone(obj) {
  return { ...obj };
}

/**
 * Validates and clamps a given setting value based on expected type and range.
 * @param {string} key 
 * @param {*} value 
 * @returns {*} Sanitized value or default value if invalid
 */
function sanitizeSetting(key, value) {
  if (value === undefined || value === null) {
    return DEFAULTS[key] ?? null;
  }

  switch (key) {
    case 'theme':
      return value === 'light' ? 'light' : 'dark';

    case 'depth': {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(1, Math.min(40, Math.round(num))) : DEFAULTS.depth;
    }

    case 'multiPV': {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(1, Math.min(10, Math.round(num))) : DEFAULTS.multiPV;
    }

    case 'threads': {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(1, Math.min(32, Math.round(num))) : DEFAULTS.threads;
    }

    case 'ttsEnabled':
    case 'liteMode':
    case 'showCoordinates':
    case 'autoAnalyze':
    case 'showEvalBar':
    case 'highlightBestMove':
      return Boolean(value);

    case 'ttsVoice':
      return typeof value === 'string' && value.trim() ? value.trim() : null;

    case 'ttsRate': {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(0.25, Math.min(3.0, Math.round(num * 10) / 10)) : DEFAULTS.ttsRate;
    }

    case 'boardOrientation':
      return value === 'black' ? 'black' : 'white';

    case 'pieceSet':
      return typeof value === 'string' && value.trim() ? value.trim() : DEFAULTS.pieceSet;

    case 'voiceEngine':
      return value === 'whisper' ? 'whisper' : 'webspeech';

    case 'animationSpeed': {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(0, Math.min(1000, Math.round(num))) : DEFAULTS.animationSpeed;
    }

    default:
      return value;
  }
}

/**
 * Validates and sanitizes a complete or partial settings object against DEFAULTS.
 * @param {Object} rawSettings 
 * @returns {Object} Sanitized settings object
 */
function sanitizeAll(rawSettings) {
  const sanitized = {};
  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    if (key in rawSettings) {
      sanitized[key] = sanitizeSetting(key, rawSettings[key]);
    } else {
      sanitized[key] = defaultVal;
    }
  }
  return sanitized;
}

/**
 * Dispatches a custom event on window when settings are updated.
 * @param {string | null} [changedKey=null] - The key that changed, or null for bulk changes
 * @param {*} [changedValue=null] - The new value of the changed key
 */
function notifyChange(changedKey = null, changedValue = null) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      const event = new CustomEvent('chessmind:settings-changed', {
        detail: {
          key: changedKey,
          value: changedValue,
          settings: clone(cachedSettings || DEFAULTS),
        },
      });
      window.dispatchEvent(event);
    } catch {
      // Ignore errors in environments where CustomEvent might be restricted
    }
  }
}

/**
 * Load settings from localStorage, merging any saved values with the defaults.
 * If localStorage has no settings or contains invalid JSON, defaults are used.
 * 
 * @returns {Object} Current active settings object (clone)
 */
export function loadSettings() {
  const saved = getStorageItem(STORAGE_KEY);
  let parsed = null;

  if (saved) {
    try {
      parsed = JSON.parse(saved);
    } catch (err) {
      console.warn('[ChessMind Settings] Failed to parse stored settings, falling back to defaults:', err);
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    cachedSettings = sanitizeAll({ ...DEFAULTS, ...parsed });
  } else {
    cachedSettings = clone(DEFAULTS);
  }

  return clone(cachedSettings);
}

/**
 * Save settings to localStorage and update internal state cache.
 * Can be called with a complete or partial settings object to merge and save.
 * 
 * @param {Object} [settings] - Settings object to merge and save. If omitted, saves current cached settings.
 * @returns {Object} Saved settings object (clone)
 */
export function saveSettings(settings) {
  if (cachedSettings === null) {
    loadSettings();
  }

  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    cachedSettings = sanitizeAll({ ...cachedSettings, ...settings });
  }

  const serialized = JSON.stringify(cachedSettings);
  setStorageItem(STORAGE_KEY, serialized);
  notifyChange(null, null);

  return clone(cachedSettings);
}

/**
 * Get the value of a single setting.
 * 
 * @param {string} key - Setting property name
 * @returns {*} The setting value, or default value if not set
 */
export function getSetting(key) {
  if (cachedSettings === null) {
    loadSettings();
  }

  if (key in cachedSettings) {
    return cachedSettings[key];
  }

  return DEFAULTS[key];
}

/**
 * Set a single setting value and immediately persist it to localStorage.
 * 
 * @param {string} key - Setting property name
 * @param {*} value - New setting value
 * @returns {*} The updated (and sanitized) setting value
 */
export function setSetting(key, value) {
  if (cachedSettings === null) {
    loadSettings();
  }

  const sanitizedValue = sanitizeSetting(key, value);
  cachedSettings[key] = sanitizedValue;

  setStorageItem(STORAGE_KEY, JSON.stringify(cachedSettings));
  notifyChange(key, sanitizedValue);

  return sanitizedValue;
}

/**
 * Reset all settings back to default values and persist to localStorage.
 * 
 * @returns {Object} Fresh defaults settings object (clone)
 */
export function resetSettings() {
  removeStorageItem(STORAGE_KEY);
  cachedSettings = clone(DEFAULTS);
  setStorageItem(STORAGE_KEY, JSON.stringify(cachedSettings));
  notifyChange(null, null);

  return clone(cachedSettings);
}

/**
 * Export the current settings as a formatted JSON string.
 * 
 * @returns {string} Indented JSON string representation of current settings
 */
export function exportSettings() {
  if (cachedSettings === null) {
    loadSettings();
  }
  return JSON.stringify(cachedSettings, null, 2);
}

/**
 * Import settings from a JSON string, merge with defaults, and persist.
 * 
 * @param {string} json - JSON string representation of settings
 * @returns {Object} The newly applied and saved settings object (clone)
 * @throws {Error} If JSON parsing fails or input is not a valid object
 */
export function importSettings(json) {
  if (typeof json !== 'string') {
    throw new TypeError('importSettings expects a JSON string argument.');
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Failed to parse settings JSON: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid settings JSON format: expected a JSON object.');
  }

  return saveSettings(parsed);
}
