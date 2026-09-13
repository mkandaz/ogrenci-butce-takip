/**
 * ============================================================================
 * Öğrenci Bütçe Takip Uygulaması (Student Budget Tracker)
 * Mimari Standartlar ve İş Mantığı (app.js)
 * ============================================================================
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. SABİTLER VE GÜVENLİ DEPOLAMA (SafeStorage)
  // --------------------------------------------------------------------------
  const STORAGE_KEY = 'student_budget_app_state_v1';
  const THEME_KEY = 'student_budget_theme';
  const SCHEMA_VERSION = '1.0.0';

  /**
   * LocalStorage erişim kısıtlamalarına veya kotalarına karşı güvenli sarmalayıcı (SafeStorage)
   * Gizli sekme veya tarayıcı izin engellerinde uygulamanın çökmesini engeller.
   */
  const SafeStorage = {
    memoryFallback: {},
    getItem(key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch (err) {
        console.warn('LocalStorage okuma izni yok, bellekten okunuyor:', err);
      }
      return this.memoryFallback[key] || null;
    },
    setItem(key, value) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
          return true;
        }
      } catch (err) {
        console.warn('LocalStorage yazma hatası, belleğe kaydediliyor:', err);
      }
      this.memoryFallback[key] = String(value);
      return false;
    },
    removeItem(key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch (err) {
        console.warn('LocalStorage silme hatası:', err);
      }
      delete this.memoryFallback[key];
    }
  };

  const DEFAULT_PRESETS = [
    { id: 'preset_food', title: 'Yemekhane Fişi', amount: 40, categoryId: 'exp_food', icon: '🍱', emoji: '🍱', name: 'Yemekhane', label: 'Yemekhane' },
    { id: 'preset_coffee', title: 'Kampüs Kahve', amount: 70, categoryId: 'exp_social', icon: '☕', emoji: '☕', name: 'Kahve', label: 'Kahve' },
    { id: 'preset_market', title: 'Haftalık Market', amount: 200, categoryId: 'exp_food', icon: '🛒', emoji: '🛒', name: 'Market', label: 'Market' },
    { id: 'preset_transit', title: 'Ulaşım / Dolmuş', amount: 30, categoryId: 'exp_transport', icon: '🚌', emoji: '🚌', name: 'Dolmuş', label: 'Dolmuş' },
    { id: 'preset_print', title: 'Fotokopi & Ders Notu', amount: 50, categoryId: 'exp_education', icon: '📄', emoji: '📄', name: 'Fotokopi', label: 'Fotokopi' }
  ];

  const DEFAULT_SETTINGS = {
    currency: '₺',
    monthStartDay: 1,
    warningThresholdPercent: 15,
    theme: 'light',
    targetMonth: '',
    presets: DEFAULT_PRESETS
  };

  const DEFAULT_CATEGORIES = [
    // Gelir Kategorileri
    { id: 'inc_kyk', name: 'KYK Burs / Kredi', type: 'income', icon: 'graduation-cap', color: '#3B82F6' },
    { id: 'inc_allowance', name: 'Aile Harçlığı', type: 'income', icon: 'hand-coins', color: '#10B981' },
    { id: 'inc_part_time', name: 'Part-Time / Freelance', type: 'income', icon: 'briefcase', color: '#8B5CF6' },
    { id: 'inc_scholarship', name: 'Özel Kurum Bursu', type: 'income', icon: 'award', color: '#06B6D4' },
    { id: 'inc_other', name: 'Diğer Gelirler', type: 'income', icon: 'piggy-bank', color: '#64748B' },

    // Gider Kategorileri
    { id: 'exp_housing', name: 'Yurt / Ev Kirası', type: 'expense', icon: 'home', color: '#6366F1' },
    { id: 'exp_food', name: 'Yemek & Market', type: 'expense', icon: 'utensils-crossed', color: '#F59E0B' },
    { id: 'exp_transport', name: 'Ulaşım', type: 'expense', icon: 'bus', color: '#0EA5E9' },
    { id: 'exp_bills', name: 'Faturalar & Abonelikler', type: 'expense', icon: 'receipt', color: '#EF4444' },
    { id: 'exp_education', name: 'Kitap & Kırtasiye', type: 'expense', icon: 'book-open', color: '#14B8A6' },
    { id: 'exp_social', name: 'Sosyal & Eğlence', type: 'expense', icon: 'party-popper', color: '#EC4899' },
    { id: 'exp_health', name: 'Sağlık & Kişisel Bakım', type: 'expense', icon: 'heart-pulse', color: '#10B981' },
    { id: 'exp_tech', name: 'Teknoloji & Donanım', type: 'expense', icon: 'laptop', color: '#8B5CF6' },
    { id: 'exp_other', name: 'Diğer Giderler', type: 'expense', icon: 'circle-ellipsis', color: '#94A3B8' }
  ];

  // architecture.md'deki birebir seed veri seti
  const DEFAULT_SEED_TRANSACTIONS = [
    {
      id: 'seed-tx-001',
      title: 'KYK Lisans Bursu',
      amount: 2000.00,
      type: 'income',
      categoryId: 'inc_kyk',
      date: '2026-09-06',
      notes: 'Eylül ayı burs ödemesi',
      createdAt: 1725609600000,
      updatedAt: 1725609600000
    },
    {
      id: 'seed-tx-002',
      title: 'Aile Destek Harçlığı',
      amount: 4000.00,
      type: 'income',
      categoryId: 'inc_allowance',
      date: '2026-09-01',
      notes: 'Eylül başı kira ve harçlık desteği',
      createdAt: 1725177600000,
      updatedAt: 1725177600000
    },
    {
      id: 'seed-tx-003',
      title: 'Özel Ders Ücreti',
      amount: 1200.00,
      type: 'income',
      categoryId: 'inc_part_time',
      date: '2026-09-10',
      notes: 'Lise matematik 2 seans',
      createdAt: 1725955200000,
      updatedAt: 1725955200000
    },
    {
      id: 'seed-tx-004',
      title: 'KYK Yurt Ücreti',
      amount: 1100.00,
      type: 'expense',
      categoryId: 'exp_housing',
      date: '2026-09-02',
      notes: 'Eylül yurt taksiti',
      createdAt: 1725264000000,
      updatedAt: 1725264000000
    },
    {
      id: 'seed-tx-005',
      title: 'İstanbulkart Öğrenci Abonman',
      amount: 250.00,
      type: 'expense',
      categoryId: 'exp_transport',
      date: '2026-09-03',
      notes: 'Aylık 200 basım',
      createdAt: 1725350400000,
      updatedAt: 1725350400000
    },
    {
      id: 'seed-tx-006',
      title: 'Haftalık Market & Kahvaltılık',
      amount: 750.00,
      type: 'expense',
      categoryId: 'exp_food',
      date: '2026-09-05',
      notes: 'Yulaf, süt, peynir, yumurta',
      createdAt: 1725523200000,
      updatedAt: 1725523200000
    },
    {
      id: 'seed-tx-007',
      title: 'Dönem Ders Kitapları & Fotokopi',
      amount: 420.00,
      type: 'expense',
      categoryId: 'exp_education',
      date: '2026-09-08',
      notes: 'Mühendislik ders notları',
      createdAt: 1725782400000,
      updatedAt: 1725782400000
    },
    {
      id: 'seed-tx-008',
      title: 'Spotify & Telefon Faturası',
      amount: 210.00,
      type: 'expense',
      categoryId: 'exp_bills',
      date: '2026-09-09',
      notes: 'Öğrenci paketi',
      createdAt: 1725868800000,
      updatedAt: 1725868800000
    },
    {
      id: 'seed-tx-009',
      title: 'Kampüs Kahve & Sinema',
      amount: 340.00,
      type: 'expense',
      categoryId: 'exp_social',
      date: '2026-09-11',
      notes: 'Kulüp etkinliği sonrası',
      createdAt: 1726041600000,
      updatedAt: 1726041600000
    }
  ];

  // --------------------------------------------------------------------------
  // 2. YARDIMCI VE BİÇİMLENDİRME FONKSİYONLARI
  // --------------------------------------------------------------------------
  const numberFormatter = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function formatCurrency(val) {
    const num = Number(val) || 0;
    return `${numberFormatter.format(num)} ₺`;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      const parts = String(isoStr).split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
        }
      }
      return isoStr;
    } catch {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeColor(color, fallback = '#6366F1') {
    if (typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
      return color.trim();
    }
    return fallback;
  }

  function sanitizeIcon(icon, fallback = 'tag') {
    if (typeof icon === 'string' && /^[a-z0-9-]+$/.test(icon.trim())) {
      return icon.trim();
    }
    return fallback;
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
  }

  function getTodayIsoDate() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getCurrentYearMonth() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function formatMonthDisplay(yearMonthStr) {
    if (!yearMonthStr || typeof yearMonthStr !== 'string') {
      const today = new Date();
      return today.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    }
    const parts = yearMonthStr.split('-');
    if (parts.length === 2) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
      }
    }
    return yearMonthStr;
  }

  function getAdjacentMonth(yearMonthStr, offset = 0) {
    const ym = yearMonthStr || getCurrentYearMonth();
    const parts = ym.split('-');
    if (parts.length !== 2) return getCurrentYearMonth();
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = new Date(y, m - 1 + offset, 1);
    const nextY = d.getFullYear();
    const nextM = String(d.getMonth() + 1).padStart(2, '0');
    return `${nextY}-${nextM}`;
  }

  // --------------------------------------------------------------------------
  // 3. MATEMATİKSEL ALGORİTMALAR (architecture.md Bölüm 4)
  // --------------------------------------------------------------------------

  /**
   * Ayda kalan gün sayısı hesabı (Bugün dahil)
   * Formül 4.2
   */
  function getDaysRemainingInMonth(referenceDate = new Date(), targetYearMonth = null) {
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
   * Formül 4.4 & Tablo 4.4
   */
  function calculateBudgetHealth(totalIncome, balance) {
    // 1. İşlem bulunmama veya sıfır dengeli nötr durum
    if (totalIncome === 0 && balance === 0) {
      return 'healthy';
    }
    // 2. Bütçe tükendi veya eksiye düştü (Kalan <= 0)
    if (balance <= 0) {
      return 'depleted';
    }
    // 3. Gelir varken kalan bütçe oranı hesabı
    if (totalIncome > 0) {
      const remainingPercentage = (balance / totalIncome) * 100;
      if (remainingPercentage <= 15) {
        return 'critical'; // %15 veya daha az kaldı
      } else if (remainingPercentage <= 35) {
        return 'warning'; // %15 - %35 arası
      }
    }
    return 'healthy'; // > %35
  }

  /**
   * Finansal Özet Metrikleri Hesabı (Aylık Dönem ve Devreden Bakiye Destekli)
   */
  function calculateSummary(allTransactions, referenceDate = new Date(), targetYearMonth = null) {
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

    // 5. Bütçe Sağlık Durumu (Toplam kullanılabilir kapasite üzerinden)
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
      balance,                        // Kalan Net Bütçe (Devreden Bakiye + Bu Ay Gelir - Bu Ay Gider)
      incomeCount,
      expenseCount,
      daysRemainingInMonth: daysRemaining,
      dailySafeSpendLimit,
      budgetHealth,
      expenseRatio,
      monthTransactions: thisMonthTxs
    };
  }

  // --------------------------------------------------------------------------
  // 4. MERKEZİ STORE (BudgetStore)
  // --------------------------------------------------------------------------
  class BudgetStore {
    constructor() {
      this.listeners = [];
      this.state = this.loadState();
    }

    loadState() {
      try {
        const raw = SafeStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.transactions)) {
            // Eksik kategoriler varsa varsayılanla tamamla
            const categories = Array.isArray(parsed.categories) && parsed.categories.length > 0
              ? parsed.categories
              : DEFAULT_CATEGORIES;

            let isOnboarded = false;
            if (typeof parsed.onboarded === 'boolean') {
              isOnboarded = parsed.onboarded;
            } else if (parsed.transactions.length > 0) {
              isOnboarded = true;
            }

            return {
              version: parsed.version || SCHEMA_VERSION,
              onboarded: isOnboarded,
              transactions: parsed.transactions,
              categories: categories,
              settings: {
                ...DEFAULT_SETTINGS,
                targetMonth: getCurrentYearMonth(),
                ...(parsed.settings || {}),
                presets: (parsed.settings && Array.isArray(parsed.settings.presets) && parsed.settings.presets.length > 0)
                  ? parsed.settings.presets
                  : DEFAULT_PRESETS
              }
            };
          }
        }
      } catch (err) {
        console.error('LocalStorage okunamadı:', err);
      }

      // İlk açılış: Demo verileri otomatik yazılmaz, onboarding modalı beklenir
      const initialState = {
        version: SCHEMA_VERSION,
        onboarded: false,
        transactions: [],
        categories: [...DEFAULT_CATEGORIES],
        settings: {
          ...DEFAULT_SETTINGS,
          targetMonth: getCurrentYearMonth()
        }
      };
      this.saveToStorage(initialState);
      return initialState;
    }

    saveToStorage(state = this.state) {
      try {
        SafeStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...state,
          lastSyncedAt: Date.now()
        }));
      } catch (err) {
        console.error('LocalStorage kaydetme hatası:', err);
      }
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }

    notify() {
      this.saveToStorage();
      for (const listener of this.listeners) {
        try {
          listener(this.state);
        } catch (err) {
          console.error('Store dinleyici hatası:', err);
        }
      }
    }

    getTransactions() {
      return this.state.transactions || [];
    }

    getCategories(type) {
      const cats = this.state.categories || DEFAULT_CATEGORIES;
      if (!type) return cats;
      return cats.filter(c => c.type === type);
    }

    getCategoryById(id) {
      const cats = this.state.categories || DEFAULT_CATEGORIES;
      return cats.find(c => c.id === id) || {
        id: 'unknown',
        name: 'Genel',
        type: 'expense',
        icon: 'tag',
        color: '#64748B'
      };
    }

    addTransaction(tx) {
      const now = Date.now();
      const newTx = {
        id: tx.id || generateUUID(),
        title: String(tx.title || '').trim(),
        amount: Math.round(Number(tx.amount) * 100) / 100,
        type: tx.type === 'income' ? 'income' : 'expense',
        categoryId: tx.categoryId,
        date: tx.date,
        notes: String(tx.notes || '').trim(),
        createdAt: now,
        updatedAt: now
      };
      this.state.transactions.unshift(newTx);
      this.notify();
      return newTx;
    }

    updateTransaction(id, updatedFields) {
      const index = this.state.transactions.findIndex(t => t.id === id);
      if (index === -1) return false;

      this.state.transactions[index] = {
        ...this.state.transactions[index],
        ...updatedFields,
        amount: Math.round(Number(updatedFields.amount) * 100) / 100,
        updatedAt: Date.now()
      };
      this.notify();
      return true;
    }

    deleteTransaction(id) {
      const prevLen = this.state.transactions.length;
      this.state.transactions = this.state.transactions.filter(t => t.id !== id);
      if (this.state.transactions.length !== prevLen) {
        this.notify();
        return true;
      }
      return false;
    }

    startWithDemo() {
      this.state.transactions = [...DEFAULT_SEED_TRANSACTIONS];
      this.state.categories = [...DEFAULT_CATEGORIES];
      this.state.onboarded = true;
      this.notify();
    }

    startWithCustomBudget({ initialBalance = 0, monthlyIncome = 0, targetMonth = '' }) {
      const monthStr = targetMonth || getCurrentYearMonth();
      const txDate = `${monthStr}-01`;
      const newTxs = [];

      const initBal = Number(initialBalance);
      if (!isNaN(initBal) && initBal > 0) {
        newTxs.push({
          id: generateUUID(),
          title: 'Mevcut Nakit / Başlangıç Bakiyesi',
          amount: Math.round(initBal * 100) / 100,
          type: 'income',
          categoryId: 'inc_other',
          date: txDate,
          notes: 'Bütçe başlangıç devir bakiyesi',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      const inc = Number(monthlyIncome);
      if (!isNaN(inc) && inc > 0) {
        newTxs.push({
          id: generateUUID(),
          title: 'Aylık Düzenli Gelir (Burs / Harçlık / Maaş)',
          amount: Math.round(inc * 100) / 100,
          type: 'income',
          categoryId: 'inc_kyk',
          date: txDate,
          notes: 'Aylık düzenli bütçe geliri',
          createdAt: Date.now() + 1,
          updatedAt: Date.now() + 1
        });
      }

      this.state.transactions = newTxs;
      this.state.categories = [...DEFAULT_CATEGORIES];
      this.state.settings.targetMonth = monthStr;
      this.state.onboarded = true;
      this.notify();
    }

    resetAndRestartOnboarding() {
      this.state.transactions = [];
      this.state.categories = [...DEFAULT_CATEGORIES];
      this.state.onboarded = false;
      this.notify();
    }

    loadDemoSeedData() {
      this.state.transactions = [...DEFAULT_SEED_TRANSACTIONS];
      this.state.categories = [...DEFAULT_CATEGORIES];
      this.state.onboarded = true;
      this.notify();
    }

    resetData() {
      this.loadDemoSeedData();
    }

    getPresets() {
      const defaultMap = new Map(DEFAULT_PRESETS.map(p => [p.id, p]));
      const rawList = (this.state.settings && Array.isArray(this.state.settings.presets) && this.state.settings.presets.length > 0)
        ? this.state.settings.presets
        : DEFAULT_PRESETS;

      return rawList.map(p => {
        const def = defaultMap.get(p.id) || {};
        const name = p.name || p.label || def.name || def.label || 'Harcama';
        const icon = p.icon || p.emoji || def.icon || def.emoji || '⚡';
        const title = p.title || def.title || name;
        const categoryId = p.categoryId || def.categoryId || 'exp_other';
        const amount = Number(p.amount) || def.amount || 0;

        return {
          id: p.id,
          name,
          label: name,
          icon,
          emoji: icon,
          title,
          categoryId,
          amount
        };
      });
    }

    updatePresets(newPresets) {
      if (!this.state.settings) {
        this.state.settings = { ...DEFAULT_SETTINGS };
      }
      this.state.settings.presets = newPresets;
      this.saveToStorage();
      this.notify();
    }

    importData(importedData, mode = 'merge') {
      let rawTransactions = null;
      let rawCategories = null;

      if (Array.isArray(importedData)) {
        rawTransactions = importedData;
      } else if (importedData && Array.isArray(importedData.transactions)) {
        rawTransactions = importedData.transactions;
        if (Array.isArray(importedData.categories)) {
          rawCategories = importedData.categories;
        }
      } else {
        throw new Error('Geçersiz veri formatı: JSON dosyasında "transactions" dizisi bulunamadı.');
      }

      if (rawTransactions.length === 0) {
        throw new Error('İçe aktarılacak dosyada herhangi bir işlem kaydı bulunamadı.');
      }

      // Kapsamlı doğrulama ve veri temizleme
      const validatedList = [];
      for (let i = 0; i < rawTransactions.length; i++) {
        const t = rawTransactions[i];
        const rowNum = i + 1;

        if (!t || typeof t !== 'object') {
          throw new Error(`${rowNum}. sıradaki işlem geçersiz bir nesne.`);
        }

        const title = String(t.title || '').trim();
        if (!title || title.length < 2) {
          throw new Error(`${rowNum}. sıradaki işlemin başlığı eksik veya çok kısa.`);
        }

        const amount = Number(t.amount);
        if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
          throw new Error(`${rowNum}. sıradaki "${title}" işleminin tutarı pozitif bir sayı olmalıdır.`);
        }
        if (amount > 10000000) {
          throw new Error(`${rowNum}. sıradaki "${title}" işleminin tutarı 10.000.000 ₺ sınırını aşıyor.`);
        }

        const type = t.type === 'income' ? 'income' : (t.type === 'expense' ? 'expense' : null);
        if (!type) {
          throw new Error(`${rowNum}. sıradaki "${title}" işleminin türü 'income' veya 'expense' olmalıdır.`);
        }

        const date = String(t.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error(`${rowNum}. sıradaki "${title}" işleminin tarihi YYYY-MM-DD formatında olmalıdır.`);
        }

        const categoryId = t.categoryId || (type === 'income' ? 'inc_other' : 'exp_other');
        const notes = String(t.notes || '').trim().slice(0, 300);

        validatedList.push({
          id: String(t.id || generateUUID()),
          title: title.slice(0, 80),
          amount: Math.round(amount * 100) / 100,
          type: type,
          categoryId: categoryId,
          date: date,
          notes: notes,
          createdAt: Number(t.createdAt) || Date.now(),
          updatedAt: Number(t.updatedAt) || Date.now()
        });
      }

      if (mode === 'replace') {
        this.state.transactions = validatedList;
        if (rawCategories && rawCategories.length > 0) {
          this.state.categories = rawCategories;
        }
      } else {
        // Merge: ID çakışmasında yeni olanı koru, diğerlerini ekle
        const map = new Map();
        for (const t of this.state.transactions) {
          map.set(t.id, t);
        }
        for (const t of validatedList) {
          map.set(t.id, t);
        }
        this.state.transactions = Array.from(map.values());
      }

      this.notify();
    }

    getExportData() {
      return {
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        settings: this.state.settings,
        categories: this.state.categories,
        transactions: this.state.transactions
      };
    }
  }

  // --------------------------------------------------------------------------
  // 5. TOAST VE MODAL YÖNETİMİ
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-enter pointer-events-auto flex items-center justify-between p-3.5 rounded-2xl shadow-xl border text-xs font-medium space-x-3 transition-all';

    let iconHtml = '';
    let bgClasses = '';

    if (type === 'success') {
      bgClasses = 'bg-white dark:bg-slate-900 border-emerald-500/40 text-slate-800 dark:text-slate-100 glow-emerald';
      iconHtml = '<div class="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"><i data-lucide="check" class="w-3.5 h-3.5"></i></div>';
    } else if (type === 'error') {
      bgClasses = 'bg-white dark:bg-slate-900 border-rose-500/40 text-slate-800 dark:text-slate-100 glow-rose';
      iconHtml = '<div class="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0"><i data-lucide="alert-circle" class="w-3.5 h-3.5"></i></div>';
    } else if (type === 'warning') {
      bgClasses = 'bg-white dark:bg-slate-900 border-amber-500/40 text-slate-800 dark:text-slate-100 glow-amber';
      iconHtml = '<div class="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0"><i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i></div>';
    } else {
      bgClasses = 'bg-white dark:bg-slate-900 border-indigo-500/40 text-slate-800 dark:text-slate-100 glow-blue';
      iconHtml = '<div class="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0"><i data-lucide="info" class="w-3.5 h-3.5"></i></div>';
    }

    toast.className += ' ' + bgClasses;
    toast.innerHTML = `
      <div class="flex items-center space-x-2.5">
        ${iconHtml}
        <span class="leading-snug">${escapeHtml(message)}</span>
      </div>
      <button type="button" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    `;

    const closeBtn = toast.querySelector('button');
    const dismiss = () => {
      toast.classList.remove('toast-enter');
      toast.classList.add('toast-leave');
      setTimeout(() => toast.remove(), 250);
    };

    closeBtn.addEventListener('click', dismiss);
    container.appendChild(toast);

    if (window.lucide) {
      window.lucide.createIcons({ root: toast });
    }

    setTimeout(dismiss, duration);
  }

  // --------------------------------------------------------------------------
  // 6. UI YÖNETİCİSİ (UIManager)
  // --------------------------------------------------------------------------
  class UIManager {
    constructor(store) {
      this.store = store;
      this.selectedMonth = this.store.state.settings.targetMonth || getCurrentYearMonth();
      this.activeFilter = 'all'; // 'all' | 'income' | 'expense'
      this.searchQuery = '';
      this.categoryFilter = '';
      this.sortOption = 'date-desc';

      this.categoryChart = null;
      this.flowChart = null;
      this.confirmCallback = null;
      this.lastFocusedElement = null;

      this.initTheme();
      this.cacheElements();
      this.bindEvents();
      this.bindKeyboardAndModalEvents();
      this.checkOnboarding();
      this.render();
    }

    initTheme() {
      const savedTheme = SafeStorage.getItem(THEME_KEY) || 'light';
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }
      this.updateThemeIcons(savedTheme);
    }

    updateThemeIcons(currentTheme) {
      const moon = document.getElementById('theme-icon-moon');
      const sun = document.getElementById('theme-icon-sun');
      if (!moon || !sun) return;

      if (currentTheme === 'dark') {
        moon.classList.remove('hidden');
        sun.classList.add('hidden');
      } else {
        moon.classList.add('hidden');
        sun.classList.remove('hidden');
      }
    }

    toggleTheme() {
      const isDark = document.documentElement.classList.contains('dark');
      const nextTheme = isDark ? 'light' : 'dark';

      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      }

      SafeStorage.setItem(THEME_KEY, nextTheme);
      this.updateThemeIcons(nextTheme);

      // Grafikleri tema renkleriyle bellek sızıntısız yeniden çiz
      this.renderCharts();
    }

    cacheElements() {
      // Header & Navigation
      this.themeToggleBtn = document.getElementById('btn-theme-toggle');
      this.headerDateText = document.getElementById('header-date-text');
      this.btnBackupMenu = document.getElementById('btn-backup-menu');
      this.backupDropdown = document.getElementById('backup-dropdown');
      this.btnExportJson = document.getElementById('btn-export-json');
      this.btnOpenImport = document.getElementById('btn-open-import');
      this.btnLoadSeed = document.getElementById('btn-load-seed');
      this.btnResetData = document.getElementById('btn-reset-data');

      // Month Navigator Elements
      this.monthNavigatorContainer = document.getElementById('month-navigator-container');
      this.btnPrevMonth = document.getElementById('btn-prev-month');
      this.btnNextMonth = document.getElementById('btn-next-month');
      this.headerMonthPicker = document.getElementById('header-month-picker');
      this.btnMonthDisplay = document.getElementById('btn-month-display');

      // Onboarding Elements
      this.onboardingModal = document.getElementById('onboarding-modal');
      this.btnOnboardDemo = document.getElementById('btn-onboard-demo');
      this.onboardCustomForm = document.getElementById('onboard-custom-form');
      this.onboardInitialBalance = document.getElementById('onboard-initial-balance');
      this.onboardMonthlyIncome = document.getElementById('onboard-monthly-income');
      this.onboardTargetMonth = document.getElementById('onboard-target-month');

      // Quick Preset Elements
      this.btnEditPresets = document.getElementById('btn-edit-presets');
      this.quickPresetsContainer = document.getElementById('quick-presets-container');
      this.presetModal = document.getElementById('preset-modal');
      this.presetModalClose = document.getElementById('preset-modal-close');
      this.presetModalCancel = document.getElementById('preset-modal-cancel');
      this.presetModalSave = document.getElementById('preset-modal-save');
      this.presetModalResetDefault = document.getElementById('preset-modal-reset-default');
      this.presetInputsContainer = document.getElementById('preset-inputs-container');
      this.presetEditForm = document.getElementById('preset-edit-form');

      // Alert banner
      this.budgetAlertBanner = document.getElementById('budget-alert-banner');
      this.alertBannerIconBox = document.getElementById('alert-banner-icon-box');
      this.alertBannerIcon = document.getElementById('alert-banner-icon');
      this.alertBannerTitle = document.getElementById('alert-banner-title');
      this.alertBannerDesc = document.getElementById('alert-banner-desc');
      this.alertBannerClose = document.getElementById('alert-banner-close');

      // Metric elements
      this.starCardContainer = document.getElementById('star-card-container');
      this.badgeHealthStatus = document.getElementById('badge-health-status');
      this.metricNetBalance = document.getElementById('metric-net-balance');
      this.badgeCarriedBalance = document.getElementById('badge-carried-balance');
      this.metricSpentPercent = document.getElementById('metric-spent-percent');
      this.badgeDaysLeft = document.getElementById('badge-days-left');
      this.metricDailyLimit = document.getElementById('metric-daily-limit');
      this.metricDailyTip = document.getElementById('metric-daily-tip');
      this.metricTotalIncome = document.getElementById('metric-total-income');
      this.metricIncomeCount = document.getElementById('metric-income-count');
      this.metricTotalExpense = document.getElementById('metric-total-expense');
      this.metricExpenseCount = document.getElementById('metric-expense-count');

      // Transaction list & filter elements
      this.txCountBadge = document.getElementById('tx-count-badge');
      this.txScopeBadge = document.getElementById('tx-scope-badge');
      this.filterTypeBtns = {
        all: document.getElementById('filter-type-all'),
        income: document.getElementById('filter-type-income'),
        expense: document.getElementById('filter-type-expense')
      };
      this.txSearchInput = document.getElementById('tx-search-input');
      this.txSearchClear = document.getElementById('tx-search-clear');
      this.filterCategorySelect = document.getElementById('filter-category-select');
      this.sortSelect = document.getElementById('sort-select');
      this.transactionsContainer = document.getElementById('transactions-container');
      this.transactionsEmptyState = document.getElementById('transactions-empty-state');
      this.txEmptyTitle = document.getElementById('tx-empty-title');
      this.txEmptyDesc = document.getElementById('tx-empty-desc');
      this.btnEmptyAddTx = document.getElementById('btn-empty-add-tx');
      this.btnEmptyResetSeed = document.getElementById('btn-empty-reset-seed');

      // Transaction Modal Elements
      this.btnOpenAddModal = document.getElementById('btn-open-add-modal');
      this.txModal = document.getElementById('transaction-modal');
      this.txForm = document.getElementById('tx-form');
      this.modalTitleText = document.getElementById('modal-title-text');
      this.modalBtnClose = document.getElementById('modal-btn-close');
      this.modalBtnCancel = document.getElementById('modal-btn-cancel');
      this.txFieldId = document.getElementById('tx-field-id');
      this.txFieldType = document.getElementById('tx-field-type');
      this.txTypeExpenseBtn = document.getElementById('tx-type-expense-btn');
      this.txTypeIncomeBtn = document.getElementById('tx-type-income-btn');
      this.txFieldTitle = document.getElementById('tx-field-title');
      this.txFieldAmount = document.getElementById('tx-field-amount');
      this.txFieldDate = document.getElementById('tx-field-date');
      this.txFieldCategory = document.getElementById('tx-field-category');
      this.txCategoryPicker = document.getElementById('tx-category-picker');
      this.txFieldNotes = document.getElementById('tx-field-notes');

      // Form Error Feedback Elements
      this.formErrors = {
        title: document.getElementById('tx-err-title'),
        amount: document.getElementById('tx-err-amount'),
        date: document.getElementById('tx-err-date'),
        category: document.getElementById('tx-err-category'),
        notes: document.getElementById('tx-err-notes')
      };

      // Import Modal
      this.importModal = document.getElementById('import-modal');
      this.importModalClose = document.getElementById('import-modal-close');
      this.importModalCancel = document.getElementById('import-modal-cancel');
      this.importModalConfirm = document.getElementById('import-modal-confirm');
      this.importFileInput = document.getElementById('import-file-input');
      this.importFileError = document.getElementById('import-file-error');

      // Confirm Modal
      this.confirmModal = document.getElementById('confirm-modal');
      this.confirmModalTitle = document.getElementById('confirm-modal-title');
      this.confirmModalDesc = document.getElementById('confirm-modal-desc');
      this.confirmModalCancel = document.getElementById('confirm-modal-cancel');
      this.confirmModalAction = document.getElementById('confirm-modal-action');

      // Charts
      this.categoryChartCanvas = document.getElementById('categoryExpenseChart');
      this.flowChartCanvas = document.getElementById('flowChart');
      this.chartEmptyState = document.getElementById('chart-empty-state');
      this.flowChartEmptyState = document.getElementById('flow-chart-empty-state');
    }

    checkOnboarding() {
      if (this.onboardTargetMonth) {
        this.onboardTargetMonth.value = this.store.state.settings.targetMonth || getCurrentYearMonth();
      }
      if (!this.store.state.onboarded) {
        this.openOnboardingModal();
      } else {
        this.closeOnboardingModal();
      }
    }

    openOnboardingModal() {
      this.lastFocusedElement = document.activeElement;
      if (this.onboardingModal) {
        this.onboardingModal.classList.remove('hidden');
        if (this.onboardTargetMonth) {
          this.onboardTargetMonth.value = this.store.state.settings.targetMonth || getCurrentYearMonth();
        }
        if (window.lucide) {
          window.lucide.createIcons({ root: this.onboardingModal });
        }
      }
    }

    closeOnboardingModal() {
      if (this.onboardingModal) {
        this.onboardingModal.classList.add('hidden');
      }
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    bindEvents() {
      // Theme Toggle
      this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());

      // Backup Dropdown Toggle
      this.btnBackupMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        this.backupDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
        if (this.backupDropdown && !this.backupDropdown.contains(e.target) && e.target !== this.btnBackupMenu) {
          this.backupDropdown.classList.add('hidden');
        }
      });

      // Export JSON
      this.btnExportJson.addEventListener('click', () => {
        this.backupDropdown.classList.add('hidden');
        this.handleExport();
      });

      // Open Import Modal
      this.btnOpenImport.addEventListener('click', () => {
        this.backupDropdown.classList.add('hidden');
        this.openImportModal();
      });

      // Load Seed / Demo Data
      if (this.btnLoadSeed) {
        this.btnLoadSeed.addEventListener('click', () => {
          this.backupDropdown.classList.add('hidden');
          this.store.loadDemoSeedData();
          showToast('Demo verileri başarıyla yüklendi.', 'success');
        });
      }

      // Import Modal Actions
      this.importModalClose.addEventListener('click', () => this.closeImportModal());
      this.importModalCancel.addEventListener('click', () => this.closeImportModal());
      this.importModalConfirm.addEventListener('click', () => this.handleImport());

      // Reset Data Action (Yeni Başlangıç Yap)
      this.btnResetData.addEventListener('click', () => {
        this.backupDropdown.classList.add('hidden');
        this.openConfirmModal({
          title: 'Verileri Sıfırla / Yeni Başlangıç Yap',
          desc: 'Tüm mevcut işlemleriniz silinecek ve başlangıç (Onboarding) ekranına dönülecektir. Kişisel bütçenizi yeniden kurabilir veya demo verilerini seçebilirsiniz. Devam etmek istiyor musunuz?',
          actionText: 'Sıfırla ve Başlat',
          onConfirm: () => {
            this.store.resetAndRestartOnboarding();
            showToast('Tüm veriler sıfırlandı. Yeni başlangıç ekranı açılıyor.', 'info');
            this.openOnboardingModal();
          }
        });
      });

      // Onboarding Action: Demo Button
      if (this.btnOnboardDemo) {
        this.btnOnboardDemo.addEventListener('click', () => {
          this.store.startWithDemo();
          this.closeOnboardingModal();
          showToast('Demo veriler yüklendi! İyi incelemeler.', 'success');
        });
      }

      // Onboarding Action: Custom Budget Form Submit
      if (this.onboardCustomForm) {
        this.onboardCustomForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const initBal = this.onboardInitialBalance && this.onboardInitialBalance.value
            ? Number(this.onboardInitialBalance.value)
            : 0;
          const monInc = this.onboardMonthlyIncome && this.onboardMonthlyIncome.value
            ? Number(this.onboardMonthlyIncome.value)
            : 0;
          const targetM = this.onboardTargetMonth && this.onboardTargetMonth.value
            ? this.onboardTargetMonth.value
            : getCurrentYearMonth();

          if (initBal < 0 || isNaN(initBal)) {
            showToast('Başlangıç bakiyesi negatif olamaz.', 'error');
            return;
          }
          if (monInc < 0 || isNaN(monInc)) {
            showToast('Aylık düzenli gelir negatif olamaz.', 'error');
            return;
          }

          this.store.startWithCustomBudget({
            initialBalance: initBal,
            monthlyIncome: monInc,
            targetMonth: targetM
          });
          this.closeOnboardingModal();
          showToast('Kişisel bütçeniz başarıyla oluşturuldu!', 'success');
        });
      }

      // Empty State Actions
      if (this.btnEmptyAddTx) {
        this.btnEmptyAddTx.addEventListener('click', () => this.openTransactionModal('add'));
      }
      if (this.btnEmptyResetSeed) {
        this.btnEmptyResetSeed.addEventListener('click', () => {
          this.store.resetData();
          showToast('Başlangıç verileri başarıyla yüklendi.', 'success');
        });
      }

      // Confirm Modal Cancel & Action
      this.confirmModalCancel.addEventListener('click', () => this.closeConfirmModal());
      this.confirmModalAction.addEventListener('click', () => {
        if (typeof this.confirmCallback === 'function') {
          this.confirmCallback();
        }
        this.closeConfirmModal();
      });

      // Alert Banner Close
      this.alertBannerClose.addEventListener('click', () => {
        this.budgetAlertBanner.classList.add('hidden');
      });

      // Open Add Modal
      this.btnOpenAddModal.addEventListener('click', () => {
        this.openTransactionModal('add');
      });

      // Month Navigator Actions
      if (this.btnPrevMonth) {
        this.btnPrevMonth.addEventListener('click', () => this.changeMonth(-1));
      }
      if (this.btnNextMonth) {
        this.btnNextMonth.addEventListener('click', () => this.changeMonth(1));
      }
      if (this.btnMonthDisplay && this.headerMonthPicker) {
        this.btnMonthDisplay.addEventListener('click', () => {
          if (typeof this.headerMonthPicker.showPicker === 'function') {
            this.headerMonthPicker.showPicker();
          } else {
            this.headerMonthPicker.focus();
            this.headerMonthPicker.click();
          }
        });
      }
      if (this.headerMonthPicker) {
        this.headerMonthPicker.addEventListener('change', (e) => {
          if (e.target.value) {
            this.setMonth(e.target.value);
          }
        });
      }

      // Preset Edit Actions
      if (this.btnEditPresets) {
        this.btnEditPresets.addEventListener('click', () => this.openPresetModal());
      }
      if (this.presetModalClose) {
        this.presetModalClose.addEventListener('click', () => this.closePresetModal());
      }
      if (this.presetModalCancel) {
        this.presetModalCancel.addEventListener('click', () => this.closePresetModal());
      }
      if (this.presetModalResetDefault) {
        this.presetModalResetDefault.addEventListener('click', () => this.resetPresetsToDefault());
      }
      if (this.presetEditForm) {
        this.presetEditForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handlePresetFormSubmit();
        });
      }

      // Initial render for dynamic quick presets
      this.renderQuickPresets();

      // Transaction Modal Close & Cancel
      this.modalBtnClose.addEventListener('click', () => this.closeTransactionModal());
      this.modalBtnCancel.addEventListener('click', () => this.closeTransactionModal());

      // Transaction Type Switcher Buttons
      this.txTypeExpenseBtn.addEventListener('click', () => this.setModalType('expense'));
      this.txTypeIncomeBtn.addEventListener('click', () => this.setModalType('income'));

      // Realtime validation clearing on input
      this.txFieldTitle.addEventListener('input', () => this.clearFieldError('title'));
      this.txFieldAmount.addEventListener('input', () => this.clearFieldError('amount'));
      this.txFieldDate.addEventListener('change', () => this.clearFieldError('date'));
      this.txFieldNotes.addEventListener('input', () => this.clearFieldError('notes'));

      // Transaction Form Submit
      this.txForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleTransactionFormSubmit();
      });

      // Filters: Type Tabs
      Object.keys(this.filterTypeBtns).forEach(key => {
        this.filterTypeBtns[key].addEventListener('click', () => {
          this.activeFilter = key;
          this.updateFilterButtons();
          this.renderTransactions();
        });
      });

      // Filters: Search Input
      this.txSearchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLocaleLowerCase('tr-TR');
        if (this.searchQuery) {
          this.txSearchClear.classList.remove('hidden');
        } else {
          this.txSearchClear.classList.add('hidden');
        }
        this.renderTransactions();
      });

      this.txSearchClear.addEventListener('click', () => {
        this.txSearchInput.value = '';
        this.searchQuery = '';
        this.txSearchClear.classList.add('hidden');
        this.renderTransactions();
        this.txSearchInput.focus();
      });

      // Filters: Category & Sort Selects
      this.filterCategorySelect.addEventListener('change', (e) => {
        this.categoryFilter = e.target.value;
        this.renderTransactions();
      });

      this.sortSelect.addEventListener('change', (e) => {
        this.sortOption = e.target.value;
        this.renderTransactions();
      });

      // Store değişikliklerini dinle
      this.store.subscribe(() => {
        this.render();
      });
    }

    /**
     * UX & Erişilebilirlik: ESC tuşu ve arka plan tıklamasıyla modalları kapatma
     */
    bindKeyboardAndModalEvents() {
      // ESC tuşu dinleyicisi
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.keyCode === 27) {
          if (!this.confirmModal.classList.contains('hidden')) {
            this.closeConfirmModal();
          } else if (this.onboardingModal && !this.onboardingModal.classList.contains('hidden')) {
            this.closeOnboardingModal();
          } else if (this.presetModal && !this.presetModal.classList.contains('hidden')) {
            this.closePresetModal();
          } else if (!this.importModal.classList.contains('hidden')) {
            this.closeImportModal();
          } else if (!this.txModal.classList.contains('hidden')) {
            this.closeTransactionModal();
          } else if (!this.backupDropdown.classList.contains('hidden')) {
            this.backupDropdown.classList.add('hidden');
          }
        }
      });

      // Arka plan (Backdrop) tıklama dinleyicileri
      if (this.onboardingModal) {
        this.onboardingModal.addEventListener('click', (e) => {
          if (e.target === this.onboardingModal) {
            this.closeOnboardingModal();
          }
        });
      }

      if (this.presetModal) {
        this.presetModal.addEventListener('click', (e) => {
          if (e.target === this.presetModal) {
            this.closePresetModal();
          }
        });
      }

      this.txModal.addEventListener('click', (e) => {
        if (e.target === this.txModal) {
          this.closeTransactionModal();
        }
      });

      this.importModal.addEventListener('click', (e) => {
        if (e.target === this.importModal) {
          this.closeImportModal();
        }
      });

      this.confirmModal.addEventListener('click', (e) => {
        if (e.target === this.confirmModal) {
          this.closeConfirmModal();
        }
      });
    }

    updateFilterButtons() {
      Object.keys(this.filterTypeBtns).forEach(key => {
        const btn = this.filterTypeBtns[key];
        if (key === this.activeFilter) {
          btn.className = 'filter-type-btn min-h-[38px] px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-bold transition flex items-center justify-center';
        } else {
          btn.className = 'filter-type-btn min-h-[38px] px-3.5 py-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center';
        }
      });
    }

    openConfirmModal({ title, desc, actionText, onConfirm }) {
      this.lastFocusedElement = document.activeElement;
      this.confirmModalTitle.textContent = title;
      this.confirmModalDesc.textContent = desc;
      this.confirmModalAction.textContent = actionText || 'Onayla';
      this.confirmCallback = onConfirm;
      this.confirmModal.classList.remove('hidden');
      this.confirmModalCancel.focus();

      if (window.lucide) {
        window.lucide.createIcons({ root: this.confirmModal });
      }
    }

    closeConfirmModal() {
      this.confirmModal.classList.add('hidden');
      this.confirmCallback = null;
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    openImportModal() {
      this.lastFocusedElement = document.activeElement;
      this.importFileInput.value = '';
      if (this.importFileError) {
        this.importFileError.classList.add('hidden');
      }
      this.importModal.classList.remove('hidden');
      this.importFileInput.focus();

      if (window.lucide) {
        window.lucide.createIcons({ root: this.importModal });
      }
    }

    closeImportModal() {
      this.importModal.classList.add('hidden');
      this.importFileInput.value = '';
      if (this.importFileError) {
        this.importFileError.classList.add('hidden');
      }
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    setModalType(type) {
      this.txFieldType.value = type;
      if (type === 'expense') {
        this.txTypeExpenseBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg bg-rose-500 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
        this.txTypeIncomeBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
      } else {
        this.txTypeExpenseBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
        this.txTypeIncomeBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg bg-emerald-500 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      }
      this.clearFieldError('category');
      this.renderCategoryPicker(type);
    }

    renderCategoryPicker(type, selectedCatId = null) {
      const categories = this.store.getCategories(type);
      this.txCategoryPicker.innerHTML = '';

      let firstCatId = selectedCatId || (categories[0] ? categories[0].id : '');

      categories.forEach(cat => {
        const isSelected = cat.id === firstCatId;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.catId = cat.id;
        btn.className = `category-btn min-h-[44px] text-left p-2.5 rounded-xl text-xs flex items-center space-x-2 border transition ${
          isSelected
            ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-bold active'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
        }`;

        const safeColor = sanitizeColor(cat.color);
        const safeIcon = sanitizeIcon(cat.icon);

        btn.innerHTML = `
          <div class="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style="background-color: ${safeColor}20; color: ${safeColor};">
            <i data-lucide="${safeIcon}" class="w-3.5 h-3.5"></i>
          </div>
          <span class="truncate">${escapeHtml(cat.name)}</span>
        `;

        btn.addEventListener('click', () => {
          this.txCategoryPicker.querySelectorAll('.category-btn').forEach(b => {
            b.classList.remove('border-indigo-600', 'dark:border-indigo-400', 'bg-indigo-50', 'dark:bg-indigo-950/60', 'text-indigo-900', 'dark:text-indigo-200', 'font-bold', 'active');
            b.classList.add('border-slate-200', 'dark:border-slate-700', 'bg-white', 'dark:bg-slate-900', 'text-slate-700', 'dark:text-slate-300');
          });
          btn.classList.remove('border-slate-200', 'dark:border-slate-700', 'bg-white', 'dark:bg-slate-900', 'text-slate-700', 'dark:text-slate-300');
          btn.classList.add('border-indigo-600', 'dark:border-indigo-400', 'bg-indigo-50', 'dark:bg-indigo-950/60', 'text-indigo-900', 'dark:text-indigo-200', 'font-bold', 'active');
          this.txFieldCategory.value = cat.id;
          this.clearFieldError('category');
        });

        this.txCategoryPicker.appendChild(btn);
      });

      this.txFieldCategory.value = firstCatId;
      if (window.lucide) {
        window.lucide.createIcons({ root: this.txCategoryPicker });
      }
    }

    showFieldError(field, message) {
      const errElem = this.formErrors[field];
      let inputElem = null;

      if (field === 'title') inputElem = this.txFieldTitle;
      else if (field === 'amount') inputElem = this.txFieldAmount;
      else if (field === 'date') inputElem = this.txFieldDate;
      else if (field === 'category') inputElem = this.txCategoryPicker;
      else if (field === 'notes') inputElem = this.txFieldNotes;

      if (inputElem) {
        inputElem.classList.add('input-error');
      }

      if (errElem) {
        const textSpan = errElem.querySelector('.err-text');
        if (textSpan) textSpan.textContent = message;
        else errElem.textContent = message;
        errElem.classList.remove('hidden');
      }
    }

    clearFieldError(field) {
      const errElem = this.formErrors[field];
      let inputElem = null;

      if (field === 'title') inputElem = this.txFieldTitle;
      else if (field === 'amount') inputElem = this.txFieldAmount;
      else if (field === 'date') inputElem = this.txFieldDate;
      else if (field === 'category') inputElem = this.txCategoryPicker;
      else if (field === 'notes') inputElem = this.txFieldNotes;

      if (inputElem) {
        inputElem.classList.remove('input-error');
      }

      if (errElem) {
        errElem.classList.add('hidden');
      }
    }

    clearAllFieldErrors() {
      ['title', 'amount', 'date', 'category', 'notes'].forEach(f => this.clearFieldError(f));
    }

    changeMonth(offset) {
      const nextMonth = getAdjacentMonth(this.selectedMonth, offset);
      this.setMonth(nextMonth);
    }

    setMonth(monthStr) {
      if (!monthStr || monthStr === this.selectedMonth) return;
      this.selectedMonth = monthStr;
      this.store.state.settings.targetMonth = monthStr;
      this.store.saveToStorage();
      if (this.headerMonthPicker) {
        this.headerMonthPicker.value = monthStr;
      }
      this.render();
    }

    getDefaultTransactionDate() {
      const currentYM = getCurrentYearMonth();
      if (this.selectedMonth === currentYM) {
        return getTodayIsoDate();
      }
      return `${this.selectedMonth}-01`;
    }

    renderQuickPresets() {
      if (!this.quickPresetsContainer) return;
      const presets = this.store.getPresets();
      this.quickPresetsContainer.innerHTML = '';

      presets.forEach(preset => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.presetId = preset.id;
        btn.dataset.presetTitle = preset.title;
        btn.dataset.presetAmount = String(preset.amount);
        btn.dataset.presetCat = preset.categoryId;
        btn.className = 'quick-preset-btn min-h-[44px] text-xs font-medium px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition active:scale-95 flex items-center space-x-1.5';
        btn.innerHTML = `<span>${escapeHtml(preset.emoji)} ${escapeHtml(preset.name)} (${formatCurrency(preset.amount)})</span>`;

        btn.addEventListener('click', () => {
          this.openTransactionModal('add', {
            title: preset.title,
            amount: preset.amount,
            type: 'expense',
            categoryId: preset.categoryId,
            date: this.getDefaultTransactionDate()
          });
        });

        this.quickPresetsContainer.appendChild(btn);
      });
    }

    openPresetModal() {
      this.lastFocusedElement = document.activeElement;
      if (!this.presetModal || !this.presetInputsContainer) return;

      const presets = this.store.getPresets();
      this.presetInputsContainer.innerHTML = '';

      presets.forEach(p => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 gap-3';
        row.innerHTML = `
          <div class="flex items-center space-x-2.5 min-w-0">
            <span class="text-base shrink-0">${escapeHtml(p.emoji)}</span>
            <div class="min-w-0">
              <span class="text-xs font-bold text-slate-900 dark:text-white truncate block">${escapeHtml(p.name)}</span>
              <span class="text-[10px] text-slate-500 dark:text-slate-400 truncate block">${escapeHtml(p.title)}</span>
            </div>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            <input
              type="number"
              step="any"
              min="1"
              max="1000000"
              name="preset_${p.id}"
              data-preset-id="${p.id}"
              value="${p.amount}"
              required
              class="preset-amount-input w-24 sm:w-28 px-2.5 py-1.5 text-xs text-right font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition"
            />
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400">₺</span>
          </div>
        `;
        this.presetInputsContainer.appendChild(row);
      });

      this.presetModal.classList.remove('hidden');
      const firstInput = this.presetInputsContainer.querySelector('input');
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 50);
      }
      if (window.lucide) {
        window.lucide.createIcons({ root: this.presetModal });
      }
    }

    closePresetModal() {
      if (this.presetModal) {
        this.presetModal.classList.add('hidden');
      }
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    resetPresetsToDefault() {
      this.store.updatePresets([...DEFAULT_PRESETS]);
      this.renderQuickPresets();
      this.openPresetModal();
      showToast('Hızlı harcamalar varsayılan tutarlara döndürüldü.', 'info');
    }

    handlePresetFormSubmit() {
      const inputs = this.presetInputsContainer.querySelectorAll('.preset-amount-input');
      const currentPresets = this.store.getPresets();
      const updatedPresets = [];

      for (const input of inputs) {
        const id = input.dataset.presetId;
        const val = parseFloat(input.value);
        if (isNaN(val) || val <= 0) {
          showToast('Lütfen tüm harcamalar için 0\'dan büyük geçerli bir tutar girin.', 'error');
          input.focus();
          return;
        }
        const existing = currentPresets.find(p => p.id === id);
        if (existing) {
          updatedPresets.push({
            ...existing,
            amount: Math.round(val * 100) / 100
          });
        }
      }

      this.store.updatePresets(updatedPresets);
      this.renderQuickPresets();
      this.closePresetModal();
      showToast('Hızlı harcama tutarları başarıyla kaydedildi!', 'success');
    }

    openTransactionModal(mode = 'add', prefillData = null) {
      this.lastFocusedElement = document.activeElement;
      this.txForm.reset();
      this.clearAllFieldErrors();
      this.txFieldId.value = '';

      if (mode === 'edit' && prefillData) {
        this.modalTitleText.textContent = 'İşlemi Düzenle';
        this.txFieldId.value = prefillData.id;
        this.txFieldTitle.value = prefillData.title || '';
        this.txFieldAmount.value = prefillData.amount || '';
        this.txFieldDate.value = prefillData.date || this.getDefaultTransactionDate();
        this.txFieldNotes.value = prefillData.notes || '';
        this.setModalType(prefillData.type);
        this.renderCategoryPicker(prefillData.type, prefillData.categoryId);
      } else {
        this.modalTitleText.textContent = 'Yeni İşlem Ekle';
        this.txFieldDate.value = (prefillData && prefillData.date) ? prefillData.date : this.getDefaultTransactionDate();
        const initialType = (prefillData && prefillData.type) ? prefillData.type : 'expense';
        this.setModalType(initialType);
        if (prefillData) {
          if (prefillData.title) this.txFieldTitle.value = prefillData.title;
          if (prefillData.amount) this.txFieldAmount.value = prefillData.amount;
          if (prefillData.categoryId) {
            this.renderCategoryPicker(initialType, prefillData.categoryId);
          }
        }
      }

      this.txModal.classList.remove('hidden');
      setTimeout(() => this.txFieldTitle.focus(), 50);

      if (window.lucide) {
        window.lucide.createIcons({ root: this.txModal });
      }
    }

    closeTransactionModal() {
      this.txModal.classList.add('hidden');
      this.txForm.reset();
      this.clearAllFieldErrors();
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    handleTransactionFormSubmit() {
      this.clearAllFieldErrors();

      const id = this.txFieldId.value;
      const title = this.txFieldTitle.value.trim();
      const rawAmount = this.txFieldAmount.value.trim();
      const amount = parseFloat(rawAmount);
      const type = this.txFieldType.value;
      const categoryId = this.txFieldCategory.value;
      const date = this.txFieldDate.value.trim();
      const notes = this.txFieldNotes.value.trim();

      let hasError = false;
      let firstInvalidInput = null;

      // 1. Başlık validasyonu
      if (!title) {
        this.showFieldError('title', 'Lütfen işlem başlığını girin.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldTitle;
      } else if (title.length < 2) {
        this.showFieldError('title', 'Başlık en az 2 karakter olmalıdır.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldTitle;
      } else if (title.length > 80) {
        this.showFieldError('title', 'Başlık en fazla 80 karakter olabilir.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldTitle;
      }

      // 2. Tutar validasyonu (Negatif, 0, Geçersiz, Aşırı büyük sayılar)
      if (!rawAmount || isNaN(amount) || !isFinite(amount)) {
        this.showFieldError('amount', 'Lütfen geçerli bir tutar girin.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldAmount;
      } else if (amount <= 0) {
        this.showFieldError('amount', 'Tutar 0\'dan büyük pozitif bir sayı olmalıdır.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldAmount;
      } else if (amount > 10000000) {
        this.showFieldError('amount', 'Maksimum işlem tutarı 10.000.000 ₺ olabilir.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldAmount;
      }

      // 3. Tarih validasyonu
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        this.showFieldError('date', 'Lütfen geçerli bir tarih seçin.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldDate;
      }

      // 4. Kategori validasyonu
      if (!categoryId) {
        this.showFieldError('category', 'Lütfen bir kategori seçin.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txCategoryPicker;
      }

      // 5. Not alanı uzunluk kontrolü
      if (notes.length > 300) {
        this.showFieldError('notes', 'Not alanı en fazla 300 karakter olabilir.');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = this.txFieldNotes;
      }

      if (hasError) {
        if (firstInvalidInput && typeof firstInvalidInput.focus === 'function') {
          firstInvalidInput.focus();
        }
        showToast('Lütfen formdaki hatalı alanları düzeltin.', 'error');
        return;
      }

      if (id) {
        // Güncelleme
        this.store.updateTransaction(id, {
          title,
          amount,
          type,
          categoryId,
          date,
          notes
        });
        showToast('İşlem başarıyla güncellendi.', 'success');
      } else {
        // Yeni ekleme
        this.store.addTransaction({
          title,
          amount,
          type,
          categoryId,
          date,
          notes
        });
        showToast('Yeni işlem bütçenize eklendi.', 'success');
      }

      this.closeTransactionModal();
    }

    handleExport() {
      const data = this.store.getExportData();
      const dateStr = getTodayIsoDate();
      const filename = `student_budget_export_${dateStr}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Yedek "${filename}" olarak indirildi.`, 'success');
    }

    handleImport() {
      const file = this.importFileInput.files[0];
      if (!file) {
        this.showImportError('Lütfen geçerli bir .json dosyası seçin.');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        this.showImportError('Dosya boyutu çok büyük (Maksimum 5MB).');
        return;
      }

      const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const content = e.target.result;
          let parsed;
          try {
            parsed = JSON.parse(content);
          } catch (jsonErr) {
            throw new Error('Dosya geçerli bir JSON biçiminde değil.');
          }

          this.store.importData(parsed, mode);
          this.closeImportModal();
          showToast('Bütçe verileri başarıyla içe aktarıldı.', 'success');
        } catch (err) {
          console.error('Import hatası:', err);
          this.showImportError(err.message || 'Dosya içe aktarılamadı.');
        }
      };

      reader.onerror = () => {
        this.showImportError('Dosya okunurken bir sistem hatası oluştu.');
      };

      reader.readAsText(file);
    }

    showImportError(msg) {
      if (this.importFileError) {
        const textSpan = this.importFileError.querySelector('.err-text');
        if (textSpan) textSpan.textContent = msg;
        else this.importFileError.textContent = msg;
        this.importFileError.classList.remove('hidden');
      }
      showToast(msg, 'error');
    }

    // ------------------------------------------------------------------------
    // 7. RENDER METODLARI
    // ------------------------------------------------------------------------
    render() {
      const transactions = this.store.getTransactions();
      const currentMonth = this.selectedMonth || getCurrentYearMonth();
      const summary = calculateSummary(transactions, new Date(), currentMonth);

      this.renderHeaderDate();
      this.renderDashboardCards(summary);
      this.renderAlertBanner(summary);
      this.renderCategoryFilterDropdown();
      this.renderTransactions();
      this.renderCharts(transactions, summary);
      this.renderQuickPresets();

      if (window.lucide) {
        window.lucide.createIcons();
      }
    }

    renderHeaderDate() {
      const displayMonth = this.selectedMonth || getCurrentYearMonth();
      const formatted = formatMonthDisplay(displayMonth);
      if (this.headerDateText) {
        this.headerDateText.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
      }
      if (this.headerMonthPicker) {
        this.headerMonthPicker.value = displayMonth;
      }
      if (this.txScopeBadge) {
        this.txScopeBadge.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
      }
    }

    renderDashboardCards(summary) {
      // 1. Kalan Bütçe (Net Balance)
      this.metricNetBalance.textContent = formatCurrency(summary.balance);

      if (summary.balance < 0) {
        this.metricNetBalance.className = 'text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-600 dark:text-rose-400';
      } else if (summary.balance === 0 && (summary.totalIncome > 0 || summary.carriedOverBalance !== 0)) {
        this.metricNetBalance.className = 'text-2xl sm:text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400';
      } else {
        this.metricNetBalance.className = 'text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white';
      }

      // Devreden Bakiye Rozeti
      if (this.badgeCarriedBalance) {
        const cob = summary.carriedOverBalance || 0;
        if (cob > 0) {
          this.badgeCarriedBalance.textContent = `+${formatCurrency(cob)}`;
          this.badgeCarriedBalance.className = 'font-bold text-emerald-600 dark:text-emerald-400';
        } else if (cob < 0) {
          this.badgeCarriedBalance.textContent = `-${formatCurrency(Math.abs(cob))}`;
          this.badgeCarriedBalance.className = 'font-bold text-rose-600 dark:text-rose-400';
        } else {
          this.badgeCarriedBalance.textContent = '0,00 ₺';
          this.badgeCarriedBalance.className = 'font-bold text-slate-500 dark:text-slate-400';
        }
      }

      // Sağlık Rozeti
      const badge = this.badgeHealthStatus;
      if (summary.totalIncome === 0 && summary.totalExpense === 0 && summary.carriedOverBalance === 0) {
        badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
        badge.textContent = 'İşlem Yok';
      } else if (summary.budgetHealth === 'healthy') {
        badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
        badge.textContent = 'Sağlıklı';
      } else if (summary.budgetHealth === 'warning') {
        badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
        badge.textContent = 'Dikkat';
      } else if (summary.budgetHealth === 'critical') {
        badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 pulse-critical';
        badge.textContent = 'Kritik';
      } else {
        badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 pulse-critical';
        badge.textContent = 'Tükendi';
      }

      this.metricSpentPercent.textContent = `%${summary.expenseRatio}`;

      // 2. GÜNLÜK GÜVENLİ HARCAMA LİMİTİ (STAR CARD)
      if (summary.daysRemainingInMonth === 1) {
        this.badgeDaysLeft.textContent = 'Son Gün!';
      } else {
        this.badgeDaysLeft.textContent = `${summary.daysRemainingInMonth} Gün Kaldı`;
      }

      this.metricDailyLimit.textContent = formatCurrency(summary.dailySafeSpendLimit);

      // Star Card Arka Planı ve İpuçları (UX İyileştirmesi)
      if (this.starCardContainer) {
        if (summary.balance <= 0 && (summary.totalIncome > 0 || summary.totalExpense > 0 || summary.carriedOverBalance !== 0)) {
          // Bütçe açığı veya sıfır limit alarm durumu
          this.starCardContainer.className = 'transition-card bg-gradient-to-br from-rose-700 via-rose-800 to-slate-900 text-white p-5 rounded-2xl shadow-lg shadow-rose-500/20 flex flex-col justify-between relative overflow-hidden';
          this.metricDailyTip.textContent = 'Bütçe tükendi! Günlük harcama limiti kalmadı.';
        } else if (summary.budgetHealth === 'critical') {
          // Kritik seviye durumu
          this.starCardContainer.className = 'transition-card bg-gradient-to-br from-amber-600 via-orange-700 to-rose-800 text-white p-5 rounded-2xl shadow-lg shadow-orange-500/20 flex flex-col justify-between relative overflow-hidden';
          this.metricDailyTip.textContent = 'Kritik seviye! Bu limiti kesinlikle aşmayın.';
        } else if (summary.daysRemainingInMonth === 1 && summary.balance > 0) {
          // Ayın son günü
          this.starCardContainer.className = 'transition-card bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white p-5 rounded-2xl shadow-lg shadow-indigo-500/20 flex flex-col justify-between relative overflow-hidden';
          this.metricDailyTip.textContent = 'Ayın son günü! Kalan bakiyenin tamamı harcanabilir.';
        } else {
          // Normal sağlıklı durum
          this.starCardContainer.className = 'transition-card bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white p-5 rounded-2xl shadow-lg shadow-indigo-500/20 flex flex-col justify-between relative overflow-hidden';
          this.metricDailyTip.textContent = 'Ay sonuna kadar günde harcayabileceğiniz güvenli tutar';
        }
      }

      // 3. Bu Ay Gelir
      this.metricTotalIncome.textContent = formatCurrency(summary.totalIncome);
      this.metricIncomeCount.textContent = `${summary.incomeCount} adet`;

      // 4. Bu Ay Gider
      this.metricTotalExpense.textContent = formatCurrency(summary.totalExpense);
      this.metricExpenseCount.textContent = `${summary.expenseCount} adet`;
    }

    renderAlertBanner(summary) {
      // Hiç işlem yoksa veya durum sağlıklıysa uyarı paneli gizlenir
      if (summary.budgetHealth === 'healthy' || (summary.totalIncome === 0 && summary.totalExpense === 0 && summary.carriedOverBalance === 0)) {
        this.budgetAlertBanner.classList.add('hidden');
        return;
      }

      this.budgetAlertBanner.classList.remove('hidden');

      if (summary.budgetHealth === 'depleted') {
        this.budgetAlertBanner.className = 'transition-all duration-300 rounded-2xl p-4 border flex items-start sm:items-center justify-between gap-3 shadow-sm bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60 text-rose-900 dark:text-rose-200';
        this.alertBannerIconBox.className = 'p-2 rounded-xl shrink-0 bg-rose-200 dark:bg-rose-900/80 text-rose-700 dark:text-rose-200';
        this.alertBannerTitle.textContent = 'Bütçe Açığı Uyarısı!';
        this.alertBannerDesc.textContent = 'Kalan bakiyeniz tükendi veya eksiye düştü. Günlük harcama limitiniz 0 ₺ olarak sınırlandırıldı.';
      } else if (summary.budgetHealth === 'critical') {
        this.budgetAlertBanner.className = 'transition-all duration-300 rounded-2xl p-4 border flex items-start sm:items-center justify-between gap-3 shadow-sm bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900/60 text-orange-900 dark:text-orange-200';
        this.alertBannerIconBox.className = 'p-2 rounded-xl shrink-0 bg-orange-200 dark:bg-orange-900/80 text-orange-700 dark:text-orange-200';
        this.alertBannerTitle.textContent = 'Kritik Bütçe Seviyesi!';
        this.alertBannerDesc.textContent = `Kalan bütçeniz %15 veya altına indi. Ayın geri kalanında günlük ${formatCurrency(summary.dailySafeSpendLimit)} limitini aşmamaya özen gösterin.`;
      } else if (summary.budgetHealth === 'warning') {
        this.budgetAlertBanner.className = 'transition-all duration-300 rounded-2xl p-4 border flex items-start sm:items-center justify-between gap-3 shadow-sm bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200';
        this.alertBannerIconBox.className = 'p-2 rounded-xl shrink-0 bg-amber-200 dark:bg-amber-900/80 text-amber-700 dark:text-amber-200';
        this.alertBannerTitle.textContent = 'Bütçe Uyarısı: Dikkat!';
        this.alertBannerDesc.textContent = 'Bütçeniz %35 seviyesinin altına indi. Zorunlu olmayan harcamaları erteleyerek ay sonunu rahat getirebilirsiniz.';
      }
    }

    renderCategoryFilterDropdown() {
      const currentSelected = this.categoryFilter;
      const categories = this.store.getCategories();

      this.filterCategorySelect.innerHTML = '<option value="">Tüm Kategoriler</option>';
      categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.type === 'income' ? '🟢 Gelir:' : '🔴 Gider:'} ${c.name}`;
        if (c.id === currentSelected) {
          opt.selected = true;
        }
        this.filterCategorySelect.appendChild(opt);
      });
    }

    getFilteredAndSortedTransactions() {
      // Yalnızca seçili aya ait işlemler
      let list = this.store.getTransactions().filter(t => t.date && String(t.date).startsWith(this.selectedMonth));

      // 1. Tip Filtresi
      if (this.activeFilter === 'income') {
        list = list.filter(t => t.type === 'income');
      } else if (this.activeFilter === 'expense') {
        list = list.filter(t => t.type === 'expense');
      }

      // 2. Kategori Filtresi
      if (this.categoryFilter) {
        list = list.filter(t => t.categoryId === this.categoryFilter);
      }

      // 3. Arama Filtresi (Başlık ve Notlar)
      if (this.searchQuery) {
        list = list.filter(t => {
          const title = (t.title || '').toLocaleLowerCase('tr-TR');
          const notes = (t.notes || '').toLocaleLowerCase('tr-TR');
          return title.includes(this.searchQuery) || notes.includes(this.searchQuery);
        });
      }

      // 4. Sıralama (Zaman damgaları ve string karşılaştırma ile dayanıklı sıralama)
      list.sort((a, b) => {
        if (this.sortOption === 'date-desc') {
          return String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0);
        } else if (this.sortOption === 'date-asc') {
          return String(a.date || '').localeCompare(String(b.date || '')) || (a.createdAt || 0) - (b.createdAt || 0);
        } else if (this.sortOption === 'amount-desc') {
          return Number(b.amount) - Number(a.amount);
        } else if (this.sortOption === 'amount-asc') {
          return Number(a.amount) - Number(b.amount);
        }
        return 0;
      });

      return list;
    }

    renderTransactions() {
      const allTx = this.store.getTransactions();
      const filtered = this.getFilteredAndSortedTransactions();
      this.txCountBadge.textContent = `${filtered.length} İşlem`;

      if (filtered.length === 0) {
        this.transactionsContainer.innerHTML = '';
        this.transactionsEmptyState.classList.remove('hidden');

        if (allTx.length === 0) {
          // Bütçede hiç işlem yok
          this.txEmptyTitle.textContent = 'Henüz İşlem Kaydedilmedi';
          this.txEmptyDesc.textContent = 'Bütçenizi kontrol altına almak için yukarıdaki "İşlem Ekle" butonunu veya hızlı harcama butonlarını kullanabilirsiniz.';
        } else {
          // Arama veya filtreleme sonucu boş
          this.txEmptyTitle.textContent = 'Arama Kriterine Uygun İşlem Yok';
          this.txEmptyDesc.textContent = 'Seçtiğiniz filtrelere veya arama terimine uygun işlem bulunamadı. Filtreleri temizleyerek tüm işlemleri görebilirsiniz.';
        }
        return;
      }

      this.transactionsEmptyState.classList.add('hidden');
      this.transactionsContainer.innerHTML = '';

      filtered.forEach(tx => {
        const category = this.store.getCategoryById(tx.categoryId);
        const isIncome = tx.type === 'income';

        const row = document.createElement('div');
        row.className = 'p-4 sm:px-6 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition flex items-center justify-between gap-3 group';

        const amountFormatted = isIncome ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`;
        const amountColorClass = isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

        const safeColor = sanitizeColor(category.color);
        const safeIcon = sanitizeIcon(category.icon);

        row.innerHTML = `
          <div class="flex items-center space-x-3.5 min-w-0">
            <!-- Category Icon Box -->
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs" style="background-color: ${safeColor}15; color: ${safeColor};">
              <i data-lucide="${safeIcon}" class="w-5 h-5"></i>
            </div>
            
            <!-- Details -->
            <div class="min-w-0">
              <div class="flex items-center space-x-2">
                <span class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  ${escapeHtml(tx.title)}
                </span>
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                  ${escapeHtml(category.name)}
                </span>
              </div>
              <div class="flex items-center space-x-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span>${formatDate(tx.date)}</span>
                ${tx.notes ? `<span class="truncate max-w-[150px] sm:max-w-[280px] text-slate-500 dark:text-slate-400">• ${escapeHtml(tx.notes)}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Amount and Action buttons -->
          <div class="flex items-center space-x-2 sm:space-x-4 shrink-0">
            <div class="text-right">
              <div class="text-xs sm:text-sm font-extrabold tracking-tight ${amountColorClass}">
                ${amountFormatted}
              </div>
            </div>

            <!-- Action buttons (WCAG 44px mobil dokunma alanı uyumlu) -->
            <div class="flex items-center space-x-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
              <button type="button" aria-label="İşlemi Düzenle" class="btn-edit-tx min-w-[44px] min-h-[44px] p-2.5 sm:p-2 rounded-xl flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition" title="Düzenle">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              <button type="button" aria-label="İşlemi Sil" class="btn-delete-tx min-w-[44px] min-h-[44px] p-2.5 sm:p-2 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition" title="Sil">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        `;

        // Event listeners for Edit and Delete
        const editBtn = row.querySelector('.btn-edit-tx');
        const deleteBtn = row.querySelector('.btn-delete-tx');

        editBtn.addEventListener('click', () => {
          this.openTransactionModal('edit', tx);
        });

        deleteBtn.addEventListener('click', () => {
          this.openConfirmModal({
            title: 'İşlemi Sil',
            desc: `"${tx.title}" başlıklı ${formatCurrency(tx.amount)} tutarındaki işlemi silmek istediğinize emin misiniz?`,
            actionText: 'Evet, Sil',
            onConfirm: () => {
              this.store.deleteTransaction(tx.id);
              showToast('İşlem başarıyla silindi.', 'success');
            }
          });
        });

        this.transactionsContainer.appendChild(row);
      });

      if (window.lucide) {
        window.lucide.createIcons({ root: this.transactionsContainer });
      }
    }

    // ------------------------------------------------------------------------
    // 8. GRAFİK ENTEGRASYONU (Chart.js)
    // ------------------------------------------------------------------------
    renderCharts(transactions = this.store.getTransactions(), summary = calculateSummary(transactions, new Date(), this.selectedMonth)) {
      // Grafiklerde sadece seçili aya ait giderler gösterilir
      const monthTxs = (transactions || []).filter(t => t.date && String(t.date).startsWith(this.selectedMonth));
      this.renderCategoryDoughnutChart(monthTxs);
      this.renderFlowBarChart(summary);
    }

    renderCategoryDoughnutChart(transactions) {
      if (!window.Chart || !this.categoryChartCanvas) return;

      const expenseTransactions = (transactions || []).filter(t => t.type === 'expense');

      if (expenseTransactions.length === 0) {
        this.categoryChartCanvas.style.display = 'none';
        if (this.chartEmptyState) {
          this.chartEmptyState.classList.remove('hidden');
        }
        if (this.categoryChart) {
          this.categoryChart.destroy();
          this.categoryChart = null;
        }
        return;
      }

      this.categoryChartCanvas.style.display = 'block';
      if (this.chartEmptyState) {
        this.chartEmptyState.classList.add('hidden');
      }

      // Kategori bazlı toplam hesapla
      const catTotals = {};
      expenseTransactions.forEach(t => {
        const amt = Number(t.amount) || 0;
        catTotals[t.categoryId] = (catTotals[t.categoryId] || 0) + amt;
      });

      const labels = [];
      const data = [];
      const bgColors = [];

      Object.keys(catTotals).forEach(catId => {
        const cat = this.store.getCategoryById(catId);
        labels.push(cat.name);
        data.push(Math.round(catTotals[catId] * 100) / 100);
        bgColors.push(sanitizeColor(cat.color, '#6366F1'));
      });

      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#94A3B8' : '#475569';

      // Bellek sızıntısını önlemek için önceki grafiği yok et
      if (this.categoryChart) {
        this.categoryChart.destroy();
        this.categoryChart = null;
      }

      const ctx = this.categoryChartCanvas.getContext('2d');
      this.categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: bgColors,
            borderWidth: 2,
            borderColor: isDark ? '#0f172a' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                boxHeight: 12,
                borderRadius: 4,
                useBorderRadius: true,
                padding: 12,
                color: textColor,
                font: {
                  family: "'Plus Jakarta Sans', sans-serif",
                  size: 11,
                  weight: '600'
                }
              }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw || 0;
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                  return ` ${formatCurrency(val)} (%${pct})`;
                }
              }
            }
          },
          cutout: '68%'
        }
      });
    }

    renderFlowBarChart(summary) {
      if (!window.Chart || !this.flowChartCanvas) return;

      const hasActivity = summary.totalIncome > 0 || summary.totalExpense > 0 || summary.carriedOverBalance !== 0;

      // Hem gelir, hem gider, hem devreden 0 ise boş durum göster
      if (!hasActivity) {
        this.flowChartCanvas.style.display = 'none';
        if (this.flowChartEmptyState) {
          this.flowChartEmptyState.classList.remove('hidden');
        }
        if (this.flowChart) {
          this.flowChart.destroy();
          this.flowChart = null;
        }
        return;
      }

      this.flowChartCanvas.style.display = 'block';
      if (this.flowChartEmptyState) {
        this.flowChartEmptyState.classList.add('hidden');
      }

      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#94A3B8' : '#475569';
      const gridColor = isDark ? 'rgba(51, 65, 85, 0.4)' : 'rgba(226, 232, 240, 0.8)';

      // Bellek sızıntısını önlemek için önceki grafiği yok et
      if (this.flowChart) {
        this.flowChart.destroy();
        this.flowChart = null;
      }

      const hasCarriedOver = summary.carriedOverBalance !== 0;
      let chartLabels = [];
      let chartData = [];
      let chartColors = [];

      if (hasCarriedOver) {
        chartLabels = ['Devreden', 'Bu Ay Gelir', 'Bu Ay Gider', 'Kalan Bakiye'];
        chartData = [
          summary.carriedOverBalance,
          summary.totalIncome,
          summary.totalExpense,
          Math.max(0, summary.balance)
        ];
        chartColors = [
          summary.carriedOverBalance >= 0 ? '#0ea5e9' : '#f43f5e', // Sky Blue veya Rose
          '#10B981', // Emerald (Gelir)
          '#F43F5E', // Rose (Gider)
          summary.balance >= 0 ? '#6366F1' : '#94A3B8' // Indigo veya Nötr Gri
        ];
      } else {
        chartLabels = ['Bu Ay Gelir', 'Bu Ay Gider', 'Kalan Bakiye'];
        chartData = [
          summary.totalIncome,
          summary.totalExpense,
          Math.max(0, summary.balance)
        ];
        chartColors = [
          '#10B981', // Emerald (Gelir)
          '#F43F5E', // Rose (Gider)
          summary.balance >= 0 ? '#6366F1' : '#94A3B8' // Indigo veya Nötr Gri
        ];
      }

      const ctx = this.flowChartCanvas.getContext('2d');
      this.flowChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [{
            label: 'Tutar (₺)',
            data: chartData,
            backgroundColor: chartColors,
            borderRadius: 8,
            borderSkipped: false,
            barThickness: hasCarriedOver ? 26 : 32
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${formatCurrency(ctx.raw)}`
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: textColor,
                font: {
                  family: "'Plus Jakarta Sans', sans-serif",
                  size: 11,
                  weight: '600'
                }
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: gridColor
              },
              ticks: {
                color: textColor,
                font: {
                  family: "'Plus Jakarta Sans', sans-serif",
                  size: 10
                },
                callback: (val) => `${numberFormatter.format(val)} ₺`
              }
            }
          }
        }
      });
    }
  }

  // --------------------------------------------------------------------------
  // 9. UYGULAMA BAŞLATICI (Bootstrap)
  // --------------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.BudgetStore = BudgetStore;
    window.calculateSummary = calculateSummary;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const store = new BudgetStore();
    window.app = new UIManager(store);
  });

})();
