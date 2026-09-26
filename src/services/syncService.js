import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { authService } from './authService.js';
import { generateUUID, isValidUUID, getCurrentYearMonth } from '../utils/helpers.js';
import { SafeStorage } from '../utils/storage.js';

const LAST_SYNCED_KEY = 'student_budget_last_synced_at';
const PRE_CLOUD_BACKUP_KEY = 'student_budget_pre_cloud_backup';
const DELETED_QUEUE_KEY = 'student_budget_deleted_queue';

export class SyncService {
  constructor(store, customClient = null) {
    this.store = store;
    this.client = customClient;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'pending' | 'synced' | 'offline' | 'error'
    this.statusListeners = [];
    this.isSyncing = false;
    this.debounceTimer = null;
    this.remoteSyncTimer = null;
    this.pendingSyncRequested = false;
    this.pendingRemotePullRequested = false;
    this.recentLocalWrites = new Map();
    this.lastSyncAttemptTime = 0;
    this.realtimeChannel = null;
    this.realtimeStatus = 'DISCONNECTED';
    this.pollingInterval = null;
    this.windowListenersAttached = false;

    // 1. Yerel store mutasyonlarında debounced sync planla
    if (this.store && typeof this.store.onLocalChange === 'function') {
      this.store.onLocalChange(() => {
        this.scheduleDebouncedSync(1000);
      });
    }

    // 2. Pencere, sekme görünürlüğü, odak ve ağ durumu dinleyicileri
    this.setupWindowListeners();

    // 3. Auth durum değişikliklerinde senkronizasyonu ve Realtime aboneliğini yönet
    authService.onAuthStateChange((user, session, event) => {
      if (user) {
        this.setupRealtimeSubscription(user);
        this.startForegroundPolling(120000);
        if (event === 'SIGNED_IN') {
          this.handleUserLogin(user);
        }
      } else {
        this.unsubscribeRealtime();
        this.stopForegroundPolling();
        this.setStatus('idle');
      }
    });
  }

  scheduleDebouncedSync(delay = 1000) {
    const user = authService.getUser();
    if (!user) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline', 'Çevrimdışı Mod');
      return;
    }

    this.setStatus('pending', 'Bekleyen değişiklikler...');

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      if (this.isSyncing) {
        this.pendingSyncRequested = true;
        return;
      }
      await this.sync({ reason: 'local-change', pullOnly: false });
    }, delay);
  }

  async flushDebouncedSync() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.sync({ reason: 'local-change', pullOnly: false });
  }

  recordLocalWrite(id, updatedAtIso) {
    if (!this.recentLocalWrites) {
      this.recentLocalWrites = new Map();
    }
    this.recentLocalWrites.set(id, updatedAtIso || 'ANY');
    setTimeout(() => {
      if (this.recentLocalWrites) {
        this.recentLocalWrites.delete(id);
      }
    }, 15000);
  }

  isSelfEcho(tableName, payload) {
    if (!this.recentLocalWrites) return false;
    const record = payload?.new;
    if (tableName === 'transactions' && record && record.id) {
      if (this.recentLocalWrites.has(record.id)) {
        const expected = this.recentLocalWrites.get(record.id);
        if (expected === 'ANY' || !record.updated_at || record.updated_at === expected) {
          return true;
        }
      }
    }
    return false;
  }

  scheduleRemoteDeltaSync(delay = 400) {
    if (this.remoteSyncTimer) {
      clearTimeout(this.remoteSyncTimer);
      this.remoteSyncTimer = null;
    }

    this.remoteSyncTimer = setTimeout(async () => {
      this.remoteSyncTimer = null;
      if (this.isSyncing) {
        this.pendingRemotePullRequested = true;
        return;
      }
      const user = authService.getUser();
      if (user) {
        await this.sync({ user, reason: 'realtime', pullOnly: true });
      }
    }, delay);
  }

  setupRealtimeSubscription(user) {
    if (!user || !user.id) return;
    const client = this.getClient();
    if (!client || typeof client.channel !== 'function') return;

    this.unsubscribeRealtime();

    const channelName = `db-user-${user.id}`;
    this.realtimeChannel = client.channel(channelName);

    const handleRemoteChange = (tableName, payload) => {
      if (this.isSelfEcho(tableName, payload)) {
        console.info(`[SyncService] Realtime (${tableName}) değişikliği self-echo olarak tespit edildi, yoksayılıyor:`, payload?.new?.id);
        return;
      }
      console.info(`[SyncService] Realtime (${tableName}) değişikliği algılandı:`, payload?.eventType || payload);
      this.scheduleRemoteDeltaSync(400);
    };

    this.realtimeChannel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => handleRemoteChange('transactions', payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_settings',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => handleRemoteChange('user_settings', payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'presets',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => handleRemoteChange('presets', payload)
      )
      .subscribe((status, err) => {
        this.realtimeStatus = status;
        if (status === 'SUBSCRIBED') {
          console.info(`[SyncService] Realtime kanalı başarıyla bağlandı (${status}): ${channelName}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[SyncService] Realtime kanal hatası (${status}):`, err);
        } else if (status === 'TIMED_OUT') {
          console.warn(`[SyncService] Realtime kanal zaman aşımı (${status}):`, err);
        }
      });
  }

  unsubscribeRealtime() {
    if (this.realtimeChannel) {
      try {
        const client = this.getClient();
        if (client && typeof client.removeChannel === 'function') {
          client.removeChannel(this.realtimeChannel);
        }
      } catch (e) {
        console.warn('[SyncService] unsubscribeRealtime uyarısı:', e);
      }
      this.realtimeChannel = null;
      this.realtimeStatus = 'DISCONNECTED';
    }
  }

  startForegroundPolling(intervalMs = 120000) {
    this.stopForegroundPolling();
    this.pollingInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const user = authService.getUser();
      if (user && !this.isSyncing && !this.debounceTimer && !this.remoteSyncTimer) {
        console.info('[SyncService] Önplan güvenlik yoklaması (Foreground Polling 120s)...');
        if (this.store && this.store.hasUnsyncedChanges) {
          this.sync({ user, reason: 'polling', pullOnly: false });
        } else {
          this.sync({ user, reason: 'polling', pullOnly: true });
        }
      }
    }, intervalMs);
    if (this.pollingInterval && typeof this.pollingInterval.unref === 'function') {
      this.pollingInterval.unref();
    }
  }

  stopForegroundPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  setupWindowListeners() {
    if (typeof window === 'undefined' || this.windowListenersAttached) return;
    this.windowListenersAttached = true;

    const handleFocusOrVisible = (triggerName = 'Sekme görünür/odakta') => {
      const user = authService.getUser();
      if (!user) return;
      const now = Date.now();
      const elapsed = now - this.lastSyncAttemptTime;
      if (elapsed < 5000 && (!this.store || !this.store.hasUnsyncedChanges)) {
        return;
      }
      if (this.store && this.store.hasUnsyncedChanges) {
        console.info(`[SyncService] ${triggerName} -> Bekleyen yerel değişiklikler push edilecek...`);
        this.scheduleDebouncedSync(300);
      } else {
        console.info(`[SyncService] ${triggerName} -> Delta pull kontrolü...`);
        this.scheduleRemoteDeltaSync(300);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          handleFocusOrVisible('Görünürlük değişti (visible)');
        }
      });
    }

    window.addEventListener('focus', () => {
      handleFocusOrVisible('Pencere odaklandı (focus)');
    });

    window.addEventListener('online', () => {
      console.info('[SyncService] İnternet bağlantısı sağlandı -> Senkronizasyon tetikleniyor...');
      const user = authService.getUser();
      if (user) {
        if (this.store && this.store.hasUnsyncedChanges) {
          this.setStatus('syncing', 'Bağlantı kuruldu, eşitleniyor...');
          this.scheduleDebouncedSync(100);
        } else {
          this.scheduleRemoteDeltaSync(100);
        }
      } else {
        this.setStatus('idle');
      }
    });

    window.addEventListener('offline', () => {
      this.setStatus('offline', 'Çevrimdışı Mod');
    });
  }

  setStatus(status, message = null) {
    this.syncStatus = status;
    this.statusListeners.forEach(fn => {
      try { fn(status, message); } catch (e) { console.error('[SyncService] Listener error:', e); }
    });
  }

  onStatusChange(fn) {
    if (typeof fn === 'function') {
      this.statusListeners.push(fn);
      fn(this.syncStatus);
    }
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== fn);
    };
  }

  getStatus() {
    return this.syncStatus;
  }

  getLastSyncedAt() {
    return SafeStorage.getItem(LAST_SYNCED_KEY) || null;
  }

  setLastSyncedAt(timestamp) {
    SafeStorage.setItem(LAST_SYNCED_KEY, timestamp);
  }

  // Silinen işlem takibi (Soft-delete queue)
  trackDeletedTransaction(txId) {
    try {
      const queue = JSON.parse(SafeStorage.getItem(DELETED_QUEUE_KEY) || '[]');
      if (!queue.some(item => item.id === txId)) {
        queue.push({
          id: txId,
          deletedAt: new Date().toISOString()
        });
        SafeStorage.setItem(DELETED_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (e) {
      console.warn('[SyncService] trackDeletedTransaction hatası:', e);
    }
  }

  getDeletedQueue() {
    try {
      return JSON.parse(SafeStorage.getItem(DELETED_QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  clearDeletedQueue(txIds = []) {
    try {
      if (!txIds.length) {
        SafeStorage.removeItem(DELETED_QUEUE_KEY);
      } else {
        const queue = this.getDeletedQueue();
        const filtered = queue.filter(item => !txIds.includes(item.id));
        SafeStorage.setItem(DELETED_QUEUE_KEY, JSON.stringify(filtered));
      }
    } catch (e) {
      console.warn('[SyncService] clearDeletedQueue hatası:', e);
    }
  }

  // 1. Kullanıcı Giriş Yaptığında Başlatıcı
  async handleUserLogin(user) {
    if (!user) return;
    this.setupRealtimeSubscription(user);
    this.startForegroundPolling(120000);
    if (this.isSyncing) {
      this.pendingSyncRequested = true;
      return;
    }
    try {
      await this.sync(user);
      if (this.store.state.onboarded && typeof window !== 'undefined' && window.app?.modalManager) {
        window.app.modalManager.closeOnboardingModal();
      }
    } catch (err) {
      console.error('[SyncService] Giriş sonrası senkronizasyon hatası:', err);
    }
  }

  getClient() {
    return this.client || supabase;
  }

  // 2. Ana Senkronizasyon Akışı
  async sync(options = {}) {
    const client = this.getClient();
    if ((!this.client && !isSupabaseConfigured()) || !client) {
      this.setStatus('offline', 'Supabase yapılandırılmamış');
      return { success: false, reason: 'unconfigured' };
    }

    let user = null;
    let opts = {};
    if (options && options.id && !options.reason) {
      user = options;
      opts = {};
    } else if (options && typeof options === 'object') {
      opts = options;
      user = opts.user || null;
    }
    if (!user) {
      user = (this.authService && typeof this.authService.getUser === 'function')
        ? this.authService.getUser()
        : authService.getUser();
    }
    if (!user) {
      this.setStatus('idle');
      return { success: false, reason: 'not_authenticated' };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline', 'İnternet bağlantısı yok');
      return { success: false, reason: 'offline' };
    }

    const pullOnly = Boolean(
      opts.pullOnly ||
      (opts.reason === 'realtime') ||
      (opts.reason === 'polling' && (!this.store || !this.store.hasUnsyncedChanges)) ||
      ((opts.reason === 'focus' || opts.reason === 'visibility') && (!this.store || !this.store.hasUnsyncedChanges))
    );

    if (this.isSyncing) {
      if (pullOnly) {
        this.pendingRemotePullRequested = true;
      } else {
        this.pendingSyncRequested = true;
      }
      return { success: false, reason: 'already_syncing' };
    }

    this.isSyncing = true;
    this.lastSyncAttemptTime = Date.now();

    // Sadece gerçek kullanıcı değişikliği veya önceden pending durumdaysa UI'da "syncing" göster
    const isBackgroundPull = pullOnly && (!this.store || !this.store.hasUnsyncedChanges);
    if (!isBackgroundPull) {
      this.setStatus('syncing', 'Bulut ile eşitleniyor...');
    }

    try {
      // Adım 1: user_sync_metadata kontrolü
      const { data: meta, error: metaErr } = await client
        .from('user_sync_metadata')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (metaErr) {
        throw new Error(`user_sync_metadata okunamadı: ${metaErr.message}`);
      }

      const localLastSyncedAt = this.getLastSyncedAt();

      if (!meta) {
        // İLK MIGRATION (Bu hesap bulutta henüz ilklendirilmemiş)
        console.info('[SyncService] İlk bulut ilklendirmesi (Initial Migration) başlatılıyor...');
        await this.runInitialMigration(user);
      } else if (!localLastSyncedAt) {
        // FRESH DEVICE / EMPTY LOCALSTORAGE BOOTSTRAP
        console.info('[SyncService] Fresh device tespit edildi. Full Cloud Bootstrap başlatılıyor...');
        await this.runFullCloudBootstrap(user, meta);
      } else {
        // DELTA SYNC
        console.info(`[SyncService] Delta senkronizasyonu başlatılıyor (pullOnly: ${pullOnly})...`);
        await this.runDeltaSync(user, meta, { pullOnly });
      }

      const nowIso = new Date().toISOString();
      this.setLastSyncedAt(nowIso);
      if (!pullOnly && this.store && typeof this.store.markSynced === 'function') {
        this.store.markSynced();
      }
      this.setStatus('synced', 'Bulut ile başarıyla eşitlendi');
      return { success: true };
    } catch (err) {
      console.error('[SyncService] Senkronizasyon hatası:', err);
      this.setStatus('error', err.message || 'Senkronizasyon başarısız');
      return { success: false, error: err };
    } finally {
      this.isSyncing = false;
      if (this.pendingSyncRequested) {
        this.pendingSyncRequested = false;
        this.scheduleDebouncedSync(300);
      } else if (this.pendingRemotePullRequested) {
        this.pendingRemotePullRequested = false;
        this.scheduleRemoteDeltaSync(300);
      }
    }
  }

  // 3. İlk Migration (Kural 6, 7, 8)
  async runInitialMigration(user) {
    const client = this.getClient();
    // KURAL 7: Mevcut veriyi silme, yedek oluştur
    this.createPreCloudBackup();

    // KURAL 8: Legacy ID'lerin UUID normalizasyonu
    this.normalizeLegacyTransactionIds();

    const state = this.store.state;
    const settings = state.settings || {};
    const initBudget = settings.initialBudget || {};

    // ADIM 1: user_settings Upsert
    const userSettingsPayload = {
      user_id: user.id,
      currency: settings.currency || 'TRY',
      language: settings.language || 'tr',
      target_month: settings.targetMonth || getCurrentYearMonth(),
      month_start_day: settings.monthStartDay || 1,
      warning_threshold_percent: settings.warningThresholdPercent || 15,
      theme: settings.theme || 'light',
      onboarded: Boolean(state.onboarded),
      initial_balance: Number(initBudget.initialBalance) || 0,
      monthly_income: Number(initBudget.monthlyIncome) || 0,
      initial_balance_tx_id: isValidUUID(initBudget.initialBalanceTxId) ? initBudget.initialBalanceTxId : null,
      monthly_income_tx_id: isValidUUID(initBudget.monthlyIncomeTxId) ? initBudget.monthlyIncomeTxId : null,
      updated_at: new Date().toISOString()
    };

    const { error: settingsErr } = await client
      .from('user_settings')
      .upsert(userSettingsPayload);

    if (settingsErr) {
      throw new Error(`user_settings kaydedilemedi: ${settingsErr.message}`);
    }

    // ADIM 2: presets Upsert
    const presets = this.store.getPresets();
    if (presets && presets.length > 0) {
      const presetsPayload = presets.map(p => ({
        user_id: user.id,
        preset_key: p.id,
        name: p.name,
        emoji: p.emoji,
        amount: Math.round(Number(p.amount) * 100) / 100,
        category_id: p.categoryId,
        updated_at: new Date().toISOString()
      }));

      const { error: presetsErr } = await client
        .from('presets')
        .upsert(presetsPayload, { onConflict: 'user_id,preset_key' });

      if (presetsErr) {
        throw new Error(`presets kaydedilemedi: ${presetsErr.message}`);
      }
    }

    // ADIM 3: transactions Batch Upsert
    const transactions = this.store.getTransactions();
    if (transactions && transactions.length > 0) {
      const txPayload = transactions.map(t => ({
        id: t.id,
        user_id: user.id,
        title: t.title,
        amount: Math.round(Number(t.amount) * 100) / 100,
        type: t.type,
        category_id: t.categoryId,
        date: t.date,
        notes: t.notes || null,
        is_deleted: false,
        created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
        updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : new Date().toISOString()
      }));

      const { error: txErr } = await client
        .from('transactions')
        .upsert(txPayload);

      if (txErr) {
        throw new Error(`transactions kaydedilemedi: ${txErr.message}`);
      }
    }

    // ADIM 4: EN SON user_sync_metadata (Öncekiler başarılıysa)
    const { error: finalMetaErr } = await client
      .from('user_sync_metadata')
      .insert({
        user_id: user.id,
        schema_version: '1.1.0',
        last_synced_at: new Date().toISOString(),
        client_app_version: '1.1.0'
      });

    if (finalMetaErr) {
      throw new Error(`user_sync_metadata oluşturulamadı: ${finalMetaErr.message}`);
    }

    console.info('[SyncService] İlk bulut göçü başarıyla tamamlandı.');
  }

  // 3.5. Fresh Device / Empty LocalStorage için Tam İndirme (Full Cloud Bootstrap)
  async runFullCloudBootstrap(user, cloudMeta) {
    const client = this.getClient();

    // ADIM 1: user_settings Çek
    const { data: cloudSettings, error: settingsErr } = await client
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingsErr) {
      throw new Error(`user_settings okunamadı: ${settingsErr.message}`);
    }

    if (cloudSettings) {
      this.store.state.settings = {
        ...this.store.state.settings,
        currency: cloudSettings.currency || 'TRY',
        language: cloudSettings.language || 'tr',
        targetMonth: cloudSettings.target_month || '',
        monthStartDay: cloudSettings.month_start_day || 1,
        warningThresholdPercent: cloudSettings.warning_threshold_percent || 15,
        theme: cloudSettings.theme || 'light',
        initialBudget: {
          initialBalance: Number(cloudSettings.initial_balance) || 0,
          monthlyIncome: Number(cloudSettings.monthly_income) || 0,
          targetMonth: cloudSettings.target_month,
          initialBalanceTxId: cloudSettings.initial_balance_tx_id,
          monthlyIncomeTxId: cloudSettings.monthly_income_tx_id
        },
        updatedAt: cloudSettings.updated_at ? new Date(cloudSettings.updated_at).getTime() : Date.now()
      };
      this.store.state.onboarded = Boolean(cloudSettings.onboarded);
    }

    // ADIM 2: presets Çek
    const { data: cloudPresets, error: presetsErr } = await client
      .from('presets')
      .select('*')
      .eq('user_id', user.id);

    if (presetsErr) {
      throw new Error(`presets okunamadı: ${presetsErr.message}`);
    }

    if (cloudPresets && cloudPresets.length > 0) {
      this.store.state.settings.presets = cloudPresets.map(cp => ({
        id: cp.preset_key,
        name: cp.name,
        emoji: cp.emoji,
        amount: Number(cp.amount),
        categoryId: cp.category_id,
        updatedAt: cp.updated_at ? new Date(cp.updated_at).getTime() : Date.now()
      }));
      this.store.state.settings.presetsUpdatedAt = Date.now();
    }

    // ADIM 3: transactions Çek (Tüm aktif kayıtlar, last_synced_at filtresi OLMADAN)
    const { data: cloudTxs, error: cloudTxsErr } = await client
      .from('transactions')
      .select('*')
      .eq('user_id', user.id);

    if (cloudTxsErr) {
      throw new Error(`transactions okunamadı: ${cloudTxsErr.message}`);
    }

    // is_deleted=true olanları yerel aktif listeye ekleme
    const activeCloudTxs = (cloudTxs || [])
      .filter(ctx => !ctx.is_deleted)
      .map(ctx => ({
        id: ctx.id,
        title: ctx.title,
        amount: Number(ctx.amount),
        type: ctx.type,
        categoryId: ctx.category_id,
        date: ctx.date,
        notes: ctx.notes || '',
        createdAt: ctx.created_at ? new Date(ctx.created_at).getTime() : Date.now(),
        updatedAt: ctx.updated_at ? new Date(ctx.updated_at).getTime() : Date.now()
      }));

    this.store.state.transactions = activeCloudTxs;

    // ÖNEMLİ: Boş veya varsayılan yerel state'i buluta PUSH ETME!
    // Sadece cloud -> local hydrate.

    // ADIM 4: LocalStorage'a persist et ve arayüzü bilgilendir
    const applyRemoteData = () => {
      this.store.state.transactions = activeCloudTxs;
      this.store.saveToStorage();
      this.store.notify();
    };

    if (this.store && typeof this.store.withRemoteUpdate === 'function') {
      this.store.withRemoteUpdate(applyRemoteData);
    } else {
      applyRemoteData();
    }

    console.info(`[SyncService] Full Cloud Bootstrap başarıyla tamamlandı. (${activeCloudTxs.length} aktif işlem yüklendi)`);
  }

  // 4. İki Yönlü Delta Senkronizasyonu (Pull + Push)
  async runDeltaSync(user, cloudMeta, { pullOnly = false } = {}) {
    const client = this.getClient();
    const lastSyncedAt = this.getLastSyncedAt() || null;
    const lastSyncedTime = lastSyncedAt ? (new Date(lastSyncedAt).getTime() || 0) : 0;
    let hasPushedData = false;

    // --- PULL & SYNC: user_settings (Çift yönlü senkronizasyon & Last-Write-Wins) ---
    const { data: cloudSettings, error: settingsErr } = await client
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingsErr) {
      throw new Error(`user_settings okunamadı: ${settingsErr.message}`);
    }

    const localSettings = this.store.state.settings || {};
    const localSettingsUpdated = localSettings.updatedAt ? new Date(localSettings.updatedAt).getTime() : 0;
    const cloudSettingsUpdated = cloudSettings?.updated_at ? new Date(cloudSettings.updated_at).getTime() : 0;

    if (cloudSettings && cloudSettingsUpdated > localSettingsUpdated) {
      // Buluttaki ayarlar daha güncel -> Yereli güncelle (Cloud updated_at korunur)
      this.store.state.settings = {
        ...this.store.state.settings,
        currency: cloudSettings.currency || this.store.state.settings.currency,
        language: cloudSettings.language || this.store.state.settings.language,
        targetMonth: cloudSettings.target_month || this.store.state.settings.targetMonth,
        monthStartDay: cloudSettings.month_start_day || this.store.state.settings.monthStartDay,
        warningThresholdPercent: cloudSettings.warning_threshold_percent || this.store.state.settings.warningThresholdPercent,
        theme: cloudSettings.theme || this.store.state.settings.theme,
        initialBudget: {
          initialBalance: Number(cloudSettings.initial_balance) || 0,
          monthlyIncome: Number(cloudSettings.monthly_income) || 0,
          targetMonth: cloudSettings.target_month,
          initialBalanceTxId: cloudSettings.initial_balance_tx_id,
          monthlyIncomeTxId: cloudSettings.monthly_income_tx_id
        },
        updatedAt: cloudSettingsUpdated
      };
      this.store.state.onboarded = Boolean(cloudSettings.onboarded);
      if (this.store) this.store.dirtySettings = false;
    } else if (!pullOnly && (this.store?.dirtySettings || (!cloudSettings && localSettingsUpdated > 0) || (localSettingsUpdated > cloudSettingsUpdated))) {
      // Yerel ayarlar daha güncel veya bulutta henüz yok -> Yalnızca pullOnly DEĞİLSE ve yerel ayar dirty ise gönder
      const initBudget = localSettings.initialBudget || {};
      const userSettingsPayload = {
        user_id: user.id,
        currency: localSettings.currency || 'TRY',
        language: localSettings.language || 'tr',
        target_month: localSettings.targetMonth || getCurrentYearMonth(),
        month_start_day: localSettings.monthStartDay || 1,
        warning_threshold_percent: localSettings.warningThresholdPercent || 15,
        theme: localSettings.theme || 'light',
        onboarded: Boolean(this.store.state.onboarded),
        initial_balance: Number(initBudget.initialBalance) || 0,
        monthly_income: Number(initBudget.monthlyIncome) || 0,
        initial_balance_tx_id: isValidUUID(initBudget.initialBalanceTxId) ? initBudget.initialBalanceTxId : null,
        monthly_income_tx_id: isValidUUID(initBudget.monthlyIncomeTxId) ? initBudget.monthlyIncomeTxId : null,
        updated_at: new Date(localSettingsUpdated || Date.now()).toISOString()
      };

      const { error: pushSettingsErr } = await client
        .from('user_settings')
        .upsert(userSettingsPayload);

      if (pushSettingsErr) {
        throw new Error(`user_settings gönderilemedi: ${pushSettingsErr.message}`);
      }
      if (this.store) this.store.dirtySettings = false;
      hasPushedData = true;
    }

    // --- PULL & SYNC: presets (Çift yönlü senkronizasyon & Last-Write-Wins) ---
    const { data: cloudPresets, error: presetsErr } = await client
      .from('presets')
      .select('*')
      .eq('user_id', user.id);

    if (presetsErr) {
      throw new Error(`presets okunamadı: ${presetsErr.message}`);
    }

    const localPresets = this.store.getPresets();
    const cloudPresetMap = new Map((cloudPresets || []).map(cp => [cp.preset_key, cp]));
    const presetsToPush = [];
    const mergedPresets = [];

    for (const lp of localPresets) {
      const cp = cloudPresetMap.get(lp.id);
      const localUpdated = lp.updatedAt ? new Date(lp.updatedAt).getTime() : (this.store.state.settings?.presetsUpdatedAt || 0);
      const cloudUpdated = cp?.updated_at ? new Date(cp.updated_at).getTime() : 0;

      if (cp && cloudUpdated > localUpdated) {
        // Buluttaki preset daha yeni
        mergedPresets.push({
          id: cp.preset_key,
          name: cp.name,
          emoji: cp.emoji,
          amount: Number(cp.amount),
          categoryId: cp.category_id,
          updatedAt: cloudUpdated
        });
      } else {
        // Yereldeki preset daha yeni veya eşit
        mergedPresets.push({
          ...lp,
          updatedAt: localUpdated || cloudUpdated || Date.now()
        });

        if (!pullOnly && (this.store?.dirtyPresets || (!cp && localUpdated > 0) || (cp && localUpdated > cloudUpdated))) {
          presetsToPush.push({
            user_id: user.id,
            preset_key: lp.id,
            name: lp.name,
            emoji: lp.emoji,
            amount: Math.round(Number(lp.amount) * 100) / 100,
            category_id: lp.categoryId,
            updated_at: new Date(localUpdated || Date.now()).toISOString()
          });
        }
      }
    }

    // Bulutta olup yerelde bulunmayan preset'leri de içeri al
    if (cloudPresets && cloudPresets.length > 0) {
      const localKeySet = new Set(localPresets.map(lp => lp.id));
      for (const cp of cloudPresets) {
        if (!localKeySet.has(cp.preset_key)) {
          mergedPresets.push({
            id: cp.preset_key,
            name: cp.name,
            emoji: cp.emoji,
            amount: Number(cp.amount),
            categoryId: cp.category_id,
            updatedAt: new Date(cp.updated_at).getTime()
          });
        }
      }
    }

    this.store.state.settings.presets = mergedPresets;
    if (this.store) this.store.dirtyPresets = false;

    if (!pullOnly && presetsToPush.length > 0) {
      const { error: pushPresetsErr } = await client
        .from('presets')
        .upsert(presetsToPush, { onConflict: 'user_id,preset_key' });

      if (pushPresetsErr) {
        throw new Error(`presets gönderilemedi: ${pushPresetsErr.message}`);
      }
      hasPushedData = true;
    }

    // --- PULL: transactions (Delta: Sadece updated_at > lastSyncedAt olanlar veya tümü) ---
    let txQuery = client
      .from('transactions')
      .select('*')
      .eq('user_id', user.id);

    if (lastSyncedAt) {
      txQuery = txQuery.gt('updated_at', lastSyncedAt);
    }

    const { data: cloudTxs, error: cloudTxsErr } = await txQuery;

    if (cloudTxsErr) {
      throw new Error(`transactions çekilemedi: ${cloudTxsErr.message}`);
    }

    if (cloudTxs && cloudTxs.length > 0) {
      const localMap = new Map((this.store.state.transactions || []).map(t => [t.id, t]));

      cloudTxs.forEach(ctx => {
        if (ctx.is_deleted) {
          // Soft-deleted: Yerel listeden kaldır
          localMap.delete(ctx.id);
        } else {
          const localItem = localMap.get(ctx.id);
          const cloudUpdated = new Date(ctx.updated_at).getTime();
          const localUpdated = localItem?.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;

          // Last-write-wins: Bulut daha yeniyse veya yerelde yoksa güncelle
          if (!localItem || cloudUpdated >= localUpdated) {
            localMap.set(ctx.id, {
              id: ctx.id,
              title: ctx.title,
              amount: Number(ctx.amount),
              type: ctx.type,
              categoryId: ctx.category_id,
              date: ctx.date,
              notes: ctx.notes || '',
              createdAt: ctx.created_at ? new Date(ctx.created_at).getTime() : Date.now(),
              updatedAt: ctx.updated_at ? new Date(ctx.updated_at).getTime() : Date.now()
            });
          }
        }
      });

      this.store.state.transactions = Array.from(localMap.values());
    }

    // --- PUSH: Soft-delete kuyruğundakileri bulutta UPDATE et (YALNIZCA pullOnly DEĞİLSE) ---
    if (!pullOnly) {
      const deletedQueue = this.getDeletedQueue();
      if (deletedQueue.length > 0) {
        const successfullyDeletedIds = [];
        for (const item of deletedQueue) {
          const { error: delErr } = await client
            .from('transactions')
            .update({
              is_deleted: true,
              deleted_at: item.deletedAt || new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id)
            .eq('user_id', user.id);

          if (delErr) {
            if (successfullyDeletedIds.length > 0) {
              this.clearDeletedQueue(successfullyDeletedIds);
            }
            throw new Error(`Soft-delete güncellenemedi (${item.id}): ${delErr.message}`);
          }
          successfullyDeletedIds.push(item.id);
        }

        if (successfullyDeletedIds.length > 0) {
          this.clearDeletedQueue(successfullyDeletedIds);
          hasPushedData = true;
        }
      }

      // --- PUSH: Yerel güncel işlemleri buluta gönder (Delta: updatedAt > lastSyncedTime olanlar) ---
      const localTxs = this.store.getTransactions();
      const txToPush = lastSyncedTime > 0
        ? localTxs.filter(t => t.updatedAt && new Date(t.updatedAt).getTime() > lastSyncedTime)
        : [];

      if (txToPush.length > 0) {
        const txPayload = txToPush.map(t => {
          const upIso = t.updatedAt ? new Date(t.updatedAt).toISOString() : new Date().toISOString();
          this.recordLocalWrite(t.id, upIso);
          return {
            id: t.id,
            user_id: user.id,
            title: t.title,
            amount: Math.round(Number(t.amount) * 100) / 100,
            type: t.type,
            category_id: t.categoryId,
            date: t.date,
            notes: t.notes || null,
            is_deleted: false,
            created_at: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
            updated_at: upIso
          };
        });

        const { error: pushTxErr } = await client
          .from('transactions')
          .upsert(txPayload);

        if (pushTxErr) {
          throw new Error(`transactions gönderilemedi: ${pushTxErr.message}`);
        }
        hasPushedData = true;
      }
    }

    // --- METADATA: user_sync_metadata last_synced_at güncelle ---
    // YALNIZCA bu cihaz buluta gerçek bir PUSH gerçekleştirdiyse cloud metadata'yı güncelle!
    if (hasPushedData) {
      const syncTimestamp = new Date().toISOString();
      const { error: metaUpdateErr } = await client
        .from('user_sync_metadata')
        .update({
          last_synced_at: syncTimestamp
        })
        .eq('user_id', user.id);

      if (metaUpdateErr) {
        console.warn(`[SyncService] user_sync_metadata güncellenemedi: ${metaUpdateErr.message}`);
      }
    }

    // Yerel store'u kaydet ve UI'ı güncelle
    if (this.store && typeof this.store.withRemoteUpdate === 'function') {
      this.store.withRemoteUpdate(() => {
        this.store.saveToStorage();
        this.store.notify();
      });
    } else {
      this.store.notify();
    }
  }

  // Kural 7: Güvenli yerel yedek
  createPreCloudBackup() {
    try {
      const backupData = {
        backupAt: new Date().toISOString(),
        state: this.store.state
      };
      SafeStorage.setItem(PRE_CLOUD_BACKUP_KEY, JSON.stringify(backupData));
      console.info('[SyncService] Güvenli yerel yedek oluşturuldu.');
    } catch (e) {
      console.warn('[SyncService] Yedekleme uyarısı:', e);
    }
  }

  // Kural 8: Eski transaction ID'lerinin UUID formatına güvenle dönüştürülmesi
  normalizeLegacyTransactionIds() {
    let changed = false;
    const txs = this.store.getTransactions();
    const idMap = new Map();

    const normalizedTxs = txs.map(tx => {
      if (!isValidUUID(tx.id)) {
        const newUuid = generateUUID();
        idMap.set(tx.id, newUuid);
        changed = true;
        const preservedNote = tx.notes ? `${tx.notes} [Eski ID: ${tx.id}]` : `[Eski ID: ${tx.id}]`;
        return {
          ...tx,
          id: newUuid,
          notes: preservedNote
        };
      }
      return tx;
    });

    if (changed) {
      this.store.state.transactions = normalizedTxs;

      // Initial budget ID referanslarını da güncelle
      const initBudget = this.store.state.settings?.initialBudget;
      if (initBudget) {
        if (initBudget.initialBalanceTxId && idMap.has(initBudget.initialBalanceTxId)) {
          initBudget.initialBalanceTxId = idMap.get(initBudget.initialBalanceTxId);
        }
        if (initBudget.monthlyIncomeTxId && idMap.has(initBudget.monthlyIncomeTxId)) {
          initBudget.monthlyIncomeTxId = idMap.get(initBudget.monthlyIncomeTxId);
        }
      }
      this.store.notify();
      console.info("[SyncService] Legacy ID'ler UUID formatına başarıyla dönüştürüldü.");
    }
  }
}
