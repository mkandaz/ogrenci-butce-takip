export const STORAGE_KEY = 'student_budget_app_state_v1';
export const THEME_KEY = 'student_budget_theme';
export const LANG_KEY = 'student_budget_lang';
export const SCHEMA_VERSION = '1.1.0';

export const SUPPORTED_CURRENCIES = {
  TRY: { code: 'TRY', symbol: '₺', name: 'Türk Lirası (₺)' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar ($)' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro (€)' }
};

export const DEFAULT_CURRENCY = 'TRY';
export const DEFAULT_LANGUAGE = 'tr';
export const DEFAULT_MONTH_START_DAY = 1;
export const DEFAULT_WARNING_THRESHOLD_PERCENT = 15;
