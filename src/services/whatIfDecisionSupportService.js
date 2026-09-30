import { round } from './analyticsEngine.js';
import { forecastMonth } from './forecastEngine.js';
import { simulateWhatIf, SCENARIO_TYPES } from './whatIfEngine.js';
import { planCashflow, COVERAGE_STATUS } from './cashflowPlannerEngine.js';
import { calculateSummary } from '../store/calculations.js';
import { getCurrentYearMonth, getLocalDateString } from '../utils/helpers.js';

/**
 * Karar etki başlık kodları (Machine-readable decision impact codes).
 */
export const DECISION_IMPACT_CODES = {
  AWAITING_INPUT: 'AWAITING_INPUT',
  STATUS_SHIFT_DEFICIT: 'STATUS_SHIFT_DEFICIT',
  STATUS_SHIFT_TIGHT: 'STATUS_SHIFT_TIGHT',
  STATUS_SHIFT_COVERED: 'STATUS_SHIFT_COVERED',
  DEFICIT_DEEPENED: 'DEFICIT_DEEPENED',
  DEFICIT_REDUCED: 'DEFICIT_REDUCED',
  DEFICIT_ADJUSTMENT_NEEDED: 'DEFICIT_ADJUSTMENT_NEEDED',
  SAFE_SPEND_DECREASED: 'SAFE_SPEND_DECREASED',
  SAFE_SPEND_INCREASED: 'SAFE_SPEND_INCREASED',
  PRE_INCOME_BALANCE_DECREASED: 'PRE_INCOME_BALANCE_DECREASED',
  PRE_INCOME_BALANCE_INCREASED: 'PRE_INCOME_BALANCE_INCREASED',
  PLAN_REMAINS_BALANCED: 'PLAN_REMAINS_BALANCED',
  NO_NEXT_INCOME_MONTH_END_DECREASE: 'NO_NEXT_INCOME_MONTH_END_DECREASE',
  NO_NEXT_INCOME_MONTH_END_INCREASE: 'NO_NEXT_INCOME_MONTH_END_INCREASE',
  NO_NEXT_INCOME_MONTH_END_EXPENSE_INCREASE: 'NO_NEXT_INCOME_MONTH_END_EXPENSE_INCREASE',
  NO_NEXT_INCOME_MONTH_END_EXPENSE_DECREASE: 'NO_NEXT_INCOME_MONTH_END_EXPENSE_DECREASE',
  NO_NEXT_INCOME_NEUTRAL: 'NO_NEXT_INCOME_NEUTRAL'
};

/**
 * Karar destek orkestrasyonu:
 * Mevcut deterministik nehirleri (whatIfEngine + cashflowPlannerEngine + forecastEngine)
 * tek bir saf (pure) ve açıklanabilir servis altında birleştirir.
 *
 * @param {Object} params
 * @param {Object} [params.store] BudgetStore örneği (opsiyonel)
 * @param {Array<Object>} [params.transactions] İşlem listesi
 * @param {Array<Object>} [params.plannedCashflows] Planlı nakit akışları
 * @param {number|null} [params.currentAvailableBalance] Bakiye override (opsiyonel)
 * @param {Object} params.scenario Senaryo objesi ({ type, amount, percent, amountPerDay })
 * @param {Date|string} [params.now=new Date()] Referans tarih (Bugün)
 * @param {string} [params.selectedMonth] Seçili ay (zaman ayrımı için)
 * @returns {Object} Cashflow-aware decision support ViewModel
 */
export function getWhatIfDecisionSupport({
  store,
  transactions,
  plannedCashflows,
  currentAvailableBalance,
  scenario,
  now = new Date()
} = {}) {
  const validNow = now instanceof Date ? now : (now ? new Date(now) : new Date());
  const safeNow = isNaN(validNow.getTime()) ? new Date() : validNow;
  const referenceDateStr = getLocalDateString(safeNow);

  const currentYearMonth = getCurrentYearMonth(safeNow);
  const [curYStr, curMStr] = currentYearMonth.split('-');
  const currentYear = parseInt(curYStr, 10) || safeNow.getFullYear();
  const currentMonthNum = parseInt(curMStr, 10) || (safeNow.getMonth() + 1);

  // 1. Veri kaynakları
  const txs = Array.isArray(transactions)
    ? transactions
    : (store?.getTransactions?.() || []);
  const plans = Array.isArray(plannedCashflows)
    ? plannedCashflows
    : (store?.getPlannedCashflows?.() || []);

  // 2. Canlı bakiye çözümleme (safeNow ve currentYearMonth üzerinden)
  let liveBalance = null;
  if (currentAvailableBalance === null) {
    liveBalance = null;
  } else if (typeof currentAvailableBalance === 'number' && !isNaN(currentAvailableBalance)) {
    liveBalance = currentAvailableBalance;
  } else {
    try {
      const summary = calculateSummary(txs, safeNow, currentYearMonth);
      if (summary && typeof summary.balance === 'number' && !isNaN(summary.balance)) {
        liveBalance = summary.balance;
      }
    } catch (_) {}
  }

  // 3. Baseline modeller
  const baselineForecast = forecastMonth(txs, {
    now: safeNow,
    year: currentYear,
    month: currentMonthNum,
    currentAvailableBalance: liveBalance
  });

  const baselineWhatIf = simulateWhatIf({
    transactions: txs,
    options: {
      now: safeNow,
      year: currentYear,
      month: currentMonthNum,
      currentAvailableBalance: liveBalance
    },
    scenario,
    baselineForecast
  });

  const baselinePlan = planCashflow({
    plannedCashflows: plans,
    options: {
      now: safeNow,
      currentAvailableBalance: liveBalance
    },
    forecast: baselineForecast
  });

  // 4. Senaryo Çözümleme (Scenario -> Cashflow Semantics)
  const isScenarioValid = Boolean(baselineWhatIf.isValid);
  let simulatedBalance = liveBalance;
  let simulatedDailyRate = baselineWhatIf.baseline.dailyRate;

  if (isScenarioValid && scenario) {
    if (scenario.type === SCENARIO_TYPES.ONE_TIME_EXPENSE) {
      // Tek seferlik harcama: anlık bakiye düşer, günlük harcama hızı (rate) değişmez
      if (liveBalance !== null && typeof scenario.amount === 'number' && !isNaN(scenario.amount)) {
        simulatedBalance = round(liveBalance - scenario.amount);
      }
      simulatedDailyRate = baselineWhatIf.baseline.dailyRate;
    } else if (scenario.type === SCENARIO_TYPES.ONE_TIME_INCOME) {
      // Tek seferlik gelir: anlık bakiye artar, harcama hızı değişmez
      if (liveBalance !== null && typeof scenario.amount === 'number' && !isNaN(scenario.amount)) {
        simulatedBalance = round(liveBalance + scenario.amount);
      }
      simulatedDailyRate = baselineWhatIf.baseline.dailyRate;
    } else if (scenario.type === SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE) {
      // Gelecek harcama oranı değişimi: anlık bakiye değişmez, günlük hız whatIfEngine tarafından belirlenir
      simulatedBalance = liveBalance;
      simulatedDailyRate = baselineWhatIf.simulated.dailyRate;
    } else if (scenario.type === SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE) {
      // Günlük harcama tutarı değişimi: anlık bakiye değişmez, günlük hız whatIfEngine tarafından belirlenir
      simulatedBalance = liveBalance;
      simulatedDailyRate = baselineWhatIf.simulated.dailyRate;
    }
  }

  // Senaryo forecast objesi (variable spending için)
  const simulatedForecast = {
    ...baselineForecast,
    dailyRates: {
      ...baselineForecast?.dailyRates,
      blended: simulatedDailyRate
    }
  };

  const simulatedPlan = planCashflow({
    plannedCashflows: plans,
    options: {
      now: safeNow,
      currentAvailableBalance: simulatedBalance
    },
    forecast: simulatedForecast
  });

  // 5. Bir Sonraki Gelire Kadar Metrikleri (Until Next Income)
  const nextIncome = baselinePlan.nextIncome || { found: false };
  const hasNextIncome = Boolean(nextIncome.found);

  const baseSafeDaily = baselinePlan.spending?.safeDailySpendUntilNextIncome ?? null;
  const simSafeDaily = simulatedPlan.spending?.safeDailySpendUntilNextIncome ?? null;
  const deltaSafeDaily = (simSafeDaily !== null && baseSafeDaily !== null)
    ? round(simSafeDaily - baseSafeDaily)
    : null;

  const baseStatus = baselinePlan.status?.coverageStatus || COVERAGE_STATUS.NO_NEXT_INCOME;
  const simStatus = simulatedPlan.status?.coverageStatus || COVERAGE_STATUS.NO_NEXT_INCOME;
  const statusChanged = isScenarioValid && baseStatus !== simStatus;

  const basePreIncomeBalance = baselinePlan.spending?.projectedBalanceBeforeNextIncome ?? null;
  const simPreIncomeBalance = simulatedPlan.spending?.projectedBalanceBeforeNextIncome ?? null;
  const deltaPreIncomeBalance = (simPreIncomeBalance !== null && basePreIncomeBalance !== null)
    ? round(simPreIncomeBalance - basePreIncomeBalance)
    : null;

  const baseAdjustment = baselinePlan.spending?.dailyAdjustmentNeeded ?? 0;
  const simAdjustment = simulatedPlan.spending?.dailyAdjustmentNeeded ?? 0;
  const deltaAdjustment = round(simAdjustment - baseAdjustment);

  const obligationsBeforeIncome = baselinePlan.obligations?.totalBeforeIncome || 0;
  const sameDayObligations = baselinePlan.obligations?.sameDayExpenseTotal || 0;
  const totalReservedObligations = round(obligationsBeforeIncome + sameDayObligations);

  // 6. Deterministik Karar Etki Analizi (Decision Impact Priority Logic)
  const decisionImpact = evaluateDecisionImpact({
    isScenarioValid,
    hasNextIncome,
    baseStatus,
    simStatus,
    baseSafeDaily,
    simSafeDaily,
    deltaSafeDaily,
    basePreIncomeBalance,
    simPreIncomeBalance,
    deltaPreIncomeBalance,
    baseAdjustment,
    simAdjustment,
    deltaAdjustment,
    monthEndDeltaBalance: baselineWhatIf.delta.projectedEndBalance,
    monthEndDeltaExpense: baselineWhatIf.delta.projectedExpense
  });

  // 7. Açıklanabilirlik Varsayımları (Explainability)
  const explainability = buildExplainabilityNotes({
    scenario,
    isScenarioValid,
    hasNextIncome,
    nextIncome,
    totalReservedObligations,
    baselineDailyRate: baselineWhatIf.baseline.dailyRate,
    simulatedDailyRate,
    daysUntilNextIncome: nextIncome.daysUntil,
    whatIfAssumptions: baselineWhatIf.metadata?.assumptions || [],
    daysRemainingInMonth: baselineWhatIf.metadata?.daysRemaining || 0
  });

  return {
    referenceDate: referenceDateStr,
    currentYearMonth,
    hasPlannedCashflows: plans.length > 0,
    hasNextIncome,
    nextIncome: {
      found: hasNextIncome,
      name: nextIncome.name,
      date: nextIncome.date,
      amount: nextIncome.amount,
      daysUntil: nextIncome.daysUntil
    },
    obligations: {
      totalBeforeIncome: obligationsBeforeIncome,
      sameDayExpenseTotal: sameDayObligations,
      totalReserved: totalReservedObligations
    },
    untilNextIncome: {
      baseline: {
        safeDailySpend: baseSafeDaily,
        coverageStatus: baseStatus,
        projectedBalanceBeforeNextIncome: basePreIncomeBalance,
        dailyAdjustmentNeeded: baseAdjustment,
        availableAfterPlannedObligations: baselinePlan.spending?.availableAfterPlannedObligations ?? null
      },
      simulated: {
        safeDailySpend: simSafeDaily,
        coverageStatus: simStatus,
        projectedBalanceBeforeNextIncome: simPreIncomeBalance,
        dailyAdjustmentNeeded: simAdjustment,
        availableAfterPlannedObligations: simulatedPlan.spending?.availableAfterPlannedObligations ?? null
      },
      delta: {
        safeDailySpend: deltaSafeDaily,
        projectedBalanceBeforeNextIncome: deltaPreIncomeBalance,
        dailyAdjustmentNeeded: deltaAdjustment,
        statusChanged,
        statusTransition: {
          from: baseStatus,
          to: simStatus
        }
      }
    },
    monthEnd: {
      baseline: baselineWhatIf.baseline,
      simulated: baselineWhatIf.simulated,
      delta: baselineWhatIf.delta
    },
    decisionImpact,
    explainability,
    raw: {
      baselineForecast,
      simulatedForecast,
      baselinePlan,
      simulatedPlan,
      whatIfResult: baselineWhatIf
    }
  };
}

/**
 * Önceliklendirilmiş deterministik etki değerlendirmesi.
 * Tavsiye vermez (finansal nasihat yoktur); nesnel olası sonuçları belirler.
 */
function evaluateDecisionImpact({
  isScenarioValid,
  hasNextIncome,
  baseStatus,
  simStatus,
  baseSafeDaily,
  simSafeDaily,
  deltaSafeDaily,
  basePreIncomeBalance,
  simPreIncomeBalance,
  deltaPreIncomeBalance,
  baseAdjustment,
  simAdjustment,
  deltaAdjustment,
  monthEndDeltaBalance,
  monthEndDeltaExpense
}) {
  if (!isScenarioValid) {
    return {
      code: DECISION_IMPACT_CODES.AWAITING_INPUT,
      severity: 'neutral',
      badge: '—',
      params: {}
    };
  }

  // 1. DURUM: Planlı sonraki gelir varsa (Nakit akışı ufku birincildir)
  if (hasNextIncome) {
    // Öncelik 1: Statü Değişimi -> Açık Riskine Giriş
    if (baseStatus !== COVERAGE_STATUS.DEFICIT_BEFORE_INCOME && simStatus === COVERAGE_STATUS.DEFICIT_BEFORE_INCOME) {
      const deficitAmount = (simPreIncomeBalance !== null && simPreIncomeBalance < 0)
        ? Math.abs(simPreIncomeBalance)
        : null;
      return {
        code: DECISION_IMPACT_CODES.STATUS_SHIFT_DEFICIT,
        severity: 'deficit',
        badge: deficitAmount !== null ? `-${deficitAmount}` : 'Açık Riski',
        params: {
          from: baseStatus,
          to: simStatus,
          amount: deficitAmount
        }
      };
    }

    // Öncelik 2: Statü Değişimi -> Sınıra Yaklaşma (TIGHT)
    if (baseStatus === COVERAGE_STATUS.COVERED && simStatus === COVERAGE_STATUS.TIGHT) {
      return {
        code: DECISION_IMPACT_CODES.STATUS_SHIFT_TIGHT,
        severity: 'warning',
        badge: 'Sınıra Yaklaşıyor',
        params: { from: baseStatus, to: simStatus }
      };
    }

    // Öncelik 3: Statü İyileşmesi -> Plan Dengeliye Geçiş (COVERED)
    if (baseStatus !== COVERAGE_STATUS.COVERED && simStatus === COVERAGE_STATUS.COVERED) {
      return {
        code: DECISION_IMPACT_CODES.STATUS_SHIFT_COVERED,
        severity: 'positive',
        badge: 'Plan Dengeli',
        params: { from: baseStatus, to: simStatus }
      };
    }

    // Öncelik 4: Her ikisi de DEFICIT_BEFORE_INCOME ise
    if (baseStatus === COVERAGE_STATUS.DEFICIT_BEFORE_INCOME && simStatus === COVERAGE_STATUS.DEFICIT_BEFORE_INCOME) {
      if (deltaPreIncomeBalance !== null && deltaPreIncomeBalance < 0) {
        return {
          code: DECISION_IMPACT_CODES.DEFICIT_DEEPENED,
          severity: 'deficit',
          badge: `-${Math.abs(deltaPreIncomeBalance)}`,
          params: { amount: Math.abs(deltaPreIncomeBalance) }
        };
      }
      if (deltaPreIncomeBalance !== null && deltaPreIncomeBalance > 0) {
        return {
          code: DECISION_IMPACT_CODES.DEFICIT_REDUCED,
          severity: 'positive',
          badge: `+${deltaPreIncomeBalance}`,
          params: { amount: deltaPreIncomeBalance }
        };
      }
      if (simAdjustment > 0) {
        return {
          code: DECISION_IMPACT_CODES.DEFICIT_ADJUSTMENT_NEEDED,
          severity: 'deficit',
          badge: `-${simAdjustment}/gün`,
          params: { amount: simAdjustment }
        };
      }
    }

    // Öncelik 5: Güvenli günlük limit değişimi
    if (deltaSafeDaily !== null && deltaSafeDaily !== 0) {
      if (deltaSafeDaily < 0) {
        return {
          code: DECISION_IMPACT_CODES.SAFE_SPEND_DECREASED,
          severity: simSafeDaily === 0 ? 'deficit' : 'warning',
          badge: `-${Math.abs(deltaSafeDaily)}/gün`,
          params: { amount: Math.abs(deltaSafeDaily) }
        };
      } else {
        return {
          code: DECISION_IMPACT_CODES.SAFE_SPEND_INCREASED,
          severity: 'positive',
          badge: `+${deltaSafeDaily}/gün`,
          params: { amount: deltaSafeDaily }
        };
      }
    }

    // Öncelik 6: Gelir öncesi tahmini bakiye değişimi (harcama hızı değişimlerinden kaynaklı)
    if (deltaPreIncomeBalance !== null && deltaPreIncomeBalance !== 0) {
      if (deltaPreIncomeBalance < 0) {
        return {
          code: DECISION_IMPACT_CODES.PRE_INCOME_BALANCE_DECREASED,
          severity: 'warning',
          badge: `-${Math.abs(deltaPreIncomeBalance)}`,
          params: { amount: Math.abs(deltaPreIncomeBalance) }
        };
      } else {
        return {
          code: DECISION_IMPACT_CODES.PRE_INCOME_BALANCE_INCREASED,
          severity: 'positive',
          badge: `+${deltaPreIncomeBalance}`,
          params: { amount: deltaPreIncomeBalance }
        };
      }
    }

    // Öncelik 7: Plan dengeli kalıyor
    return {
      code: DECISION_IMPACT_CODES.PLAN_REMAINS_BALANCED,
      severity: 'positive',
      badge: 'Plan Dengeli',
      params: {}
    };
  }

  // 2. DURUM: Planlı sonraki gelir yok (Ay sonu projeksiyonuna dönülür)
  if (monthEndDeltaBalance !== null && monthEndDeltaBalance !== 0) {
    if (monthEndDeltaBalance < 0) {
      return {
        code: DECISION_IMPACT_CODES.NO_NEXT_INCOME_MONTH_END_DECREASE,
        severity: 'warning',
        badge: `-${Math.abs(monthEndDeltaBalance)}`,
        params: { amount: Math.abs(monthEndDeltaBalance) }
      };
    } else {
      return {
        code: DECISION_IMPACT_CODES.NO_NEXT_INCOME_MONTH_END_INCREASE,
        severity: 'positive',
        badge: `+${monthEndDeltaBalance}`,
        params: { amount: monthEndDeltaBalance }
      };
    }
  }

  if (monthEndDeltaExpense !== 0) {
    if (monthEndDeltaExpense > 0) {
      return {
        code: DECISION_IMPACT_CODES.NO_NEXT_INCOME_MONTH_END_EXPENSE_INCREASE,
        severity: 'warning',
        badge: `+${monthEndDeltaExpense}`,
        params: { amount: monthEndDeltaExpense }
      };
    } else {
      return {
        code: DECISION_IMPACT_CODES.NO_NEXT_INCOME_MONTH_END_EXPENSE_DECREASE,
        severity: 'positive',
        badge: `-${Math.abs(monthEndDeltaExpense)}`,
        params: { amount: Math.abs(monthEndDeltaExpense) }
      };
    }
  }

  return {
    code: DECISION_IMPACT_CODES.NO_NEXT_INCOME_NEUTRAL,
    severity: 'neutral',
    badge: '—',
    params: {}
  };
}

/**
 * Açıklanabilirlik maddelerini iki ayrı ufuk için üretir:
 * 1. Bir Sonraki Gelire Kadar (Nakit akışı ufku)
 * 2. Ay Sonu Harcama Projeksiyonu (Takvim ayı ufku)
 */
function buildExplainabilityNotes({
  scenario,
  isScenarioValid,
  hasNextIncome,
  nextIncome,
  totalReservedObligations,
  baselineDailyRate,
  simulatedDailyRate,
  daysUntilNextIncome,
  whatIfAssumptions,
  daysRemainingInMonth
}) {
  const untilNextIncomeNotes = [];
  const monthEndNotes = [];

  if (!isScenarioValid || !scenario) {
    return {
      untilNextIncome: [],
      monthEnd: [],
      assumptions: []
    };
  }

  // 1. Bir Sonraki Gelire Kadar Ufku Açıklamaları
  if (scenario.type === SCENARIO_TYPES.ONE_TIME_EXPENSE) {
    untilNextIncomeNotes.push({
      key: 'EXPENSE_REDUCED_FROM_AVAILABLE_BALANCE',
      params: { amount: scenario.amount }
    });
    untilNextIncomeNotes.push({
      key: 'ONE_TIME_EVENT_DOES_NOT_ALTER_DAILY_VELOCITY',
      params: {}
    });
  } else if (scenario.type === SCENARIO_TYPES.ONE_TIME_INCOME) {
    untilNextIncomeNotes.push({
      key: 'INCOME_ADDED_TO_AVAILABLE_BALANCE',
      params: { amount: scenario.amount }
    });
    untilNextIncomeNotes.push({
      key: 'ONE_TIME_INCOME_DOES_NOT_ALTER_DAILY_EXPENSE',
      params: {}
    });
  } else if (scenario.type === SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE) {
    untilNextIncomeNotes.push({
      key: 'FUTURE_SPEND_RATE_UPDATED_PERCENT',
      params: { percent: scenario.percent, newRate: simulatedDailyRate }
    });
  } else if (scenario.type === SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE) {
    untilNextIncomeNotes.push({
      key: 'FUTURE_SPEND_RATE_UPDATED_DAILY',
      params: { amountPerDay: scenario.amountPerDay, newRate: simulatedDailyRate }
    });
  }

  if (hasNextIncome) {
    untilNextIncomeNotes.push({
      key: 'NEXT_INCOME_HORIZON_APPLIED',
      params: {
        name: nextIncome.name,
        date: nextIncome.date,
        days: daysUntilNextIncome,
        obligations: totalReservedObligations
      }
    });
  } else {
    untilNextIncomeNotes.push({
      key: 'NO_NEXT_INCOME_PLANNED_NOTICE',
      params: {}
    });
  }

  // 2. Ay Sonu Harcama Projeksiyonu Açıklamaları
  monthEndNotes.push({
    key: 'MONTH_END_BEHAVIORAL_BASELINE_APPLIED',
    params: {
      dailyRate: baselineDailyRate,
      daysRemaining: daysRemainingInMonth
    }
  });

  return {
    untilNextIncome: untilNextIncomeNotes,
    monthEnd: monthEndNotes,
    assumptions: whatIfAssumptions
  };
}
