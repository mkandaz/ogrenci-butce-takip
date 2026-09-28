import { getLocalDateString, getCurrentYearMonth } from '../utils/helpers.js';
import { DEFAULT_CATEGORIES } from '../config/defaultData.js';

/**
 * Sayıyı belirtilen basamak hassasiyetinde deterministik olarak yuvarlar.
 * Floating point hatalarını (199.9999999997) önler.
 *
 * @param {number} val
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function round(val, decimals = 2) {
  if (typeof val !== 'number' || isNaN(val)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/**
 * Tarih ve takvim dönem parametrelerini çözer.
 *
 * @param {Object} [options={}]
 * @returns {Object}
 */
function resolvePeriodContext(options = {}) {
  const now = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());

  const validNow = isNaN(now.getTime()) ? new Date() : now;
  const nowYear = validNow.getFullYear();
  const nowMonth = validNow.getMonth() + 1; // 1-12
  const nowDay = validNow.getDate();
  const todayStr = getLocalDateString(validNow);

  const targetYear = typeof options.year === 'number' ? options.year : nowYear;
  const targetMonth = typeof options.month === 'number' ? options.month : nowMonth;
  const targetYearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  const isCurrentMonth = (targetYear === nowYear && targetMonth === nowMonth);
  const isHistoricalMonth = (targetYear < nowYear || (targetYear === nowYear && targetMonth < nowMonth));
  const isFutureMonth = (targetYear > nowYear || (targetYear === nowYear && targetMonth > nowMonth));

  let daysElapsed = 0;
  let daysRemaining = daysInMonth;

  if (isCurrentMonth) {
    daysElapsed = Math.min(nowDay, daysInMonth);
    daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  } else if (isHistoricalMonth) {
    daysElapsed = daysInMonth;
    daysRemaining = 0;
  } else {
    // Gelecek ay
    daysElapsed = 0;
    daysRemaining = daysInMonth;
  }

  const effectiveEndDay = isCurrentMonth ? nowDay : (isHistoricalMonth ? daysInMonth : 0);
  const startDateStr = `${targetYearMonth}-01`;
  const endDateStr = effectiveEndDay > 0
    ? `${targetYearMonth}-${String(effectiveEndDay).padStart(2, '0')}`
    : startDateStr;

  // Önceki ay bilgisi
  let prevYear = targetYear;
  let prevMonth = targetMonth - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevYearMonth = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();

  // Adil karşılaştırma için önceki ayın bitiş günü:
  // Current month ise MTD gün sayısı ile clamp edilir (örn: 18 Eylül -> 18 Ağustos)
  // Historical month ise ayın tamamı (örn: 30 gün) kullanılır
  const prevPeriodEndDay = isCurrentMonth
    ? Math.min(nowDay, daysInPrevMonth)
    : daysInPrevMonth;

  const prevPeriodEndDateStr = `${prevYearMonth}-${String(prevPeriodEndDay).padStart(2, '0')}`;
  const comparisonDays = isCurrentMonth ? prevPeriodEndDay : daysInMonth;

  return {
    validNow,
    nowYear,
    nowMonth,
    nowDay,
    todayStr,
    targetYear,
    targetMonth,
    targetYearMonth,
    daysInMonth,
    isCurrentMonth,
    isHistoricalMonth,
    isFutureMonth,
    daysElapsed,
    daysRemaining,
    effectiveEndDay,
    startDateStr,
    endDateStr,
    prevYear,
    prevMonth,
    prevYearMonth,
    daysInPrevMonth,
    prevPeriodEndDay,
    prevPeriodEndDateStr,
    comparisonDays
  };
}

/**
 * İşlemleri temizler ve doğrular.
 *
 * @param {Array} rawTransactions
 * @returns {Array}
 */
function sanitizeTransactions(rawTransactions) {
  if (!Array.isArray(rawTransactions)) return [];
  const valid = [];
  for (let i = 0; i < rawTransactions.length; i++) {
    const t = rawTransactions[i];
    if (!t || typeof t !== 'object') continue;
    if (t.is_deleted === true) continue;
    const amt = Number(t.amount);
    if (isNaN(amt) || amt <= 0) continue;
    if (!t.date || typeof t.date !== 'string') continue;
    const type = t.type === 'income' ? 'income' : (t.type === 'expense' ? 'expense' : null);
    if (!type) continue;

    valid.push({
      id: t.id,
      title: t.title || '',
      amount: amt,
      type,
      categoryId: t.categoryId || (type === 'income' ? 'inc_other' : 'exp_other'),
      date: t.date,
      createdAt: t.createdAt || null
    });
  }
  return valid;
}

/**
 * 4. AYLIK TEMEL ÖZET
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getMonthlySummary(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  let totalIncome = 0;
  let totalExpense = 0;
  let incomeTransactionCount = 0;
  let expenseTransactionCount = 0;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.date.startsWith(ctx.targetYearMonth)) continue;

    // Current month için bugünden sonraki geleceğe tarihli işlemleri actual spend hesabına dahil etme
    if (ctx.isCurrentMonth && t.date > ctx.todayStr) {
      continue;
    }

    if (t.type === 'income') {
      totalIncome += t.amount;
      incomeTransactionCount++;
    } else if (t.type === 'expense') {
      totalExpense += t.amount;
      expenseTransactionCount++;
    }
  }

  totalIncome = round(totalIncome);
  totalExpense = round(totalExpense);
  const netCashFlow = round(totalIncome - totalExpense);
  const transactionCount = incomeTransactionCount + expenseTransactionCount;

  // Günlük ortalamalar takvim günü üzerinden (işlem girilmeyen günler de dahil)
  const elapsed = ctx.daysElapsed > 0 ? ctx.daysElapsed : 0;
  const avgDailyExpense = elapsed > 0 ? round(totalExpense / elapsed) : 0;
  const avgDailyIncome = elapsed > 0 ? round(totalIncome / elapsed) : 0;

  return {
    totalIncome,
    totalExpense,
    netCashFlow,
    transactionCount,
    expenseTransactionCount,
    incomeTransactionCount,
    daysElapsed: ctx.daysElapsed,
    daysInMonth: ctx.daysInMonth,
    daysRemaining: ctx.daysRemaining,
    avgDailyExpense,
    avgDailyIncome
  };
}

/**
 * 5. HARCAMA HIZI (SPENDING VELOCITY)
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getSpendingVelocity(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  const summary = getMonthlySummary(transactions, options);
  const monthToDateDailyAverage = summary.avgDailyExpense;

  // Rolling 7-day penceresi belirleme
  const endDay = ctx.effectiveEndDay;
  if (endDay <= 0) {
    return {
      monthToDateDailyAverage: 0,
      last7DaysExpense: 0,
      last7DaysDailyAverage: 0,
      previous7DaysExpense: 0,
      previous7DaysDailyAverage: 0,
      velocityRatio: null,
      velocityChangePercent: null,
      last7DaysSampleDays: 0,
      previous7DaysSampleDays: 0
    };
  }

  const last7StartDay = Math.max(1, endDay - 6);
  const last7DaysSampleDays = endDay - last7StartDay + 1;

  const last7StartDateStr = `${ctx.targetYearMonth}-${String(last7StartDay).padStart(2, '0')}`;
  const last7EndDateStr = `${ctx.targetYearMonth}-${String(endDay).padStart(2, '0')}`;

  let last7DaysExpense = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.type === 'expense' && t.date >= last7StartDateStr && t.date <= last7EndDateStr) {
      last7DaysExpense += t.amount;
    }
  }
  last7DaysExpense = round(last7DaysExpense);
  const last7DaysDailyAverage = last7DaysSampleDays > 0 ? round(last7DaysExpense / last7DaysSampleDays) : 0;

  // Previous 7-day penceresi (last7StartDay'den bir önceki günden geriye)
  const prev7EndDay = last7StartDay - 1;
  let previous7DaysExpense = 0;
  let previous7DaysSampleDays = 0;
  let previous7DaysDailyAverage = 0;

  if (prev7EndDay >= 1) {
    const prev7StartDay = Math.max(1, prev7EndDay - 6);
    previous7DaysSampleDays = prev7EndDay - prev7StartDay + 1;
    const prev7StartDateStr = `${ctx.targetYearMonth}-${String(prev7StartDay).padStart(2, '0')}`;
    const prev7EndDateStr = `${ctx.targetYearMonth}-${String(prev7EndDay).padStart(2, '0')}`;

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.type === 'expense' && t.date >= prev7StartDateStr && t.date <= prev7EndDateStr) {
        previous7DaysExpense += t.amount;
      }
    }
    previous7DaysExpense = round(previous7DaysExpense);
    previous7DaysDailyAverage = previous7DaysSampleDays > 0 ? round(previous7DaysExpense / previous7DaysSampleDays) : 0;
  }

  let velocityRatio = null;
  let velocityChangePercent = null;

  if (monthToDateDailyAverage > 0) {
    velocityRatio = round(last7DaysDailyAverage / monthToDateDailyAverage);
    velocityChangePercent = round(((last7DaysDailyAverage - monthToDateDailyAverage) / monthToDateDailyAverage) * 100);
  }

  return {
    monthToDateDailyAverage,
    last7DaysExpense,
    last7DaysDailyAverage,
    previous7DaysExpense,
    previous7DaysDailyAverage,
    velocityRatio,
    velocityChangePercent,
    last7DaysSampleDays,
    previous7DaysSampleDays
  };
}

/**
 * 6. ÖNCEKİ AY KARŞILAŞTIRMASI (ADİL / SAME-PERIOD COMPARISON)
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getPeriodComparison(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  // 1. Mevcut Dönem Actuals
  let currentExpense = 0;
  let currentIncome = 0;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.date.startsWith(ctx.targetYearMonth)) continue;
    if (ctx.isCurrentMonth && t.date > ctx.todayStr) continue;

    if (t.type === 'expense') currentExpense += t.amount;
    else if (t.type === 'income') currentIncome += t.amount;
  }

  currentExpense = round(currentExpense);
  currentIncome = round(currentIncome);

  // 2. Önceki Ay Aynı Dönem (Same-Period / MTD Karşılaştırması)
  let previousExpense = 0;
  let previousIncome = 0;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.date.startsWith(ctx.prevYearMonth)) continue;
    // Adil karşılaştırma bitiş tarihi
    if (t.date > ctx.prevPeriodEndDateStr) continue;

    if (t.type === 'expense') previousExpense += t.amount;
    else if (t.type === 'income') previousIncome += t.amount;
  }

  previousExpense = round(previousExpense);
  previousIncome = round(previousIncome);

  const absoluteChange = round(currentExpense - previousExpense);
  let percentageChange = null;
  if (previousExpense > 0) {
    percentageChange = round(((currentExpense - previousExpense) / previousExpense) * 100);
  }

  const incomeAbsoluteChange = round(currentIncome - previousIncome);
  let incomePercentageChange = null;
  if (previousIncome > 0) {
    incomePercentageChange = round(((currentIncome - previousIncome) / previousIncome) * 100);
  }

  return {
    currentExpense,
    previousExpense,
    absoluteChange,
    percentageChange,
    currentIncome,
    previousIncome,
    incomeAbsoluteChange,
    incomePercentageChange,
    comparisonDays: ctx.comparisonDays
  };
}

/**
 * 7. KATEGORİ ANALİZİ
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Array}
 */
export function getCategoryAnalytics(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  // Kategori ad eşleştirmesi
  const categoryMap = new Map();
  const providedCats = Array.isArray(options.categories) && options.categories.length > 0
    ? options.categories
    : DEFAULT_CATEGORIES;
  providedCats.forEach(c => {
    if (c && c.id) categoryMap.set(c.id, c.name || c.title || c.id);
  });

  const currentCatExpense = new Map();
  const currentCatCount = new Map();
  let totalExpense = 0;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.type !== 'expense') continue;
    if (!t.date.startsWith(ctx.targetYearMonth)) continue;
    if (ctx.isCurrentMonth && t.date > ctx.todayStr) continue;

    const cid = t.categoryId;
    currentCatExpense.set(cid, (currentCatExpense.get(cid) || 0) + t.amount);
    currentCatCount.set(cid, (currentCatCount.get(cid) || 0) + 1);
    totalExpense += t.amount;
  }
  totalExpense = round(totalExpense);

  // Önceki ay same-period harcamaları
  const prevCatExpense = new Map();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.type !== 'expense') continue;
    if (!t.date.startsWith(ctx.prevYearMonth)) continue;
    if (t.date > ctx.prevPeriodEndDateStr) continue;

    const cid = t.categoryId;
    prevCatExpense.set(cid, (prevCatExpense.get(cid) || 0) + t.amount);
  }

  // İlgili tüm kategorileri birleştir
  const allCategoryIds = new Set([
    ...currentCatExpense.keys(),
    ...prevCatExpense.keys()
  ]);

  const categoriesResult = [];
  allCategoryIds.forEach(categoryId => {
    const currentAmount = round(currentCatExpense.get(categoryId) || 0);
    const previousAmount = round(prevCatExpense.get(categoryId) || 0);
    const count = currentCatCount.get(categoryId) || 0;

    const absoluteChange = round(currentAmount - previousAmount);
    let percentageChange = null;
    if (previousAmount > 0) {
      percentageChange = round(((currentAmount - previousAmount) / previousAmount) * 100);
    }

    const shareOfTotalExpense = totalExpense > 0 ? round((currentAmount / totalExpense) * 100) : 0;
    const avgTransactionAmount = count > 0 ? round(currentAmount / count) : 0;
    const categoryName = categoryMap.get(categoryId) || categoryId;

    categoriesResult.push({
      categoryId,
      categoryName,
      currentAmount,
      previousAmount,
      absoluteChange,
      percentageChange,
      shareOfTotalExpense,
      transactionCount: count,
      avgTransactionAmount
    });
  });

  // Varsayılan sıralama: currentAmount DESC, ardından categoryName ASC
  categoriesResult.sort((a, b) => {
    if (b.currentAmount !== a.currentAmount) {
      return b.currentAmount - a.currentAmount;
    }
    return String(a.categoryName).localeCompare(String(b.categoryName));
  });

  return categoriesResult;
}

/**
 * 8. GÜNLÜK HARCAMA SERİSİ
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Array<{date: string, expense: number}>}
 */
export function getDailyExpenseSeries(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  // Gelecek ay için henüz actual series oluşmamıştır
  if (ctx.isFutureMonth || ctx.effectiveEndDay <= 0) {
    return [];
  }

  const dailyMap = new Map();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.type !== 'expense') continue;
    if (!t.date.startsWith(ctx.targetYearMonth)) continue;
    if (ctx.isCurrentMonth && t.date > ctx.todayStr) continue;

    dailyMap.set(t.date, (dailyMap.get(t.date) || 0) + t.amount);
  }

  const series = [];
  for (let day = 1; day <= ctx.effectiveEndDay; day++) {
    const dateStr = `${ctx.targetYearMonth}-${String(day).padStart(2, '0')}`;
    const expense = round(dailyMap.get(dateStr) || 0);
    series.push({ date: dateStr, expense });
  }

  return series;
}

/**
 * 9. HAFTALIK ANALİZ (ROLLING 7-DAY)
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getWeeklyExpenseAnalytics(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  const endDay = ctx.effectiveEndDay;
  if (endDay <= 0) {
    return {
      currentWeekExpense: 0,
      previousWeekExpense: 0,
      absoluteChange: 0,
      percentageChange: null,
      currentDailyAverage: 0,
      previousDailyAverage: 0,
      currentPeriod: { startDate: '', endDate: '', days: 0 },
      previousPeriod: { startDate: '', endDate: '', days: 0 }
    };
  }

  const curStartDay = Math.max(1, endDay - 6);
  const curDays = endDay - curStartDay + 1;
  const curStartStr = `${ctx.targetYearMonth}-${String(curStartDay).padStart(2, '0')}`;
  const curEndStr = `${ctx.targetYearMonth}-${String(endDay).padStart(2, '0')}`;

  let currentWeekExpense = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.type === 'expense' && t.date >= curStartStr && t.date <= curEndStr) {
      currentWeekExpense += t.amount;
    }
  }
  currentWeekExpense = round(currentWeekExpense);
  const currentDailyAverage = curDays > 0 ? round(currentWeekExpense / curDays) : 0;

  const prevEndDay = curStartDay - 1;
  let previousWeekExpense = 0;
  let prevDays = 0;
  let prevStartStr = '';
  let prevEndStr = '';

  if (prevEndDay >= 1) {
    const prevStartDay = Math.max(1, prevEndDay - 6);
    prevDays = prevEndDay - prevStartDay + 1;
    prevStartStr = `${ctx.targetYearMonth}-${String(prevStartDay).padStart(2, '0')}`;
    prevEndStr = `${ctx.targetYearMonth}-${String(prevEndDay).padStart(2, '0')}`;

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.type === 'expense' && t.date >= prevStartStr && t.date <= prevEndStr) {
        previousWeekExpense += t.amount;
      }
    }
    previousWeekExpense = round(previousWeekExpense);
  }
  const previousDailyAverage = prevDays > 0 ? round(previousWeekExpense / prevDays) : 0;

  const absoluteChange = round(currentWeekExpense - previousWeekExpense);
  let percentageChange = null;
  if (previousWeekExpense > 0) {
    percentageChange = round(((currentWeekExpense - previousWeekExpense) / previousWeekExpense) * 100);
  }

  return {
    currentWeekExpense,
    previousWeekExpense,
    absoluteChange,
    percentageChange,
    currentDailyAverage,
    previousDailyAverage,
    currentPeriod: {
      startDate: curStartStr,
      endDate: curEndStr,
      days: curDays
    },
    previousPeriod: {
      startDate: prevStartStr,
      endDate: prevEndStr,
      days: prevDays
    }
  };
}

/**
 * 10. VERİ KALİTESİ METADATASI
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getDataQualityMetadata(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const list = sanitizeTransactions(transactions);

  let transactionCount = 0;
  const activeExpenseDates = new Set();
  let hasPreviousMonthData = false;
  let oldestDate = null;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];

    // Oldest date bul
    if (!oldestDate || t.date < oldestDate) {
      oldestDate = t.date;
    }

    // Önceki ay verisi var mı?
    if (t.date.startsWith(ctx.prevYearMonth)) {
      hasPreviousMonthData = true;
    }

    // Hedef aya ait kontroller
    if (t.date.startsWith(ctx.targetYearMonth)) {
      if (ctx.isCurrentMonth && t.date > ctx.todayStr) continue;

      transactionCount++;
      if (t.type === 'expense' && t.amount > 0) {
        activeExpenseDates.add(t.date);
      }
    }
  }

  let historyDaysAvailable = 0;
  if (oldestDate && ctx.endDateStr) {
    const oldestD = new Date(oldestDate);
    const endD = new Date(ctx.endDateStr);
    if (!isNaN(oldestD.getTime()) && !isNaN(endD.getTime())) {
      const diffMs = endD.getTime() - oldestD.getTime();
      historyDaysAvailable = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
    }
  }

  return {
    transactionCount,
    expenseDaysWithActivity: activeExpenseDates.size,
    historyDaysAvailable,
    hasPreviousMonthData,
    oldestTransactionDate: oldestDate
  };
}

/**
 * 11. ANA ANALYTICS ENGINE GİRİŞİ (PUBLIC ENTRY POINT)
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function analyzeMonth(transactions, options = {}) {
  const ctx = resolvePeriodContext(options);
  const summary = getMonthlySummary(transactions, options);
  const spendingVelocity = getSpendingVelocity(transactions, options);
  const comparison = getPeriodComparison(transactions, options);
  const categories = getCategoryAnalytics(transactions, options);
  const dailySeries = getDailyExpenseSeries(transactions, options);
  const weekly = getWeeklyExpenseAnalytics(transactions, options);
  const dataQuality = getDataQualityMetadata(transactions, options);

  return {
    period: {
      year: ctx.targetYear,
      month: ctx.targetMonth,
      yearMonth: ctx.targetYearMonth,
      startDate: ctx.startDateStr,
      endDate: ctx.endDateStr,
      isCurrentMonth: ctx.isCurrentMonth,
      isHistoricalMonth: ctx.isHistoricalMonth,
      isFutureMonth: ctx.isFutureMonth,
      daysInMonth: ctx.daysInMonth,
      daysElapsed: ctx.daysElapsed,
      daysRemaining: ctx.daysRemaining
    },
    summary,
    spendingVelocity,
    comparison,
    categories,
    dailySeries,
    weekly,
    dataQuality
  };
}
