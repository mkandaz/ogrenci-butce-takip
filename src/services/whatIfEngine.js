import { round } from './analyticsEngine.js';
import { forecastMonth } from './forecastEngine.js';

/**
 * Desteklenen simülasyon senaryo tipleri.
 */
export const SCENARIO_TYPES = {
  ONE_TIME_EXPENSE: 'ONE_TIME_EXPENSE',
  ONE_TIME_INCOME: 'ONE_TIME_INCOME',
  FUTURE_SPEND_PERCENT_CHANGE: 'FUTURE_SPEND_PERCENT_CHANGE',
  FUTURE_DAILY_SPEND_CHANGE: 'FUTURE_DAILY_SPEND_CHANGE'
};

/**
 * Senaryo türlerine göre açıklayıcı varsayım kodları (Assumptions).
 */
export const SCENARIO_ASSUMPTIONS = {
  ONE_TIME_EXPENSE: [
    'BASELINE_FORECAST_UNCHANGED',
    'NO_ADDITIONAL_INCOME_ASSUMED',
    'ONE_TIME_EVENT'
  ],
  ONE_TIME_INCOME: [
    'BASELINE_EXPENSE_FORECAST_UNCHANGED',
    'ONE_TIME_INCOME_EVENT'
  ],
  FUTURE_SPEND_PERCENT_CHANGE: [
    'CHANGE_APPLIES_TO_REMAINING_DAYS_ONLY',
    'PAST_ACTUALS_UNCHANGED'
  ],
  FUTURE_DAILY_SPEND_CHANGE: [
    'CHANGE_APPLIES_TO_REMAINING_DAYS_ONLY',
    'PAST_ACTUALS_UNCHANGED',
    'DAILY_RATE_NON_NEGATIVE'
  ]
};

/**
 * Verilen senaryonun yapısal ve sayısal geçerliliğini denetler.
 *
 * @param {Object} scenario
 * @returns {{isValid: boolean, error?: string, reason?: string, type?: string}}
 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    return {
      isValid: false,
      error: 'INVALID_SCENARIO_OBJECT',
      reason: 'Scenario must be a valid non-null object'
    };
  }

  const { type } = scenario;
  if (!type || !Object.values(SCENARIO_TYPES).includes(type)) {
    return {
      isValid: false,
      error: 'UNSUPPORTED_SCENARIO_TYPE',
      reason: `Unsupported scenario type: ${type}`
    };
  }

  if (type === SCENARIO_TYPES.ONE_TIME_EXPENSE || type === SCENARIO_TYPES.ONE_TIME_INCOME) {
    const { amount } = scenario;
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
      return {
        isValid: false,
        error: 'INVALID_AMOUNT',
        reason: 'Amount must be a finite positive number'
      };
    }
    return { isValid: true, type };
  }

  if (type === SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE) {
    const { percent } = scenario;
    if (typeof percent !== 'number' || isNaN(percent) || !isFinite(percent)) {
      return {
        isValid: false,
        error: 'INVALID_PERCENT',
        reason: 'Percent must be a finite number'
      };
    }
    if (percent < -100 || percent > 1000) {
      return {
        isValid: false,
        error: 'PERCENT_OUT_OF_BOUNDS',
        reason: 'Percent must be between -100 and 1000'
      };
    }
    return { isValid: true, type };
  }

  if (type === SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE) {
    const { amountPerDay } = scenario;
    if (typeof amountPerDay !== 'number' || isNaN(amountPerDay) || !isFinite(amountPerDay)) {
      return {
        isValid: false,
        error: 'INVALID_DAILY_AMOUNT',
        reason: 'AmountPerDay must be a finite number'
      };
    }
    return { isValid: true, type };
  }

  return { isValid: false, error: 'UNKNOWN_VALIDATION_ERROR' };
}

/**
 * Tek bir finansal varsayımı (What-If senaryosu) mevcut durum (baseline) ile simüle eder.
 *
 * @param {Object} params
 * @param {Array} [params.transactions=[]] Gerçek işlem listesi (mutate edilmez)
 * @param {Object} [params.options={}] Tarih, balance ve hesaplama parametreleri
 * @param {number} [params.options.currentAvailableBalance] Bakiye simülasyonu için mevcut kullanılabilir bakiye
 * @param {Object} params.scenario Simüle edilecek senaryo objesi
 * @param {Object} [params.baselineForecast] Önceden hesaplanmış forecast (gereksiz tekrar hesaplamayı önler)
 * @returns {Object} Baseline, simulated, delta ve impact analizi
 */
export function simulateWhatIf({ transactions = [], options = {}, scenario, baselineForecast } = {}) {
  // 1. BASELINE HESAPLAMA VEYA ÇÖZÜMLEME
  const resolvedForecast = baselineForecast || forecastMonth(transactions, options);

  const period = resolvedForecast?.period || {};
  const actual = resolvedForecast?.actual || {};
  const forecast = resolvedForecast?.forecast || {};
  const dailyRates = resolvedForecast?.dailyRates || {};
  const forecastMeta = resolvedForecast?.metadata || {};

  const daysRemaining = typeof period.daysRemaining === 'number' ? period.daysRemaining : 0;
  const actualExpense = typeof actual.expenseToDate === 'number' ? actual.expenseToDate : 0;
  const baselineDailyRate = typeof dailyRates.blended === 'number' ? dailyRates.blended : 0;
  const baselineProjectedRemainingExpense = typeof forecast.projectedRemainingExpense === 'number'
    ? forecast.projectedRemainingExpense
    : 0;
  const baselineProjectedExpense = typeof forecast.projectedExpense === 'number'
    ? forecast.projectedExpense
    : 0;
  const baselineProjectedEndBalance = (typeof forecast.projectedEndBalanceAssumingNoNewIncome === 'number' && !isNaN(forecast.projectedEndBalanceAssumingNoNewIncome))
    ? forecast.projectedEndBalanceAssumingNoNewIncome
    : null;

  const baseline = {
    projectedExpense: baselineProjectedExpense,
    projectedRemainingExpense: baselineProjectedRemainingExpense,
    projectedEndBalance: baselineProjectedEndBalance,
    dailyRate: baselineDailyRate
  };

  // 2. SENARYO DOĞRULAMA (VALIDATION)
  const validation = validateScenario(scenario);
  if (!validation.isValid) {
    if (options.throwOnError) {
      throw new Error(`INVALID_SCENARIO: ${validation.reason || validation.error}`);
    }

    return {
      scenario: {
        type: scenario?.type || 'UNKNOWN',
        input: scenario
      },
      isValid: false,
      error: validation.error,
      reason: validation.reason,
      baseline,
      simulated: { ...baseline },
      delta: {
        projectedExpense: 0,
        projectedRemainingExpense: 0,
        projectedEndBalance: baselineProjectedEndBalance !== null ? 0 : null,
        dailyRate: 0
      },
      impact: {
        direction: 'neutral',
        magnitude: 0
      },
      metadata: {
        isApplicable: false,
        error: validation.error,
        reason: validation.reason,
        assumptions: []
      }
    };
  }

  // 3. SENARYO MATEMATİKSEL SİMÜLASYONU
  let simDailyRate = baselineDailyRate;
  let simRemainingExpense = baselineProjectedRemainingExpense;
  let simProjectedExpense = baselineProjectedExpense;
  let simProjectedEndBalance = baselineProjectedEndBalance;
  let assumptions = [];

  const hasBalance = baselineProjectedEndBalance !== null;
  let currentBalance = null;
  if (typeof options.currentAvailableBalance === 'number' && !isNaN(options.currentAvailableBalance)) {
    currentBalance = options.currentAvailableBalance;
  } else if (hasBalance) {
    currentBalance = baselineProjectedEndBalance + baselineProjectedRemainingExpense;
  }

  switch (scenario.type) {
    case SCENARIO_TYPES.ONE_TIME_EXPENSE: {
      const amount = round(scenario.amount);
      // Tek seferlik harcama forecast'in behavioral daily rate'ini DEĞİŞTİRMEZ
      simDailyRate = baselineDailyRate;
      simRemainingExpense = baselineProjectedRemainingExpense;
      simProjectedExpense = round(baselineProjectedExpense + amount);
      simProjectedEndBalance = hasBalance ? round(baselineProjectedEndBalance - amount) : null;
      assumptions = [...SCENARIO_ASSUMPTIONS.ONE_TIME_EXPENSE];
      break;
    }

    case SCENARIO_TYPES.ONE_TIME_INCOME: {
      const amount = round(scenario.amount);
      // Tek seferlik gelir harcama tahminini DEĞİŞTİRMEZ
      simDailyRate = baselineDailyRate;
      simRemainingExpense = baselineProjectedRemainingExpense;
      simProjectedExpense = baselineProjectedExpense;
      simProjectedEndBalance = hasBalance ? round(baselineProjectedEndBalance + amount) : null;
      assumptions = [...SCENARIO_ASSUMPTIONS.ONE_TIME_INCOME];
      break;
    }

    case SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE: {
      const percent = scenario.percent;
      const rawDailyRate = baselineDailyRate * (1 + percent / 100);
      simDailyRate = round(Math.max(0, rawDailyRate));
      simRemainingExpense = round(simDailyRate * daysRemaining);
      simProjectedExpense = round(actualExpense + simRemainingExpense);
      simProjectedEndBalance = currentBalance !== null
        ? round(currentBalance - simRemainingExpense)
        : null;
      assumptions = [...SCENARIO_ASSUMPTIONS.FUTURE_SPEND_PERCENT_CHANGE];
      break;
    }

    case SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE: {
      const amountPerDay = scenario.amountPerDay;
      simDailyRate = round(Math.max(0, baselineDailyRate + amountPerDay));
      simRemainingExpense = round(simDailyRate * daysRemaining);
      simProjectedExpense = round(actualExpense + simRemainingExpense);
      simProjectedEndBalance = currentBalance !== null
        ? round(currentBalance - simRemainingExpense)
        : null;
      assumptions = [...SCENARIO_ASSUMPTIONS.FUTURE_DAILY_SPEND_CHANGE];
      break;
    }
  }

  // 4. DELTA HESAPLAMALARI
  const delta = {
    projectedExpense: round(simProjectedExpense - baselineProjectedExpense),
    projectedRemainingExpense: round(simRemainingExpense - baselineProjectedRemainingExpense),
    projectedEndBalance: (simProjectedEndBalance !== null && baselineProjectedEndBalance !== null)
      ? round(simProjectedEndBalance - baselineProjectedEndBalance)
      : null,
    dailyRate: round(simDailyRate - baselineDailyRate)
  };

  // 5. IMPACT DIRECTION VE MAGNITUDE
  let direction = 'neutral';
  let magnitude = 0;

  if (delta.projectedEndBalance !== null) {
    if (delta.projectedEndBalance > 0) {
      direction = 'positive';
    } else if (delta.projectedEndBalance < 0) {
      direction = 'negative';
    } else {
      direction = 'neutral';
    }
    magnitude = round(Math.abs(delta.projectedEndBalance));
  } else {
    // Bakiye verisi yoksa harcama yönüne göre (harcama düşüşü pozitif, artışı negatif)
    if (delta.projectedExpense < 0) {
      direction = 'positive';
    } else if (delta.projectedExpense > 0) {
      direction = 'negative';
    } else {
      direction = 'neutral';
    }
    magnitude = round(Math.abs(delta.projectedExpense));
  }

  // 6. METADATA
  const isApplicable = Boolean(forecastMeta.isForecastApplicable);

  return {
    scenario: {
      type: scenario.type,
      input: scenario
    },
    isValid: true,
    baseline,
    simulated: {
      projectedExpense: simProjectedExpense,
      projectedRemainingExpense: simRemainingExpense,
      projectedEndBalance: simProjectedEndBalance,
      dailyRate: simDailyRate
    },
    delta,
    impact: {
      direction,
      magnitude
    },
    metadata: {
      isApplicable,
      reason: forecastMeta.reason || null,
      daysRemaining,
      assumptions
    }
  };
}

/**
 * Birden fazla senaryoyu aynı baseline üzerinden bağımsız olarak simüle eder ve karşılaştırır.
 *
 * @param {Object} params
 * @param {Array} [params.transactions=[]]
 * @param {Object} [params.options={}]
 * @param {Array<Object>} [params.scenarios=[]]
 * @returns {Object} { baseline, scenarios }
 */
export function compareScenarios({ transactions = [], options = {}, scenarios = [] } = {}) {
  const baselineForecast = options.baselineForecast || forecastMonth(transactions, options);

  const forecast = baselineForecast?.forecast || {};
  const dailyRates = baselineForecast?.dailyRates || {};

  const baseline = {
    projectedExpense: typeof forecast.projectedExpense === 'number' ? forecast.projectedExpense : 0,
    projectedRemainingExpense: typeof forecast.projectedRemainingExpense === 'number' ? forecast.projectedRemainingExpense : 0,
    projectedEndBalance: (typeof forecast.projectedEndBalanceAssumingNoNewIncome === 'number' && !isNaN(forecast.projectedEndBalanceAssumingNoNewIncome))
      ? forecast.projectedEndBalanceAssumingNoNewIncome
      : null,
    dailyRate: typeof dailyRates.blended === 'number' ? dailyRates.blended : 0
  };

  const results = (Array.isArray(scenarios) ? scenarios : []).map((sc, index) => {
    const sim = simulateWhatIf({
      transactions,
      options,
      scenario: sc,
      baselineForecast
    });

    return {
      id: sc?.id || `scenario_${index + 1}`,
      scenario: sim.scenario,
      simulated: sim.simulated,
      delta: sim.delta,
      impact: sim.impact,
      metadata: sim.metadata
    };
  });

  return {
    baseline,
    scenarios: results
  };
}
