import { round } from './analyticsEngine.js';
import { getLocalDateString } from '../utils/helpers.js';

/**
 * Desteklenen nakit akışı türleri.
 */
export const CASHFLOW_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense'
};

/**
 * Desteklenen periyot/tekrar türleri.
 */
export const RECURRENCE_TYPES = {
  MONTHLY: 'monthly',
  ONCE: 'once'
};

/**
 * Nakit akışı durum göstergeleri (Machine-readable coverage status).
 */
export const COVERAGE_STATUS = {
  NO_NEXT_INCOME: 'NO_NEXT_INCOME',
  DEFICIT_BEFORE_INCOME: 'DEFICIT_BEFORE_INCOME',
  TIGHT: 'TIGHT',
  COVERED: 'COVERED'
};

/**
 * Nakit akışı motoru varsayımları (Assumptions).
 */
export const CASHFLOW_ASSUMPTIONS = [
  'DATE_ONLY_CASHFLOW_ORDER_UNKNOWN',
  'SAME_DAY_EXPENSES_RESERVED_BEFORE_INCOME'
];

/**
 * "YYYY-MM-DD" formatındaki tarih stringini yıl, ay, gün sayılarına ayrıştırır.
 *
 * @param {string} dateStr
 * @returns {{year: number, month: number, day: number}}
 */
function parseDateParts(dateStr) {
  if (typeof dateStr !== 'string') return { year: 0, month: 0, day: 0 };
  const parts = dateStr.split('-');
  return {
    year: parseInt(parts[0], 10) || 0,
    month: parseInt(parts[1], 10) || 0,
    day: parseInt(parts[2], 10) || 0
  };
}

/**
 * İki "YYYY-MM-DD" tarihi arasındaki tam takvim günü farkını (B - A) hesaplar.
 * UTC kullanılarak yerel DST/saat kaymaları önlenir.
 *
 * @param {string} dateStrA
 * @param {string} dateStrB
 * @returns {number}
 */
export function daysBetween(dateStrA, dateStrB) {
  const pA = parseDateParts(dateStrA);
  const pB = parseDateParts(dateStrB);
  const utcA = Date.UTC(pA.year, pA.month - 1, pA.day);
  const utcB = Date.UTC(pB.year, pB.month - 1, pB.day);
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

/**
 * Bir planlı nakit akışı tanımını doğrular.
 *
 * @param {Object} cashflow
 * @returns {{isValid: boolean, error?: string, reason?: string}}
 */
export function validatePlannedCashflow(cashflow) {
  if (!cashflow || typeof cashflow !== 'object' || Array.isArray(cashflow)) {
    return {
      isValid: false,
      error: 'INVALID_CASHFLOW_OBJECT',
      reason: 'Cashflow must be a non-null object'
    };
  }

  const { id, name, type, amount, recurrence } = cashflow;

  if (id === undefined || id === null || String(id).trim() === '') {
    return { isValid: false, error: 'MISSING_ID', reason: 'Cashflow ID is required' };
  }

  if (typeof name !== 'string' || name.trim() === '') {
    return { isValid: false, error: 'MISSING_NAME', reason: 'Cashflow name is required' };
  }

  if (type !== CASHFLOW_TYPES.INCOME && type !== CASHFLOW_TYPES.EXPENSE) {
    return { isValid: false, error: 'INVALID_TYPE', reason: `Type must be 'income' or 'expense', received: ${type}` };
  }

  if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
    return { isValid: false, error: 'INVALID_AMOUNT', reason: 'Amount must be a finite positive number' };
  }

  if (recurrence !== RECURRENCE_TYPES.MONTHLY && recurrence !== RECURRENCE_TYPES.ONCE) {
    return { isValid: false, error: 'INVALID_RECURRENCE', reason: `Recurrence must be 'monthly' or 'once', received: ${recurrence}` };
  }

  if (recurrence === RECURRENCE_TYPES.MONTHLY) {
    const { dayOfMonth } = cashflow;
    if (typeof dayOfMonth !== 'number' || isNaN(dayOfMonth) || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return { isValid: false, error: 'INVALID_DAY_OF_MONTH', reason: 'dayOfMonth must be an integer between 1 and 31' };
    }
  }

  if (recurrence === RECURRENCE_TYPES.ONCE) {
    const { date } = cashflow;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
      return { isValid: false, error: 'INVALID_DATE', reason: 'date must be a valid YYYY-MM-DD string' };
    }
  }

  if (cashflow.startDate) {
    if (typeof cashflow.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cashflow.startDate) || isNaN(new Date(cashflow.startDate).getTime())) {
      return { isValid: false, error: 'INVALID_START_DATE', reason: 'startDate must be a valid YYYY-MM-DD string' };
    }
  }

  if (cashflow.endDate) {
    if (typeof cashflow.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cashflow.endDate) || isNaN(new Date(cashflow.endDate).getTime())) {
      return { isValid: false, error: 'INVALID_END_DATE', reason: 'endDate must be a valid YYYY-MM-DD string' };
    }
  }

  return { isValid: true };
}

/**
 * Planlı nakit akışlarından belirtilen zaman ufku (horizonDays) boyunca gerçekleşecek
 * tekil occurrence listesi üretir.
 *
 * Ay sonu Clamp Kuralı:
 * dayOfMonth = 31 olan bir aylık akış:
 * - Şubat 2026 -> 2026-02-28
 * - Şubat 2024 (Artık Yıl) -> 2024-02-29
 * - Nisan -> 2026-04-30
 * olarak son takvim gününe kenetlenir.
 *
 * @param {Array<Object>} [plannedCashflows=[]]
 * @param {Object} [options={}]
 * @param {Date|string} [options.now]
 * @param {number} [options.horizonDays=60]
 * @returns {Array<Object>} Tarihe göre sıralı occurrence listesi
 */
export function generateCashflowOccurrences(plannedCashflows = [], options = {}) {
  const refDate = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());
  const refDateStr = getLocalDateString(refDate);

  const horizonDays = (typeof options.horizonDays === 'number' && options.horizonDays > 0)
    ? options.horizonDays
    : 60;

  const pStart = parseDateParts(refDateStr);
  const endUtc = new Date(Date.UTC(pStart.year, pStart.month - 1, pStart.day + horizonDays));
  const horizonEndDateStr = `${endUtc.getUTCFullYear()}-${String(endUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(endUtc.getUTCDate()).padStart(2, '0')}`;

  const pEnd = parseDateParts(horizonEndDateStr);

  const seen = new Set();
  const occurrences = [];

  const list = Array.isArray(plannedCashflows) ? plannedCashflows : [];

  for (const item of list) {
    if (!item || typeof item !== 'object' || item.isActive === false) {
      continue;
    }

    const validation = validatePlannedCashflow(item);
    if (!validation.isValid) {
      continue;
    }

    const itemStart = item.startDate || null;
    const itemEnd = item.endDate || null;

    if (item.recurrence === RECURRENCE_TYPES.ONCE) {
      const occDate = item.date;
      if (occDate >= refDateStr && occDate <= horizonEndDateStr) {
        if ((!itemStart || occDate >= itemStart) && (!itemEnd || occDate <= itemEnd)) {
          const key = `${item.id}_${occDate}`;
          if (!seen.has(key)) {
            seen.add(key);
            occurrences.push({
              cashflowId: item.id,
              name: item.name,
              type: item.type,
              amount: round(item.amount),
              date: occDate,
              categoryId: item.categoryId || null,
              recurrence: item.recurrence,
              source: 'planned_cashflow'
            });
          }
        }
      }
    } else if (item.recurrence === RECURRENCE_TYPES.MONTHLY) {
      let curYear = pStart.year;
      let curMonth = pStart.month;

      while (curYear < pEnd.year || (curYear === pEnd.year && curMonth <= pEnd.month)) {
        // İlgili ayın son takvim günü (Clamping)
        const daysInCurrentMonth = new Date(curYear, curMonth, 0).getDate();
        const actualDay = Math.min(item.dayOfMonth, daysInCurrentMonth);
        const occDate = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;

        if (occDate >= refDateStr && occDate <= horizonEndDateStr) {
          if ((!itemStart || occDate >= itemStart) && (!itemEnd || occDate <= itemEnd)) {
            const key = `${item.id}_${occDate}`;
            if (!seen.has(key)) {
              seen.add(key);
              occurrences.push({
                cashflowId: item.id,
                name: item.name,
                type: item.type,
                amount: round(item.amount),
                date: occDate,
                categoryId: item.categoryId || null,
                recurrence: item.recurrence,
                source: 'planned_cashflow'
              });
            }
          }
        }

        curMonth++;
        if (curMonth > 12) {
          curMonth = 1;
          curYear++;
        }
      }
    }
  }

  // Tarihe göre ASC sırala, aynı gün için stabil sıra: giderler önce, sonra ID sıralaması
  occurrences.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (a.type !== b.type) {
      return a.type === CASHFLOW_TYPES.EXPENSE ? -1 : 1;
    }
    return String(a.cashflowId).localeCompare(String(b.cashflowId));
  });

  return occurrences;
}

/**
 * Referans tarihinden itibaren horizon içindeki en yakın aktif geliri bulur.
 *
 * @param {Array<Object>} occurrences
 * @param {Object} [options={}]
 * @returns {Object} { found, date, amount, name, cashflowId, daysUntil }
 */
export function getNextIncome(occurrences = [], options = {}) {
  const refDate = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());
  const refDateStr = getLocalDateString(refDate);

  const list = Array.isArray(occurrences) ? occurrences : [];
  const incomeOccurrences = list
    .filter(o => o.type === CASHFLOW_TYPES.INCOME && o.date >= refDateStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (incomeOccurrences.length === 0) {
    return {
      found: false,
      date: null,
      amount: null,
      name: null,
      cashflowId: null,
      daysUntil: null
    };
  }

  const nearest = incomeOccurrences[0];
  const daysUntil = daysBetween(refDateStr, nearest.date);

  return {
    found: true,
    date: nearest.date,
    amount: round(nearest.amount),
    name: nearest.name,
    cashflowId: nearest.cashflowId,
    daysUntil
  };
}

/**
 * Bir sonraki gelire kadar olan planlı gider yükümlülüklerini hesaplar.
 * Next income ile AYNI GÜN olan giderleri ayrı tutar (`sameDayExpenses`).
 *
 * @param {Object} params
 * @param {Array<Object>} params.occurrences
 * @param {Object} params.nextIncome
 * @param {Object} [params.options={}]
 * @returns {{expensesBeforeIncome: Array, totalBeforeIncome: number, sameDayExpenses: Array, sameDayExpenseTotal: number}}
 */
export function getObligationsBeforeNextIncome({ occurrences = [], nextIncome, options = {} } = {}) {
  const refDate = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());
  const refDateStr = getLocalDateString(refDate);

  const list = Array.isArray(occurrences) ? occurrences : [];

  if (!nextIncome || !nextIncome.found) {
    const expenses = list.filter(o => o.type === CASHFLOW_TYPES.EXPENSE && o.date >= refDateStr);
    const total = expenses.reduce((sum, o) => sum + o.amount, 0);
    return {
      expensesBeforeIncome: expenses,
      totalBeforeIncome: round(total),
      sameDayExpenses: [],
      sameDayExpenseTotal: 0
    };
  }

  const incomeDate = nextIncome.date;
  const beforeExpenses = list.filter(o => o.type === CASHFLOW_TYPES.EXPENSE && o.date >= refDateStr && o.date < incomeDate);
  const sameExpenses = list.filter(o => o.type === CASHFLOW_TYPES.EXPENSE && o.date === incomeDate);

  const totalBefore = beforeExpenses.reduce((sum, o) => sum + o.amount, 0);
  const totalSame = sameExpenses.reduce((sum, o) => sum + o.amount, 0);

  return {
    expensesBeforeIncome: beforeExpenses,
    totalBeforeIncome: round(totalBefore),
    sameDayExpenses: sameExpenses,
    sameDayExpenseTotal: round(totalSame)
  };
}

/**
 * Öğrenci nakit akışı planını ve harcama kapasitesini hesaplayan ana public API.
 *
 * @param {Object} params
 * @param {Array<Object>} [params.plannedCashflows=[]] Planlı gelir ve gider tanımları
 * @param {Object} [params.options={}] { now, currentAvailableBalance, horizonDays }
 * @param {Object} [params.forecast=null] FAZ 5.2 forecastMonth çıktısı (opsiyonel)
 * @returns {Object} Tam nakit akışı planı ve metrikleri
 */
export function planCashflow({ plannedCashflows = [], options = {}, forecast = null } = {}) {
  const refDate = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());
  const referenceDate = getLocalDateString(refDate);

  const horizonDays = (typeof options.horizonDays === 'number' && options.horizonDays > 0)
    ? options.horizonDays
    : 60;

  // 1. OCCURRENCES & NEXT INCOME & OBLIGATIONS
  const occurrences = generateCashflowOccurrences(plannedCashflows, { ...options, now: refDate, horizonDays });
  const nextIncome = getNextIncome(occurrences, { ...options, now: refDate });
  const obligations = getObligationsBeforeNextIncome({ occurrences, nextIncome, options: { ...options, now: refDate } });

  // 2. MEVCUT BAKİYE VE AYRILMIŞ BAKİYE (AVAILABLE AFTER PLANNED OBLIGATIONS)
  const currentAvailableBalance = (typeof options.currentAvailableBalance === 'number' && !isNaN(options.currentAvailableBalance))
    ? options.currentAvailableBalance
    : null;

  let availableAfterPlannedObligations = null;
  if (currentAvailableBalance !== null) {
    // Aynı gün olan giderler de konservatif olarak reserve edilir
    availableAfterPlannedObligations = round(currentAvailableBalance - obligations.totalBeforeIncome - obligations.sameDayExpenseTotal);
  }

  // 3. GÜVENLİ GÜNLÜK HARCAMA KAPASİTESİ (SAFE DAILY SPEND)
  const daysUntilNextIncome = nextIncome.found ? nextIncome.daysUntil : null;
  let safeDailySpendUntilNextIncome = null;

  if (nextIncome.found && availableAfterPlannedObligations !== null) {
    const freePool = Math.max(0, availableAfterPlannedObligations);
    const daySpan = Math.max(1, daysUntilNextIncome);
    safeDailySpendUntilNextIncome = round(freePool / daySpan);
  }

  // 4. FORECAST ENTEGRASYONU (FORECAST-AWARE METRİKLER)
  const isForecastApplicable = Boolean(forecast?.metadata?.isForecastApplicable);
  const baselineDailyRate = (isForecastApplicable && typeof forecast?.dailyRates?.blended === 'number')
    ? forecast.dailyRates.blended
    : null;

  let projectedVariableSpendUntilNextIncome = null;
  let projectedBalanceBeforeNextIncome = null;
  let dailyAdjustmentNeeded = null;
  let runwayDays = null;

  if (isForecastApplicable && baselineDailyRate !== null) {
    if (nextIncome.found && daysUntilNextIncome !== null) {
      projectedVariableSpendUntilNextIncome = round(baselineDailyRate * daysUntilNextIncome);

      if (availableAfterPlannedObligations !== null) {
        projectedBalanceBeforeNextIncome = round(availableAfterPlannedObligations - projectedVariableSpendUntilNextIncome);
      }

      if (safeDailySpendUntilNextIncome !== null) {
        if (baselineDailyRate > safeDailySpendUntilNextIncome) {
          dailyAdjustmentNeeded = round(baselineDailyRate - safeDailySpendUntilNextIncome);
        } else {
          dailyAdjustmentNeeded = 0;
        }
      }
    }

    if (availableAfterPlannedObligations !== null) {
      if (baselineDailyRate > 0) {
        runwayDays = Math.floor(Math.max(0, availableAfterPlannedObligations) / baselineDailyRate);
      } else {
        runwayDays = null;
      }
    }
  }

  // 5. COVERAGE STATUS (MAKİNE TARAFINDAN OKUNABİLİR KAPLAMA DURUMU)
  let coverageStatus = COVERAGE_STATUS.COVERED;

  if (!nextIncome.found) {
    coverageStatus = COVERAGE_STATUS.NO_NEXT_INCOME;
  } else if (
    (availableAfterPlannedObligations !== null && availableAfterPlannedObligations < 0) ||
    (projectedBalanceBeforeNextIncome !== null && projectedBalanceBeforeNextIncome < 0)
  ) {
    coverageStatus = COVERAGE_STATUS.DEFICIT_BEFORE_INCOME;
  } else if (
    baselineDailyRate !== null &&
    safeDailySpendUntilNextIncome !== null &&
    (baselineDailyRate > safeDailySpendUntilNextIncome || baselineDailyRate >= safeDailySpendUntilNextIncome * 0.8)
  ) {
    coverageStatus = COVERAGE_STATUS.TIGHT;
  } else {
    coverageStatus = COVERAGE_STATUS.COVERED;
  }

  // 6. RESPONSE TIMELINE & METADATA
  const timeline = occurrences.map(o => ({
    cashflowId: o.cashflowId,
    name: o.name,
    type: o.type,
    amount: o.amount,
    date: o.date,
    categoryId: o.categoryId,
    recurrence: o.recurrence
  }));

  return {
    referenceDate,
    nextIncome,
    obligations,
    spending: {
      baselineDailyRate,
      daysUntilNextIncome,
      availableAfterPlannedObligations,
      safeDailySpendUntilNextIncome,
      projectedVariableSpendUntilNextIncome,
      projectedBalanceBeforeNextIncome,
      runwayDays,
      dailyAdjustmentNeeded
    },
    status: {
      coverageStatus
    },
    timeline,
    metadata: {
      isForecastApplicable,
      horizonDays,
      assumptions: [...CASHFLOW_ASSUMPTIONS]
    }
  };
}
