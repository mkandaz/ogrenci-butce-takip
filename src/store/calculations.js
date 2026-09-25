import { getCurrentYearMonth } from '../utils/helpers.js';

/**
 * Ayda kalan gün sayısı hesabı (Bugün dahil)
 */
export function getDaysRemainingInMonth(referenceDate = new Date(), targetYearMonth = null) {
  const d = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const currentY = validDate.getFullYear();
  const currentM = validDate.getMonth();
  const today = validDate.getDate();

  if (targetYearMonth && typeof targetYearMonth === 'string') {
    const parts = targetYearMonth.split('-');
    if (parts.length === 2) {
      const targetY = parseInt(parts[0], 10);
      const targetM = parseInt(parts[1], 10) - 1;
      if (!isNaN(targetY) && !isNaN(targetM)) {
        const totalDays = new Date(targetY, targetM + 1, 0).getDate();
        if (targetY === currentY && targetM === currentM) {
          return Math.max(1, totalDays - today + 1);
        } else if (targetY < currentY || (targetY === currentY && targetM < currentM)) {
          // Geçmiş ay
          return 1;
        } else {
          // Gelecek ay
          return totalDays;
        }
      }
    }
  }

  const totalDaysInMonth = new Date(currentY, currentM + 1, 0).getDate();
  return Math.max(1, totalDaysInMonth - today + 1);
}

/**
 * Bütçe Sağlık Durumu Hesabı
 */
export function calculateBudgetHealth(totalIncome, balance) {
  if (totalIncome === 0 && balance === 0) {
    return 'healthy';
  }
  if (balance <= 0) {
    return 'depleted';
  }
  if (totalIncome > 0) {
    const remainingPercentage = (balance / totalIncome) * 100;
    if (remainingPercentage <= 15) {
      return 'critical';
    } else if (remainingPercentage <= 35) {
      return 'warning';
    }
  }
  return 'healthy';
}

/**
 * Finansal Özet Metrikleri Hesabı (Aylık Dönem ve Devreden Bakiye Destekli)
 */
export function calculateSummary(allTransactions, referenceDate = new Date(), targetYearMonth = null) {
  const selectedMonth = targetYearMonth || getCurrentYearMonth();
  const list = Array.isArray(allTransactions) ? allTransactions : [];

  // 1. Devreden Bakiye (Seçilen aydan önceki tüm işlemlerin net farkı)
  let carriedOverIncome = 0;
  let carriedOverExpense = 0;
  const beforeMonthTxs = list.filter(t => t.date && String(t.date).slice(0, 7) < selectedMonth);
  for (const tx of beforeMonthTxs) {
    const amt = Number(tx.amount) || 0;
    if (amt > 0) {
      if (tx.type === 'income') carriedOverIncome += amt;
      else if (tx.type === 'expense') carriedOverExpense += amt;
    }
  }
  carriedOverIncome = Math.round(carriedOverIncome * 100) / 100;
  carriedOverExpense = Math.round(carriedOverExpense * 100) / 100;
  const carriedOverBalance = Math.round((carriedOverIncome - carriedOverExpense) * 100) / 100;

  // 2. Bu Ayın İşlemleri (Seçilen aya ait gelir ve giderler)
  let thisMonthIncome = 0;
  let thisMonthExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  const thisMonthTxs = list.filter(t => t.date && String(t.date).startsWith(selectedMonth));
  for (const tx of thisMonthTxs) {
    const amt = Number(tx.amount) || 0;
    if (amt > 0) {
      if (tx.type === 'income') {
        thisMonthIncome += amt;
        incomeCount++;
      } else if (tx.type === 'expense') {
        thisMonthExpense += amt;
        expenseCount++;
      }
    }
  }
  thisMonthIncome = Math.round(thisMonthIncome * 100) / 100;
  thisMonthExpense = Math.round(thisMonthExpense * 100) / 100;
  const thisMonthNet = Math.round((thisMonthIncome - thisMonthExpense) * 100) / 100;

  // 3. Kalan Net Bütçe = Devreden Bakiye + Bu Ay Gelir - Bu Ay Gider
  // Bu ay gelirine devreden bakiye KESİNLİKLE eklenmez; ayrı tutulur.
  const balance = Math.round((carriedOverBalance + thisMonthNet) * 100) / 100;

  // 4. Günlük Güvenli Harcama Limiti
  const daysRemaining = getDaysRemainingInMonth(referenceDate, selectedMonth);
  const dailySafeSpendLimit = balance <= 0
    ? 0
    : Math.round((balance / daysRemaining) * 100) / 100;

  // 5. Bütçe Sağlık Durumu (Toplam kullanılabilir bakiye üzerinden)
  const totalAvailable = Math.max(0, carriedOverBalance) + thisMonthIncome;
  let budgetHealth = 'healthy';
  if (totalAvailable === 0 && balance === 0) {
    budgetHealth = 'healthy';
  } else if (balance <= 0 && (totalAvailable > 0 || thisMonthExpense > 0 || carriedOverBalance !== 0)) {
    budgetHealth = 'depleted';
  } else if (totalAvailable > 0) {
    const remainingPercentage = (balance / totalAvailable) * 100;
    if (remainingPercentage <= 15) {
      budgetHealth = 'critical';
    } else if (remainingPercentage <= 35) {
      budgetHealth = 'warning';
    }
  }

  // 6. Harcama Payı
  let expenseRatio = 0;
  if (totalAvailable > 0) {
    expenseRatio = Math.min(100, Math.round((thisMonthExpense / totalAvailable) * 100));
  } else if (thisMonthExpense > 0) {
    expenseRatio = 100;
  }

  return {
    selectedMonth,
    carriedOverIncome,
    carriedOverExpense,
    carriedOverBalance,
    totalIncome: thisMonthIncome,   // Yalnızca Bu Ay Gelir
    totalExpense: thisMonthExpense, // Yalnızca Bu Ay Gider
    thisMonthNet,
    balance,                        // Kalan Net Bütçe
    incomeCount,
    expenseCount,
    daysRemainingInMonth: daysRemaining,
    dailySafeSpendLimit,
    budgetHealth,
    expenseRatio,
    monthTransactions: thisMonthTxs
  };
}
