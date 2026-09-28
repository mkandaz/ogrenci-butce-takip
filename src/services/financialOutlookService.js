import { round, analyzeMonth } from './analyticsEngine.js';
import { forecastMonth } from './forecastEngine.js';
import { generateInsights } from './insightEngine.js';
import { planCashflow, COVERAGE_STATUS } from './cashflowPlannerEngine.js';
import { calculateSummary } from '../store/calculations.js';
import { getCurrentYearMonth, getLocalDateString } from '../utils/helpers.js';

/**
 * FAZ 5.5C — Finansal Görünüm View Model Orkestrasyonu
 * 
 * Tüm matematiksel modelleri (Analytics, Forecast, Insight, Cashflow Planner)
 * tek bir yerde deterministik olarak bağlar ve UI katmanına sunar.
 * UIManager içinde formül tekrarlanmaz.
 *
 * @param {Object} params
 * @param {Object} params.store BudgetStore örneği
 * @param {string} [params.selectedMonth] Seçili ay ("YYYY-MM")
 * @param {Date|string} [params.now=new Date()] Referans tarih
 * @returns {Object} Financial Outlook View Model
 */
export function getFinancialOutlookViewModel({ store, selectedMonth, now = new Date() } = {}) {
  if (!store || typeof store.getTransactions !== 'function') {
    throw new Error('getFinancialOutlookViewModel requires a valid BudgetStore instance.');
  }

  const validNow = now instanceof Date ? now : (now ? new Date(now) : new Date());
  const safeNow = isNaN(validNow.getTime()) ? new Date() : validNow;
  const refDateStr = getLocalDateString(safeNow);

  // Time-axis separation (UX Option B):
  // selectedMonth determines dashboard period navigation (historical, current, future).
  // Financial Outlook is ALWAYS "today's live financial situation" based on safeNow!
  const currentYearMonth = getCurrentYearMonth(safeNow);
  const selectedPeriod = selectedMonth || currentYearMonth;

  const isCurrentMonth = selectedPeriod === currentYearMonth;
  const isHistorical = selectedPeriod < currentYearMonth;
  const isFuture = selectedPeriod > currentYearMonth;

  // Live calculation period is ALWAYS current year & current month of safeNow
  const [curYStr, curMStr] = currentYearMonth.split('-');
  const currentYear = parseInt(curYStr, 10) || safeNow.getFullYear();
  const currentMonthNum = parseInt(curMStr, 10) || (safeNow.getMonth() + 1);

  // 1. İşlem ve plan kayıtları
  const transactions = store.getTransactions() || [];
  const plannedCashflows = store.getPlannedCashflows() || [];

  // 2. Canlı Mevcut Bakiye: DAİMA safeNow ve currentYearMonth üzerinden hesaplanır.
  // Seçili ay geçmiş veya gelecek olsa bile Finansal Görünüm bugünkü canlı bakiyeyi kullanır.
  const summary = calculateSummary(transactions, safeNow, currentYearMonth);
  const currentAvailableBalance = summary.balance;

  // 3. Analytics Engine (FAZ 5.1): Canlı cari ay analizi
  const analytics = analyzeMonth(transactions, {
    now: safeNow,
    year: currentYear,
    month: currentMonthNum
  });

  // 4. Forecast Engine (FAZ 5.2): Canlı cari ay tahmini
  const forecast = forecastMonth(transactions, {
    now: safeNow,
    year: currentYear,
    month: currentMonthNum,
    currentAvailableBalance
  });

  // 5. Insight Engine (FAZ 5.3) - Max 3 içgörü
  const insights = generateInsights({
    analytics,
    forecast,
    transactions,
    options: {
      maxInsights: 3,
      currentAvailableBalance
    }
  });

  // 6. Cashflow Planner Engine (FAZ 5.5A)
  // Cashflow planlaması her zaman öğrencinin gerçek takvim gününden (safeNow) ileriye bakar.
  const plan = planCashflow({
    plannedCashflows,
    options: {
      now: safeNow,
      currentAvailableBalance
    },
    forecast
  });

  const isLowConfidence = forecast?.confidence?.level === 'low';

  // 7. Structured UI ViewModel
  return {
    referenceDate: refDateStr,
    targetMonth: selectedPeriod,
    selectedMonth: selectedPeriod,
    currentYearMonth,
    isCurrentMonth,
    isHistorical,
    isFuture,
    currentAvailableBalance,
    hasPlannedCashflows: Array.isArray(plannedCashflows) && plannedCashflows.length > 0,
    nextIncome: {
      found: Boolean(plan.nextIncome?.found),
      name: plan.nextIncome?.name || null,
      date: plan.nextIncome?.date || null,
      daysUntil: typeof plan.nextIncome?.daysUntil === 'number' ? plan.nextIncome.daysUntil : null,
      amount: typeof plan.nextIncome?.amount === 'number' ? plan.nextIncome.amount : null,
      type: plan.nextIncome?.type || null
    },
    safeDailySpend: plan.spending?.safeDailySpendUntilNextIncome,
    currentDailyPace: forecast.dailyRates?.blended || 0,
    dailyAdjustmentNeeded: plan.spending?.dailyAdjustmentNeeded || 0,
    monthEndForecast: {
      projectedExpense: forecast.forecast?.projectedExpense || 0,
      isLowConfidence,
      confidenceScore: forecast.confidence?.score || 0
    },
    coverageStatus: plan.status?.coverageStatus || COVERAGE_STATUS.NO_NEXT_INCOME,
    utilizationRatio: plan.spending?.utilizationRatio,
    projectedBalanceBeforeNextIncome: plan.spending?.projectedBalanceBeforeNextIncome,
    obligationsBeforeIncome: plan.obligations?.totalBeforeIncome || 0,
    sameDayObligations: plan.obligations?.sameDayExpenseTotal || 0,
    timeline: (plan.timeline || []).slice(0, 5),
    insights: (insights.insights || []).slice(0, 3),
    raw: {
      analytics,
      forecast,
      plan,
      insights
    }
  };
}
