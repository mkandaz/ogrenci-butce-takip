import { escapeHtml } from '../utils/sanitize.js';
import { formatCurrency } from '../utils/formatters.js';
import { getCurrentYearMonth } from '../utils/helpers.js';
import { t } from '../i18n/index.js';
import { showToast } from './toastManager.js';
import { DEFAULT_PRESETS } from '../config/defaultData.js';

export class ModalManager {
  constructor(store, uiManager) {
    this.store = store;
    this.ui = uiManager;
    this.lastFocusedElement = null;
    this.confirmCallback = null;

    this.cacheElements();
    this.bindEvents();
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

    // Modal dışına tıklayınca kapatma & ESC tuşu
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.txModal && !this.txModal.classList.contains('hidden')) {
          this.closeTransactionModal();
        } else if (this.importModal && !this.importModal.classList.contains('hidden')) {
          this.closeImportModal();
        } else if (this.confirmModal && !this.confirmModal.classList.contains('hidden')) {
          this.closeConfirmModal();
        } else if (this.presetModal && !this.presetModal.classList.contains('hidden')) {
          this.closePresetModal();
        } else if (this.initialBudgetModal && !this.initialBudgetModal.classList.contains('hidden')) {
          this.closeInitialBudgetModal();
        }
      }
    });

    [this.txModal, this.importModal, this.confirmModal, this.presetModal, this.initialBudgetModal].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            if (modal === this.txModal) this.closeTransactionModal();
            else if (modal === this.importModal) this.closeImportModal();
            else if (modal === this.confirmModal) this.closeConfirmModal();
            else if (modal === this.presetModal) this.closePresetModal();
            else if (modal === this.initialBudgetModal) this.closeInitialBudgetModal();
          }
        });
      }
    });
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
  }

  closeTransactionModal() {
    if (this.txModal) this.txModal.classList.add('hidden');
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
    const firstInput = this.presetInputsContainer.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  closePresetModal() {
    if (this.presetModal) this.presetModal.classList.add('hidden');
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
  }

  closeImportModal() {
    if (this.importModal) this.importModal.classList.add('hidden');
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
  openConfirmModal({ title, desc, onConfirm, actionText = 'Evet, Onaylıyorum' }) {
    this.lastFocusedElement = document.activeElement;
    if (this.confirmModalTitle) this.confirmModalTitle.textContent = title;
    if (this.confirmModalDesc) this.confirmModalDesc.textContent = desc;
    if (this.confirmModalAction) this.confirmModalAction.textContent = actionText;
    this.confirmCallback = onConfirm;
    if (this.confirmModal) this.confirmModal.classList.remove('hidden');
  }

  closeConfirmModal() {
    if (this.confirmModal) this.confirmModal.classList.add('hidden');
    this.confirmCallback = null;
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  // --- Onboarding Modal Methods ---
  openOnboardingModal() {
    if (this.onboardingModal) {
      this.onboardingModal.classList.remove('hidden');
      if (this.onboardTargetMonth) {
        this.onboardTargetMonth.value = this.store.state.settings.targetMonth || getCurrentYearMonth();
      }
    }
  }

  closeOnboardingModal() {
    if (this.onboardingModal) {
      this.onboardingModal.classList.add('hidden');
    }
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
    if (this.editInitialBalance) setTimeout(() => this.editInitialBalance.focus(), 50);
  }

  closeInitialBudgetModal() {
    if (this.initialBudgetModal) this.initialBudgetModal.classList.add('hidden');
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
}
