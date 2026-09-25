import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '../config/constants.js';

/**
 * Gelen para birimini ISO 4217 koduna normalize eder
 * '₺' veya 'TL' -> 'TRY'
 * '$' -> 'USD'
 * '€' -> 'EUR'
 */
export function normalizeCurrency(curr) {
  if (!curr) return DEFAULT_CURRENCY;
  const upper = String(curr).trim().toUpperCase();
  if (upper === 'TRY' || upper === 'TL' || upper === '₺') return 'TRY';
  if (upper === 'USD' || upper === '$') return 'USD';
  if (upper === 'EUR' || upper === '€') return 'EUR';
  return DEFAULT_CURRENCY;
}

/**
 * Para birimi sembolünü döner
 */
export function getCurrencySymbol(curr) {
  const code = normalizeCurrency(curr);
  return SUPPORTED_CURRENCIES[code]?.symbol || '₺';
}

/**
 * Intl.NumberFormat kullanarak yerelleştirilmiş ve para birimi sembollü biçimlendirme
 */
export function formatCurrency(val, currencyCode = 'TRY', lang = 'tr') {
  const num = Number(val) || 0;
  const isoCode = normalizeCurrency(currencyCode);
  const locale = lang === 'en' ? 'en-US' : 'tr-TR';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: isoCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  } catch (err) {
    // Fallback
    const sym = getCurrencySymbol(isoCode);
    const formattedNum = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
    return `${formattedNum} ${sym}`;
  }
}

/**
 * Sadece sayı formatı (grafikler ve inputlar için)
 */
export function formatNumber(val, lang = 'tr') {
  const num = Number(val) || 0;
  const locale = lang === 'en' ? 'en-US' : 'tr-TR';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * ISO Tarih stringini (YYYY-MM-DD) yerelleştirilmiş formata çevirir
 */
export function formatDate(isoStr, lang = 'tr') {
  if (!isoStr) return '';
  try {
    const parts = String(isoStr).split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        const locale = lang === 'en' ? 'en-US' : 'tr-TR';
        return d.toLocaleDateString(locale, {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
      }
    }
  } catch {
    // ignore
  }
  return isoStr;
}

/**
 * Ay başlığı formatı (Örn: "Eylül 2026" veya "September 2026")
 */
export function formatMonthTitle(yearMonthStr, lang = 'tr') {
  if (!yearMonthStr) return '';
  const parts = String(yearMonthStr).split('-');
  if (parts.length !== 2) return yearMonthStr;

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = new Date(y, m, 1);
  if (isNaN(d.getTime())) return yearMonthStr;

  const locale = lang === 'en' ? 'en-US' : 'tr-TR';
  const monthName = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
}
