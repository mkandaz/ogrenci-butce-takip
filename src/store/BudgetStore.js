import { STORAGE_KEY, SCHEMA_VERSION, DEFAULT_CURRENCY, DEFAULT_LANGUAGE } from '../config/constants.js';
import { DEFAULT_PRESETS, DEFAULT_SETTINGS, DEFAULT_CATEGORIES, DEFAULT_SEED_TRANSACTIONS } from '../config/defaultData.js';
import { SafeStorage } from '../utils/storage.js';
import { generateUUID, getCurrentYearMonth } from '../utils/helpers.js';
import { normalizeCurrency } from '../utils/formatters.js';

export class BudgetStore {
  constructor() {
    this.listeners = [];
    this.localChangeListeners = [];
    this.hasUnsyncedChanges = false;
    this.isApplyingRemote = false;
    this.state = this.loadState();
  }

  loadState() {
    try {
      const raw = SafeStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.transactions)) {
          // Eksik kategoriler varsa varsayılanla tamamla
          const categoryMap = new Map();
          DEFAULT_CATEGORIES.forEach(c => categoryMap.set(c.id, c));
          if (Array.isArray(parsed.categories)) {
            parsed.categories.forEach(c => categoryMap.set(c.id, c));
          }

          let isOnboarded = true;
          if (typeof parsed.onboarded === 'boolean') {
            isOnboarded = parsed.onboarded;
          } else if (parsed.transactions.length === 0) {
            isOnboarded = false;
          }

          // Para birimi ISO normalizasyonu (₺ -> TRY)
          const rawCurrency = (parsed.settings && parsed.settings.currency) || DEFAULT_CURRENCY;
          const normalizedCurrency = normalizeCurrency(rawCurrency);

          return {
            version: SCHEMA_VERSION,
            onboarded: isOnboarded,
            settings: {
              ...DEFAULT_SETTINGS,
              ...(parsed.settings || {}),
              currency: normalizedCurrency,
              presets: (parsed.settings && Array.isArray(parsed.settings.presets) && parsed.settings.presets.length > 0)
                ? parsed.settings.presets
                : DEFAULT_PRESETS
            },
            categories: Array.from(categoryMap.values()),
            transactions: parsed.transactions.map(t => ({
              id: t.id || generateUUID(),
              title: String(t.title || '').trim(),
              amount: Number(t.amount) || 0,
              type: t.type === 'income' ? 'income' : 'expense',
              categoryId: t.categoryId || (t.type === 'income' ? 'inc_other' : 'exp_other'),
              date: t.date || new Date().toISOString().slice(0, 10),
              notes: t.notes ? String(t.notes).trim() : '',
              createdAt: t.createdAt || Date.now(),
              updatedAt: t.updatedAt || Date.now()
            }))
          };
        }
      }
    } catch (err) {
      console.warn('BudgetStore state okunamadı, varsayılan başlatılıyor:', err);
    }

    // İlk açılış: Onboarding modalı beklenir
    return {
      version: SCHEMA_VERSION,
      onboarded: false,
      settings: { ...DEFAULT_SETTINGS },
      categories: [...DEFAULT_CATEGORIES],
      transactions: []
    };
  }

  saveToStorage() {
    try {
      SafeStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.error('BudgetStore state kaydedilemedi:', err);
    }
  }

  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.push(listener);
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.saveToStorage();
    this.listeners.forEach(fn => {
      try { fn(this.state); } catch (e) { console.error('Listener hatası:', e); }
    });
  }

  onLocalChange(listener) {
    if (typeof listener === 'function') {
      this.localChangeListeners.push(listener);
    }
    return () => {
      this.localChangeListeners = this.localChangeListeners.filter(l => l !== listener);
    };
  }

  emitLocalChange(type, detail = null) {
    if (this.isApplyingRemote) return;
    this.hasUnsyncedChanges = true;
    this.localChangeListeners.forEach(fn => {
      try {
        fn({ type, detail, timestamp: Date.now() });
      } catch (e) {
        console.error('Local change listener hatası:', e);
      }
    });
  }

  markSynced() {
    this.hasUnsyncedChanges = false;
  }

  withRemoteUpdate(fn) {
    const prev = this.isApplyingRemote;
    this.isApplyingRemote = true;
    try {
      fn();
    } finally {
      this.isApplyingRemote = prev;
    }
  }

  getTransactions() {
    return this.state.transactions || [];
  }

  getCategories(type = null) {
    if (!type) return this.state.categories || [];
    return (this.state.categories || []).filter(c => c.type === type);
  }

  getCategoryById(id) {
    return (this.state.categories || []).find(c => c.id === id) || null;
  }

  getSettings() {
    return this.state.settings || DEFAULT_SETTINGS;
  }

  updateSettings(partial) {
    if (partial.currency) {
      partial.currency = normalizeCurrency(partial.currency);
    }
    this.state.settings = {
      ...this.state.settings,
      ...partial,
      updatedAt: Date.now()
    };
    this.emitLocalChange('settings:update', partial);
    this.notify();
  }

  addTransaction(txData) {
    const amount = Math.round(Number(txData.amount) * 100) / 100;
    if (isNaN(amount) || amount <= 0) {
      throw new Error('İşlem tutarı 0\'dan büyük olmalıdır.');
    }
    if (!txData.title || !String(txData.title).trim()) {
      throw new Error('İşlem başlığı boş bırakılamaz.');
    }
    if (!txData.categoryId) {
      throw new Error('Lütfen bir kategori seçin.');
    }

    const newTx = {
      id: txData.id || generateUUID(),
      title: String(txData.title).trim(),
      amount,
      type: txData.type === 'income' ? 'income' : 'expense',
      categoryId: txData.categoryId,
      date: txData.date || new Date().toISOString().slice(0, 10),
      notes: txData.notes ? String(txData.notes).trim() : '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.state.transactions.unshift(newTx);
    this.emitLocalChange('transaction:add', newTx);
    this.notify();
    return newTx;
  }

  updateTransaction(id, updatedFields) {
    const idx = this.state.transactions.findIndex(t => t.id === id);
    if (idx === -1) return false;

    const existing = this.state.transactions[idx];
    let newAmount = existing.amount;
    if (updatedFields.amount !== undefined) {
      newAmount = Math.round(Number(updatedFields.amount) * 100) / 100;
      if (isNaN(newAmount) || newAmount <= 0) {
        throw new Error('İşlem tutarı 0\'dan büyük olmalıdır.');
      }
    }

    this.state.transactions[idx] = {
      ...existing,
      ...updatedFields,
      amount: newAmount,
      updatedAt: Date.now()
    };

    this.emitLocalChange('transaction:update', this.state.transactions[idx]);
    this.notify();
    return true;
  }

  deleteTransaction(id) {
    const prevLen = this.state.transactions.length;
    this.state.transactions = this.state.transactions.filter(t => t.id !== id);
    if (this.state.transactions.length !== prevLen) {
      this.trackDeleted(id);
      this.emitLocalChange('transaction:delete', { id });
      this.notify();
      return true;
    }
    return false;
  }

  trackDeleted(id) {
    try {
      const DELETED_QUEUE_KEY = 'student_budget_deleted_queue';
      const queue = JSON.parse(SafeStorage.getItem(DELETED_QUEUE_KEY) || '[]');
      if (!queue.some(item => item.id === id)) {
        queue.push({ id, deletedAt: new Date().toISOString() });
        SafeStorage.setItem(DELETED_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (e) {
      // sessizce geç
    }
  }

  startWithDemo() {
    this.state.transactions = [...DEFAULT_SEED_TRANSACTIONS];
    this.state.categories = [...DEFAULT_CATEGORIES];
    this.state.onboarded = true;
    this.state.settings.updatedAt = Date.now();
    this.emitLocalChange('budget:startDemo', null);
    this.notify();
  }

  startWithCustomBudget({ initialBalance = 0, monthlyIncome = 0, targetMonth = '' }) {
    const monthStr = targetMonth || getCurrentYearMonth();
    const txDate = `${monthStr}-01`;
    const newTxs = [];
    let initBalId = null;
    let monIncId = null;

    const initBal = Number(initialBalance);
    if (!isNaN(initBal) && initBal > 0) {
      initBalId = generateUUID();
      newTxs.push({
        id: initBalId,
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
      monIncId = generateUUID();
      newTxs.push({
        id: monIncId,
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
    this.state.settings.initialBudget = {
      initialBalance: initBal > 0 ? initBal : 0,
      monthlyIncome: inc > 0 ? inc : 0,
      targetMonth: monthStr,
      initialBalanceTxId: initBalId,
      monthlyIncomeTxId: monIncId
    };
    this.state.settings.updatedAt = Date.now();
    this.state.onboarded = true;
    this.emitLocalChange('budget:startCustom', { initialBalance, monthlyIncome, targetMonth });
    this.notify();
  }

  getInitialBudget() {
    const targetMonth = this.state.settings.targetMonth || getCurrentYearMonth();
    let initTx = null;
    let incTx = null;

    if (this.state.settings.initialBudget) {
      const { initialBalanceTxId, monthlyIncomeTxId } = this.state.settings.initialBudget;
      if (initialBalanceTxId) {
        initTx = this.state.transactions.find(t => t.id === initialBalanceTxId);
      }
      if (monthlyIncomeTxId) {
        incTx = this.state.transactions.find(t => t.id === monthlyIncomeTxId);
      }
    }

    // Fallback arama (eski sürümler veya ID eşleşmeme durumu için)
    if (!initTx) {
      initTx = this.state.transactions.find(t =>
        t.title === 'Mevcut Nakit / Başlangıç Bakiyesi' || (t.notes && t.notes.includes('başlangıç devir bakiyesi'))
      );
    }
    if (!incTx) {
      incTx = this.state.transactions.find(t =>
        t.title === 'Aylık Düzenli Gelir (Burs / Harçlık / Maaş)' || (t.notes && t.notes.includes('düzenli bütçe geliri'))
      );
    }

    return {
      initialBalance: initTx ? initTx.amount : (this.state.settings.initialBudget?.initialBalance || 0),
      monthlyIncome: incTx ? incTx.amount : (this.state.settings.initialBudget?.monthlyIncome || 0),
      targetMonth: (initTx?.date ? String(initTx.date).slice(0, 7) : null) || (incTx?.date ? String(incTx.date).slice(0, 7) : null) || targetMonth,
      initialBalanceTxId: initTx ? initTx.id : null,
      monthlyIncomeTxId: incTx ? incTx.id : null
    };
  }

  updateInitialBudget({ initialBalance = 0, monthlyIncome = 0, targetMonth = '' }) {
    const current = this.getInitialBudget();
    const monthStr = targetMonth || current.targetMonth || this.state.settings.targetMonth || getCurrentYearMonth();
    const txDate = `${monthStr}-01`;

    const newInitBal = Number(initialBalance) || 0;
    const newMonthlyInc = Number(monthlyIncome) || 0;

    let initBalId = current.initialBalanceTxId;
    let monIncId = current.monthlyIncomeTxId;

    // 1. Başlangıç Bakiyesi Güncelle / Ekle / Sil
    if (newInitBal > 0) {
      if (initBalId && this.state.transactions.some(t => t.id === initBalId)) {
        this.updateTransaction(initBalId, {
          amount: Math.round(newInitBal * 100) / 100,
          date: txDate
        });
      } else {
        initBalId = generateUUID();
        this.addTransaction({
          id: initBalId,
          title: 'Mevcut Nakit / Başlangıç Bakiyesi',
          amount: Math.round(newInitBal * 100) / 100,
          type: 'income',
          categoryId: 'inc_other',
          date: txDate,
          notes: 'Bütçe başlangıç devir bakiyesi'
        });
      }
    } else if (initBalId) {
      this.deleteTransaction(initBalId);
      initBalId = null;
    }

    // 2. Aylık Düzenli Gelir Güncelle / Ekle / Sil
    if (newMonthlyInc > 0) {
      if (monIncId && this.state.transactions.some(t => t.id === monIncId)) {
        this.updateTransaction(monIncId, {
          amount: Math.round(newMonthlyInc * 100) / 100,
          date: txDate
        });
      } else {
        monIncId = generateUUID();
        this.addTransaction({
          id: monIncId,
          title: 'Aylık Düzenli Gelir (Burs / Harçlık / Maaş)',
          amount: Math.round(newMonthlyInc * 100) / 100,
          type: 'income',
          categoryId: 'inc_kyk',
          date: txDate,
          notes: 'Aylık düzenli bütçe geliri'
        });
      }
    } else if (monIncId) {
      this.deleteTransaction(monIncId);
      monIncId = null;
    }

    this.state.settings.targetMonth = monthStr;
    this.state.settings.initialBudget = {
      initialBalance: newInitBal,
      monthlyIncome: newMonthlyInc,
      targetMonth: monthStr,
      initialBalanceTxId: initBalId,
      monthlyIncomeTxId: monIncId
    };
    this.state.settings.updatedAt = Date.now();
    this.emitLocalChange('settings:initialBudget', this.state.settings.initialBudget);
    this.notify();
    return true;
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
    const timestamp = Date.now();
    const currentPresets = this.state.settings.presets || [];
    const currentMap = new Map(currentPresets.map(p => [p.id, p]));

    this.state.settings.presets = newPresets.map(p => {
      const old = currentMap.get(p.id);
      const isChanged = !old || Number(old.amount) !== Number(p.amount) || old.name !== p.name || old.emoji !== p.emoji;
      let updatedAt = p.updatedAt;
      if (isChanged && (!p.updatedAt || (old && p.updatedAt === old.updatedAt))) {
        updatedAt = timestamp;
      }
      return {
        ...p,
        updatedAt: updatedAt || timestamp
      };
    });
    this.state.settings.presetsUpdatedAt = timestamp;
    this.saveToStorage();
    this.emitLocalChange('presets:update', newPresets);
    this.notify();
  }

  importData(importedData, mode = 'merge') {
    let rawTransactions = null;
    let rawCategories = null;

    if (Array.isArray(importedData)) {
      rawTransactions = importedData;
    } else if (importedData && typeof importedData === 'object') {
      if (Array.isArray(importedData.transactions)) {
        rawTransactions = importedData.transactions;
      }
      if (Array.isArray(importedData.categories)) {
        rawCategories = importedData.categories;
      }
    }

    if (!Array.isArray(rawTransactions)) {
      throw new Error('Geçersiz dosya formatı: İşlem listesi bulunamadı.');
    }

    const validatedTxs = rawTransactions.map(t => {
      if (!t.title || Number(t.amount) <= 0) {
        throw new Error('Dosyadaki bazı işlemler eksik veya geçersiz tutara sahip.');
      }
      return {
        id: t.id || generateUUID(),
        title: String(t.title).trim(),
        amount: Math.round(Number(t.amount) * 100) / 100,
        type: t.type === 'income' ? 'income' : 'expense',
        categoryId: t.categoryId || (t.type === 'income' ? 'inc_other' : 'exp_other'),
        date: t.date || new Date().toISOString().slice(0, 10),
        notes: t.notes ? String(t.notes).trim() : '',
        createdAt: t.createdAt || Date.now(),
        updatedAt: t.updatedAt || Date.now()
      };
    });

    if (rawCategories && Array.isArray(rawCategories)) {
      const catMap = new Map(this.state.categories.map(c => [c.id, c]));
      rawCategories.forEach(c => {
        if (c.id && c.name) catMap.set(c.id, c);
      });
      this.state.categories = Array.from(catMap.values());
    }

    if (mode === 'replace') {
      this.state.transactions = validatedTxs;
    } else {
      // Merge
      const txMap = new Map(this.state.transactions.map(t => [t.id, t]));
      validatedTxs.forEach(t => txMap.set(t.id, t));
      this.state.transactions = Array.from(txMap.values());
    }

    this.state.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    this.state.onboarded = true;
    this.emitLocalChange('data:import', null);
    this.notify();
    return true;
  }

  exportData() {
    return {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: this.state.settings,
      categories: this.state.categories,
      transactions: this.state.transactions
    };
  }
}
