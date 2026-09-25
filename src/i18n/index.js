import tr from './tr.js';
import en from './en.js';
import { LANG_KEY, DEFAULT_LANGUAGE } from '../config/constants.js';
import { SafeStorage } from '../utils/storage.js';

const dictionaries = { tr, en };

let currentLanguage = SafeStorage.getItem(LANG_KEY) || DEFAULT_LANGUAGE;
if (!dictionaries[currentLanguage]) {
  currentLanguage = DEFAULT_LANGUAGE;
}

const listeners = [];

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(lang) {
  if (dictionaries[lang] && lang !== currentLanguage) {
    currentLanguage = lang;
    SafeStorage.setItem(LANG_KEY, lang);
    listeners.forEach(fn => {
      try { fn(currentLanguage); } catch (e) { console.error(e); }
    });
  }
}

export function onLanguageChange(fn) {
  if (typeof fn === 'function') {
    listeners.push(fn);
  }
}

/**
 * Ana çeviri fonksiyonu: t('cards.daysLeft', { days: 18 })
 */
export function t(path, params = {}) {
  const dict = dictionaries[currentLanguage] || dictionaries[DEFAULT_LANGUAGE];
  const keys = path.split('.');
  let val = dict;

  for (const k of keys) {
    if (val && Object.prototype.hasOwnProperty.call(val, k)) {
      val = val[k];
    } else {
      // Fallback to default language
      val = null;
      break;
    }
  }

  if (val === null || val === undefined) {
    let fallbackVal = dictionaries[DEFAULT_LANGUAGE];
    for (const k of keys) {
      if (fallbackVal && Object.prototype.hasOwnProperty.call(fallbackVal, k)) {
        fallbackVal = fallbackVal[k];
      } else {
        return path;
      }
    }
    val = fallbackVal;
  }

  if (typeof val !== 'string') {
    return path;
  }

  // Parametre yerleştirme {param}
  return val.replace(/\{(\w+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{${key}}`;
  });
}
