/**
 * UUID v4 veya crypto.randomUUID() oluşturucu
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Verilen string'in geçerli bir UUID olup olmadığını kontrol eder
 */
export function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Şu anki yılı ve ayı "YYYY-MM" formatında döndürür
 */
export function getCurrentYearMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Belirli bir "YYYY-MM" stringine ay ekler/çıkarır (offset)
 */
export function getAdjacentMonth(yearMonthStr, offset = 1) {
  if (!yearMonthStr || typeof yearMonthStr !== 'string') {
    return getCurrentYearMonth();
  }
  const parts = yearMonthStr.split('-');
  if (parts.length !== 2) return getCurrentYearMonth();

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-based
  if (isNaN(y) || isNaN(m)) return getCurrentYearMonth();

  const d = new Date(y, m + offset, 1);
  const nextY = d.getFullYear();
  const nextM = String(d.getMonth() + 1).padStart(2, '0');
  return `${nextY}-${nextM}`;
}
