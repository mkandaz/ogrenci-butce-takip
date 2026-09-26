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
 * Verilen Date nesnesini veya şu anki zamanı kullanıcının yerel saat diliminde (local timezone)
 * "YYYY-MM-DD" formatında döndürür. ASLA toISOString().slice(0, 10) veya UTC kullanmaz.
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} YYYY-MM-DD
 */
export function getLocalDateString(date = new Date()) {
  let y, m, day;
  if (date && typeof date.getFullYear === 'function') {
    y = date.getFullYear();
    m = String(date.getMonth() + 1).padStart(2, '0');
    day = String(date.getDate()).padStart(2, '0');
  } else {
    const d = date instanceof Date ? date : new Date(date);
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    y = validDate.getFullYear();
    m = String(validDate.getMonth() + 1).padStart(2, '0');
    day = String(validDate.getDate()).padStart(2, '0');
  }
  return `${y}-${m}-${day}`;
}

/**
 * Şu anki yılı ve ayı kullanıcının yerel saat dilimine göre "YYYY-MM" formatında döndürür
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} YYYY-MM
 */
export function getCurrentYearMonth(date = new Date()) {
  let y, m;
  if (date && typeof date.getFullYear === 'function') {
    y = date.getFullYear();
    m = String(date.getMonth() + 1).padStart(2, '0');
  } else {
    const d = date instanceof Date ? date : new Date(date);
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    y = validDate.getFullYear();
    m = String(validDate.getMonth() + 1).padStart(2, '0');
  }
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

/**
 * İşlemleri belirtilen kritere göre sıralamak için karşılaştırma fonksiyonu
 *
 * Sıralama kuralları:
 * - 'date-desc' (Varsayılan): Önce transaction.date DESC (YYYY-MM-DD), aynı gün içindeyse createdAt DESC.
 *   (En son oluşturulan işlem en üstte; updatedAt sırayı bozmaz).
 * - 'date-asc': Önce transaction.date ASC, aynı gün içindeyse createdAt ASC.
 * - 'amount-desc': Tutar azalan (b.amount - a.amount). Eşitse date DESC, ardından createdAt DESC.
 * - 'amount-asc': Tutar artan (a.amount - b.amount). Eşitse date DESC, ardından createdAt DESC.
 *
 * @param {Object} a - İlk işlem
 * @param {Object} b - İkinci işlem
 * @param {string} [sortOption='date-desc'] - Sıralama seçeneği
 * @returns {number}
 */
export function compareTransactions(a, b, sortOption = 'date-desc') {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  if (sortOption === 'date-desc') {
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return 0;
  }

  if (sortOption === 'date-asc') {
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return 0;
  }

  if (sortOption === 'amount-desc') {
    const diff = (Number(b.amount) || 0) - (Number(a.amount) || 0);
    if (diff !== 0) return diff;
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  }

  if (sortOption === 'amount-asc') {
    const diff = (Number(a.amount) || 0) - (Number(b.amount) || 0);
    if (diff !== 0) return diff;
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  }

  return 0;
}

