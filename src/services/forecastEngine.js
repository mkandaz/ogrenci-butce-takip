import {
  round,
  analyzeMonth,
  getMonthlySummary,
  getSpendingVelocity,
  getDailyExpenseSeries,
  getDataQualityMetadata
} from './analyticsEngine.js';

/**
 * Model ağırlık katsayıları
 * Son 7 günlük harcama ivmesi %60, ay geneli MTD ortalaması %40 etkilidir.
 */
export const RECENT_WEIGHT = 0.60;
export const MTD_WEIGHT = 0.40;

/**
 * Günlük harcama serisinden volatilite (oynaklık) metriklerini hesaplar.
 *
 * @param {Array<{date: string, expense: number}>} dailySeries
 * @returns {{mean: number, standardDeviation: number, coefficientOfVariation: number, sampleCount: number}}
 */
export function calculateDailyVolatility(dailySeries) {
  if (!Array.isArray(dailySeries) || dailySeries.length === 0) {
    return {
      mean: 0,
      standardDeviation: 0,
      coefficientOfVariation: 0,
      sampleCount: 0
    };
  }

  const n = dailySeries.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Number(dailySeries[i].expense) || 0;
  }
  const mean = round(sum / n);

  if (n <= 1) {
    return {
      mean,
      standardDeviation: 0,
      coefficientOfVariation: 0,
      sampleCount: n
    };
  }

  // Örneklem varyansı (Sample variance - Bessel düzeltmeli: n - 1)
  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const exp = Number(dailySeries[i].expense) || 0;
    const diff = exp - mean;
    sumSqDiff += diff * diff;
  }

  const variance = sumSqDiff / (n - 1);
  const stdDev = Math.sqrt(Math.max(0, variance));
  const standardDeviation = round(stdDev);
  const coefficientOfVariation = mean > 0 ? round(standardDeviation / mean, 4) : 0;

  return {
    mean,
    standardDeviation,
    coefficientOfVariation,
    sampleCount: n
  };
}

/**
 * Tahmin güvenilirlik seviyesini, puanını ve nedenlerini hesaplar.
 *
 * Formül:
 * - historyScore: Geçmiş gün sayısı / 30 gün (%35 ağırlık)
 * - activityScore: Harcama yapılan aktif gün sayısı / 15 gün (%35 ağırlık)
 * - stabilityScore: 100 - (CV * 50) (%30 ağırlık)
 *
 * Seviye Belirleme:
 * - LOW: historyDaysAvailable < 7 VEYA expenseDaysWithActivity < 3
 * - HIGH: historyDaysAvailable >= 21 VE expenseDaysWithActivity >= 8 VE CV <= 1.0
 * - MEDIUM: Diğer durumlar
 *
 * @param {Object} params
 * @param {Object} params.dataQuality
 * @param {Object} params.volatility
 * @param {number} params.daysElapsed
 * @returns {Object}
 */
export function calculateConfidence({ dataQuality = {}, volatility = {}, daysElapsed = 0 }) {
  const historyDays = typeof dataQuality.historyDaysAvailable === 'number' ? dataQuality.historyDaysAvailable : 0;
  const activeDays = typeof dataQuality.expenseDaysWithActivity === 'number' ? dataQuality.expenseDaysWithActivity : 0;
  const cv = typeof volatility.coefficientOfVariation === 'number' ? volatility.coefficientOfVariation : 0;

  const reasons = [];

  if (activeDays === 0) {
    reasons.push('NO_EXPENSE_ACTIVITY');
  }

  if (historyDays < 7) {
    reasons.push('INSUFFICIENT_HISTORY');
  } else if (historyDays >= 21) {
    reasons.push('SUFFICIENT_HISTORY');
  }

  if (activeDays > 0 && activeDays < 3) {
    reasons.push('LOW_ACTIVITY');
  } else if (activeDays >= 8) {
    reasons.push('SUFFICIENT_ACTIVITY');
  }

  if (cv > 1.0) {
    reasons.push('HIGH_VOLATILITY');
  } else if (cv <= 1.0 && activeDays >= 3) {
    reasons.push('STABLE_SPENDING');
  }

  // Seviye tayini (Deterministik kurallar)
  let level = 'medium';
  if (historyDays < 7 || activeDays < 3) {
    level = 'low';
  } else if (historyDays >= 21 && activeDays >= 8 && cv <= 1.0) {
    level = 'high';
  } else {
    level = 'medium';
  }

  // Sayısal Güven Puanı (0 - 100)
  const historyScore = Math.min(100, (historyDays / 30) * 100);
  const activityScore = Math.min(100, (activeDays / 15) * 100);
  const stabilityScore = activeDays === 0 ? 0 : Math.max(0, 100 - (cv * 50));

  let rawScore = (historyScore * 0.35) + (activityScore * 0.35) + (stabilityScore * 0.30);
  rawScore = Math.max(0, Math.min(100, rawScore));

  // Seviye kısıtlarına göre sınırlandırma (Low max 45, High min 70)
  if (level === 'low') {
    rawScore = Math.min(45, rawScore);
  } else if (level === 'high') {
    rawScore = Math.max(70, rawScore);
  }

  const score = round(rawScore, 1);

  return {
    level,
    score,
    reasons,
    sampleDays: daysElapsed,
    activeExpenseDays: activeDays,
    volatility
  };
}

/**
 * Belirtilen ay için deterministik harcama tahmini üretir.
 *
 * @param {Array} transactions
 * @param {Object} [options={}]
 * @param {Date|string} [options.now]
 * @param {number} [options.year]
 * @param {number} [options.month]
 * @param {number} [options.currentAvailableBalance]
 * @returns {Object}
 */
export function forecastMonth(transactions, options = {}) {
  const analysis = analyzeMonth(transactions, options);
  const { period, summary, spendingVelocity, dailySeries, dataQuality } = analysis;

  const volatility = calculateDailyVolatility(dailySeries);

  // 1. GEÇMİŞ / KAPANMIŞ AY DURUMU
  if (period.isHistoricalMonth) {
    const actualExpense = summary.totalExpense;
    const confidence = calculateConfidence({
      dataQuality,
      volatility,
      daysElapsed: period.daysElapsed
    });
    confidence.level = 'high';
    confidence.score = 100;
    confidence.reasons = ['HISTORICAL_MONTH_CLOSED'];

    let projectedEndBalanceAssumingNoNewIncome = null;
    if (typeof options.currentAvailableBalance === 'number' && !isNaN(options.currentAvailableBalance)) {
      projectedEndBalanceAssumingNoNewIncome = round(options.currentAvailableBalance);
    }

    return {
      period,
      actual: {
        expenseToDate: actualExpense,
        incomeToDate: summary.totalIncome,
        daysElapsed: period.daysElapsed,
        daysRemaining: 0
      },
      dailyRates: {
        monthToDate: summary.avgDailyExpense,
        recent: spendingVelocity.last7DaysDailyAverage,
        blended: summary.avgDailyExpense
      },
      models: {
        runRate: {
          projectedRemainingExpense: 0,
          projectedExpense: actualExpense
        },
        recentPace: {
          projectedRemainingExpense: 0,
          projectedExpense: actualExpense
        },
        blended: {
          projectedRemainingExpense: 0,
          projectedExpense: actualExpense
        }
      },
      forecast: {
        projectedExpense: actualExpense,
        projectedRemainingExpense: 0,
        lowerProjection: actualExpense,
        upperProjection: actualExpense,
        projectedEndBalanceAssumingNoNewIncome
      },
      confidence,
      metadata: {
        isForecastApplicable: false,
        reason: 'HISTORICAL_MONTH_CLOSED',
        weights: {
          recent: RECENT_WEIGHT,
          mtd: MTD_WEIGHT
        },
        dataQuality
      }
    };
  }

  // 2. GELECEK AY DURUMU (Henüz planned cashflow yok)
  if (period.isFutureMonth) {
    let projectedEndBalanceAssumingNoNewIncome = null;
    if (typeof options.currentAvailableBalance === 'number' && !isNaN(options.currentAvailableBalance)) {
      projectedEndBalanceAssumingNoNewIncome = round(options.currentAvailableBalance);
    }

    return {
      period,
      actual: {
        expenseToDate: 0,
        incomeToDate: 0,
        daysElapsed: 0,
        daysRemaining: period.daysInMonth
      },
      dailyRates: {
        monthToDate: 0,
        recent: 0,
        blended: 0
      },
      models: {
        runRate: {
          projectedRemainingExpense: 0,
          projectedExpense: 0
        },
        recentPace: {
          projectedRemainingExpense: 0,
          projectedExpense: 0
        },
        blended: {
          projectedRemainingExpense: 0,
          projectedExpense: 0
        }
      },
      forecast: {
        projectedExpense: 0,
        projectedRemainingExpense: 0,
        lowerProjection: 0,
        upperProjection: 0,
        projectedEndBalanceAssumingNoNewIncome
      },
      confidence: {
        level: 'low',
        score: 0,
        reasons: ['FUTURE_MONTH_NOT_APPLICABLE'],
        sampleDays: 0,
        activeExpenseDays: 0,
        volatility: {
          mean: 0,
          standardDeviation: 0,
          coefficientOfVariation: 0,
          sampleCount: 0
        }
      },
      metadata: {
        isForecastApplicable: false,
        reason: 'FUTURE_MONTH_NOT_APPLICABLE',
        weights: {
          recent: RECENT_WEIGHT,
          mtd: MTD_WEIGHT
        },
        dataQuality
      }
    };
  }

  // 3. İÇİNDE BULUNULAN AY (CURRENT MONTH) TAHMİNİ
  const expenseToDate = summary.totalExpense;
  const daysElapsed = period.daysElapsed;
  const daysRemaining = period.daysRemaining;

  // A) MTD Run-Rate Modeli
  const mtdDailyAverage = daysElapsed > 0 ? round(expenseToDate / daysElapsed) : 0;
  const mtdRemaining = round(daysRemaining * mtdDailyAverage);
  const mtdProjectedExpense = round(expenseToDate + mtdRemaining);

  // B) Recent-Pace Modeli (Son 7 gün hızı)
  // Yeterli sample yoksa (örn: ayın 0. veya 1. günü) mtd ortalamasına fallback yapılır
  const hasRecentData = spendingVelocity.last7DaysSampleDays > 0;
  const recentDailyAverage = hasRecentData ? spendingVelocity.last7DaysDailyAverage : mtdDailyAverage;
  const recentRemaining = round(daysRemaining * recentDailyAverage);
  const recentProjectedExpense = round(expenseToDate + recentRemaining);

  // C) Blended Model (%60 Son 7 Gün + %40 Ay Geneli)
  let forecastDailyRate = 0;
  if (daysElapsed > 0) {
    if (hasRecentData) {
      forecastDailyRate = round((recentDailyAverage * RECENT_WEIGHT) + (mtdDailyAverage * MTD_WEIGHT));
    } else {
      forecastDailyRate = mtdDailyAverage;
    }
  }

  const blendedRemaining = round(forecastDailyRate * daysRemaining);
  const blendedProjectedExpense = round(expenseToDate + blendedRemaining);

  // Tahmin Aralığı (Projection Range: Min & Max)
  const lowerProjection = round(Math.min(mtdProjectedExpense, recentProjectedExpense, blendedProjectedExpense));
  const upperProjection = round(Math.max(mtdProjectedExpense, recentProjectedExpense, blendedProjectedExpense));

  // Opsiyonel Bakiye Projeksiyonu
  let projectedEndBalanceAssumingNoNewIncome = null;
  if (typeof options.currentAvailableBalance === 'number' && !isNaN(options.currentAvailableBalance)) {
    projectedEndBalanceAssumingNoNewIncome = round(options.currentAvailableBalance - blendedRemaining);
  }

  // Güvenilirlik analizi
  const confidence = calculateConfidence({
    dataQuality,
    volatility,
    daysElapsed
  });

  return {
    period,
    actual: {
      expenseToDate,
      incomeToDate: summary.totalIncome,
      daysElapsed,
      daysRemaining
    },
    dailyRates: {
      monthToDate: mtdDailyAverage,
      recent: recentDailyAverage,
      blended: forecastDailyRate
    },
    models: {
      runRate: {
        projectedRemainingExpense: mtdRemaining,
        projectedExpense: mtdProjectedExpense
      },
      recentPace: {
        projectedRemainingExpense: recentRemaining,
        projectedExpense: recentProjectedExpense
      },
      blended: {
        projectedRemainingExpense: blendedRemaining,
        projectedExpense: blendedProjectedExpense
      }
    },
    forecast: {
      projectedExpense: blendedProjectedExpense,
      projectedRemainingExpense: blendedRemaining,
      lowerProjection,
      upperProjection,
      projectedEndBalanceAssumingNoNewIncome
    },
    confidence,
    metadata: {
      isForecastApplicable: true,
      weights: {
        recent: RECENT_WEIGHT,
        mtd: MTD_WEIGHT
      },
      dataQuality
    }
  };
}

/**
 * Geçmiş tamamlanmış bir ay üzerinde geriye dönük tahmin testi (backtest) yapar.
 *
 * Mantık:
 * Belirtilen ayın cutoff günündeymiş gibi zaman simülasyonu yapar,
 * o güne kadar olan işlemlerle ay sonu tahminini üretir,
 * ardından tüm ayın gerçekleşen gideriyle karşılaştırarak hata payını hesaplar.
 *
 * @param {Array} transactions
 * @param {Object} options
 * @param {number} options.year Hedef yıl
 * @param {number} options.month Hedef ay (1-12)
 * @param {number} [options.cutoffDay=15] Simüle edilen gün (varsayılan: ayın 15'i)
 * @returns {Object}
 */
export function evaluateHistoricalForecast(transactions, options = {}) {
  const rawList = Array.isArray(transactions) ? transactions : [];

  const now = options.now ? new Date(options.now) : new Date();
  const targetYear = typeof options.year === 'number' ? options.year : now.getFullYear();
  const targetMonth = typeof options.month === 'number' ? options.month : (now.getMonth() + 1);
  const targetYearMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const cutoffDay = Math.min(daysInMonth, Math.max(1, typeof options.cutoffDay === 'number' ? options.cutoffDay : 15));
  const cutoffDateStr = `${targetYearMonth}-${String(cutoffDay).padStart(2, '0')}`;

  // 1. Gerçekleşen tüm ay toplam gideri (Actual Expense)
  let actualExpense = 0;
  for (let i = 0; i < rawList.length; i++) {
    const t = rawList[i];
    if (!t || t.is_deleted === true || t.type !== 'expense') continue;
    if (t.date && t.date.startsWith(targetYearMonth)) {
      const amt = Number(t.amount);
      if (!isNaN(amt) && amt > 0) {
        actualExpense += amt;
      }
    }
  }
  actualExpense = round(actualExpense);

  // 2. Bilinen veri kümesi (Known data at cutoff day)
  // Hedef aya ait işlemlerden sadece cutoff gününe kadar olanlar, ve önceki ayların geçmişi
  const knownTransactions = [];
  for (let i = 0; i < rawList.length; i++) {
    const t = rawList[i];
    if (!t || t.is_deleted === true) continue;
    if (!t.date || typeof t.date !== 'string') continue;

    if (t.date.startsWith(targetYearMonth)) {
      if (t.date <= cutoffDateStr) {
        knownTransactions.push(t);
      }
    } else if (t.date < `${targetYearMonth}-01`) {
      // Önceki aylara ait geçmiş veriler aynen korunur
      knownTransactions.push(t);
    }
    // Hedef ayın cutoff gününden sonraki veya hedef aydan sonraki işlemler filtrelenir
  }

  // 3. Simüle edilmiş "şimdi" tarihi ile tahmin çalıştır
  const simulatedNow = new Date(targetYear, targetMonth - 1, cutoffDay, 12, 0, 0);

  const forecastResult = forecastMonth(knownTransactions, {
    ...options,
    year: targetYear,
    month: targetMonth,
    now: simulatedNow
  });

  const projectedExpense = forecastResult.forecast.projectedExpense;
  const absoluteError = round(Math.abs(projectedExpense - actualExpense));

  let percentageError = null;
  if (actualExpense > 0) {
    percentageError = round((absoluteError / actualExpense) * 100);
  } else if (projectedExpense === 0) {
    percentageError = 0;
  }

  return {
    year: targetYear,
    month: targetMonth,
    cutoffDay,
    projectedExpense,
    actualExpense,
    absoluteError,
    percentageError,
    forecast: forecastResult
  };
}
