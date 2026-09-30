import {
  createIcons,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Settings,
  Download,
  Upload,
  Sparkles,
  RotateCcw,
  Moon,
  Sun,
  PlusCircle,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Shield,
  ArrowDownLeft,
  ArrowUpRight,
  Zap,
  SlidersHorizontal,
  PieChart,
  BarChart3,
  Search,
  X,
  Receipt,
  Inbox,
  Plus,
  Wallet,
  CheckCircle,
  Edit3,
  Trash2,
  Info,
  Cloud,
  CloudOff,
  RefreshCw,
  LogOut,
  User,
  Mail,
  Compass,
  CalendarClock,
  ArrowDownCircle,
  TrendingUp,
  Calculator,
  CalendarPlus,
  TrendingDown,
  ChevronDown,
  HelpCircle
} from 'lucide';

const appIcons = {
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Settings,
  Download,
  Upload,
  Sparkles,
  RotateCcw,
  Moon,
  Sun,
  PlusCircle,
  AlertTriangle,
  AlertCircle,
  ShieldCheck,
  Shield,
  ArrowDownLeft,
  ArrowUpRight,
  Zap,
  SlidersHorizontal,
  PieChart,
  BarChart3,
  Search,
  X,
  Receipt,
  Inbox,
  Plus,
  Wallet,
  CheckCircle,
  Edit3,
  Trash2,
  Info,
  Cloud,
  CloudOff,
  RefreshCw,
  LogOut,
  User,
  Mail,
  Compass,
  CalendarClock,
  ArrowDownCircle,
  TrendingUp,
  Calculator,
  CalendarPlus,
  TrendingDown,
  ChevronDown,
  HelpCircle
};
import { calculateSummary } from '../store/calculations.js';
import { formatCurrency, formatNumber, formatDate, formatTime, formatMonthTitle, getCurrencySymbol } from '../utils/formatters.js';
import { getCurrentYearMonth, getAdjacentMonth, getLocalDateString, compareTransactions } from '../utils/helpers.js';
import { escapeHtml } from '../utils/sanitize.js';
import { t, getLanguage, setLanguage, onLanguageChange } from '../i18n/index.js';
import { showToast } from './toastManager.js';
import { ChartManager } from '../charts/chartManager.js';
import { ModalManager } from './modalManager.js';
import { SUPPORTED_CURRENCIES, THEME_KEY } from '../config/constants.js';
import { SafeStorage } from '../utils/storage.js';
import { authService } from '../services/authService.js';
import { SyncService } from '../services/syncService.js';
import { getFinancialOutlookViewModel } from '../services/financialOutlookService.js';

export class UIManager {
  constructor(store, options = {}) {
    this.store = store;
    this.authService = options.authService || authService;
    this.syncService = options.syncService || new SyncService(this.store);
    const initialNow = options.now instanceof Date ? options.now : (options.now ? new Date(options.now) : null);
    this.selectedMonth = options.selectedMonth || (initialNow ? getCurrentYearMonth(initialNow) : (this.store.state.settings?.targetMonth || getCurrentYearMonth()));
    this.activeFilter = 'all'; // 'all' | 'income' | 'expense'
    this.searchQuery = '';
    this.categoryFilter = '';
    this.sortOption = 'date-desc';

    if (typeof document !== 'undefined') {
      this.cacheElements();
      this.modalManager = options.modalManager || new ModalManager(this.store, this);
      this.chartManager = new ChartManager(
        this.categoryChartCanvas,
        this.flowChartCanvas,
        this.chartEmptyState,
        this.flowChartEmptyState
      );

      this.initTheme();
      this.bindEvents();

      this.authService.onAuthStateChange((user) => {
        this.renderAuthBadge(user);
        if (user) {
          this.modalManager.closeAuthModal?.();
          this.modalManager.closeOnboardingModal?.();
        }
      });

      this.syncService.onStatusChange((status, message) => {
        this.renderSyncStatus(status, message);
      });

      this.store.subscribe(() => {
        this.render();
      });

      onLanguageChange(() => {
        this.render();
      });

      this.render();
      this.renderAuthBadge(this.authService.getUser());
      this.renderSyncStatus(this.syncService.getStatus());
    } else {
      this.modalManager = {
        openOnboardingModal: () => {},
        closeOnboardingModal: () => {},
        ...(options.modalManager || {})
      };
    }

    // Başlangıç bootstrap & onboarding akışı (auth/cloud pending kontrolü)
    this.initBootstrapPromise = this.initBootstrap();
  }

  async init() {
    return this.initBootstrapPromise;
  }

  async initBootstrap() {
    // 1. Eğer yerel veride kullanıcı zaten onboarded ise, onboarding gösterme
    if (this.store.state.onboarded) {
      return;
    }

    // 2. Supabase yapılandırılmışsa, session ve auth durumunu bekle
    if (this.authService && this.authService.isConfigured()) {
      try {
        const user = await this.authService.waitForAuth();
        if (user) {
          this.renderAuthBadge(user);
          this.renderSyncStatus('syncing', 'Bulut verileri eşitleniyor...');
          await this.syncService.sync(user);
          if (this.store.state.settings?.targetMonth) {
            this.selectedMonth = this.store.state.settings.targetMonth;
          }
        }
      } catch (err) {
        console.warn('[UIManager] Başlangıç auth/sync uyarısı:', err);
      }
    }

    // 3. Karar anı:
    // Eğer cloud bootstrap veya yerel veriden onboarded true geldiyse onboarding açılmaz!
    if (this.store.state.onboarded) {
      if (typeof this.modalManager?.closeOnboardingModal === 'function') {
        this.modalManager.closeOnboardingModal();
      }
    } else {
      // Sadece gerçekten onboarded=false olan (örn: anonymous veya yeni hesap) kullanıcı için aç
      if (typeof this.modalManager?.openOnboardingModal === 'function') {
        this.modalManager.openOnboardingModal();
      }
    }

    this.render();
  }

  cacheElements() {
    // Header & Navigation
    this.headerDateText = document.getElementById('header-date-text');
    this.headerMonthPicker = document.getElementById('header-month-picker');
    this.btnPrevMonth = document.getElementById('btn-prev-month');
    this.btnNextMonth = document.getElementById('btn-next-month');
    this.btnThemeToggle = document.getElementById('btn-theme-toggle');
    this.themeIconMoon = document.getElementById('theme-icon-moon');
    this.themeIconSun = document.getElementById('theme-icon-sun');
    this.btnBackupMenu = document.getElementById('btn-backup-menu');
    this.backupDropdown = document.getElementById('backup-dropdown');
    this.btnExportJson = document.getElementById('btn-export-json');
    this.btnOpenImport = document.getElementById('btn-open-import');
    this.btnLoadSeed = document.getElementById('btn-load-seed');
    this.btnEditInitialBudget = document.getElementById('btn-edit-initial-budget');
    this.btnResetData = document.getElementById('btn-reset-data');
    this.btnOpenAddModal = document.getElementById('btn-open-add-modal');

    // Cloud Sync & Auth
    this.btnOpenAuth = document.getElementById('btn-open-auth');
    this.userAuthBadge = document.getElementById('user-auth-badge');
    this.syncStatusIndicator = document.getElementById('sync-status-indicator');
    this.iconSyncCloud = document.getElementById('icon-sync-cloud');
    this.syncStatusText = document.getElementById('sync-status-text');
    this.userEmailText = document.getElementById('user-email-text');
    this.userAvatarImg = document.getElementById('user-avatar-img');
    this.btnSignOut = document.getElementById('btn-sign-out');
    this.btnManualSync = document.getElementById('btn-manual-sync');

    // Language & Currency Selector (Header'a eklenecek)
    this.currencySelect = document.getElementById('currency-select');
    this.langSelect = document.getElementById('lang-select');

    // Metric Cards
    this.metricNetBalance = document.getElementById('metric-net-balance');
    this.badgeHealthStatus = document.getElementById('badge-health-status');
    this.badgeCarriedBalance = document.getElementById('badge-carried-balance');
    this.metricSpentPercent = document.getElementById('metric-spent-percent');
    this.metricDailyLimit = document.getElementById('metric-daily-limit');
    this.badgeDaysLeft = document.getElementById('badge-days-left');
    this.metricDailyTip = document.getElementById('metric-daily-tip');
    this.metricTotalIncome = document.getElementById('metric-total-income');
    this.metricIncomeCount = document.getElementById('metric-income-count');
    this.metricTotalExpense = document.getElementById('metric-total-expense');
    this.metricExpenseCount = document.getElementById('metric-expense-count');

    // Alert Banner
    this.budgetAlertBanner = document.getElementById('budget-alert-banner');
    this.alertBannerIconBox = document.getElementById('alert-banner-icon-box');
    this.alertBannerTitle = document.getElementById('alert-banner-title');
    this.alertBannerDesc = document.getElementById('alert-banner-desc');
    this.alertBannerClose = document.getElementById('alert-banner-close');

    // Presets
    this.quickPresetsContainer = document.getElementById('quick-presets-container');
    this.btnEditPresets = document.getElementById('btn-edit-presets');

    // Charts
    this.categoryChartCanvas = document.getElementById('categoryExpenseChart');
    this.flowChartCanvas = document.getElementById('flowChart');
    this.chartEmptyState = document.getElementById('chart-empty-state');
    this.flowChartEmptyState = document.getElementById('flow-chart-empty-state');

    // Transactions list & filters
    this.transactionsContainer = document.getElementById('transactions-container');
    this.transactionsEmptyState = document.getElementById('transactions-empty-state');
    this.txCountBadge = document.getElementById('tx-count-badge');
    this.txScopeBadge = document.getElementById('tx-scope-badge');
    this.txSearchInput = document.getElementById('tx-search-input');
    this.txSearchClear = document.getElementById('tx-search-clear');
    this.filterCategorySelect = document.getElementById('filter-category-select');
    this.sortSelect = document.getElementById('sort-select');
    this.filterTypeAll = document.getElementById('filter-type-all');
    this.filterTypeIncome = document.getElementById('filter-type-income');
    this.filterTypeExpense = document.getElementById('filter-type-expense');
    this.btnEmptyAddTx = document.getElementById('btn-empty-add-tx');
    this.btnEmptyResetSeed = document.getElementById('btn-empty-reset-seed');

    // Financial Outlook (FAZ 5.5C)
    this.financialOutlookSection = document.getElementById('financial-outlook-section');
    this.outlookHistoricalBadge = document.getElementById('outlook-historical-badge');
    this.btnManageCashflows = document.getElementById('btn-manage-cashflows');
    this.btnOpenWhatIf = document.getElementById('btn-open-whatif');
    this.metricNextIncomeDays = document.getElementById('metric-next-income-days');
    this.metricNextIncomeName = document.getElementById('metric-next-income-name');
    this.metricNextIncomeAmount = document.getElementById('metric-next-income-amount');
    this.metricNextIncomeDate = document.getElementById('metric-next-income-date');
    this.metricObligationsReserved = document.getElementById('metric-obligations-reserved');
    this.metricSafeDailySpend = document.getElementById('metric-safe-daily-spend');
    this.metricSafeDailyStatus = document.getElementById('metric-safe-daily-status');
    this.metricCurrentDailyPace = document.getElementById('metric-current-daily-pace');
    this.metricDailyPaceDiff = document.getElementById('metric-daily-pace-diff');
    this.metricMonthEndForecast = document.getElementById('metric-month-end-forecast');
    this.metricForecastConfidenceNote = document.getElementById('metric-forecast-confidence-note');
    this.chipCoverageStatus = document.getElementById('chip-coverage-status');
    this.textUtilizationRatio = document.getElementById('text-utilization-ratio');
    this.textUtilizationLabel = document.getElementById('text-utilization-label');
    this.barUtilization = document.getElementById('bar-utilization');
    this.textCoverageContext = document.getElementById('text-coverage-context');
    this.outlookEmptyState = document.getElementById('outlook-empty-state');
    this.btnFirstCashflow = document.getElementById('btn-first-cashflow');
    this.outlookDetailsGrid = document.getElementById('outlook-details-grid');
    this.outlookInsightsContainer = document.getElementById('outlook-insights-container');
    this.outlookTimelineContainer = document.getElementById('outlook-timeline-container');
  }

  initTheme() {
    const savedTheme = SafeStorage.getItem(THEME_KEY) || 'light';
    const isDark = savedTheme === 'dark' || (savedTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
      this.themeIconMoon?.classList.remove('hidden');
      this.themeIconSun?.classList.add('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      this.themeIconMoon?.classList.add('hidden');
      this.themeIconSun?.classList.remove('hidden');
    }
  }

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    SafeStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    if (isDark) {
      this.themeIconMoon?.classList.remove('hidden');
      this.themeIconSun?.classList.add('hidden');
    } else {
      this.themeIconMoon?.classList.add('hidden');
      this.themeIconSun?.classList.remove('hidden');
    }
    this.renderCharts();
  }

  bindEvents() {
    // Ay Gezgini
    if (this.btnPrevMonth) {
      this.btnPrevMonth.addEventListener('click', () => this.navigateMonth(-1));
    }
    if (this.btnNextMonth) {
      this.btnNextMonth.addEventListener('click', () => this.navigateMonth(1));
    }
    if (this.headerMonthPicker) {
      this.headerMonthPicker.addEventListener('change', (e) => {
        if (e.target.value) this.setMonth(e.target.value);
      });
    }

    // Tema
    if (this.btnThemeToggle) {
      this.btnThemeToggle.addEventListener('click', () => this.toggleTheme());
    }

    // Yedekleme Menüsü
    if (this.btnBackupMenu) {
      this.btnBackupMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        this.backupDropdown?.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
        if (this.backupDropdown && !this.backupDropdown.contains(e.target) && e.target !== this.btnBackupMenu) {
          this.backupDropdown.classList.add('hidden');
        }
      });
    }

    // Export JSON
    if (this.btnExportJson) {
      this.btnExportJson.addEventListener('click', () => {
        this.backupDropdown?.classList.add('hidden');
        this.exportData();
      });
    }

    // Import Modal Aç
    if (this.btnOpenImport) {
      this.btnOpenImport.addEventListener('click', () => {
        this.backupDropdown?.classList.add('hidden');
        this.modalManager.openImportModal();
      });
    }

    // Demo Yükle
    if (this.btnLoadSeed) {
      this.btnLoadSeed.addEventListener('click', () => {
        this.backupDropdown?.classList.add('hidden');
        this.store.loadDemoSeedData();
        showToast('Demo veriler başarıyla yüklendi.', 'success');
      });
    }

    // Başlangıç Bütçesini Düzenle
    if (this.btnEditInitialBudget) {
      this.btnEditInitialBudget.addEventListener('click', () => {
        this.backupDropdown?.classList.add('hidden');
        this.modalManager.openInitialBudgetModal();
      });
    }

    // Bulut ile Eşitle / Giriş Yap
    if (this.btnOpenAuth) {
      this.btnOpenAuth.addEventListener('click', () => {
        this.modalManager.openAuthModal();
      });
    }

    // Çıkış Yap
    if (this.btnSignOut) {
      this.btnSignOut.addEventListener('click', () => {
        this.modalManager.openConfirmModal({
          title: t('auth.signOut'),
          desc: t('auth.signOutDesc') || 'Bulut oturumunuz kapatılacak. Gizliliğinizi korumak için bu cihazdaki oturum verileri temizlenir. Tekrar giriş yaptığınızda tüm verileriniz buluttan geri yüklenir.',
          actionText: t('auth.signOut'),
          onConfirm: async () => {
            if (this.store.hasUnsyncedChanges && this.syncService) {
              try {
                await this.syncService.sync();
              } catch (e) {
                console.warn('[UIManager] Çıkış öncesi son senkronizasyon uyarısı:', e);
              }
            }
            await authService.signOut();
            this.store.clearSessionOnSignOut();
            showToast('Oturum kapatıldı. Verileriniz bulutta güvendedir.', 'info');
          }
        });
      });
    }

    // Manuel Şimdi Eşitle Butonu
    if (this.btnManualSync) {
      this.btnManualSync.addEventListener('click', async () => {
        this.backupDropdown?.classList.add('hidden');
        if (!authService.isLoggedIn()) {
          this.modalManager.openAuthModal();
        } else {
          showToast('Bulut senkronizasyonu başlatılıyor...', 'info');
          const res = await this.syncService.sync();
          if (res.success) {
            showToast('Verileriniz bulut ile başarıyla eşitlendi.', 'success');
          } else {
            showToast(res.error?.message || 'Senkronizasyon hatası.', 'error');
          }
        }
      });
    }

    // Durum Göstergesine Tıklayınca Senkronizasyonu Tetikle
    if (this.syncStatusIndicator) {
      this.syncStatusIndicator.addEventListener('click', async () => {
        if (authService.isLoggedIn()) {
          showToast('Bulut senkronizasyonu tetiklendi...', 'info');
          await this.syncService.sync();
        }
      });
    }

    // Verileri Sıfırla (Yeni Başlangıç)
    if (this.btnResetData) {
      this.btnResetData.addEventListener('click', () => {
        this.backupDropdown?.classList.add('hidden');
        this.modalManager.openConfirmModal({
          title: t('confirmModal.resetTitle'),
          desc: t('confirmModal.resetDesc'),
          actionText: 'Sıfırla ve Başlat',
          onConfirm: () => {
            this.store.resetAndRestartOnboarding();
            showToast('Tüm veriler sıfırlandı. Yeni başlangıç ekranı açılıyor.', 'info');
            this.modalManager.openOnboardingModal();
          }
        });
      });
    }

    // İşlem Ekle Modalı Aç
    if (this.btnOpenAddModal) {
      this.btnOpenAddModal.addEventListener('click', () => this.modalManager.openTransactionModal('add'));
    }
    if (this.btnEmptyAddTx) {
      this.btnEmptyAddTx.addEventListener('click', () => this.modalManager.openTransactionModal('add'));
    }
    if (this.btnEmptyResetSeed) {
      this.btnEmptyResetSeed.addEventListener('click', () => {
        this.store.resetData();
        showToast('Örnek veriler başarıyla yüklendi.', 'success');
      });
    }

    // Preset Tutarları Düzenle
    if (this.btnEditPresets) {
      this.btnEditPresets.addEventListener('click', () => this.modalManager.openPresetModal());
    }

    // Arama & Filtreleme
    if (this.txSearchInput) {
      this.txSearchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        if (this.txSearchClear) {
          if (this.searchQuery) this.txSearchClear.classList.remove('hidden');
          else this.txSearchClear.classList.add('hidden');
        }
        this.renderTransactions();
      });
    }

    if (this.txSearchClear) {
      this.txSearchClear.addEventListener('click', () => {
        if (this.txSearchInput) this.txSearchInput.value = '';
        this.searchQuery = '';
        this.txSearchClear.classList.add('hidden');
        this.renderTransactions();
      });
    }

    if (this.filterCategorySelect) {
      this.filterCategorySelect.addEventListener('change', (e) => {
        this.categoryFilter = e.target.value;
        this.renderTransactions();
      });
    }

    if (this.sortSelect) {
      this.sortSelect.addEventListener('change', (e) => {
        this.sortOption = e.target.value;
        this.renderTransactions();
      });
    }

    // Gelir / Gider Sekme Filtreleri
    const typeButtons = [
      { btn: this.filterTypeAll, val: 'all' },
      { btn: this.filterTypeIncome, val: 'income' },
      { btn: this.filterTypeExpense, val: 'expense' }
    ];
    typeButtons.forEach(({ btn, val }) => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.activeFilter = val;
          typeButtons.forEach(b => {
            if (b.btn) {
              b.btn.className = b.val === val
                ? 'filter-type-btn px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs transition'
                : 'filter-type-btn px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition';
            }
          });
          this.renderTransactions();
        });
      }
    });

    // Alert Banner Kapat
    if (this.alertBannerClose) {
      this.alertBannerClose.addEventListener('click', () => {
        this.budgetAlertBanner?.classList.add('hidden');
      });
    }

    // Para birimi ve dil seçimi dinleyicileri
    if (this.currencySelect) {
      this.currencySelect.addEventListener('change', (e) => {
        const newCurr = e.target.value;
        this.store.updateSettings({ currency: newCurr });
        showToast(`Para birimi ${newCurr} olarak güncellendi.`, 'info');
      });
    }

    if (this.langSelect) {
      this.langSelect.addEventListener('change', (e) => {
        const newLang = e.target.value;
        setLanguage(newLang);
        this.store.updateSettings({ language: newLang });
        showToast(newLang === 'tr' ? 'Dil Türkçe olarak ayarlandı.' : 'Language set to English.', 'info');
      });
    }

    // Financial Outlook & Planned Cashflows (FAZ 5.5C & FAZ 5.6)
    if (this.btnManageCashflows) {
      this.btnManageCashflows.addEventListener('click', () => {
        this.modalManager?.openCashflowManagerModal?.();
      });
    }
    if (this.btnOpenWhatIf) {
      this.btnOpenWhatIf.addEventListener('click', () => {
        this.modalManager?.openWhatIfModal?.();
      });
    }
    if (this.btnFirstCashflow) {
      this.btnFirstCashflow.addEventListener('click', () => {
        this.modalManager?.openCashflowModal?.('add');
      });
    }
  }

  navigateMonth(offset) {
    const nextMonth = getAdjacentMonth(this.selectedMonth, offset);
    this.setMonth(nextMonth);
  }

  setMonth(monthStr) {
    if (!monthStr || monthStr === this.selectedMonth) return;
    this.selectedMonth = monthStr;
    this.store.updateSettings({ targetMonth: monthStr });
    this.render();
  }

  getDefaultTransactionDate() {
    const currentYM = getCurrentYearMonth();
    if (this.selectedMonth === currentYM) {
      return getLocalDateString();
    }
    return `${this.selectedMonth}-01`;
  }

  render() {
    if (typeof document === 'undefined') return;
    const transactions = this.store.getTransactions();
    const currentMonth = this.selectedMonth || getCurrentYearMonth();
    const summary = calculateSummary(transactions, new Date(), currentMonth);
    const settings = this.store.getSettings();
    const currency = settings.currency || 'TRY';
    const lang = getLanguage();

    if (this.currencySelect && this.currencySelect.value !== currency) {
      this.currencySelect.value = currency;
    }
    if (this.langSelect && this.langSelect.value !== lang) {
      this.langSelect.value = lang;
    }

    this.renderHeaderDate(lang);
    this.renderDashboardCards(summary, currency, lang);
    this.renderAlertBanner(summary);
    this.renderFinancialOutlook(currency, lang);
    this.renderQuickPresets(currency, lang);
    this.renderCategoryFilterDropdown(lang);
    this.renderTransactions(currency, lang);
    this.renderCharts(transactions, summary, currency, lang);
    this.updateCurrencySymbols(currency);
    this.updateStaticTranslations();
    this.refreshIcons();
  }

  updateCurrencySymbols(currency) {
    const symbol = getCurrencySymbol(currency);
    document.querySelectorAll('.currency-symbol').forEach(el => {
      el.textContent = symbol;
    });
  }

  renderHeaderDate(lang) {
    if (this.headerDateText) {
      this.headerDateText.textContent = formatMonthTitle(this.selectedMonth, lang);
    }
    if (this.headerMonthPicker) {
      this.headerMonthPicker.value = this.selectedMonth;
    }
    if (this.txScopeBadge) {
      this.txScopeBadge.textContent = formatMonthTitle(this.selectedMonth, lang);
    }
  }

  renderDashboardCards(summary, currency, lang) {
    // 1. Kalan Net Bütçe
    if (this.metricNetBalance) {
      this.metricNetBalance.textContent = formatCurrency(summary.balance, currency, lang);
    }
    if (this.badgeCarriedBalance) {
      this.badgeCarriedBalance.textContent = formatCurrency(summary.carriedOverBalance, currency, lang);
    }
    if (this.metricSpentPercent) {
      this.metricSpentPercent.textContent = `%${summary.expenseRatio}`;
    }

    if (this.badgeHealthStatus) {
      let badgeBg = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
      let badgeText = t('health.healthy');
      if (summary.budgetHealth === 'warning') {
        badgeBg = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
        badgeText = t('health.warning');
      } else if (summary.budgetHealth === 'critical') {
        badgeBg = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 pulse-critical';
        badgeText = t('health.critical');
      } else if (summary.budgetHealth === 'depleted') {
        badgeBg = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
        badgeText = t('health.depleted');
      }
      this.badgeHealthStatus.className = `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeBg}`;
      this.badgeHealthStatus.textContent = badgeText;
    }

    // 2. Günlük Güvenli Harcama Limiti
    if (this.metricDailyLimit) {
      this.metricDailyLimit.textContent = formatCurrency(summary.dailySafeSpendLimit, currency, lang);
    }
    if (this.badgeDaysLeft) {
      this.badgeDaysLeft.textContent = t('cards.daysLeft', { days: summary.daysRemainingInMonth });
    }
    if (this.metricDailyTip) {
      this.metricDailyTip.textContent = summary.balance <= 0
        ? t('cards.dailyTipDeficit')
        : t('cards.dailyTipNormal');
    }

    // 3. Bu Ay Gelir
    if (this.metricTotalIncome) {
      this.metricTotalIncome.textContent = formatCurrency(summary.totalIncome, currency, lang);
    }
    if (this.metricIncomeCount) {
      this.metricIncomeCount.textContent = t('cards.itemsCount', { count: summary.incomeCount });
    }

    // 4. Bu Ay Gider
    if (this.metricTotalExpense) {
      this.metricTotalExpense.textContent = formatCurrency(summary.totalExpense, currency, lang);
    }
    if (this.metricExpenseCount) {
      this.metricExpenseCount.textContent = t('cards.itemsCount', { count: summary.expenseCount });
    }
  }

  renderAlertBanner(summary) {
    if (!this.budgetAlertBanner) return;

    if (summary.budgetHealth === 'critical' || summary.budgetHealth === 'depleted') {
      this.budgetAlertBanner.classList.remove('hidden');
      if (summary.budgetHealth === 'critical') {
        this.budgetAlertBanner.className = 'transition-all duration-300 rounded-2xl p-4 border flex items-start sm:items-center justify-between gap-3 shadow-sm bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200';
        if (this.alertBannerIconBox) this.alertBannerIconBox.className = 'p-2 rounded-xl shrink-0 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300';
        if (this.alertBannerTitle) this.alertBannerTitle.textContent = t('health.critical');
        if (this.alertBannerDesc) this.alertBannerDesc.textContent = t('health.criticalDesc');
      } else {
        this.budgetAlertBanner.className = 'transition-all duration-300 rounded-2xl p-4 border flex items-start sm:items-center justify-between gap-3 shadow-sm bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200';
        if (this.alertBannerIconBox) this.alertBannerIconBox.className = 'p-2 rounded-xl shrink-0 bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300';
        if (this.alertBannerTitle) this.alertBannerTitle.textContent = t('health.depleted');
        if (this.alertBannerDesc) this.alertBannerDesc.textContent = t('health.depletedDesc');
      }
    } else {
      this.budgetAlertBanner.classList.add('hidden');
    }
  }

  renderFinancialOutlook(currency, lang, now = new Date()) {
    if (typeof document === 'undefined') return;
    if (!this.financialOutlookSection) return;

    let outlook;
    try {
      outlook = getFinancialOutlookViewModel({
        store: this.store,
        selectedMonth: this.selectedMonth,
        now
      });
    } catch (err) {
      console.warn('[UIManager] Failed to compute financial outlook:', err);
      return;
    }

    // Historical / non-current month explanatory badge
    if (this.outlookHistoricalBadge) {
      if (!outlook.isCurrentMonth) {
        this.outlookHistoricalBadge.textContent = t('financialOutlook.currentBadge');
        this.outlookHistoricalBadge.classList.remove('hidden');
      } else {
        this.outlookHistoricalBadge.classList.add('hidden');
      }
    }

    // Metric A: Next Income
    if (this.metricNextIncomeDays && this.metricNextIncomeName && this.metricNextIncomeAmount) {
      if (outlook.nextIncome && outlook.nextIncome.found) {
        const ni = outlook.nextIncome;
        if (ni.daysUntil === 0) {
          this.metricNextIncomeDays.textContent = t('financialOutlook.daysRemainingToday');
        } else {
          this.metricNextIncomeDays.textContent = t('financialOutlook.daysCount', { days: ni.daysUntil });
        }
        this.metricNextIncomeName.textContent = ni.name;
        this.metricNextIncomeAmount.textContent = formatCurrency(ni.amount, currency, lang);
        if (this.metricNextIncomeDate) {
          this.metricNextIncomeDate.textContent = ni.date ? formatDate(ni.date, lang) : '--';
        }
        if (this.metricObligationsReserved) {
          this.metricObligationsReserved.textContent = t('financialOutlook.obligationsReserved', {
            amount: formatCurrency(outlook.obligationsBeforeIncome || 0, currency, lang)
          });
        }
      } else {
        this.metricNextIncomeDays.textContent = '--';
        this.metricNextIncomeName.textContent = t('financialOutlook.noNextIncome');
        this.metricNextIncomeAmount.textContent = formatCurrency(0, currency, lang);
        if (this.metricNextIncomeDate) this.metricNextIncomeDate.textContent = '--';
        if (this.metricObligationsReserved) this.metricObligationsReserved.textContent = '--';
      }
    }

    // Metric B: Safe Daily Spend
    if (this.metricSafeDailySpend) {
      if (typeof outlook.safeDailySpend === 'number') {
        this.metricSafeDailySpend.textContent = formatCurrency(outlook.safeDailySpend, currency, lang);
      } else {
        this.metricSafeDailySpend.textContent = '--';
      }
    }
    if (this.metricSafeDailyStatus) {
      const cov = outlook.coverageStatus;
      if (cov === 'DEFICIT_BEFORE_INCOME') {
        this.metricSafeDailyStatus.textContent = t('coverage.DEFICIT_BEFORE_INCOME');
        this.metricSafeDailyStatus.className = 'text-rose-600 dark:text-rose-400 font-bold';
      } else if (cov === 'TIGHT') {
        this.metricSafeDailyStatus.textContent = t('coverage.TIGHT');
        this.metricSafeDailyStatus.className = 'text-amber-600 dark:text-amber-400 font-bold';
      } else if (cov === 'COVERED') {
        this.metricSafeDailyStatus.textContent = t('coverage.COVERED');
        this.metricSafeDailyStatus.className = 'text-emerald-600 dark:text-emerald-400 font-bold';
      } else {
        this.metricSafeDailyStatus.textContent = t('coverage.NO_NEXT_INCOME');
        this.metricSafeDailyStatus.className = 'text-slate-500 dark:text-slate-400 font-medium';
      }
    }

    // Metric C: Current Daily Pace
    if (this.metricCurrentDailyPace) {
      this.metricCurrentDailyPace.textContent = formatCurrency(outlook.currentDailyPace || 0, currency, lang);
    }
    if (this.metricDailyPaceDiff) {
      if (outlook.coverageStatus === 'NO_NEXT_INCOME' || outlook.safeDailySpend === null) {
        this.metricDailyPaceDiff.textContent = '--';
        this.metricDailyPaceDiff.className = 'font-bold text-slate-500 dark:text-slate-400';
      } else if (outlook.dailyAdjustmentNeeded > 0) {
        this.metricDailyPaceDiff.textContent = t('financialOutlook.paceDifference', {
          amount: formatCurrency(outlook.dailyAdjustmentNeeded, currency, lang)
        });
        this.metricDailyPaceDiff.className = 'font-bold text-rose-600 dark:text-rose-400 truncate';
      } else {
        this.metricDailyPaceDiff.textContent = t('financialOutlook.paceBalanced');
        this.metricDailyPaceDiff.className = 'font-bold text-emerald-600 dark:text-emerald-400 truncate';
      }
    }

    // Metric D: Month-End Forecast
    if (this.metricMonthEndForecast) {
      this.metricMonthEndForecast.textContent = formatCurrency(
        outlook.monthEndForecast?.projectedExpense || 0,
        currency,
        lang
      );
    }
    if (this.metricForecastConfidenceNote) {
      if (outlook.monthEndForecast?.isLowConfidence) {
        this.metricForecastConfidenceNote.textContent = t('financialOutlook.limitedData');
        this.metricForecastConfidenceNote.className = 'text-amber-600 dark:text-amber-400 truncate block text-[10px] font-semibold';
      } else {
        this.metricForecastConfidenceNote.textContent = t('financialOutlook.monthEndForecastSub');
        this.metricForecastConfidenceNote.className = 'text-slate-500 dark:text-slate-400 truncate block text-[10px]';
      }
    }

    // Coverage Status Chip
    if (this.chipCoverageStatus) {
      const cov = outlook.coverageStatus;
      this.chipCoverageStatus.textContent = t(`coverage.${cov}`) || cov;
      if (cov === 'COVERED') {
        this.chipCoverageStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
      } else if (cov === 'TIGHT') {
        this.chipCoverageStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      } else if (cov === 'DEFICIT_BEFORE_INCOME') {
        this.chipCoverageStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 pulse-critical';
      } else {
        this.chipCoverageStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200';
      }
    }

    // Utilization bar & ratio
    const utilRatio = outlook.utilizationRatio;
    if (this.textUtilizationRatio && this.barUtilization) {
      if (utilRatio === null || utilRatio === undefined) {
        this.textUtilizationRatio.textContent = '--';
        if (this.textUtilizationLabel) this.textUtilizationLabel.textContent = '';
        this.barUtilization.style.width = '0%';
        this.barUtilization.className = 'bg-slate-300 dark:bg-slate-600 h-2 rounded-full transition-all duration-300';
      } else {
        const utilPct = Math.round(utilRatio * 100);
        this.textUtilizationRatio.textContent = `%${utilPct}`;
        const barWidth = Math.min(100, Math.max(0, utilPct));
        this.barUtilization.style.width = `${barWidth}%`;

        if (utilRatio >= 1.0 || outlook.coverageStatus === 'DEFICIT_BEFORE_INCOME') {
          this.barUtilization.className = 'bg-rose-500 h-2 rounded-full transition-all duration-300';
          if (this.textUtilizationLabel) {
            this.textUtilizationLabel.textContent = `(${t('planner.utilizationPressure')})`;
            this.textUtilizationLabel.className = 'text-[11px] font-semibold text-rose-600 dark:text-rose-400';
          }
        } else if (utilRatio >= 0.80) {
          this.barUtilization.className = 'bg-amber-500 h-2 rounded-full transition-all duration-300';
          if (this.textUtilizationLabel) {
            this.textUtilizationLabel.textContent = `(${t('planner.utilizationTight')})`;
            this.textUtilizationLabel.className = 'text-[11px] font-semibold text-amber-600 dark:text-amber-400';
          }
        } else {
          this.barUtilization.className = 'bg-emerald-500 h-2 rounded-full transition-all duration-300';
          if (this.textUtilizationLabel) {
            this.textUtilizationLabel.textContent = `(${t('planner.utilizationNormal')})`;
            this.textUtilizationLabel.className = 'text-[11px] font-semibold text-emerald-600 dark:text-emerald-400';
          }
        }
      }
    }

    // Coverage context / Factual shortfall sentence
    if (this.textCoverageContext) {
      const cov = outlook.coverageStatus;
      if (cov === 'DEFICIT_BEFORE_INCOME') {
        const shortfall = Math.abs(outlook.projectedBalanceBeforeNextIncome || 0);
        this.textCoverageContext.textContent = t('coverage.deficitContext', {
          amount: formatCurrency(shortfall, currency, lang)
        });
      } else if (cov === 'TIGHT') {
        const pct = utilRatio !== null ? Math.round(utilRatio * 100) : 80;
        this.textCoverageContext.textContent = t('coverage.tightContext', { percent: pct });
      } else if (cov === 'COVERED') {
        this.textCoverageContext.textContent = t('coverage.coveredContext');
      } else {
        this.textCoverageContext.textContent = t('financialOutlook.noNextIncomeSub');
      }
    }

    // Empty state vs active plans
    if (this.outlookEmptyState) {
      if (!outlook.hasPlannedCashflows) {
        this.outlookEmptyState.classList.remove('hidden');
      } else {
        this.outlookEmptyState.classList.add('hidden');
      }
    }

    // Top 3 Insights Panel
    if (this.outlookInsightsContainer) {
      this.outlookInsightsContainer.innerHTML = '';
      if (!outlook.insights || outlook.insights.length === 0) {
        this.outlookInsightsContainer.innerHTML = `
          <div class="text-xs text-slate-400 dark:text-slate-500 py-3 text-center italic">
            ${escapeHtml(t('financialOutlook.noInsights'))}
          </div>
        `;
      } else {
        outlook.insights.forEach((ins) => {
          let iconColor = 'text-indigo-500';
          let bgBadge = 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/60';
          if (ins.severity === 'critical') {
            iconColor = 'text-rose-500';
            bgBadge = 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-900/60';
          } else if (ins.severity === 'warning') {
            iconColor = 'text-amber-500';
            bgBadge = 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/60';
          } else if (ins.severity === 'positive') {
            iconColor = 'text-emerald-500';
            bgBadge = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/60';
          }

          let msg = ins.message || '';
          if (ins.messageKey) {
            const translated = t(ins.messageKey, ins.params || {});
            if (translated && translated !== ins.messageKey) msg = translated;
          }

          const itemEl = document.createElement('div');
          itemEl.className = `p-2 rounded-lg border text-xs flex items-start space-x-2 ${bgBadge}`;
          itemEl.innerHTML = `
            <i data-lucide="sparkles" class="w-3.5 h-3.5 mt-0.5 shrink-0 ${iconColor}"></i>
            <div class="flex-1 leading-snug font-medium">${escapeHtml(msg)}</div>
          `;
          this.outlookInsightsContainer.appendChild(itemEl);
        });
      }
    }

    // Upcoming Timeline (Next 5 occurrences)
    if (this.outlookTimelineContainer) {
      this.outlookTimelineContainer.innerHTML = '';
      if (!outlook.timeline || outlook.timeline.length === 0) {
        this.outlookTimelineContainer.innerHTML = `
          <div class="text-xs text-slate-400 dark:text-slate-500 py-2.5 text-center italic">
            ${escapeHtml(t('financialOutlook.noTimeline'))}
          </div>
        `;
      } else {
        outlook.timeline.forEach((occ) => {
          const isInc = occ.type === 'income';
          const amountColor = isInc ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200';
          const sign = isInc ? '+' : '-';
          const dateFormatted = occ.date ? formatDate(occ.date, lang) : '--';
          let daysLabel = '';
          if (occ.daysUntil === 0) {
            daysLabel = t('financialOutlook.daysRemainingToday');
          } else if (occ.daysUntil !== null && occ.daysUntil !== undefined) {
            daysLabel = t('financialOutlook.daysRemaining', { days: occ.daysUntil });
          }

          const row = document.createElement('div');
          row.className = 'py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2';
          row.innerHTML = `
            <div class="min-w-0 flex-1">
              <div class="flex items-center space-x-1.5">
                <span class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(occ.name)}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                  isInc
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }">
                  ${escapeHtml(t(`cashflow.${occ.type}`))}
                </span>
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center space-x-2">
                <span>${escapeHtml(dateFormatted)}</span>
                ${daysLabel ? `<span>•</span><span class="font-medium text-indigo-600 dark:text-indigo-400">${escapeHtml(daysLabel)}</span>` : ''}
              </div>
            </div>
            <div class="text-right shrink-0">
              <span class="text-xs font-bold ${amountColor}">${sign}${formatCurrency(occ.amount, currency, lang)}</span>
            </div>
          `;
          this.outlookTimelineContainer.appendChild(row);
        });
      }
    }
  }

  renderQuickPresets(currency, lang) {
    if (!this.quickPresetsContainer || typeof document === 'undefined') return;
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
      btn.innerHTML = `<span>${escapeHtml(preset.emoji)} ${escapeHtml(preset.name)} (${formatCurrency(preset.amount, currency, lang)})</span>`;

      btn.addEventListener('click', () => {
        this.modalManager.openTransactionModal('add', {
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

  renderCategoryFilterDropdown(lang) {
    if (!this.filterCategorySelect) return;
    const currentVal = this.filterCategorySelect.value;
    const categories = this.store.getCategories();

    this.filterCategorySelect.innerHTML = `<option value="">${t('history.allCategories')}</option>`;
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const translatedName = t(`categories.${c.id}`);
      opt.textContent = (translatedName !== `categories.${c.id}`) ? translatedName : c.name;
      if (c.id === currentVal) opt.selected = true;
      this.filterCategorySelect.appendChild(opt);
    });
  }

  renderTransactionRowHtml(tx, lang = getLanguage(), currency = this.store.getSettings().currency) {
    const cat = this.store.getCategoryById(tx.categoryId);
    const isIncome = tx.type === 'income';
    const translatedCat = t(`categories.${tx.categoryId}`);
    const catName = (translatedCat !== `categories.${tx.categoryId}`) ? translatedCat : (cat ? cat.name : 'Genel');
    const catColor = cat ? cat.color : '#94a3b8';
    const timeStr = formatTime(tx.createdAt, lang);

    return `
      <div class="flex items-center space-x-3.5 min-w-0">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isIncome
            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
            : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
        }">
          <i data-lucide="${isIncome ? 'arrow-down-left' : 'arrow-up-right'}" class="w-5 h-5"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center space-x-2">
            <span class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(tx.title)}</span>
            <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${catColor};"></span>
              <span>${escapeHtml(catName)}</span>
            </span>
          </div>
          <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>${formatDate(tx.date, lang)}${timeStr ? ` <span class="text-slate-400 dark:text-slate-500 font-mono text-[10px]">• ${timeStr}</span>` : ''}</span>
            ${tx.notes ? `<span class="truncate max-w-[200px]">• ${escapeHtml(tx.notes)}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="flex items-center space-x-3 shrink-0">
        <span class="text-xs sm:text-sm font-extrabold ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}">
          ${isIncome ? '+' : '-'}${formatCurrency(tx.amount, currency, lang)}
        </span>
        <div class="flex items-center space-x-1">
          <button type="button" data-action="edit" title="${t('history.edit')}" class="min-w-[36px] min-h-[36px] p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 transition flex items-center justify-center">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          <button type="button" data-action="delete" title="${t('history.delete')}" class="min-w-[36px] min-h-[36px] p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition flex items-center justify-center">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }

  renderTransactions(currency, lang) {
    if (!this.transactionsContainer) return;

    // Yalnızca seçili aya ait işlemler
    let list = this.store.getTransactions().filter(t => t.date && String(t.date).startsWith(this.selectedMonth));

    // Tip filtresi (Gelir / Gider)
    if (this.activeFilter === 'income') {
      list = list.filter(t => t.type === 'income');
    } else if (this.activeFilter === 'expense') {
      list = list.filter(t => t.type === 'expense');
    }

    // Kategori filtresi
    if (this.categoryFilter) {
      list = list.filter(t => t.categoryId === this.categoryFilter);
    }

    // Arama filtresi
    if (this.searchQuery) {
      list = list.filter(t => {
        const titleMatch = (t.title || '').toLowerCase().includes(this.searchQuery);
        const notesMatch = (t.notes || '').toLowerCase().includes(this.searchQuery);
        return titleMatch || notesMatch;
      });
    }

    // Sıralama
    list.sort((a, b) => compareTransactions(a, b, this.sortOption));

    if (this.txCountBadge) {
      this.txCountBadge.textContent = t('history.txCount', { count: list.length });
    }

    this.transactionsContainer.innerHTML = '';

    if (list.length === 0) {
      if (this.transactionsEmptyState) this.transactionsEmptyState.classList.remove('hidden');
      return;
    }

    if (this.transactionsEmptyState) this.transactionsEmptyState.classList.add('hidden');

    list.forEach(tx => {
      const row = document.createElement('div');
      row.className = 'p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition flex items-center justify-between gap-3';
      row.innerHTML = this.renderTransactionRowHtml(tx, lang, currency);

      row.querySelector('button[data-action="edit"]').addEventListener('click', () => {
        this.modalManager.openTransactionModal('edit', tx);
      });

      row.querySelector('button[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.modalManager.openConfirmModal({
          title: t('confirmModal.title'),
          desc: t('confirmModal.desc'),
          actionText: t('confirmModal.confirmDelete') || 'Sil / Onayla',
          onConfirm: () => {
            this.store.deleteTransaction(tx.id);
            showToast('İşlem başarıyla silindi.', 'info');
          }
        });
      });

      this.transactionsContainer.appendChild(row);
    });
  }

  renderCharts(transactions = this.store.getTransactions(), summary = calculateSummary(transactions, new Date(), this.selectedMonth), currency = 'TRY', lang = 'tr') {
    const monthTxs = (transactions || []).filter(t => t.date && String(t.date).startsWith(this.selectedMonth));
    this.chartManager.render(monthTxs, summary, this.store.getCategories(), currency, lang);
  }

  updateStaticTranslations() {
    // Statik data-i18n etiketlerini güncelle
    const isConfirmModalOpen = this.modalManager?.confirmModal && !this.modalManager.confirmModal.classList.contains('hidden');

    if (typeof document !== 'undefined') {
      const browserTitle = t('brand.browserTitle');
      if (browserTitle && browserTitle !== 'brand.browserTitle') {
        document.title = browserTitle;
      }
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      // Eğer onay modalı o anda açıksa içindeki dinamik metinleri ezme (flicker/flash önleme)
      if (isConfirmModalOpen && el.closest('#confirm-modal')) {
        return;
      }
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', t(key));
      }
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', t(key));
      }
    });

    const footerPrivacyEl = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById('footer-privacy-text')
      : null;
    if (footerPrivacyEl) {
      const key = this.currentUser ? 'footer.privacyCloud' : 'footer.privacyLocal';
      footerPrivacyEl.textContent = t(key);
      footerPrivacyEl.setAttribute('data-i18n', key);
    }
  }

  exportData() {
    try {
      const data = this.store.exportData();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = getLocalDateString();
      a.href = url;
      a.download = `student_budget_export_${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Yedek dosyanız (JSON) başarıyla indirildi.', 'success');
    } catch (err) {
      showToast('Yedek dışa aktarma hatası: ' + err.message, 'error');
    }
  }

  renderAuthBadge(user) {
    if (typeof document === 'undefined') return;
    this.currentUser = user || null;
    const footerPrivacyEl = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById('footer-privacy-text')
      : null;
    const headerAuthLabel = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById('header-auth-label')
      : null;
    const headerAuthSub = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
      ? document.getElementById('header-auth-sub')
      : null;

    if (user) {
      this.btnOpenAuth?.classList.add('hidden');
      this.userAuthBadge?.classList.remove('hidden');
      if (this.userEmailText) {
        this.userEmailText.textContent = user.email || 'Kullanıcı';
        this.userEmailText.title = user.email || '';
      }
      if (headerAuthLabel) {
        headerAuthLabel.textContent = user.email || 'Kullanıcı';
      }
      if (headerAuthSub) {
        headerAuthSub.textContent = t('auth.statusSynced');
      }
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
      if (avatarUrl && this.userAvatarImg) {
        this.userAvatarImg.src = avatarUrl;
        this.userAvatarImg.classList.remove('hidden');
      } else if (this.userAvatarImg) {
        this.userAvatarImg.classList.add('hidden');
      }
      if (footerPrivacyEl) {
        footerPrivacyEl.textContent = t('footer.privacyCloud');
        footerPrivacyEl.setAttribute('data-i18n', 'footer.privacyCloud');
      }
    } else {
      this.btnOpenAuth?.classList.remove('hidden');
      this.userAuthBadge?.classList.add('hidden');
      if (this.userAvatarImg) this.userAvatarImg.classList.add('hidden');
      if (headerAuthLabel) {
        headerAuthLabel.textContent = t('auth.accountGuestPrimary');
      }
      if (headerAuthSub) {
        headerAuthSub.textContent = t('auth.accountGuestSecondary');
      }
      if (footerPrivacyEl) {
        footerPrivacyEl.textContent = t('footer.privacyLocal');
        footerPrivacyEl.setAttribute('data-i18n', 'footer.privacyLocal');
      }
    }
    this.refreshIcons();
  }

  renderSyncStatus(status, message = null) {
    if (typeof document === 'undefined') return;
    if (!this.iconSyncCloud) return;

    if (status === 'syncing') {
      this.iconSyncCloud.className = 'w-4 h-4 text-amber-500 animate-spin';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusSyncing');
    } else if (status === 'pending') {
      this.iconSyncCloud.className = 'w-4 h-4 text-amber-500';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusPending');
    } else if (status === 'synced') {
      this.iconSyncCloud.className = 'w-4 h-4 text-emerald-500';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusSynced');
    } else if (status === 'offline') {
      this.iconSyncCloud.className = 'w-4 h-4 text-slate-400';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusOffline');
    } else if (status === 'error') {
      this.iconSyncCloud.className = 'w-4 h-4 text-rose-500';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusError');
    } else {
      this.iconSyncCloud.className = 'w-4 h-4 text-slate-400';
      if (this.syncStatusText) this.syncStatusText.textContent = t('auth.statusOffline');
    }
    this.refreshIcons();
  }

  refreshIcons() {
    if (typeof document === 'undefined') return;
    createIcons({ icons: appIcons });
  }
}
