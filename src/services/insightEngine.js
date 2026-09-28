import { round, analyzeMonth } from './analyticsEngine.js';
import { forecastMonth } from './forecastEngine.js';

/**
 * Kural eşik değerleri (Rule Thresholds)
 * Magic number'ları önlemek için merkezi olarak tanımlanmıştır.
 */
export const RULE_THRESHOLDS = {
  VELOCITY_CHANGE_PERCENT: 20,
  PERIOD_CHANGE_PERCENT: 20,
  CATEGORY_CHANGE_PERCENT: 25,
  CATEGORY_MIN_SHARE_PERCENT: 10,
  HIGH_CATEGORY_SHARE_PERCENT: 40,
  FORECAST_SPREAD_PERCENT: 15
};

/**
 * Finansal verilerden deterministik ve kural tabanlı içgörüler üretir.
 *
 * @param {Object} params
 * @param {Object} [params.analytics] analyzeMonth() çıktısı (opsiyonel)
 * @param {Object} [params.forecast] forecastMonth() çıktısı (opsiyonel)
 * @param {Array} [params.transactions] Ham işlem listesi (analytics/forecast verilmediyse kullanılır)
 * @param {Object} [params.options={}]
 * @param {number} [params.options.maxInsights=5] Döndürülecek maksimum içgörü adedi
 * @param {number} [params.options.currentAvailableBalance] Bakiye uyarısı için kullanılabilir bakiye
 * @returns {Object} Structured insights çıktısı
 */
export function generateInsights({ analytics, forecast, transactions, options = {} } = {}) {
  // 1. ANALYTICS VE FORECAST HAZIRLIĞI (Yeniden hesaplama yapmadan veya gerektiğinde lazy hesaplayarak)
  const resolvedAnalytics = analytics || (transactions ? analyzeMonth(transactions, options) : null);
  const resolvedForecast = forecast || (transactions ? forecastMonth(transactions, options) : null);

  const periodKey = resolvedAnalytics?.period?.yearMonth || (resolvedForecast?.period ? `${resolvedForecast.period.year}-${String(resolvedForecast.period.month).padStart(2, '0')}` : '');

  const summary = resolvedAnalytics?.summary || { totalExpense: 0, totalIncome: 0 };
  const spendingVelocity = resolvedAnalytics?.spendingVelocity || {};
  const comparison = resolvedAnalytics?.comparison || {};
  const categories = Array.isArray(resolvedAnalytics?.categories) ? resolvedAnalytics.categories : [];
  const dataQuality = resolvedAnalytics?.dataQuality || {};

  const forecastData = resolvedForecast?.forecast || {};
  const forecastMeta = resolvedForecast?.metadata || {};
  const forecastConfidence = resolvedForecast?.confidence || {};

  const totalExpense = typeof summary.totalExpense === 'number' ? summary.totalExpense : 0;
  const isNoExpense = totalExpense === 0;

  // Veri yetersizliği / Düşük güvenilirlik kontrolü
  const isLowConfidence = forecastConfidence.level === 'low' ||
    (typeof dataQuality.historyDaysAvailable === 'number' && dataQuality.historyDaysAvailable < 7) ||
    (typeof dataQuality.expenseDaysWithActivity === 'number' && dataQuality.expenseDaysWithActivity < 3);

  const candidateInsights = [];
  let evaluatedRuleCount = 0;
  let suppressedRuleCount = 0;

  // Takip ve suppression setleri
  const highShareCategoryIds = new Set();

  // -------------------------------------------------------------------------
  // KURAL 1: NO_EXPENSE_ACTIVITY
  // PRECEDENCE: NO_EXPENSE_ACTIVITY > INSUFFICIENT_DATA > Speculative trend/category rules
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (isNoExpense) {
    candidateInsights.push({
      ruleId: 'NO_EXPENSE_ACTIVITY',
      id: 'NO_EXPENSE_ACTIVITY',
      type: 'spending_activity',
      severity: 'info',
      priority: 90,
      messageKey: 'insights.noExpenseActivity',
      params: {
        totalExpense: 0
      },
      evidence: {
        metric: 'summary.totalExpense',
        value: 0,
        threshold: 0,
        comparison: '==='
      }
    });

    // NO_EXPENSE_ACTIVITY durumunda INSUFFICIENT_DATA, LOW_FORECAST_CONFIDENCE ve tüm trend/kategori kuralları baskılanır.
    // Gereksiz redundant düşük veri mesajları engellenir.
    suppressedRuleCount += 10;
  }

  // -------------------------------------------------------------------------
  // KURAL 2: INSUFFICIENT_DATA (Düşük veri güveni -> Spekülatif kuralları baskılar)
  // Sadece harcama varken (totalExpense > 0) değerlendirilir
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense && isLowConfidence) {
    candidateInsights.push({
      ruleId: 'INSUFFICIENT_DATA',
      id: 'INSUFFICIENT_DATA',
      type: 'data_quality',
      severity: 'info',
      priority: 85,
      messageKey: 'insights.insufficientData',
      params: {
        historyDaysAvailable: dataQuality.historyDaysAvailable || 0,
        activeExpenseDays: dataQuality.expenseDaysWithActivity || 0
      },
      evidence: {
        metric: 'forecast.confidence.level',
        value: forecastConfidence.level || 'low',
        threshold: 'medium',
        comparison: '<'
      }
    });
  }

  // -------------------------------------------------------------------------
  // KURAL 3: LOW_FORECAST_CONFIDENCE
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense && forecastConfidence.level === 'low') {
    candidateInsights.push({
      ruleId: 'LOW_FORECAST_CONFIDENCE',
      id: 'LOW_FORECAST_CONFIDENCE',
      type: 'forecast',
      severity: 'info',
      priority: 80,
      messageKey: 'insights.lowForecastConfidence',
      params: {
        confidenceScore: forecastConfidence.score || 0,
        sampleDays: forecastConfidence.sampleDays || 0,
        activeExpenseDays: forecastConfidence.activeExpenseDays || 0
      },
      evidence: {
        metric: 'confidence.level',
        value: 'low',
        threshold: 'medium',
        comparison: '<'
      },
      action: {
        type: 'OPEN_FORECAST_DETAILS'
      }
    });
  }

  // -------------------------------------------------------------------------
  // KURAL 4: PROJECTED_BALANCE_NEGATIVE_WITHOUT_NEW_INCOME
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (
    forecastMeta.isForecastApplicable === true &&
    typeof forecastData.projectedEndBalanceAssumingNoNewIncome === 'number' &&
    forecastData.projectedEndBalanceAssumingNoNewIncome < 0
  ) {
    candidateInsights.push({
      ruleId: 'PROJECTED_BALANCE_NEGATIVE_WITHOUT_NEW_INCOME',
      id: 'PROJECTED_BALANCE_NEGATIVE_WITHOUT_NEW_INCOME',
      type: 'forecast_pressure',
      severity: 'warning',
      priority: 95,
      messageKey: 'insights.projectedNegativeBalanceNoIncome',
      params: {
        projectedEndBalance: forecastData.projectedEndBalanceAssumingNoNewIncome,
        projectedRemainingExpense: forecastData.projectedRemainingExpense || 0
      },
      evidence: {
        metric: 'projectedEndBalanceAssumingNoNewIncome',
        value: forecastData.projectedEndBalanceAssumingNoNewIncome,
        threshold: 0,
        comparison: '<'
      },
      action: {
        type: 'OPEN_FORECAST_DETAILS'
      }
    });
  }

  // -------------------------------------------------------------------------
  // KURAL 5 & 6: SPENDING VELOCITY (Hızlanma & Yavaşlama)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense) {
    if (isLowConfidence) {
      suppressedRuleCount++;
    } else if (typeof spendingVelocity.velocityChangePercent === 'number') {
      if (spendingVelocity.velocityChangePercent >= RULE_THRESHOLDS.VELOCITY_CHANGE_PERCENT) {
        candidateInsights.push({
          ruleId: 'SPENDING_ACCELERATING',
          id: 'SPENDING_ACCELERATING',
          type: 'spending_velocity',
          severity: 'watch',
          priority: 75,
          messageKey: 'insights.spendingAccelerating',
          params: {
            changePercent: spendingVelocity.velocityChangePercent,
            recentDailyAverage: spendingVelocity.last7DaysDailyAverage,
            monthDailyAverage: spendingVelocity.monthToDateDailyAverage
          },
          evidence: {
            metric: 'velocityChangePercent',
            value: spendingVelocity.velocityChangePercent,
            threshold: RULE_THRESHOLDS.VELOCITY_CHANGE_PERCENT,
            comparison: '>='
          },
          action: {
            type: 'OPEN_VELOCITY_DETAILS'
          }
        });
      } else if (spendingVelocity.velocityChangePercent <= -RULE_THRESHOLDS.VELOCITY_CHANGE_PERCENT) {
        candidateInsights.push({
          ruleId: 'SPENDING_SLOWING',
          id: 'SPENDING_SLOWING',
          type: 'spending_velocity',
          severity: 'positive',
          priority: 70,
          messageKey: 'insights.spendingSlowing',
          params: {
            changePercent: Math.abs(spendingVelocity.velocityChangePercent),
            recentDailyAverage: spendingVelocity.last7DaysDailyAverage,
            monthDailyAverage: spendingVelocity.monthToDateDailyAverage
          },
          evidence: {
            metric: 'velocityChangePercent',
            value: spendingVelocity.velocityChangePercent,
            threshold: -RULE_THRESHOLDS.VELOCITY_CHANGE_PERCENT,
            comparison: '<='
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 7 & 8: MONTH PERIOD COMPARISON (Same-Period Artış / Azalış)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense) {
    if (isLowConfidence) {
      suppressedRuleCount++;
    } else if (typeof comparison.percentageChange === 'number') {
      if (comparison.percentageChange >= RULE_THRESHOLDS.PERIOD_CHANGE_PERCENT) {
        candidateInsights.push({
          ruleId: 'MONTH_SPEND_UP',
          id: 'MONTH_SPEND_UP',
          type: 'period_comparison',
          severity: 'watch',
          priority: 65,
          messageKey: 'insights.monthSpendUp',
          params: {
            changePercent: comparison.percentageChange,
            currentExpense: comparison.currentExpense,
            previousExpense: comparison.previousExpense,
            comparisonDays: comparison.comparisonDays
          },
          evidence: {
            metric: 'comparison.percentageChange',
            value: comparison.percentageChange,
            threshold: RULE_THRESHOLDS.PERIOD_CHANGE_PERCENT,
            comparison: '>='
          }
        });
      } else if (comparison.percentageChange <= -RULE_THRESHOLDS.PERIOD_CHANGE_PERCENT) {
        candidateInsights.push({
          ruleId: 'MONTH_SPEND_DOWN',
          id: 'MONTH_SPEND_DOWN',
          type: 'period_comparison',
          severity: 'positive',
          priority: 60,
          messageKey: 'insights.monthSpendDown',
          params: {
            changePercent: Math.abs(comparison.percentageChange),
            currentExpense: comparison.currentExpense,
            previousExpense: comparison.previousExpense,
            comparisonDays: comparison.comparisonDays
          },
          evidence: {
            metric: 'comparison.percentageChange',
            value: comparison.percentageChange,
            threshold: -RULE_THRESHOLDS.PERIOD_CHANGE_PERCENT,
            comparison: '<='
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 9: HIGH_CATEGORY_SHARE (Kategori Yoğunlaşması >= %40)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense) {
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      if (cat.shareOfTotalExpense >= RULE_THRESHOLDS.HIGH_CATEGORY_SHARE_PERCENT) {
        highShareCategoryIds.add(cat.categoryId);
        candidateInsights.push({
          ruleId: 'HIGH_CATEGORY_SHARE',
          id: `HIGH_CATEGORY_SHARE:${cat.categoryId}`,
          type: 'category_share',
          severity: 'info',
          priority: 50,
          messageKey: 'insights.highCategoryShare',
          params: {
            category: cat.categoryName || cat.categoryId,
            shareOfTotalExpense: cat.shareOfTotalExpense,
            currentAmount: cat.currentAmount
          },
          evidence: {
            metric: 'category.shareOfTotalExpense',
            value: cat.shareOfTotalExpense,
            threshold: RULE_THRESHOLDS.HIGH_CATEGORY_SHARE_PERCENT,
            comparison: '>='
          },
          action: {
            type: 'OPEN_CATEGORY',
            categoryId: cat.categoryId,
            categoryName: cat.categoryName || cat.categoryId
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 10: CATEGORY_SPEND_UP (Kategori Sıçraması: >= %25 ve pay >= %10)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense) {
    if (isLowConfidence) {
      suppressedRuleCount++;
    } else {
      const categorySurges = [];
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        if (
          typeof cat.percentageChange === 'number' &&
          cat.percentageChange >= RULE_THRESHOLDS.CATEGORY_CHANGE_PERCENT &&
          cat.shareOfTotalExpense >= RULE_THRESHOLDS.CATEGORY_MIN_SHARE_PERCENT
        ) {
          categorySurges.push(cat);
        }
      }

      // En yüksek artış oranına göre sırala ve maksimum ilk 2'yi al
      categorySurges.sort((a, b) => b.percentageChange - a.percentageChange);
      const cappedSurges = categorySurges.slice(0, 2);

      for (let i = 0; i < cappedSurges.length; i++) {
        const cat = cappedSurges[i];
        candidateInsights.push({
          ruleId: 'CATEGORY_SPEND_UP',
          id: `CATEGORY_SPEND_UP:${cat.categoryId}`,
          type: 'category_surge',
          severity: 'watch',
          priority: 60,
          messageKey: 'insights.categorySpendUp',
          params: {
            category: cat.categoryName || cat.categoryId,
            currentAmount: cat.currentAmount,
            previousAmount: cat.previousAmount,
            percentageChange: cat.percentageChange,
            shareOfTotalExpense: cat.shareOfTotalExpense
          },
          evidence: {
            metric: 'category.percentageChange',
            value: cat.percentageChange,
            threshold: RULE_THRESHOLDS.CATEGORY_CHANGE_PERCENT,
            comparison: '>='
          },
          action: {
            type: 'OPEN_CATEGORY',
            categoryId: cat.categoryId,
            categoryName: cat.categoryName || cat.categoryId
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 11: CATEGORY_SPEND_DOWN (Kategori Düşüşü: <= -%25 ve önceki pay >= %10)
  // Previous-period category share derives safely: previousAmount / previousExpense * 100
  // Safe null when previousExpense === 0
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense) {
    if (isLowConfidence) {
      suppressedRuleCount++;
    } else {
      const previousTotal = typeof comparison.previousExpense === 'number' ? comparison.previousExpense : 0;
      const categoryDrops = [];

      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const previousShare = previousTotal > 0 ? round((cat.previousAmount / previousTotal) * 100) : null;

        if (
          typeof cat.percentageChange === 'number' &&
          cat.percentageChange <= -RULE_THRESHOLDS.CATEGORY_CHANGE_PERCENT &&
          typeof previousShare === 'number' &&
          previousShare >= RULE_THRESHOLDS.CATEGORY_MIN_SHARE_PERCENT
        ) {
          categoryDrops.push({ ...cat, previousShare });
        }
      }

      // En belirgin düşüşe göre sırala ve maksimum ilk 2'yi al
      categoryDrops.sort((a, b) => a.percentageChange - b.percentageChange);
      const cappedDrops = categoryDrops.slice(0, 2);

      for (let i = 0; i < cappedDrops.length; i++) {
        const cat = cappedDrops[i];
        candidateInsights.push({
          ruleId: 'CATEGORY_SPEND_DOWN',
          id: `CATEGORY_SPEND_DOWN:${cat.categoryId}`,
          type: 'category_drop',
          severity: 'positive',
          priority: 55,
          messageKey: 'insights.categorySpendDown',
          params: {
            category: cat.categoryName || cat.categoryId,
            currentAmount: cat.currentAmount,
            previousAmount: cat.previousAmount,
            percentageChange: Math.abs(cat.percentageChange),
            previousShare: cat.previousShare,
            shareOfTotalExpense: cat.shareOfTotalExpense
          },
          evidence: {
            metric: 'category.percentageChange',
            value: cat.percentageChange,
            threshold: -RULE_THRESHOLDS.CATEGORY_CHANGE_PERCENT,
            comparison: '<=',
            previousShare: cat.previousShare
          },
          action: {
            type: 'OPEN_CATEGORY',
            categoryId: cat.categoryId,
            categoryName: cat.categoryName || cat.categoryId
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 12: TOP_SPENDING_CATEGORY (En çok harcanan kategori)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  if (!isNoExpense && categories.length > 0 && categories[0].currentAmount > 0) {
    const topCat = categories[0];
    // DEDUP: Eğer aynı kategori için zaten HIGH_CATEGORY_SHARE üretildiyse, TOP_SPENDING_CATEGORY baskılanır
    if (highShareCategoryIds.has(topCat.categoryId)) {
      suppressedRuleCount++;
    } else {
      candidateInsights.push({
        ruleId: 'TOP_SPENDING_CATEGORY',
        id: 'TOP_SPENDING_CATEGORY',
        type: 'top_category',
        severity: 'info',
        priority: 30,
        messageKey: 'insights.topSpendingCategory',
        params: {
          category: topCat.categoryName || topCat.categoryId,
          currentAmount: topCat.currentAmount,
          shareOfTotalExpense: topCat.shareOfTotalExpense
        },
        evidence: {
          metric: 'category.rank',
          value: 1,
          threshold: 1,
          comparison: '==='
        },
        action: {
          type: 'OPEN_CATEGORY',
          categoryId: topCat.categoryId,
          categoryName: topCat.categoryName || topCat.categoryId
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // KURAL 13: FORECAST_MODEL_DISAGREEMENT (Model Belirsizliği >= %15)
  // Safely handles projectedExpense === 0 (no NaN/Infinity escapes)
  // -------------------------------------------------------------------------
  evaluatedRuleCount++;
  const projectedExpense = typeof forecastData.projectedExpense === 'number' ? forecastData.projectedExpense : 0;
  if (
    forecastMeta.isForecastApplicable === true &&
    typeof forecastData.upperProjection === 'number' &&
    typeof forecastData.lowerProjection === 'number'
  ) {
    if (projectedExpense > 0) {
      const spread = round(forecastData.upperProjection - forecastData.lowerProjection);
      const spreadPercent = round((spread / projectedExpense) * 100);

      if (!isNaN(spreadPercent) && isFinite(spreadPercent) && spreadPercent >= RULE_THRESHOLDS.FORECAST_SPREAD_PERCENT) {
        candidateInsights.push({
          ruleId: 'FORECAST_MODEL_DISAGREEMENT',
          id: 'FORECAST_MODEL_DISAGREEMENT',
          type: 'forecast_uncertainty',
          severity: 'info',
          priority: 45,
          messageKey: 'insights.forecastModelDisagreement',
          params: {
            spreadPercent,
            lowerProjection: forecastData.lowerProjection,
            upperProjection: forecastData.upperProjection,
            projectedExpense: projectedExpense
          },
          evidence: {
            metric: 'forecastSpreadPercent',
            value: spreadPercent,
            threshold: RULE_THRESHOLDS.FORECAST_SPREAD_PERCENT,
            comparison: '>='
          },
          action: {
            type: 'OPEN_FORECAST_DETAILS'
          }
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // SIRALAMA, DEDUP VE CAPPING
  // -------------------------------------------------------------------------
  // Önceliğe göre sırala (priority DESC)
  candidateInsights.sort((a, b) => b.priority - a.priority);

  // ID bazlı tekilleştirme (Duplicate ID önleme)
  const seenIds = new Set();
  const dedupedInsights = [];
  for (let i = 0; i < candidateInsights.length; i++) {
    const item = candidateInsights[i];
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      dedupedInsights.push(item);
    }
  }

  // triggeredRuleCount: all triggered insight instances before maxInsights truncation
  const triggeredRuleCount = dedupedInsights.length;

  // maxInsights ile sınırla (Varsayılan: 5)
  const maxLimit = typeof options.maxInsights === 'number' && options.maxInsights > 0 ? options.maxInsights : 5;
  const finalInsights = dedupedInsights.slice(0, maxLimit);

  // returnedInsightCount: final insights.length
  const returnedInsightCount = finalInsights.length;

  // Severity sayaçları
  const counts = {
    positive: 0,
    info: 0,
    watch: 0,
    warning: 0
  };

  for (let i = 0; i < finalInsights.length; i++) {
    const sev = finalInsights[i].severity;
    if (Object.prototype.hasOwnProperty.call(counts, sev)) {
      counts[sev]++;
    }
  }

  return {
    generatedAtPeriod: periodKey,
    insights: finalInsights,
    counts,
    metadata: {
      evaluatedRuleCount,
      triggeredRuleCount,
      suppressedRuleCount,
      returnedInsightCount
    }
  };
}
