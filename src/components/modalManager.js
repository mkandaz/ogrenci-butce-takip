import { escapeHtml } from '../utils/sanitize.js';
import { formatCurrency } from '../utils/formatters.js';
import { getCurrentYearMonth } from '../utils/helpers.js';
import { t } from '../i18n/index.js';
import { showToast } from './toastManager.js';
import { DEFAULT_PRESETS } from '../config/defaultData.js';
import { authService } from '../services/authService.js';
import { SCENARIO_TYPES, simulateWhatIf } from '../services/whatIfEngine.js';
import { calculateSummary } from '../store/calculations.js';

export class ModalManager {
  constructor(store, uiManager) {
    this.store = store;
    this.ui = uiManager;
    this.lastFocusedElement = null;
    this.confirmCallback = null;

    // What-If Simulator state (FAZ 5.6)
    this.currentWhatIfType = SCENARIO_TYPES.ONE_TIME_EXPENSE;
    this.whatifPercentDirection = 'down';
    this.whatifDailyDirection = 'down';

    if (typeof document !== 'undefined') {
      this.cacheElements();
      this.bindEvents();
    }
  }

  cacheElements() {
    // Transaction Modal
    this.txModal = document.getElementById('transaction-modal');
    this.txForm = document.getElementById('tx-form');
    this.modalTitleText = document.getElementById('modal-title-text');
    this.modalBtnClose = document.getElementById('modal-btn-close');
    this.modalBtnCancel = document.getElementById('modal-btn-cancel');
    this.txTypeExpenseBtn = document.getElementById('tx-type-expense-btn');
    this.txTypeIncomeBtn = document.getElementById('tx-type-income-btn');
    this.txFieldType = document.getElementById('tx-field-type');
    this.txFieldId = document.getElementById('tx-field-id');
    this.txFieldTitle = document.getElementById('tx-field-title');
    this.txFieldAmount = document.getElementById('tx-field-amount');
    this.txFieldDate = document.getElementById('tx-field-date');
    this.txFieldCategory = document.getElementById('tx-field-category');
    this.txFieldNotes = document.getElementById('tx-field-notes');
    this.txCategoryPicker = document.getElementById('tx-category-picker');

    this.txErrTitle = document.getElementById('tx-err-title');
    this.txErrAmount = document.getElementById('tx-err-amount');
    this.txErrDate = document.getElementById('tx-err-date');
    this.txErrCategory = document.getElementById('tx-err-category');

    // Preset Modal
    this.presetModal = document.getElementById('preset-modal');
    this.presetModalClose = document.getElementById('preset-modal-close');
    this.presetModalCancel = document.getElementById('preset-modal-cancel');
    this.presetModalResetDefault = document.getElementById('preset-modal-reset-default');
    this.presetInputsContainer = document.getElementById('preset-inputs-container');
    this.presetEditForm = document.getElementById('preset-edit-form');

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

    // Onboarding Modal
    this.onboardingModal = document.getElementById('onboarding-modal');
    this.btnOnboardDemo = document.getElementById('btn-onboard-demo');
    this.onboardCustomForm = document.getElementById('onboard-custom-form');
    this.onboardInitialBalance = document.getElementById('onboard-initial-balance');
    this.onboardMonthlyIncome = document.getElementById('onboard-monthly-income');
    this.onboardTargetMonth = document.getElementById('onboard-target-month');

    // Initial Budget Edit Modal
    this.initialBudgetModal = document.getElementById('initial-budget-modal');
    this.initialBudgetModalClose = document.getElementById('initial-budget-modal-close');
    this.initialBudgetModalCancel = document.getElementById('initial-budget-modal-cancel');
    this.initialBudgetForm = document.getElementById('initial-budget-form');
    this.editInitialBalance = document.getElementById('edit-initial-balance');
    this.editMonthlyIncome = document.getElementById('edit-monthly-income');
    this.editTargetMonth = document.getElementById('edit-target-month');

    // Auth Modal (Google & Guest)
    this.authModal = document.getElementById('auth-modal');
    this.authModalClose = document.getElementById('auth-modal-close');
    this.authModalCancel = document.getElementById('auth-modal-cancel');
    this.btnAuthGoogle = document.getElementById('btn-auth-google');
    this.btnAuthGoogleText = document.getElementById('btn-auth-google-text');
    this.btnAuthGuest = document.getElementById('btn-auth-guest');
    this.authErrorBox = document.getElementById('auth-error-box');
    this.authErrorMsg = document.getElementById('auth-error-msg');
    this.authForm = document.getElementById('auth-form');
    this.authEmailInput = document.getElementById('auth-email-input');
    this.authSuccessBox = document.getElementById('auth-success-box');
    this.authBtnSubmit = document.getElementById('auth-btn-submit');
    this.authBtnText = document.getElementById('auth-btn-text');

    // Planned Cashflow Manager Modal (FAZ 5.5C)
    this.cashflowManagerModal = document.getElementById('cashflow-manager-modal');
    this.cashflowManagerTitle = document.getElementById('cashflow-manager-title');
    this.cashflowManagerClose = document.getElementById('cashflow-manager-close');
    this.cashflowManagerBtnDone = document.getElementById('cashflow-manager-btn-done');
    this.btnManagerAddNew = document.getElementById('btn-manager-add-new');
    this.cashflowListContainer = document.getElementById('cashflow-list-container');
    this.cashflowManagerEmpty = document.getElementById('cashflow-manager-empty');

    // Planned Cashflow Add/Edit Modal (FAZ 5.5C)
    this.cashflowModal = document.getElementById('cashflow-modal');
    this.cashflowModalTitle = document.getElementById('cashflow-modal-title');
    this.cashflowModalClose = document.getElementById('cashflow-modal-close');
    this.cashflowForm = document.getElementById('cashflow-form');
    this.cashflowFieldId = document.getElementById('cashflow-field-id');
    this.cfTypeIncomeBtn = document.getElementById('cf-type-income-btn');
    this.cfTypeExpenseBtn = document.getElementById('cf-type-expense-btn');
    this.cashflowFieldType = document.getElementById('cashflow-field-type');
    this.cashflowFieldName = document.getElementById('cashflow-field-name');
    this.cfErrName = document.getElementById('cf-err-name');
    this.cashflowFieldAmount = document.getElementById('cashflow-field-amount');
    this.cfErrAmount = document.getElementById('cf-err-amount');
    this.cfRecurrenceMonthlyBtn = document.getElementById('cf-recurrence-monthly-btn');
    this.cfRecurrenceOnceBtn = document.getElementById('cf-recurrence-once-btn');
    this.cashflowFieldRecurrence = document.getElementById('cashflow-field-recurrence');
    this.cfGroupMonthly = document.getElementById('cf-group-monthly');
    this.cashflowFieldDay = document.getElementById('cashflow-field-day');
    this.cfErrDay = document.getElementById('cf-err-day');
    this.cfGroupOnce = document.getElementById('cf-group-once');
    this.cashflowFieldDate = document.getElementById('cashflow-field-date');
    this.cfErrDate = document.getElementById('cf-err-date');
    this.cfGroupCategory = document.getElementById('cf-group-category');
    this.cashflowFieldCategory = document.getElementById('cashflow-field-category');
    this.cashflowFieldStartDate = document.getElementById('cashflow-field-start-date');
    this.cashflowFieldEndDate = document.getElementById('cashflow-field-end-date');
    this.cashflowFieldActive = document.getElementById('cashflow-field-active');
    this.cashflowBtnCancel = document.getElementById('cashflow-btn-cancel');
    this.cashflowBtnSubmit = document.getElementById('cashflow-btn-submit');

    // What-If Scenario Simulator Modal (FAZ 5.6)
    this.whatifModal = document.getElementById('whatif-modal');
    this.whatifModalClose = document.getElementById('whatif-modal-close');
    this.whatifBtnDone = document.getElementById('whatif-btn-done');
    this.whatifBtnReset = document.getElementById('whatif-btn-reset');

    // What-If Tabs
    this.whatifTabExpense = document.getElementById('whatif-tab-expense');
    this.whatifTabIncome = document.getElementById('whatif-tab-income');
    this.whatifTabPercent = document.getElementById('whatif-tab-percent');
    this.whatifTabDaily = document.getElementById('whatif-tab-daily');
    this.whatifTabs = [this.whatifTabExpense, this.whatifTabIncome, this.whatifTabPercent, this.whatifTabDaily].filter(Boolean);

    // What-If Sections
    this.whatifSectionExpense = document.getElementById('whatif-section-expense');
    this.whatifSectionIncome = document.getElementById('whatif-section-income');
    this.whatifSectionPercent = document.getElementById('whatif-section-percent');
    this.whatifSectionDaily = document.getElementById('whatif-section-daily');

    // What-If Inputs
    this.whatifInputExpense = document.getElementById('whatif-input-expense');
    this.whatifInputIncome = document.getElementById('whatif-input-income');
    this.whatifInputPercent = document.getElementById('whatif-input-percent');
    this.whatifPercentDirDown = document.getElementById('whatif-percent-dir-down');
    this.whatifPercentDirUp = document.getElementById('whatif-percent-dir-up');
    this.whatifPercentInterpretation = document.getElementById('whatif-percent-interpretation');
    this.whatifInputDaily = document.getElementById('whatif-input-daily');
    this.whatifDailyDirDown = document.getElementById('whatif-daily-dir-down');
    this.whatifDailyDirUp = document.getElementById('whatif-daily-dir-up');
    this.whatifDailyInterpretation = document.getElementById('whatif-daily-interpretation');

    // What-If Results
    this.whatifImpactCard = document.getElementById('whatif-impact-card');
    this.whatifImpactIconBox = document.getElementById('whatif-impact-icon-box');
    this.whatifImpactIcon = document.getElementById('whatif-impact-icon');
    this.whatifImpactText = document.getElementById('whatif-impact-text');
    this.whatifImpactBadge = document.getElementById('whatif-impact-badge');
    this.whatifBaseExpense = document.getElementById('whatif-base-expense');
    this.whatifSimExpense = document.getElementById('whatif-sim-expense');
    this.whatifDeltaExpense = document.getElementById('whatif-delta-expense');
    this.whatifBaseRemaining = document.getElementById('whatif-base-remaining');
    this.whatifSimRemaining = document.getElementById('whatif-sim-remaining');
    this.whatifDeltaRemaining = document.getElementById('whatif-delta-remaining');
    this.whatifBaseBalance = document.getElementById('whatif-base-balance');
    this.whatifSimBalance = document.getElementById('whatif-sim-balance');
    this.whatifDeltaBalance = document.getElementById('whatif-delta-balance');
    this.whatifBaseRate = document.getElementById('whatif-base-rate');
    this.whatifSimRate = document.getElementById('whatif-sim-rate');
    this.whatifDeltaRate = document.getElementById('whatif-delta-rate');
    this.whatifAssumptionsList = document.getElementById('whatif-assumptions-list');
  }

  bindEvents() {
    // Transaction Modal
    if (this.modalBtnClose) this.modalBtnClose.addEventListener('click', () => this.closeTransactionModal());
    if (this.modalBtnCancel) this.modalBtnCancel.addEventListener('click', () => this.closeTransactionModal());
    if (this.txTypeExpenseBtn) this.txTypeExpenseBtn.addEventListener('click', () => this.setTransactionType('expense'));
    if (this.txTypeIncomeBtn) this.txTypeIncomeBtn.addEventListener('click', () => this.setTransactionType('income'));
    if (this.txForm) this.txForm.addEventListener('submit', (e) => this.handleTransactionFormSubmit(e));

    // Preset Modal
    if (this.presetModalClose) this.presetModalClose.addEventListener('click', () => this.closePresetModal());
    if (this.presetModalCancel) this.presetModalCancel.addEventListener('click', () => this.closePresetModal());
    if (this.presetModalResetDefault) this.presetModalResetDefault.addEventListener('click', () => this.resetPresetsToDefault());
    if (this.presetEditForm) this.presetEditForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handlePresetFormSubmit();
    });

    // Initial Budget Edit Modal
    if (this.initialBudgetModalClose) this.initialBudgetModalClose.addEventListener('click', () => this.closeInitialBudgetModal());
    if (this.initialBudgetModalCancel) this.initialBudgetModalCancel.addEventListener('click', () => this.closeInitialBudgetModal());
    if (this.initialBudgetForm) {
      this.initialBudgetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleInitialBudgetFormSubmit();
      });
    }

    // Import Modal
    if (this.importModalClose) this.importModalClose.addEventListener('click', () => this.closeImportModal());
    if (this.importModalCancel) this.importModalCancel.addEventListener('click', () => this.closeImportModal());
    if (this.importModalConfirm) this.importModalConfirm.addEventListener('click', () => this.handleImportConfirm());

    // Confirm Modal
    if (this.confirmModalCancel) this.confirmModalCancel.addEventListener('click', () => this.closeConfirmModal());
    if (this.confirmModalAction) this.confirmModalAction.addEventListener('click', () => {
      if (typeof this.confirmCallback === 'function') {
        this.confirmCallback();
      }
      this.closeConfirmModal();
    });

    // Onboarding Modal
    if (this.btnOnboardDemo) {
      this.btnOnboardDemo.addEventListener('click', () => {
        this.store.startWithDemo();
        this.closeOnboardingModal();
        showToast(t('onboarding.demoCardTitle') + ' yüklendi!', 'success');
      });
    }

    if (this.onboardCustomForm) {
      this.onboardCustomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const initBal = this.onboardInitialBalance?.value ? Number(this.onboardInitialBalance.value) : 0;
        const monInc = this.onboardMonthlyIncome?.value ? Number(this.onboardMonthlyIncome.value) : 0;
        const targetM = this.onboardTargetMonth?.value || getCurrentYearMonth();

        if (initBal < 0 || isNaN(initBal)) {
          showToast('Başlangıç bakiyesi negatif olamaz.', 'error');
          return;
        }
        if (monInc < 0 || isNaN(monInc)) {
          showToast('Aylık gelir negatif olamaz.', 'error');
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

    // Auth Modal (Google & Guest)
    if (this.authModalClose) this.authModalClose.addEventListener('click', () => this.closeAuthModal());
    if (this.authModalCancel) this.authModalCancel.addEventListener('click', () => this.closeAuthModal());
    if (this.btnAuthGoogle) {
      this.btnAuthGoogle.addEventListener('click', () => this.handleGoogleSignIn());
    }
    if (this.btnAuthGuest) {
      this.btnAuthGuest.addEventListener('click', () => this.handleGuestContinue());
    }
    if (this.authForm) {
      this.authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAuthFormSubmit();
      });
    }

    // Planned Cashflow Modals (FAZ 5.5C)
    if (this.cashflowManagerClose) this.cashflowManagerClose.addEventListener('click', () => this.closeCashflowManagerModal());
    if (this.cashflowManagerBtnDone) this.cashflowManagerBtnDone.addEventListener('click', () => this.closeCashflowManagerModal());
    if (this.btnManagerAddNew) this.btnManagerAddNew.addEventListener('click', () => this.openCashflowModal('add'));
    if (this.cashflowModalClose) this.cashflowModalClose.addEventListener('click', () => this.closeCashflowModal());
    if (this.cashflowBtnCancel) this.cashflowBtnCancel.addEventListener('click', () => this.closeCashflowModal());
    if (this.cfTypeIncomeBtn) this.cfTypeIncomeBtn.addEventListener('click', () => this.setCashflowType('income'));
    if (this.cfTypeExpenseBtn) this.cfTypeExpenseBtn.addEventListener('click', () => this.setCashflowType('expense'));
    if (this.cfRecurrenceMonthlyBtn) this.cfRecurrenceMonthlyBtn.addEventListener('click', () => this.setCashflowRecurrence('monthly'));
    if (this.cfRecurrenceOnceBtn) this.cfRecurrenceOnceBtn.addEventListener('click', () => this.setCashflowRecurrence('once'));
    if (this.cashflowForm) {
      this.cashflowForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleCashflowFormSubmit();
      });
    }

    // What-If Scenario Simulator Modal Events (FAZ 5.6)
    if (this.whatifModalClose) this.whatifModalClose.addEventListener('click', () => this.closeWhatIfModal());
    if (this.whatifBtnDone) this.whatifBtnDone.addEventListener('click', () => this.closeWhatIfModal());
    if (this.whatifBtnReset) this.whatifBtnReset.addEventListener('click', () => this.resetWhatIfSimulation());

    // What-If Tab Switching
    this.whatifTabs.forEach(tab => {
      if (tab) {
        tab.addEventListener('click', () => {
          const type = tab.getAttribute('data-type');
          if (type) this.setWhatIfScenarioType(type);
        });
      }
    });

    // What-If Reactive Input Listeners
    [this.whatifInputExpense, this.whatifInputIncome, this.whatifInputPercent, this.whatifInputDaily].forEach(input => {
      if (input) {
        input.addEventListener('input', () => this.runWhatIfSimulation());
      }
    });

    // What-If Direction Buttons
    if (this.whatifPercentDirDown) {
      this.whatifPercentDirDown.addEventListener('click', () => this.setWhatIfPercentDirection('down'));
    }
    if (this.whatifPercentDirUp) {
      this.whatifPercentDirUp.addEventListener('click', () => this.setWhatIfPercentDirection('up'));
    }
    if (this.whatifDailyDirDown) {
      this.whatifDailyDirDown.addEventListener('click', () => this.setWhatIfDailyDirection('down'));
    }
    if (this.whatifDailyDirUp) {
      this.whatifDailyDirUp.addEventListener('click', () => this.setWhatIfDailyDirection('up'));
    }

    // What-If Chip Presets
    if (this.whatifModal && typeof this.whatifModal.querySelectorAll === 'function') {
      this.whatifModal.querySelectorAll('.whatif-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const targetId = chip.getAttribute('data-target');
          const value = chip.getAttribute('data-value');
          const targetInput = targetId && typeof document !== 'undefined' ? document.getElementById(targetId) : null;
          if (targetInput && value) {
            targetInput.value = value;
            this.runWhatIfSimulation();
          }
        });
      });
    }

    // Modal dışına tıklayınca kapatma & ESC tuşu
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.whatifModal && !this.whatifModal.classList.contains('hidden')) {
            this.closeWhatIfModal();
          } else if (this.cashflowModal && !this.cashflowModal.classList.contains('hidden')) {
            this.closeCashflowModal();
          } else if (this.cashflowManagerModal && !this.cashflowManagerModal.classList.contains('hidden')) {
            this.closeCashflowManagerModal();
          } else if (this.txModal && !this.txModal.classList.contains('hidden')) {
            this.closeTransactionModal();
          } else if (this.importModal && !this.importModal.classList.contains('hidden')) {
            this.closeImportModal();
          } else if (this.confirmModal && !this.confirmModal.classList.contains('hidden')) {
            this.closeConfirmModal();
          } else if (this.presetModal && !this.presetModal.classList.contains('hidden')) {
            this.closePresetModal();
          } else if (this.initialBudgetModal && !this.initialBudgetModal.classList.contains('hidden')) {
            this.closeInitialBudgetModal();
          } else if (this.authModal && !this.authModal.classList.contains('hidden')) {
            this.closeAuthModal();
          }
        }
      });
    }

    [this.txModal, this.importModal, this.confirmModal, this.presetModal, this.initialBudgetModal, this.authModal, this.cashflowManagerModal, this.cashflowModal, this.whatifModal].forEach(modal => {
      if (modal && typeof modal.addEventListener === 'function') {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            if (modal === this.whatifModal) this.closeWhatIfModal();
            else if (modal === this.cashflowModal) this.closeCashflowModal();
            else if (modal === this.cashflowManagerModal) this.closeCashflowManagerModal();
            else if (modal === this.txModal) this.closeTransactionModal();
            else if (modal === this.importModal) this.closeImportModal();
            else if (modal === this.confirmModal) this.closeConfirmModal();
            else if (modal === this.presetModal) this.closePresetModal();
            else if (modal === this.initialBudgetModal) this.closeInitialBudgetModal();
            else if (modal === this.authModal) this.closeAuthModal();
          }
        });
      }
    });
  }

  updateBodyScrollLock() {
    if (typeof document === 'undefined' || !document.body || !document.body.classList) return;
    const modals = [
      this.txModal,
      this.importModal,
      this.confirmModal,
      this.presetModal,
      this.initialBudgetModal,
      this.authModal,
      this.onboardingModal,
      this.cashflowManagerModal,
      this.cashflowModal
    ];
    const isAnyOpen = modals.some(modal => modal && !modal.classList.contains('hidden'));
    if (isAnyOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
  }

  // --- Transaction Modal Methods ---
  openTransactionModal(mode = 'add', prefillData = null) {
    this.lastFocusedElement = document.activeElement;
    if (this.txForm) this.txForm.reset();
    this.clearAllFieldErrors();
    if (this.txFieldId) this.txFieldId.value = '';

    if (mode === 'edit' && prefillData) {
      if (this.modalTitleText) this.modalTitleText.textContent = t('modal.editTitle');
      if (this.txFieldId) this.txFieldId.value = prefillData.id;
      if (this.txFieldTitle) this.txFieldTitle.value = prefillData.title;
      if (this.txFieldAmount) this.txFieldAmount.value = prefillData.amount;
      if (this.txFieldDate) this.txFieldDate.value = prefillData.date;
      if (this.txFieldNotes) this.txFieldNotes.value = prefillData.notes || '';
      this.setTransactionType(prefillData.type, prefillData.categoryId);
    } else {
      if (this.modalTitleText) this.modalTitleText.textContent = t('modal.addTitle');
      const initialType = (prefillData && prefillData.type) || 'expense';
      const initialCat = (prefillData && prefillData.categoryId) || '';
      if (this.txFieldDate) {
        this.txFieldDate.value = (prefillData && prefillData.date) || this.ui.getDefaultTransactionDate();
      }
      if (prefillData && prefillData.title && this.txFieldTitle) {
        this.txFieldTitle.value = prefillData.title;
      }
      if (prefillData && prefillData.amount && this.txFieldAmount) {
        this.txFieldAmount.value = prefillData.amount;
      }
      this.setTransactionType(initialType, initialCat);
    }

    if (this.txModal) {
      this.txModal.classList.remove('hidden');
      setTimeout(() => {
        if (this.txFieldTitle) this.txFieldTitle.focus();
      }, 50);
    }
    this.updateBodyScrollLock();
  }

  closeTransactionModal() {
    if (this.txModal) this.txModal.classList.add('hidden');
    this.updateBodyScrollLock();
    this.clearAllFieldErrors();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  setTransactionType(type, preselectCatId = null) {
    if (!this.txFieldType) return;
    this.txFieldType.value = type;

    if (type === 'expense') {
      this.txTypeExpenseBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg bg-rose-500 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      this.txTypeIncomeBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
    } else {
      this.txTypeIncomeBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg bg-emerald-500 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      this.txTypeExpenseBtn.className = 'type-toggle-btn min-h-[44px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
    }

    this.renderCategoryPicker(type, preselectCatId);
  }

  renderCategoryPicker(type, preselectCatId = null) {
    if (!this.txCategoryPicker) return;
    const categories = this.store.getCategories(type);
    this.txCategoryPicker.innerHTML = '';

    let selectedId = preselectCatId;
    if (!selectedId && categories.length > 0) {
      selectedId = categories[0].id;
    }
    if (this.txFieldCategory) this.txFieldCategory.value = selectedId || '';

    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.catId = cat.id;

      const isSelected = cat.id === selectedId;
      btn.className = `category-btn text-left p-2.5 rounded-xl border text-xs font-medium transition flex items-center space-x-2 ${
        isSelected
          ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 active'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`;

      const translatedName = t(`categories.${cat.id}`);
      const catName = (translatedName !== `categories.${cat.id}`) ? translatedName : cat.name;

      btn.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${cat.color};"></span>
        <span class="truncate">${escapeHtml(catName)}</span>
      `;

      btn.addEventListener('click', () => {
        this.txCategoryPicker.querySelectorAll('.category-btn').forEach(b => {
          b.className = 'category-btn text-left p-2.5 rounded-xl border text-xs font-medium transition flex items-center space-x-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800';
        });
        btn.className = 'category-btn text-left p-2.5 rounded-xl border text-xs font-medium transition flex items-center space-x-2 bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 active';
        if (this.txFieldCategory) this.txFieldCategory.value = cat.id;
        this.clearFieldError(this.txFieldCategory, this.txErrCategory);
      });

      this.txCategoryPicker.appendChild(btn);
    });
  }

  handleTransactionFormSubmit(e) {
    e.preventDefault();
    this.clearAllFieldErrors();

    const title = this.txFieldTitle?.value.trim() || '';
    const amountVal = parseFloat(this.txFieldAmount?.value);
    const dateVal = this.txFieldDate?.value || '';
    const catVal = this.txFieldCategory?.value || '';
    const typeVal = this.txFieldType?.value || 'expense';
    const notesVal = this.txFieldNotes?.value.trim() || '';
    const editingId = this.txFieldId?.value || '';

    let hasError = false;

    if (!title) {
      this.showFieldError(this.txFieldTitle, this.txErrTitle, 'Lütfen işlem başlığı girin.');
      hasError = true;
    }

    if (isNaN(amountVal) || amountVal <= 0) {
      this.showFieldError(this.txFieldAmount, this.txErrAmount, 'Tutar 0\'dan büyük olmalıdır.');
      hasError = true;
    }

    if (!dateVal) {
      this.showFieldError(this.txFieldDate, this.txErrDate, 'Lütfen geçerli bir tarih seçin.');
      hasError = true;
    }

    if (!catVal) {
      this.showFieldError(this.txFieldCategory, this.txErrCategory, 'Lütfen bir kategori seçin.');
      hasError = true;
    }

    if (hasError) return;

    try {
      if (editingId) {
        this.store.updateTransaction(editingId, {
          title,
          amount: amountVal,
          date: dateVal,
          type: typeVal,
          categoryId: catVal,
          notes: notesVal
        });
        showToast('İşlem başarıyla güncellendi.', 'success');
      } else {
        this.store.addTransaction({
          title,
          amount: amountVal,
          date: dateVal,
          type: typeVal,
          categoryId: catVal,
          notes: notesVal
        });
        showToast('Yeni işlem başarıyla kaydedildi.', 'success');
      }

      this.closeTransactionModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  showFieldError(inputEl, errEl, message) {
    if (inputEl) inputEl.classList.add('input-error');
    if (errEl) {
      const txt = errEl.querySelector('.err-text');
      if (txt) txt.textContent = message;
      errEl.classList.remove('hidden');
    }
  }

  clearFieldError(inputEl, errEl) {
    if (inputEl) inputEl.classList.remove('input-error');
    if (errEl) errEl.classList.add('hidden');
  }

  clearAllFieldErrors() {
    [this.txFieldTitle, this.txFieldAmount, this.txFieldDate].forEach(el => {
      if (el) el.classList.remove('input-error');
    });
    [this.txErrTitle, this.txErrAmount, this.txErrDate, this.txErrCategory].forEach(el => {
      if (el) el.classList.add('hidden');
    });
  }

  // --- Preset Modal Methods ---
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
    this.updateBodyScrollLock();
    const firstInput = this.presetInputsContainer.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  closePresetModal() {
    if (this.presetModal) this.presetModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  resetPresetsToDefault() {
    this.store.updatePresets([...DEFAULT_PRESETS]);
    this.ui.renderQuickPresets();
    this.openPresetModal();
    showToast(t('presets.resetSuccess'), 'info');
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
    this.ui.renderQuickPresets();
    this.closePresetModal();
    showToast(t('presets.savedSuccess'), 'success');
  }

  // --- Import Modal Methods ---
  openImportModal() {
    this.lastFocusedElement = document.activeElement;
    if (this.importFileInput) this.importFileInput.value = '';
    if (this.importFileError) this.importFileError.classList.add('hidden');
    if (this.importModal) this.importModal.classList.remove('hidden');
    this.updateBodyScrollLock();
  }

  closeImportModal() {
    if (this.importModal) this.importModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  handleImportConfirm() {
    const file = this.importFileInput?.files?.[0];
    if (!file) {
      if (this.importFileError) {
        const txt = this.importFileError.querySelector('.err-text');
        if (txt) txt.textContent = 'Lütfen geçerli bir .json dosyası seçin.';
        this.importFileError.classList.remove('hidden');
      }
      return;
    }

    const modeInput = document.querySelector('input[name="import-mode"]:checked');
    const mode = modeInput ? modeInput.value : 'merge';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        this.store.importData(json, mode);
        this.closeImportModal();
        showToast(mode === 'replace' ? t('importModal.successReplace') : t('importModal.successMerge'), 'success');
      } catch (err) {
        if (this.importFileError) {
          const txt = this.importFileError.querySelector('.err-text');
          if (txt) txt.textContent = err.message || 'Dosya okunamadı veya biçim geçersiz.';
          this.importFileError.classList.remove('hidden');
        }
      }
    };
    reader.onerror = () => {
      if (this.importFileError) {
        const txt = this.importFileError.querySelector('.err-text');
        if (txt) txt.textContent = 'Dosya okuma sırasında bir hata oluştu.';
        this.importFileError.classList.remove('hidden');
      }
    };
    reader.readAsText(file);
  }

  // --- Confirm Modal Methods ---
  openConfirmModal({ title, desc, onConfirm, actionText = (t('confirmModal.confirmDelete') || 'Sil / Onayla') }) {
    this.lastFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;
    if (this.confirmModalTitle) this.confirmModalTitle.textContent = title || t('confirmModal.title');
    if (this.confirmModalDesc) this.confirmModalDesc.textContent = desc || t('confirmModal.desc');
    if (this.confirmModalAction) this.confirmModalAction.textContent = actionText;
    this.confirmCallback = onConfirm;
    if (this.confirmModal) this.confirmModal.classList.remove('hidden');
    this.updateBodyScrollLock();
  }

  closeConfirmModal() {
    if (this.confirmModal) this.confirmModal.classList.add('hidden');
    this.updateBodyScrollLock();
    this.confirmCallback = null;
    if (this.confirmModalTitle) this.confirmModalTitle.textContent = t('confirmModal.title');
    if (this.confirmModalDesc) this.confirmModalDesc.textContent = t('confirmModal.desc');
    if (this.confirmModalAction) this.confirmModalAction.textContent = t('confirmModal.confirmDelete') || 'Sil / Onayla';
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  // --- Onboarding Modal Methods ---
  openOnboardingModal() {
    this.openAuthModal();
    if (this.onboardingModal) {
      this.onboardingModal.classList.add('hidden');
    }
    this.updateBodyScrollLock();
  }

  closeOnboardingModal() {
    this.closeAuthModal();
    if (this.onboardingModal) {
      this.onboardingModal.classList.add('hidden');
    }
    this.updateBodyScrollLock();
  }

  // --- Initial Budget Edit Modal Methods ---
  openInitialBudgetModal() {
    this.lastFocusedElement = document.activeElement;
    if (!this.initialBudgetModal) return;

    const data = this.store.getInitialBudget();
    if (this.editInitialBalance) this.editInitialBalance.value = data.initialBalance > 0 ? data.initialBalance : '';
    if (this.editMonthlyIncome) this.editMonthlyIncome.value = data.monthlyIncome > 0 ? data.monthlyIncome : '';
    if (this.editTargetMonth) this.editTargetMonth.value = data.targetMonth || getCurrentYearMonth();

    this.initialBudgetModal.classList.remove('hidden');
    this.updateBodyScrollLock();
    if (this.editInitialBalance) setTimeout(() => this.editInitialBalance.focus(), 50);
  }

  closeInitialBudgetModal() {
    if (this.initialBudgetModal) this.initialBudgetModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  handleInitialBudgetFormSubmit() {
    const initBal = this.editInitialBalance?.value ? Number(this.editInitialBalance.value) : 0;
    const monInc = this.editMonthlyIncome?.value ? Number(this.editMonthlyIncome.value) : 0;
    const targetM = this.editTargetMonth?.value || getCurrentYearMonth();

    if (initBal < 0 || isNaN(initBal)) {
      showToast('Başlangıç bakiyesi negatif olamaz.', 'error');
      return;
    }
    if (monInc < 0 || isNaN(monInc)) {
      showToast('Aylık gelir negatif olamaz.', 'error');
      return;
    }

    this.store.updateInitialBudget({
      initialBalance: initBal,
      monthlyIncome: monInc,
      targetMonth: targetM
    });

    this.closeInitialBudgetModal();
    showToast(t('initialBudgetModal.success'), 'success');
  }

  // --- Auth Modal Methods (Google & Guest) ---
  openAuthModal() {
    this.lastFocusedElement = document.activeElement;
    if (!this.authModal) return;

    if (this.authErrorBox) this.authErrorBox.classList.add('hidden');
    if (this.authErrorMsg) this.authErrorMsg.textContent = '';
    if (this.btnAuthGoogle) this.btnAuthGoogle.disabled = false;
    if (this.btnAuthGoogleText) this.btnAuthGoogleText.textContent = t('auth.googleBtn');

    this.authModal.classList.remove('hidden');
    this.updateBodyScrollLock();
    if (this.btnAuthGoogle) setTimeout(() => this.btnAuthGoogle.focus(), 50);
  }

  closeAuthModal() {
    if (this.authModal) this.authModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  async handleGoogleSignIn() {
    try {
      if (this.btnAuthGoogle) this.btnAuthGoogle.disabled = true;
      if (this.btnAuthGoogleText) this.btnAuthGoogleText.textContent = t('auth.redirecting') || 'Yönlendiriliyor...';
      if (this.authErrorBox) this.authErrorBox.classList.add('hidden');

      await authService.signInWithGoogle();
    } catch (err) {
      if (this.btnAuthGoogle) this.btnAuthGoogle.disabled = false;
      if (this.btnAuthGoogleText) this.btnAuthGoogleText.textContent = t('auth.googleBtn');
      if (this.authErrorMsg) {
        this.authErrorMsg.textContent = err.message || 'Google ile giriş başlatılamadı.';
      }
      if (this.authErrorBox) this.authErrorBox.classList.remove('hidden');
      showToast(err.message || 'Google girişi başlatılamadı.', 'error');
    }
  }

  handleGuestContinue() {
    this.store.state.onboarded = true;
    this.store.saveToStorage();
    this.closeAuthModal();
    this.closeOnboardingModal();
    this.store.notify();
    showToast(t('auth.guestSubtext') || 'Verileriniz yalnızca bu cihazda saklanır.', 'info');
  }

  async handleAuthFormSubmit() {
    const email = this.authEmailInput?.value?.trim();
    if (!email) return;

    try {
      if (this.authBtnSubmit) this.authBtnSubmit.disabled = true;
      if (this.authBtnText) this.authBtnText.textContent = t('auth.sending');
      if (this.authErrorMsg) this.authErrorMsg.classList.add('hidden');

      await authService.signInWithMagicLink(email);

      if (this.authSuccessBox) this.authSuccessBox.classList.remove('hidden');
      if (this.authBtnText) this.authBtnText.textContent = t('auth.resend');
      if (this.authBtnSubmit) this.authBtnSubmit.disabled = false;
      showToast(t('auth.magicLinkSent'), 'success');
    } catch (err) {
      if (this.authErrorMsg) {
        this.authErrorMsg.textContent = err.message || 'Giriş bağlantısı gönderilemedi.';
        this.authErrorMsg.classList.remove('hidden');
      }
      if (this.authBtnSubmit) this.authBtnSubmit.disabled = false;
      if (this.authBtnText) this.authBtnText.textContent = t('auth.sendMagicLink');
      showToast(err.message, 'error');
    }
  }

  // --- Planned Cashflow Manager Modal Methods (FAZ 5.5C) ---
  openCashflowManagerModal() {
    this.lastFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;
    this.renderCashflowManagerList();
    if (this.cashflowManagerModal) this.cashflowManagerModal.classList.remove('hidden');
    this.updateBodyScrollLock();
  }

  closeCashflowManagerModal() {
    if (this.cashflowManagerModal) this.cashflowManagerModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  renderCashflowManagerList() {
    if (!this.cashflowListContainer) return;
    const items = this.store.getPlannedCashflows ? this.store.getPlannedCashflows() : [];
    const settings = this.store.getSettings ? this.store.getSettings() : {};
    const currency = settings.currency || 'TRY';
    const lang = this.ui?.selectedMonth ? (this.store.getSettings?.()?.language || 'tr') : 'tr';

    if (items.length === 0) {
      this.cashflowListContainer.innerHTML = '';
      if (this.cashflowManagerEmpty) this.cashflowManagerEmpty.classList.remove('hidden');
      return;
    }

    if (this.cashflowManagerEmpty) this.cashflowManagerEmpty.classList.add('hidden');

    this.cashflowListContainer.innerHTML = items.map(item => {
      const isInc = item.type === 'income';
      const recurrenceStr = item.recurrence === 'monthly'
        ? (t('cashflow.monthlyBadge', { day: item.dayOfMonth }) || `Her ayın ${item.dayOfMonth}'i`)
        : (t('cashflow.onceBadge', { date: item.date || '' }) || `${item.date || ''} (Tek Seferlik)`);
      const formattedAmount = (isInc ? '+' : '-') + formatCurrency(item.amount, currency, lang);
      const badgeTypeClass = isInc
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
      const amountColorClass = isInc
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400';

      return `
        <div class="py-3 flex items-center justify-between gap-3 ${!item.isActive ? 'opacity-50' : ''}" data-cashflow-id="${item.id}">
          <div class="min-w-0 flex-1">
            <div class="flex items-center space-x-2 flex-wrap gap-y-1">
              <span class="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">${escapeHtml(item.name)}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeTypeClass}">
                ${isInc ? (t('cashflow.income') || 'Gelir (+)') : (t('cashflow.expense') || 'Gider (-)')}
              </span>
              <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                ${recurrenceStr}
              </span>
            </div>
            <div class="mt-1 flex items-center space-x-2 text-xs">
              <span class="font-extrabold ${amountColorClass}">
                ${formattedAmount}
              </span>
              <span class="text-slate-400 text-[11px]">•</span>
              <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                ${item.isActive ? (t('cashflow.activeBadge') || 'Aktif') : (t('cashflow.inactiveBadge') || 'Pasif')}
              </span>
            </div>
          </div>
          <div class="flex items-center space-x-1 shrink-0">
            <label class="relative inline-flex items-center cursor-pointer mr-1" title="${t('cashflow.toggleStatus') || 'Durumu Değiştir'}">
              <input type="checkbox" class="sr-only peer cf-toggle-active-btn" data-id="${item.id}" ${item.isActive ? 'checked' : ''} aria-label="${t('cashflow.toggleStatus') || 'Durumu Değiştir'}">
              <div class="w-8 h-4 bg-slate-300 peer-focus:outline-hidden rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
            <button type="button" class="cf-edit-btn min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition" data-id="${item.id}" aria-label="${t('cashflow.editBtn') || 'Düzenle'}" title="${t('cashflow.editBtn') || 'Düzenle'}">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button type="button" class="cf-delete-btn min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition" data-id="${item.id}" aria-label="${t('cashflow.deleteBtn') || 'Sil'}" title="${t('cashflow.deleteBtn') || 'Sil'}">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.cashflowListContainer.querySelectorAll('.cf-toggle-active-btn').forEach(btn => {
      btn.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const item = items.find(i => i.id === id);
        if (item) {
          this.store.updatePlannedCashflow(id, { isActive: !item.isActive });
          this.renderCashflowManagerList();
        }
      });
    });

    this.cashflowListContainer.querySelectorAll('.cf-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = items.find(i => i.id === id);
        if (item) {
          this.openCashflowModal('edit', item);
        }
      });
    });

    this.cashflowListContainer.querySelectorAll('.cf-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this.requestDeletePlannedCashflow(id);
      });
    });

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  requestDeletePlannedCashflow(id) {
    const item = this.store.getPlannedCashflowById(id);
    if (!item) return;
    this.openConfirmModal({
      title: t('cashflow.deleteConfirmTitle') || 'Planı Sil',
      desc: t('cashflow.deleteConfirmDesc', { name: item.name }) || `"${item.name}" planını silmek istediğinize emin misiniz?`,
      actionText: t('cashflow.deleteBtn') || 'Sil',
      onConfirm: () => {
        this.store.deletePlannedCashflow(item.id);
        this.renderCashflowManagerList();
        showToast(t('cashflow.deletedSuccess') || 'Planlı nakit akışı silindi.', 'success');
      }
    });
  }

  // --- Planned Cashflow Add/Edit Modal Methods (FAZ 5.5C) ---
  openCashflowModal(mode = 'add', prefillData = null) {
    this.lastFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;
    this.clearCashflowFieldErrors();

    if (this.cashflowModalTitle) {
      this.cashflowModalTitle.textContent = mode === 'edit'
        ? (t('cashflow.editTitle') || 'Planlı Akışı Düzenle')
        : (t('cashflow.addTitle') || 'Yeni Planlı Akış Ekle');
    }

    if (mode === 'edit' && prefillData) {
      if (this.cashflowFieldId) this.cashflowFieldId.value = prefillData.id || '';
      if (this.cashflowFieldName) this.cashflowFieldName.value = prefillData.name || '';
      if (this.cashflowFieldAmount) this.cashflowFieldAmount.value = prefillData.amount || '';
      this.setCashflowType(prefillData.type || 'income');
      this.setCashflowRecurrence(prefillData.recurrence || 'monthly');
      if (this.cashflowFieldDay) this.cashflowFieldDay.value = prefillData.dayOfMonth || '';
      if (this.cashflowFieldDate) this.cashflowFieldDate.value = prefillData.date || '';
      this.populateCashflowCategorySelect(prefillData.categoryId);
      if (this.cashflowFieldStartDate) this.cashflowFieldStartDate.value = prefillData.startDate || '';
      if (this.cashflowFieldEndDate) this.cashflowFieldEndDate.value = prefillData.endDate || '';
      if (this.cashflowFieldActive) this.cashflowFieldActive.checked = prefillData.isActive !== false;
    } else {
      if (this.cashflowFieldId) this.cashflowFieldId.value = '';
      if (this.cashflowFieldName) this.cashflowFieldName.value = '';
      if (this.cashflowFieldAmount) this.cashflowFieldAmount.value = '';
      this.setCashflowType('income');
      this.setCashflowRecurrence('monthly');
      if (this.cashflowFieldDay) this.cashflowFieldDay.value = '';
      if (this.cashflowFieldDate) this.cashflowFieldDate.value = '';
      this.populateCashflowCategorySelect(null);
      if (this.cashflowFieldStartDate) this.cashflowFieldStartDate.value = '';
      if (this.cashflowFieldEndDate) this.cashflowFieldEndDate.value = '';
      if (this.cashflowFieldActive) this.cashflowFieldActive.checked = true;
    }

    if (this.cashflowModal) {
      this.cashflowModal.classList.remove('hidden');
      setTimeout(() => {
        if (this.cashflowFieldName) this.cashflowFieldName.focus();
      }, 50);
    }
    this.updateBodyScrollLock();
  }

  closeCashflowModal() {
    if (this.cashflowModal) this.cashflowModal.classList.add('hidden');
    this.updateBodyScrollLock();
    this.clearCashflowFieldErrors();

    if (this.cashflowManagerModal && !this.cashflowManagerModal.classList.contains('hidden')) {
      this.renderCashflowManagerList();
    } else if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  setCashflowType(type) {
    if (!this.cashflowFieldType) return;
    this.cashflowFieldType.value = type;

    if (type === 'income') {
      if (this.cfTypeIncomeBtn) this.cfTypeIncomeBtn.className = 'min-h-[40px] py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      if (this.cfTypeExpenseBtn) this.cfTypeExpenseBtn.className = 'min-h-[40px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
      if (this.cfGroupCategory) this.cfGroupCategory.classList.add('hidden');
    } else {
      if (this.cfTypeExpenseBtn) this.cfTypeExpenseBtn.className = 'min-h-[40px] py-2 text-xs font-bold rounded-lg bg-rose-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      if (this.cfTypeIncomeBtn) this.cfTypeIncomeBtn.className = 'min-h-[40px] py-2 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
      if (this.cfGroupCategory) this.cfGroupCategory.classList.remove('hidden');
      this.populateCashflowCategorySelect();
    }
  }

  setCashflowRecurrence(recurrence) {
    if (!this.cashflowFieldRecurrence) return;
    this.cashflowFieldRecurrence.value = recurrence;

    if (recurrence === 'monthly') {
      if (this.cfRecurrenceMonthlyBtn) this.cfRecurrenceMonthlyBtn.className = 'min-h-[38px] py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      if (this.cfRecurrenceOnceBtn) this.cfRecurrenceOnceBtn.className = 'min-h-[38px] py-1.5 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
      if (this.cfGroupMonthly) this.cfGroupMonthly.classList.remove('hidden');
      if (this.cfGroupOnce) this.cfGroupOnce.classList.add('hidden');
    } else {
      if (this.cfRecurrenceOnceBtn) this.cfRecurrenceOnceBtn.className = 'min-h-[38px] py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-xs transition flex items-center justify-center space-x-1.5';
      if (this.cfRecurrenceMonthlyBtn) this.cfRecurrenceMonthlyBtn.className = 'min-h-[38px] py-1.5 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center space-x-1.5';
      if (this.cfGroupMonthly) this.cfGroupMonthly.classList.add('hidden');
      if (this.cfGroupOnce) this.cfGroupOnce.classList.remove('hidden');
    }
  }

  populateCashflowCategorySelect(preselectId = null) {
    if (!this.cashflowFieldCategory) return;
    const cats = this.store.getCategories ? this.store.getCategories('expense') : [];
    this.cashflowFieldCategory.innerHTML = `<option value="">${t('cashflow.optionalCategory') || 'Kategori Seçin (İsteğe Bağlı)'}</option>`;
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name || c.id;
      if (preselectId && c.id === preselectId) opt.selected = true;
      this.cashflowFieldCategory.appendChild(opt);
    });
  }

  clearCashflowFieldErrors() {
    [this.cfErrName, this.cfErrAmount, this.cfErrDay, this.cfErrDate].forEach(el => {
      if (el) el.classList.add('hidden');
    });
  }

  handleCashflowFormSubmit() {
    this.clearCashflowFieldErrors();

    const id = this.cashflowFieldId?.value?.trim() || null;
    const name = this.cashflowFieldName?.value?.trim() || '';
    const rawAmount = this.cashflowFieldAmount?.value;
    const amount = rawAmount ? Number(rawAmount) : NaN;
    const type = this.cashflowFieldType?.value || 'income';
    const recurrence = this.cashflowFieldRecurrence?.value || 'monthly';
    const rawDay = this.cashflowFieldDay?.value;
    const dayOfMonth = recurrence === 'monthly' ? parseInt(rawDay, 10) : undefined;
    const date = recurrence === 'once' ? (this.cashflowFieldDate?.value || '') : undefined;
    const categoryId = type === 'expense' ? (this.cashflowFieldCategory?.value || undefined) : undefined;
    const startDate = this.cashflowFieldStartDate?.value || undefined;
    const endDate = this.cashflowFieldEndDate?.value || undefined;
    const isActive = this.cashflowFieldActive ? this.cashflowFieldActive.checked : true;

    let hasError = false;

    if (!name) {
      if (this.cfErrName) {
        const span = this.cfErrName.querySelector('.err-text');
        if (span) span.textContent = t('cashflow.errNameRequired') || 'Lütfen plan adı girin.';
        this.cfErrName.classList.remove('hidden');
      }
      hasError = true;
    }

    if (isNaN(amount) || amount <= 0) {
      if (this.cfErrAmount) {
        const span = this.cfErrAmount.querySelector('.err-text');
        if (span) span.textContent = t('cashflow.errAmountPositive') || 'Tutar 0\'dan büyük olmalıdır.';
        this.cfErrAmount.classList.remove('hidden');
      }
      hasError = true;
    }

    if (recurrence === 'monthly') {
      if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        if (this.cfErrDay) {
          const span = this.cfErrDay.querySelector('.err-text');
          if (span) span.textContent = t('cashflow.errDayInvalid') || 'Lütfen ayın 1 ile 31 arasında geçerli bir gününü seçin.';
          this.cfErrDay.classList.remove('hidden');
        }
        hasError = true;
      }
    } else if (recurrence === 'once') {
      if (!date) {
        if (this.cfErrDate) {
          const span = this.cfErrDate.querySelector('.err-text');
          if (span) span.textContent = t('cashflow.errDateRequired') || 'Lütfen tek seferlik akış için bir tarih seçin.';
          this.cfErrDate.classList.remove('hidden');
        }
        hasError = true;
      }
    }

    if (hasError) return;

    try {
      const payload = {
        name,
        type,
        amount,
        recurrence,
        dayOfMonth: recurrence === 'monthly' ? dayOfMonth : undefined,
        date: recurrence === 'once' ? date : undefined,
        categoryId,
        startDate,
        endDate,
        isActive
      };

      if (id) {
        this.store.updatePlannedCashflow(id, payload);
      } else {
        this.store.addPlannedCashflow(payload);
      }

      this.closeCashflowModal();
      showToast(t('cashflow.savedSuccess') || 'Planlı nakit akışı başarıyla kaydedildi.', 'success');
    } catch (err) {
      showToast(err.message || 'Hata oluştu', 'error');
    }
  }

  // --- What-If Scenario Simulator Modal Methods (FAZ 5.6) ---
  openWhatIfModal() {
    this.lastFocusedElement = typeof document !== 'undefined' ? document.activeElement : null;
    if (this.whatifModal) this.whatifModal.classList.remove('hidden');
    this.updateBodyScrollLock();
    if (!this.currentWhatIfType) {
      this.currentWhatIfType = SCENARIO_TYPES.ONE_TIME_EXPENSE;
    }
    this.setWhatIfScenarioType(this.currentWhatIfType);
  }

  closeWhatIfModal() {
    if (this.whatifModal) this.whatifModal.classList.add('hidden');
    this.updateBodyScrollLock();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  setWhatIfScenarioType(type) {
    this.currentWhatIfType = type;
    const activeClass = 'whatif-tab px-2.5 py-1.5 rounded-lg text-center transition bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-300 font-bold shadow-xs';
    const inactiveClass = 'whatif-tab px-2.5 py-1.5 rounded-lg text-center transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';

    const tabMap = {
      [SCENARIO_TYPES.ONE_TIME_EXPENSE]: this.whatifTabExpense,
      [SCENARIO_TYPES.ONE_TIME_INCOME]: this.whatifTabIncome,
      [SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE]: this.whatifTabPercent,
      [SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE]: this.whatifTabDaily
    };

    Object.entries(tabMap).forEach(([tType, el]) => {
      if (!el) return;
      el.className = (tType === type) ? activeClass : inactiveClass;
    });

    const sectionMap = {
      [SCENARIO_TYPES.ONE_TIME_EXPENSE]: this.whatifSectionExpense,
      [SCENARIO_TYPES.ONE_TIME_INCOME]: this.whatifSectionIncome,
      [SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE]: this.whatifSectionPercent,
      [SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE]: this.whatifSectionDaily
    };

    Object.entries(sectionMap).forEach(([sType, el]) => {
      if (!el) return;
      if (sType === type) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    this.runWhatIfSimulation();
  }

  setWhatIfPercentDirection(dir) {
    this.whatifPercentDirection = dir;
    if (this.whatifPercentDirDown && this.whatifPercentDirUp) {
      if (dir === 'down') {
        this.whatifPercentDirDown.className = 'flex-1 py-1.5 rounded-lg text-center font-bold bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs transition';
        this.whatifPercentDirUp.className = 'flex-1 py-1.5 rounded-lg text-center font-medium text-slate-600 dark:text-slate-400 transition';
      } else {
        this.whatifPercentDirDown.className = 'flex-1 py-1.5 rounded-lg text-center font-medium text-slate-600 dark:text-slate-400 transition';
        this.whatifPercentDirUp.className = 'flex-1 py-1.5 rounded-lg text-center font-bold bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-xs transition';
      }
    }
    this.runWhatIfSimulation();
  }

  setWhatIfDailyDirection(dir) {
    this.whatifDailyDirection = dir;
    if (this.whatifDailyDirDown && this.whatifDailyDirUp) {
      if (dir === 'down') {
        this.whatifDailyDirDown.className = 'flex-1 py-1.5 rounded-lg text-center font-bold bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs transition';
        this.whatifDailyDirUp.className = 'flex-1 py-1.5 rounded-lg text-center font-medium text-slate-600 dark:text-slate-400 transition';
      } else {
        this.whatifDailyDirDown.className = 'flex-1 py-1.5 rounded-lg text-center font-medium text-slate-600 dark:text-slate-400 transition';
        this.whatifDailyDirUp.className = 'flex-1 py-1.5 rounded-lg text-center font-bold bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-xs transition';
      }
    }
    this.runWhatIfSimulation();
  }

  resetWhatIfSimulation() {
    this.setWhatIfScenarioType(SCENARIO_TYPES.ONE_TIME_EXPENSE);
    if (this.whatifInputExpense) this.whatifInputExpense.value = '';
    if (this.whatifInputIncome) this.whatifInputIncome.value = '';
    if (this.whatifInputPercent) this.whatifInputPercent.value = '';
    if (this.whatifInputDaily) this.whatifInputDaily.value = '';
    this.setWhatIfPercentDirection('down');
    this.setWhatIfDailyDirection('down');
    this.runWhatIfSimulation();
  }

  updateWhatIfInterpretations(currency, lang) {
    if (this.whatifPercentInterpretation) {
      const rawVal = parseFloat(this.whatifInputPercent?.value);
      const val = !isNaN(rawVal) && rawVal > 0 ? rawVal : 20;
      const isDown = this.whatifPercentDirection === 'down';
      this.whatifPercentInterpretation.textContent = isDown
        ? (t('whatif.interpretations.percentDecrease', { percent: val }) || `Kalan günlerde harcama %${val} azalır`)
        : (t('whatif.interpretations.percentIncrease', { percent: val }) || `Kalan günlerde harcama %${val} artar`);
    }

    if (this.whatifDailyInterpretation) {
      const rawVal = parseFloat(this.whatifInputDaily?.value);
      const val = !isNaN(rawVal) && rawVal > 0 ? rawVal : 100;
      const isLess = this.whatifDailyDirection === 'down';
      const formatted = formatCurrency(val, currency, lang);
      this.whatifDailyInterpretation.textContent = isLess
        ? (t('whatif.interpretations.dailyLess', { amount: formatted }) || `Her gün ${formatted} daha az harcarsam`)
        : (t('whatif.interpretations.dailyMore', { amount: formatted }) || `Her gün ${formatted} daha fazla harcarsam`);
    }
  }

  runWhatIfSimulation() {
    const transactions = this.store.getTransactions ? this.store.getTransactions() : [];
    const settings = this.store.getSettings ? this.store.getSettings() : {};
    const currency = settings.currency || 'TRY';
    const lang = settings.language || 'tr';

    // Live reference date (safeNow) & current calendar month
    const validNow = this.ui?.now instanceof Date ? this.ui.now : new Date();
    const safeNow = isNaN(validNow.getTime()) ? new Date() : validNow;
    const currentYearMonth = getCurrentYearMonth(safeNow);

    // Live balance from current month summary
    const summary = calculateSummary(transactions, safeNow, currentYearMonth);
    const currentAvailableBalance = summary.balance;

    let scenario = null;
    let hasValidInput = false;

    if (this.currentWhatIfType === SCENARIO_TYPES.ONE_TIME_EXPENSE) {
      const val = parseFloat(this.whatifInputExpense?.value);
      if (!isNaN(val) && val > 0) {
        scenario = { type: SCENARIO_TYPES.ONE_TIME_EXPENSE, amount: val };
        hasValidInput = true;
      }
    } else if (this.currentWhatIfType === SCENARIO_TYPES.ONE_TIME_INCOME) {
      const val = parseFloat(this.whatifInputIncome?.value);
      if (!isNaN(val) && val > 0) {
        scenario = { type: SCENARIO_TYPES.ONE_TIME_INCOME, amount: val };
        hasValidInput = true;
      }
    } else if (this.currentWhatIfType === SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE) {
      const val = parseFloat(this.whatifInputPercent?.value);
      if (!isNaN(val) && val > 0) {
        const signedPercent = this.whatifPercentDirection === 'down' ? -val : val;
        scenario = { type: SCENARIO_TYPES.FUTURE_SPEND_PERCENT_CHANGE, percent: signedPercent };
        hasValidInput = true;
      }
    } else if (this.currentWhatIfType === SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE) {
      const val = parseFloat(this.whatifInputDaily?.value);
      if (!isNaN(val) && val > 0) {
        const signedDaily = this.whatifDailyDirection === 'down' ? -val : val;
        scenario = { type: SCENARIO_TYPES.FUTURE_DAILY_SPEND_CHANGE, amountPerDay: signedDaily };
        hasValidInput = true;
      }
    }

    this.updateWhatIfInterpretations(currency, lang);

    const [curYStr, curMStr] = currentYearMonth.split('-');
    const currentYear = parseInt(curYStr, 10) || safeNow.getFullYear();
    const currentMonthNum = parseInt(curMStr, 10) || (safeNow.getMonth() + 1);

    const simResult = simulateWhatIf({
      transactions,
      options: {
        now: safeNow,
        referenceDate: safeNow,
        targetYearMonth: currentYearMonth,
        year: currentYear,
        month: currentMonthNum,
        currentAvailableBalance
      },
      scenario: scenario || { type: this.currentWhatIfType || SCENARIO_TYPES.ONE_TIME_EXPENSE, amount: 0 }
    });

    this.renderWhatIfResults(simResult, currency, lang, hasValidInput);
  }

  renderWhatIfResults(simResult, currency, lang, hasValidInput) {
    if (!simResult) return;

    const notAvail = t('whatif.results.notAvailable') || '—';

    // 1. Comparison Grid
    // Projected Expense
    if (this.whatifBaseExpense) this.whatifBaseExpense.textContent = formatCurrency(simResult.baseline.projectedExpense, currency, lang);
    if (this.whatifSimExpense) this.whatifSimExpense.textContent = hasValidInput ? formatCurrency(simResult.simulated.projectedExpense, currency, lang) : notAvail;
    if (this.whatifDeltaExpense) {
      if (!hasValidInput || simResult.delta.projectedExpense === 0) {
        this.whatifDeltaExpense.textContent = formatCurrency(0, currency, lang);
        this.whatifDeltaExpense.className = 'py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-300';
      } else if (simResult.delta.projectedExpense > 0) {
        this.whatifDeltaExpense.textContent = `+${formatCurrency(simResult.delta.projectedExpense, currency, lang)}`;
        this.whatifDeltaExpense.className = 'py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400';
      } else {
        this.whatifDeltaExpense.textContent = `-${formatCurrency(Math.abs(simResult.delta.projectedExpense), currency, lang)}`;
        this.whatifDeltaExpense.className = 'py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400';
      }
    }

    // Projected Remaining Expense
    if (this.whatifBaseRemaining) this.whatifBaseRemaining.textContent = formatCurrency(simResult.baseline.projectedRemainingExpense, currency, lang);
    if (this.whatifSimRemaining) this.whatifSimRemaining.textContent = hasValidInput ? formatCurrency(simResult.simulated.projectedRemainingExpense, currency, lang) : notAvail;
    if (this.whatifDeltaRemaining) {
      if (!hasValidInput || simResult.delta.projectedRemainingExpense === 0) {
        this.whatifDeltaRemaining.textContent = formatCurrency(0, currency, lang);
        this.whatifDeltaRemaining.className = 'py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-300';
      } else if (simResult.delta.projectedRemainingExpense > 0) {
        this.whatifDeltaRemaining.textContent = `+${formatCurrency(simResult.delta.projectedRemainingExpense, currency, lang)}`;
        this.whatifDeltaRemaining.className = 'py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400';
      } else {
        this.whatifDeltaRemaining.textContent = `-${formatCurrency(Math.abs(simResult.delta.projectedRemainingExpense), currency, lang)}`;
        this.whatifDeltaRemaining.className = 'py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400';
      }
    }

    // Projected Ending Balance
    const baseBal = simResult.baseline.projectedEndBalance;
    const simBal = simResult.simulated.projectedEndBalance;
    const deltaBal = simResult.delta.projectedEndBalance;

    if (this.whatifBaseBalance) {
      this.whatifBaseBalance.textContent = (baseBal !== null && !isNaN(baseBal))
        ? formatCurrency(baseBal, currency, lang)
        : notAvail;
    }
    if (this.whatifSimBalance) {
      this.whatifSimBalance.textContent = (hasValidInput && simBal !== null && !isNaN(simBal))
        ? formatCurrency(simBal, currency, lang)
        : notAvail;
    }
    if (this.whatifDeltaBalance) {
      if (!hasValidInput || deltaBal === null || isNaN(deltaBal)) {
        this.whatifDeltaBalance.textContent = notAvail;
        this.whatifDeltaBalance.className = 'py-2 px-3 text-right font-bold text-slate-400 dark:text-slate-500';
      } else if (deltaBal > 0) {
        this.whatifDeltaBalance.textContent = `+${formatCurrency(deltaBal, currency, lang)}`;
        this.whatifDeltaBalance.className = 'py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400';
      } else if (deltaBal < 0) {
        this.whatifDeltaBalance.textContent = `-${formatCurrency(Math.abs(deltaBal), currency, lang)}`;
        this.whatifDeltaBalance.className = 'py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400';
      } else {
        this.whatifDeltaBalance.textContent = formatCurrency(0, currency, lang);
        this.whatifDeltaBalance.className = 'py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-300';
      }
    }

    // Daily Rate
    if (this.whatifBaseRate) this.whatifBaseRate.textContent = `${formatCurrency(simResult.baseline.dailyRate, currency, lang)}/gün`;
    if (this.whatifSimRate) this.whatifSimRate.textContent = hasValidInput ? `${formatCurrency(simResult.simulated.dailyRate, currency, lang)}/gün` : notAvail;
    if (this.whatifDeltaRate) {
      if (!hasValidInput || simResult.delta.dailyRate === 0) {
        this.whatifDeltaRate.textContent = `${formatCurrency(0, currency, lang)}/gün`;
        this.whatifDeltaRate.className = 'py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-300';
      } else if (simResult.delta.dailyRate > 0) {
        this.whatifDeltaRate.textContent = `+${formatCurrency(simResult.delta.dailyRate, currency, lang)}/gün`;
        this.whatifDeltaRate.className = 'py-2 px-3 text-right font-bold text-rose-600 dark:text-rose-400';
      } else {
        this.whatifDeltaRate.textContent = `-${formatCurrency(Math.abs(simResult.delta.dailyRate), currency, lang)}/gün`;
        this.whatifDeltaRate.className = 'py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400';
      }
    }

    // 2. Visual Impact Card
    if (this.whatifImpactCard && this.whatifImpactText && this.whatifImpactBadge) {
      if (!hasValidInput) {
        this.whatifImpactText.textContent = lang === 'tr' ? 'Değer girerek olası etkiyi görün' : 'Enter a value to see potential impact';
        this.whatifImpactBadge.textContent = '—';
        this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0';
        if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0';
      } else {
        const deltaBal = simResult.delta.projectedEndBalance;
        const deltaExp = simResult.delta.projectedExpense;

        if (deltaBal !== null && !isNaN(deltaBal) && deltaBal !== 0) {
          if (deltaBal > 0) {
            const formatted = formatCurrency(deltaBal, currency, lang);
            this.whatifImpactText.textContent = t('whatif.results.balanceIncrease', { amount: formatted }) || `Öngörülen ay sonu bakiye ${formatted} artıyor`;
            this.whatifImpactBadge.textContent = `+${formatted}`;
            this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0';
            if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0';
          } else {
            const formatted = formatCurrency(Math.abs(deltaBal), currency, lang);
            this.whatifImpactText.textContent = t('whatif.results.balanceDecrease', { amount: formatted }) || `Öngörülen ay sonu bakiye ${formatted} azalıyor`;
            this.whatifImpactBadge.textContent = `-${formatted}`;
            this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 shrink-0';
            if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0';
          }
        } else if (deltaExp !== 0) {
          if (deltaExp > 0) {
            const formatted = formatCurrency(deltaExp, currency, lang);
            this.whatifImpactText.textContent = t('whatif.results.expenseIncrease', { amount: formatted }) || `Öngörülen gider +${formatted} artıyor`;
            this.whatifImpactBadge.textContent = `+${formatted}`;
            this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 shrink-0';
            if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0';
          } else {
            const formatted = formatCurrency(Math.abs(deltaExp), currency, lang);
            this.whatifImpactText.textContent = t('whatif.results.expenseDecrease', { amount: formatted }) || `Öngörülen gider ${formatted} azalıyor`;
            this.whatifImpactBadge.textContent = `-${formatted}`;
            this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0';
            if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0';
          }
        } else {
          this.whatifImpactText.textContent = t('whatif.results.noImpact') || 'Tahmin üzerinde belirgin bir değişim öngörülmüyor';
          this.whatifImpactBadge.textContent = formatCurrency(0, currency, lang);
          this.whatifImpactBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 shrink-0';
          if (this.whatifImpactIconBox) this.whatifImpactIconBox.className = 'w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0';
        }
      }
    }

    // 3. Explainability List
    if (this.whatifAssumptionsList) {
      const daysRem = simResult.metadata?.daysRemaining || 0;
      const assumptions = simResult.metadata?.assumptions || [];

      const assumptionTexts = {
        BASELINE_FORECAST_UNCHANGED: t('whatif.explainability.assumptions.BASELINE_FORECAST_UNCHANGED') || 'Mevcut harcama temposu ve davranışsal tahmin temel alındı.',
        NO_ADDITIONAL_INCOME_ASSUMED: t('whatif.explainability.assumptions.NO_ADDITIONAL_INCOME_ASSUMED') || 'Senaryo süresince ek başka bir gelir varsayılmadı.',
        ONE_TIME_EVENT: t('whatif.explainability.assumptions.ONE_TIME_EVENT') || 'Bu işlem tek seferlik kabul edildi, günlük harcama temposunu değiştirmedi.',
        BASELINE_EXPENSE_FORECAST_UNCHANGED: t('whatif.explainability.assumptions.BASELINE_EXPENSE_FORECAST_UNCHANGED') || 'Tek seferlik gelir harcama projeksiyonunu doğrudan değiştirmedi.',
        ONE_TIME_INCOME_EVENT: t('whatif.explainability.assumptions.ONE_TIME_INCOME_EVENT') || 'Bu gelir tek seferlik kabul edildi.',
        CHANGE_APPLIES_TO_REMAINING_DAYS_ONLY: t('whatif.explainability.assumptions.CHANGE_APPLIES_TO_REMAINING_DAYS_ONLY', { days: daysRem }) || `Değişiklik yalnızca ayın kalan ${daysRem} günü için geçerlidir; geçmiş gerçekleşen harcamalar korunur.`,
        PAST_ACTUALS_UNCHANGED: t('whatif.explainability.assumptions.PAST_ACTUALS_UNCHANGED') || 'Ayın başından bugüne yapılmış harcamalar sabit tutuldu.',
        DAILY_RATE_NON_NEGATIVE: t('whatif.explainability.assumptions.DAILY_RATE_NON_NEGATIVE') || 'Günlük harcama temposu 0 TL altına düşemez.'
      };

      if (!hasValidInput) {
        this.whatifAssumptionsList.innerHTML = `
          <div class="py-1 text-slate-500 dark:text-slate-400">
            ${lang === 'tr' ? 'Hesaplama varsayımlarını ve olası etkileri görmek için bir senaryo değeri belirleyin.' : 'Specify a scenario value to see calculation assumptions and potential impacts.'}
          </div>
        `;
      } else {
        this.whatifAssumptionsList.innerHTML = assumptions.map(code => {
          const txt = assumptionTexts[code] || code;
          return `
            <div class="flex items-start space-x-2 py-0.5">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 dark:bg-purple-400 mt-1.5 shrink-0"></span>
              <span class="text-xs leading-relaxed">${escapeHtml(txt)}</span>
            </div>
          `;
        }).join('');
      }
    }
  }
}

