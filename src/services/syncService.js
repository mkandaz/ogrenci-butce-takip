import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { authService } from './authService.js';
import { generateUUID, isValidUUID, getCurrentYearMonth } from '../utils/helpers.js';
import { SafeStorage } from '../utils/storage.js';

const LAST_SYNCED_KEY = 'student_budget_last_synced_at';
const PRE_CLOUD_BACKUP_KEY = 'student_budget_pre_cloud_backup';
const DELETED_QUEUE_KEY = 'student_budget_deleted_queue';
const SYNC_OUTBOX_KEY = 'student_budget_sync_outbox';
export const PLANNED_CASHFLOW_OUTBOX_KEY = 'student_budget_planned_cashflow_outbox';

// --- Mappers for Planned Cashflows ---
export function mapPlannedCashflowToDb(item, userId) {
  if (!item) return null;
  const createdAtIso = item.createdAt
    ? (typeof item.createdAt === 'number' ? new Date(item.createdAt).toISOString() : new Date(item.createdAt).toISOString())
    : new Date().toISOString();
  const updatedAtIso = item.updatedAt
    ? (typeof item.updatedAt === 'number' ? new Date(item.updatedAt).toISOString() : new Date(item.updatedAt).toISOString())
    : new Date().toISOString();

  return {
    id: item.id,
    user_id: userId,
    name: String(item.name || '').trim(),
    type: item.type === 'income' ? 'income' : 'expense',
    amount: Math.round(Number(item.amount) * 100) / 100,
    recurrence: item.recurrence === 'monthly' ? 'monthly' : 'once',
    day_of_month: item.recurrence === 'monthly' ? (Number(item.dayOfMonth) || null) : null,
    date: item.recurrence === 'once' ? (item.date || null) : null,
    start_date: item.startDate || null,
    end_date: item.endDate || null,
    category_id: item.categoryId || null,
    is_active: item.isActive !== false,
    is_deleted: Boolean(item.isDeleted),
    deleted_at: item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    created_at: createdAtIso,
    updated_at: updatedAtIso
  };
}

export function mapPlannedCashflowFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: String(row.name || '').trim(),
    type: row.type,
    amount: Number(row.amount) || 0,
    recurrence: row.recurrence,
    dayOfMonth: row.day_of_month !== null && row.day_of_month !== undefined ? Number(row.day_of_month) : null,
    date: row.date || null,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    categoryId: row.category_id || null,
    isActive: Boolean(row.is_active),
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

export class SyncService {
  constructor(store, customClient = null) {
    this.store = store;
    this.client = customClient;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'pending' | 'synced' | 'offline' | 'error'
    this.statusListeners = [];
    this.isSyncing = false;
    this.isRecovering = false;
    this.debounceTimer = null;
    this.remoteSyncTimer = null;
    this.safetyCatchUpTimer = null;
    this.pendingSyncRequested = false;
    this.pendingRemotePullRequested = false;
    this.recentLocalWrites = new Map();
    this.lastSyncAttemptTime = 0;
    this.realtimeChannel = null;
    this.realtimeStatus = 'DISCONNECTED';
    this.realtimeDisconnected = false;
    this.realtimeDisconnectedAt = 0;
    this.lastFullCatchUpTime = 0;
    this.hasPerformedStartupCatchUp = false;
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
        if (event === 'SIGNED_IN' || (typeof window !== 'undefined' && (event === 'INITIAL' || event === 'INITIAL_SESSION'))) {
          this.handleUserLogin(user);
        }
      } else {
        this.unsubscribeRealtime();
        this.stopForegroundPolling();
        this.setStatus('idle');
      }
    });

    if (this.store && (this.getOutbox().length > 0 || this.getPlannedCashflowOutbox().length > 0 || this.store.dirtySettings || this.store.dirtyPresets)) {
      this.store.hasUnsyncedChanges = true;
    }

    if (typeof window !== 'undefined') {
      const initialUser = (this.authService && typeof this.authService.getUser === 'function')
        ? this.authService.getUser()
        : (typeof authService !== 'undefined' && authService.getUser ? authService.getUser() : null);
      if (initialUser && !this.hasPerformedStartupCatchUp) {
        this.setupRealtimeSubscription(initialUser);
        this.startForegroundPolling(120000);
        this.handleUserLogin(initialUser);
      }
    }
  }

  scheduleDebouncedSync(delay = 1000) {
    const user = authService.getUser();
    if (!user) return;

    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || this.syncStatus === 'offline') {
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
    if ((tableName === 'transactions' || tableName === 'planned_cashflows') && record && record.id) {
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
          table: 'planned_cashflows',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => handleRemoteChange('planned_cashflows', payload)
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
          if (this.realtimeDisconnected) {
            console.info('[SyncService] [Lifecycle] Realtime yeniden bağlandı (SUBSCRIBED). Reconnect Recovery ve Full Catch-up tetikleniyor...');
            this.realtimeDisconnected = false;
            this.realtimeDisconnectedAt = 0;
            this.recoverAfterReconnect(user).catch(recErr => {
              console.warn('[SyncService] Realtime reconnect recovery hatası:', recErr);
            });
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[SyncService] Realtime kanal hatası/kopukluk (${status}):`, err);
          this.realtimeDisconnected = true;
          this.realtimeDisconnectedAt = Date.now();
          this.setStatus('syncing', 'Bağlantı yeniden kuruluyor...');
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

  resubscribeRealtimeIfDisconnected(user) {
    if (!user || !user.id) return;
    if (this.realtimeStatus !== 'SUBSCRIBED' || !this.realtimeChannel || this.realtimeDisconnected) {
      console.info('[SyncService] Realtime kanalı kapalı/kopuk, yeniden abone olunuyor...');
      this.setupRealtimeSubscription(user);
    }
  }

  scheduleSafetyCatchUp(user, delayMs = 1500) {
    if (this.safetyCatchUpTimer) {
      clearTimeout(this.safetyCatchUpTimer);
      this.safetyCatchUpTimer = null;
    }

    this.safetyCatchUpTimer = setTimeout(async () => {
      this.safetyCatchUpTimer = null;
      try {
        const currentUser = user || (this.authService ? this.authService.getUser() : authService.getUser());
        if (!currentUser) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

        console.info('[SyncService] Emniyet catch-up kontrolü (1.5s staggered check)...');
        await this.runFullCloudCatchUp(currentUser);
        this.setLastSyncedAt(new Date().toISOString());
      } catch (err) {
        console.warn('[SyncService] Emniyet catch-up uyarısı:', err);
      }
    }, delayMs);

    if (this.safetyCatchUpTimer && typeof this.safetyCatchUpTimer.unref === 'function') {
      this.safetyCatchUpTimer.unref();
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

    const handleLifecycleResume = async (triggerName = 'Yaşam döngüsü resume') => {
      const user = (this.authService && typeof this.authService.getUser === 'function')
        ? this.authService.getUser()
        : authService.getUser();
      if (!user) return;

      const outbox = this.getOutbox();
      const hasDirty = Boolean(
        outbox.length > 0 ||
        (this.store && this.store.hasUnsyncedChanges) ||
        (this.store && this.store.dirtySettings) ||
        (this.store && this.store.dirtyPresets) ||
        (this.getDeletedQueue().length > 0)
      );

      // Eğer outbox'ta bekleyen işlem varsa veya dirty ise derhal recovery / flush yap!
      if (hasDirty) {
        console.info(`[SyncService] ${triggerName} -> Outbox/dirty veriler mevcut, kurtarma başlatılıyor...`);
        if (!this.isSyncing && !this.isRecovering) {
          await this.recoverAfterReconnect(user);
        }
        return;
      }

      const now = Date.now();
      const elapsed = now - this.lastSyncAttemptTime;
      if (elapsed < 3000) return;

      // Realtime sağlıklı mı kontrolü
      const isRealtimeHealthy = (this.realtimeStatus === 'SUBSCRIBED' && !this.realtimeDisconnected);
      const timeSinceLastFullCatchUp = now - (this.lastFullCatchUpTime || 0);

      // Realtime kapalıysa/kopuksa VEYA son full catch-up üzerinden 45 saniye geçmişse:
      // Focus/visibility/pageshow anında güvenli bir Full Catch-up çalıştır!
      if (!isRealtimeHealthy || timeSinceLastFullCatchUp > 45000) {
        console.info(`[SyncService] ${triggerName} -> Realtime sağlıksız veya son tam tarama > 45s -> Full Cloud Catch-up...`);
        this.lastFullCatchUpTime = now;
        this.lastSyncAttemptTime = now;
        try {
          await this.runFullCloudCatchUp(user);
          this.setLastSyncedAt(new Date().toISOString());
          this.setStatus('synced', 'Bulut ile başarıyla eşitlendi');
        } catch (e) {
          console.warn('[SyncService] Resume full catch-up uyarısı:', e);
        }
      } else {
        console.info(`[SyncService] ${triggerName} -> Realtime sağlıklı, delta pull kontrolü...`);
        this.scheduleRemoteDeltaSync(300);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          handleLifecycleResume('Görünürlük değişti (visible)');
        }
      });
    }

    window.addEventListener('pageshow', () => {
      handleLifecycleResume('Sayfa görüntülendi (pageshow)');
    });

    window.addEventListener('focus', () => {
      handleLifecycleResume('Pencere odaklandı (focus)');
    });

    window.addEventListener('online', async () => {
      console.info('[SyncService] İnternet bağlantısı sağlandı -> Reconnect Recovery başlatılıyor...');
      const user = (this.authService && typeof this.authService.getUser === 'function')
        ? this.authService.getUser()
        : authService.getUser();
      if (user) {
        await this.recoverAfterReconnect(user);
      } else {
        this.setStatus('idle');
      }
    });

    window.addEventListener('offline', () => {
      this.realtimeStatus = 'DISCONNECTED';
      this.realtimeDisconnected = true;
      this.realtimeDisconnectedAt = Date.now();
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

  // Durable Outbox Takibi (student_budget_sync_outbox)
  getOutbox() {
    if (this.store && typeof this.store.getOutbox === 'function') {
      return this.store.getOutbox();
    }
    try {
      const raw = SafeStorage.getItem(SYNC_OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  removeFromOutbox(txIds = []) {
    if (this.store && typeof this.store.removeFromOutbox === 'function') {
      return this.store.removeFromOutbox(txIds);
    }
    try {
      if (!txIds || !txIds.length) {
        SafeStorage.removeItem(SYNC_OUTBOX_KEY);
      } else {
        const idSet = new Set(txIds);
        const queue = this.getOutbox();
        const filtered = queue.filter(item => !idSet.has(item.id));
        if (filtered.length === 0) {
          SafeStorage.removeItem(SYNC_OUTBOX_KEY);
        } else {
          SafeStorage.setItem(SYNC_OUTBOX_KEY, JSON.stringify(filtered));
        }
      }
    } catch (e) {
      console.warn('[SyncService] removeFromOutbox hatası:', e);
    }
  }

  // Durable Planned Cashflow Outbox Takibi (student_budget_planned_cashflow_outbox)
  getPlannedCashflowOutbox() {
    if (this.store && typeof this.store.getPlannedCashflowOutbox === 'function') {
      return this.store.getPlannedCashflowOutbox();
    }
    try {
      const raw = SafeStorage.getItem(PLANNED_CASHFLOW_OUTBOX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  removeFromPlannedCashflowOutbox(ids = []) {
    if (this.store && typeof this.store.removeFromPlannedCashflowOutbox === 'function') {
      return this.store.removeFromPlannedCashflowOutbox(ids);
    }
    try {
      if (!ids || !ids.length) {
        SafeStorage.removeItem(PLANNED_CASHFLOW_OUTBOX_KEY);
      } else {
        const idSet = new Set(ids);
        const queue = this.getPlannedCashflowOutbox();
        const filtered = queue.filter(item => !idSet.has(item.id));
        if (filtered.length === 0) {
          SafeStorage.removeItem(PLANNED_CASHFLOW_OUTBOX_KEY);
        } else {
          SafeStorage.setItem(PLANNED_CASHFLOW_OUTBOX_KEY, JSON.stringify(filtered));
        }
      }
    } catch (e) {
      console.warn('[SyncService] removeFromPlannedCashflowOutbox hatası:', e);
    }
  }

  async flushOutboxThenCatchUp(user = null) {
    return this.recoverAfterReconnect(user);
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
      await this.sync({ user, reason: 'startup' });
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

    if (opts.reason === 'online') {
      return this.recoverAfterReconnect(user);
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
      const outbox = this.getOutbox();
      const plannedOutbox = this.getPlannedCashflowOutbox();
      const hasPendingOutbox = outbox.length > 0 || plannedOutbox.length > 0;
      const hasDirty = Boolean(
        hasPendingOutbox ||
        (this.store && this.store.hasUnsyncedChanges) ||
        (this.store && this.store.dirtySettings) ||
        (this.store && this.store.dirtyPresets) ||
        (this.getDeletedQueue().length > 0)
      );

      if (!meta) {
        // İLK MIGRATION (Bu hesap bulutta henüz ilklendirilmemiş)
        console.info('[SyncService] İlk bulut ilklendirmesi (Initial Migration) başlatılıyor...');
        await this.runInitialMigration(user);
        this.removeFromOutbox();
        this.removeFromPlannedCashflowOutbox();
        this.hasPerformedStartupCatchUp = true;
        this.lastFullCatchUpTime = Date.now();
      } else if (!localLastSyncedAt && !hasDirty) {
        // FRESH DEVICE / EMPTY LOCALSTORAGE BOOTSTRAP (Sadece yerel dirty veri yoksa)
        console.info('[SyncService] Fresh device tespit edildi. Full Cloud Bootstrap başlatılıyor...');
        await this.runFullCloudBootstrap(user, meta);
        this.hasPerformedStartupCatchUp = true;
        this.lastFullCatchUpTime = Date.now();
      } else if ((!pullOnly && hasDirty) || opts.reason === 'startup' || opts.reason === 'online' || (typeof window !== 'undefined' && !this.hasPerformedStartupCatchUp && !pullOnly && opts.reason !== 'local-change')) {
        // STARTUP / RECONNECT / OUTBOX FLUSH ORDER:
        console.info('[SyncService] Startup Self-Heal: Mevcut cihaz için filtresiz Full Cloud Catch-up başlatılıyor...');
        this.hasPerformedStartupCatchUp = true;
        this.lastFullCatchUpTime = Date.now();

        // 1. Önce bekleyen yerel dirty/outbox verilerini PUSH et
        if (hasDirty) {
          console.info('[SyncService] [Startup] Bekleyen outbox/dirty veriler buluta PUSH ediliyor...');
          await this.pushLocalChanges(user, client);
        }

        // 2. Ardından filtresiz tam CATCH-UP yap & LWW merge yap
        console.info('[SyncService] [Startup] Buluttan tam CATCH-UP yapılıyor...');
        await this.runFullCloudCatchUp(user, client);
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
      const isNet = (typeof navigator !== 'undefined' && navigator.onLine === false) || err.message?.includes('fetch') || err.message?.includes('network');
      this.setStatus(isNet ? 'offline' : 'error', err.message || 'Senkronizasyon başarısız');
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

    // ADIM 3.5: planned_cashflows Batch Upsert
    const plannedCashflows = this.store?.getPlannedCashflows() || [];
    if (plannedCashflows && plannedCashflows.length > 0) {
      const plannedPayload = plannedCashflows.map(p => mapPlannedCashflowToDb({ ...p, isDeleted: false }, user.id));

      const { error: plannedErr } = await client
        .from('planned_cashflows')
        .upsert(plannedPayload);

      if (plannedErr) {
        throw new Error(`planned_cashflows kaydedilemedi: ${plannedErr.message}`);
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

    if (cloudSettings && !this.store?.dirtySettings) {
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

    if (cloudPresets && cloudPresets.length > 0 && !this.store?.dirtyPresets) {
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

    // Eğer outbox'ta bekleyen yerel transaction varsa, bunları bootstrap sırasında kaybetme!
    const localMap = new Map((this.store?.state?.transactions || []).map(t => [t.id, t]));
    const outbox = this.getOutbox();
    const pendingOutboxMap = new Map(outbox.map(item => [item.id, item]));

    // Bulut kayıtlarını ekle/güncelle
    activeCloudTxs.forEach(actx => {
      const pendingItem = pendingOutboxMap.get(actx.id);
      if (!pendingItem || (pendingItem.operation !== 'insert' && pendingItem.operation !== 'update')) {
        localMap.set(actx.id, actx);
      }
    });

    // Cloud'da henüz olmayan yerel insert'ler localMap içinde aynen korunur!
    const activeMergedTxs = Array.from(localMap.values());

    // ADIM 3.5: planned_cashflows Çek (Tüm aktif kayıtlar, last_synced_at filtresi OLMADAN)
    const { data: cloudPlanned, error: cloudPlannedErr } = await client
      .from('planned_cashflows')
      .select('*')
      .eq('user_id', user.id);

    if (cloudPlannedErr) {
      throw new Error(`planned_cashflows okunamadı: ${cloudPlannedErr.message}`);
    }

    const activeCloudPlanned = (cloudPlanned || [])
      .filter(cp => !cp.is_deleted)
      .map(cp => mapPlannedCashflowFromDb(cp));

    const localPlannedMap = new Map((this.store?.state?.plannedCashflows || []).map(p => [p.id, p]));
    const plannedOutbox = this.getPlannedCashflowOutbox();
    const pendingPlannedOutboxMap = new Map(plannedOutbox.map(item => [item.id, item]));

    activeCloudPlanned.forEach(acp => {
      const pendingItem = pendingPlannedOutboxMap.get(acp.id);
      if (pendingItem && pendingItem.operation === 'delete') {
        localPlannedMap.delete(acp.id);
      } else if (!pendingItem || (pendingItem.operation !== 'create' && pendingItem.operation !== 'insert' && pendingItem.operation !== 'update')) {
        localPlannedMap.set(acp.id, acp);
      }
    });

    const activeMergedPlanned = Array.from(localPlannedMap.values());

    this.store.state.transactions = activeMergedTxs;
    this.store.state.plannedCashflows = activeMergedPlanned;
    if (typeof this.store.sortTransactions === 'function') {
      this.store.sortTransactions('date-desc');
    }

    // ADIM 4: LocalStorage'a persist et ve arayüzü bilgilendir
    const applyRemoteData = () => {
      this.store.state.transactions = activeMergedTxs;
      this.store.state.plannedCashflows = activeMergedPlanned;
      if (typeof this.store.sortTransactions === 'function') {
        this.store.sortTransactions('date-desc');
      }
      this.store.saveToStorage();
      this.store.notify();
    };

    if (this.store && typeof this.store.withRemoteUpdate === 'function') {
      this.store.withRemoteUpdate(applyRemoteData);
    } else {
      applyRemoteData();
    }

    console.info(`[SyncService] Full Cloud Bootstrap başarıyla tamamlandı. (${activeCloudTxs.length} aktif işlem, ${activeCloudPlanned.length} aktif planlı akış yüklendi)`);
  }

  // 3.6. Bekleyen Yerel Değişiklikleri Buluta PUSH Etme
  async pushLocalChanges(user, customClient = null) {
    const client = customClient || this.getClient();
    let hasPushedData = false;

    // ADIM 1: user_settings PUSH (Sadece kirli ise)
    if (this.store?.dirtySettings) {
      const localSettings = this.store.state?.settings || {};
      const initBudget = localSettings.initialBudget || {};
      const localSettingsUpdated = localSettings.updatedAt ? new Date(localSettings.updatedAt).getTime() : Date.now();
      const userSettingsPayload = {
        user_id: user.id,
        currency: localSettings.currency || 'TRY',
        language: localSettings.language || 'tr',
        target_month: localSettings.targetMonth || getCurrentYearMonth(),
        month_start_day: localSettings.monthStartDay || 1,
        warning_threshold_percent: localSettings.warningThresholdPercent || 15,
        theme: localSettings.theme || 'light',
        onboarded: Boolean(this.store.state?.onboarded),
        initial_balance: Number(initBudget.initialBalance) || 0,
        monthly_income: Number(initBudget.monthlyIncome) || 0,
        initial_balance_tx_id: isValidUUID(initBudget.initialBalanceTxId) ? initBudget.initialBalanceTxId : null,
        monthly_income_tx_id: isValidUUID(initBudget.monthlyIncomeTxId) ? initBudget.monthlyIncomeTxId : null,
        updated_at: new Date(localSettingsUpdated).toISOString()
      };

      const { error: pushSettingsErr } = await client
        .from('user_settings')
        .upsert(userSettingsPayload);

      if (pushSettingsErr) {
        throw new Error(`user_settings gönderilemedi: ${pushSettingsErr.message}`);
      }
      this.store.dirtySettings = false;
      hasPushedData = true;
    }

    // ADIM 2: presets PUSH (Sadece kirli ise)
    if (this.store?.dirtyPresets) {
      const localPresets = this.store.getPresets() || [];
      if (localPresets.length > 0) {
        const presetsPayload = localPresets.map(lp => ({
          user_id: user.id,
          preset_key: lp.id,
          name: lp.name,
          emoji: lp.emoji,
          amount: Math.round(Number(lp.amount) * 100) / 100,
          category_id: lp.categoryId,
          updated_at: new Date(lp.updatedAt || Date.now()).toISOString()
        }));

        const { error: pushPresetsErr } = await client
          .from('presets')
          .upsert(presetsPayload, { onConflict: 'user_id,preset_key' });

        if (pushPresetsErr) {
          throw new Error(`presets gönderilemedi: ${pushPresetsErr.message}`);
        }
      }
      this.store.dirtyPresets = false;
      hasPushedData = true;
    }

    // ADIM 3: Soft-delete kuyruğu ve Outbox 'delete' PUSH
    const deletedQueue = this.getDeletedQueue();
    const outbox = this.getOutbox();
    const outboxDeletes = outbox.filter(item => item.operation === 'delete');

    const deleteIdMap = new Map();
    deletedQueue.forEach(item => deleteIdMap.set(item.id, item.deletedAt || new Date().toISOString()));
    outboxDeletes.forEach(item => {
      if (!deleteIdMap.has(item.id)) {
        deleteIdMap.set(item.id, item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString());
      }
    });

    if (deleteIdMap.size > 0) {
      const successfullyDeletedIds = [];
      for (const [delId, delAt] of deleteIdMap.entries()) {
        const { error: delErr } = await client
          .from('transactions')
          .update({
            is_deleted: true,
            deleted_at: delAt,
            updated_at: new Date().toISOString()
          })
          .eq('id', delId)
          .eq('user_id', user.id);

        if (delErr) {
          if (successfullyDeletedIds.length > 0) {
            this.clearDeletedQueue(successfullyDeletedIds);
            this.removeFromOutbox(successfullyDeletedIds);
          }
          throw new Error(`Soft-delete güncellenemedi (${delId}): ${delErr.message}`);
        }
        successfullyDeletedIds.push(delId);
      }

      if (successfullyDeletedIds.length > 0) {
        this.clearDeletedQueue(successfullyDeletedIds);
        this.removeFromOutbox(successfullyDeletedIds);
        hasPushedData = true;
      }
    }

    // ADIM 4: Yeni ve güncellenen işlemleri PUSH et (Outbox insert/update & local txs)
    const localTxs = this.store?.getTransactions() || [];
    const localTxMap = new Map(localTxs.map(t => [t.id, t]));
    const lastSyncedAt = this.getLastSyncedAt();
    const lastSyncedTime = lastSyncedAt ? (new Date(lastSyncedAt).getTime() || 0) : 0;

    const outboxUpserts = outbox.filter(item => item.operation === 'insert' || item.operation === 'update');
    const pushTxMap = new Map();

    // 1. Outbox'ta bekleyen insert ve update kayıtları
    outboxUpserts.forEach(item => {
      const tx = localTxMap.get(item.id);
      if (tx) {
        pushTxMap.set(tx.id, tx);
      }
    });

    // 2. Geriye dönük uyumluluk: Son senkronizasyondan sonra değişenler veya hasUnsyncedChanges
    if (lastSyncedTime > 0) {
      localTxs.filter(t => !t.updatedAt || new Date(t.updatedAt).getTime() >= (lastSyncedTime - 5000)).forEach(t => {
        pushTxMap.set(t.id, t);
      });
    } else if (pushTxMap.size === 0 && this.store?.hasUnsyncedChanges) {
      localTxs.forEach(t => pushTxMap.set(t.id, t));
    }

    const txToPush = Array.from(pushTxMap.values());

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

      // SADECE BAŞARILI PUSH SONRASI OUTBOX'TAN KALDIR!
      this.removeFromOutbox(txToPush.map(t => t.id));
      hasPushedData = true;
    }

    // ADIM 4.5: planned_cashflows PUSH (Outbox delete, create, update)
    const plannedOutbox = this.getPlannedCashflowOutbox();
    if (plannedOutbox.length > 0) {
      const localPlannedList = this.store?.getPlannedCashflows() || [];
      const localPlannedMap = new Map(localPlannedList.map(p => [p.id, p]));
      const plannedDeletes = plannedOutbox.filter(item => item.operation === 'delete');
      const plannedUpserts = plannedOutbox.filter(item => item.operation === 'create' || item.operation === 'insert' || item.operation === 'update');

      // 1. Soft-delete planned cashflows
      if (plannedDeletes.length > 0) {
        const successfullyDeletedPlannedIds = [];
        for (const item of plannedDeletes) {
          const delAtIso = item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString();
          const { error: delErr } = await client
            .from('planned_cashflows')
            .update({
              is_deleted: true,
              deleted_at: delAtIso,
              updated_at: delAtIso
            })
            .eq('id', item.id)
            .eq('user_id', user.id);

          if (delErr) {
            if (successfullyDeletedPlannedIds.length > 0) {
              this.removeFromPlannedCashflowOutbox(successfullyDeletedPlannedIds);
            }
            throw new Error(`Planned cashflow soft-delete güncellenemedi (${item.id}): ${delErr.message}`);
          }
          successfullyDeletedPlannedIds.push(item.id);
        }

        if (successfullyDeletedPlannedIds.length > 0) {
          this.removeFromPlannedCashflowOutbox(successfullyDeletedPlannedIds);
          hasPushedData = true;
        }
      }

      // 2. Upsert planned cashflows
      if (plannedUpserts.length > 0) {
        const itemsToUpsert = [];
        for (const outItem of plannedUpserts) {
          const item = outItem.payload || localPlannedMap.get(outItem.id);
          if (item) {
            itemsToUpsert.push(item);
          }
        }

        if (itemsToUpsert.length > 0) {
          const plannedPayload = itemsToUpsert.map(p => {
            const upIso = p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString();
            this.recordLocalWrite(p.id, upIso);
            return mapPlannedCashflowToDb({ ...p, isDeleted: false }, user.id);
          });

          const { error: pushPlannedErr } = await client
            .from('planned_cashflows')
            .upsert(plannedPayload);

          if (pushPlannedErr) {
            throw new Error(`planned_cashflows gönderilemedi: ${pushPlannedErr.message}`);
          }

          this.removeFromPlannedCashflowOutbox(itemsToUpsert.map(p => p.id));
          hasPushedData = true;
        }
      }
    }

    // ADIM 5: user_sync_metadata güncellemesi
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

    if (this.store && typeof this.store.markSynced === 'function') {
      this.store.markSynced();
    }

    return { hasPushedData };
  }

  // 3.7. Yeniden Bağlanma Tam Bulut Eşitlemesi (Full Cloud Catch-Up - Filtresiz)
  async runFullCloudCatchUp(user, customClient = null) {
    const client = customClient || this.getClient();

    // ADIM 1: user_settings Çek & LWW Merge
    const { data: cloudSettings, error: settingsErr } = await client
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingsErr) {
      throw new Error(`user_settings okunamadı: ${settingsErr.message}`);
    }

    if (cloudSettings) {
      const localSettings = this.store?.state?.settings || {};
      const localSettingsUpdated = localSettings.updatedAt ? new Date(localSettings.updatedAt).getTime() : 0;
      const cloudSettingsUpdated = cloudSettings.updated_at ? new Date(cloudSettings.updated_at).getTime() : 0;

      if (!this.store?.dirtySettings && cloudSettingsUpdated >= localSettingsUpdated) {
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
      }
    }

    // ADIM 2: presets Çek & LWW Merge
    const { data: cloudPresets, error: presetsErr } = await client
      .from('presets')
      .select('*')
      .eq('user_id', user.id);

    if (presetsErr) {
      throw new Error(`presets okunamadı: ${presetsErr.message}`);
    }

    if (cloudPresets) {
      const localPresets = this.store?.getPresets() || [];
      const cloudPresetMap = new Map((cloudPresets || []).map(cp => [cp.preset_key, cp]));
      const mergedPresets = [];

      for (const lp of localPresets) {
        const cp = cloudPresetMap.get(lp.id);
        const localUpdated = lp.updatedAt ? new Date(lp.updatedAt).getTime() : (this.store.state.settings?.presetsUpdatedAt || 0);
        const cloudUpdated = cp?.updated_at ? new Date(cp.updated_at).getTime() : 0;

        if (!this.store?.dirtyPresets && cp && cloudUpdated >= localUpdated) {
          mergedPresets.push({
            id: cp.preset_key,
            name: cp.name,
            emoji: cp.emoji,
            amount: Number(cp.amount),
            categoryId: cp.category_id,
            updatedAt: cloudUpdated
          });
        } else {
          mergedPresets.push(lp);
        }
      }

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

      this.store.state.settings.presets = mergedPresets;
    }

    // ADIM 3: transactions Çek: TÜM KAYITLAR (last_synced_at filtresi OLMADAN)
    const { data: cloudTxs, error: cloudTxsErr } = await client
      .from('transactions')
      .select('*')
      .eq('user_id', user.id);

    if (cloudTxsErr) {
      throw new Error(`transactions okunamadı: ${cloudTxsErr.message}`);
    }

    const localMap = new Map((this.store?.state?.transactions || []).map(t => [t.id, t]));
    const outbox = this.getOutbox();
    const pendingOutboxMap = new Map(outbox.map(item => [item.id, item]));

    (cloudTxs || []).forEach(ctx => {
      const pendingItem = pendingOutboxMap.get(ctx.id);

      if (ctx.is_deleted) {
        // Eğer yerel outbox'ta bekleyen insert veya update varsa, cloud silmesini yok say, yerel işlemi KORU!
        if (pendingItem && (pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
          // Yerel bekleyen işlemi koru!
        } else {
          localMap.delete(ctx.id);
        }
      } else {
        const localItem = localMap.get(ctx.id);
        const cloudUpdated = ctx.updated_at ? new Date(ctx.updated_at).getTime() : 0;
        const localUpdated = localItem?.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;

        // Eğer yerel outbox'ta henüz push edilmemiş insert veya update varsa, yerel işlemi KORU!
        if (pendingItem && (pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
          // Yerel bekleyen işlemi koru!
        } else if (!localItem || cloudUpdated >= localUpdated) {
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
        // Eğer yerel daha yeniyse (localUpdated > cloudUpdated), yerel kaydı koru!
      }
    });

    const mergedTransactions = Array.from(localMap.values());

    // ADIM 3.5: planned_cashflows Çek: TÜM KAYITLAR (last_synced_at filtresi OLMADAN)
    const { data: cloudPlanned, error: cloudPlannedErr } = await client
      .from('planned_cashflows')
      .select('*')
      .eq('user_id', user.id);

    if (cloudPlannedErr) {
      throw new Error(`planned_cashflows okunamadı: ${cloudPlannedErr.message}`);
    }

    const localPlannedMap = new Map((this.store?.state?.plannedCashflows || []).map(p => [p.id, p]));
    const plannedOutbox = this.getPlannedCashflowOutbox();
    const pendingPlannedOutboxMap = new Map(plannedOutbox.map(item => [item.id, item]));

    (cloudPlanned || []).forEach(cp => {
      const pendingItem = pendingPlannedOutboxMap.get(cp.id);

      if (cp.is_deleted) {
        if (pendingItem && (pendingItem.operation === 'create' || pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
          // Yerel bekleyen işlemi koru!
        } else {
          localPlannedMap.delete(cp.id);
        }
      } else {
        const localItem = localPlannedMap.get(cp.id);
        const cloudUpdated = cp.updated_at ? new Date(cp.updated_at).getTime() : 0;
        const localUpdated = localItem?.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;

        if (pendingItem && pendingItem.operation === 'delete') {
          // Yerelde silinmiş ve bekleyen DELETE tombstone var -> buluttaki eski kayıt yereli diriltemez!
          localPlannedMap.delete(cp.id);
        } else if (pendingItem && (pendingItem.operation === 'create' || pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
          // Yerel bekleyen işlem varsa KORU!
        } else if (!localItem || cloudUpdated >= localUpdated) {
          localPlannedMap.set(cp.id, mapPlannedCashflowFromDb(cp));
        }
      }
    });

    const mergedPlanned = Array.from(localPlannedMap.values());

    this.store.state.transactions = mergedTransactions;
    this.store.state.plannedCashflows = mergedPlanned;

    const applyRemoteData = () => {
      this.store.state.transactions = mergedTransactions;
      this.store.state.plannedCashflows = mergedPlanned;
      if (typeof this.store.sortTransactions === 'function') {
        this.store.sortTransactions('date-desc');
      }
      this.store.saveToStorage();
      this.store.notify();
    };

    if (this.store && typeof this.store.withRemoteUpdate === 'function') {
      this.store.withRemoteUpdate(applyRemoteData);
    } else {
      applyRemoteData();
    }

    this.lastFullCatchUpTime = Date.now();
    console.info(`[SyncService] Full Cloud Catch-up tamamlandı (${mergedTransactions.length} aktif işlem, ${mergedPlanned.length} aktif planlı akış).`);
  }

  // 3.8. Çevrimdışı Yeniden Bağlanma Kurtarma Akışı (Offline Reconnect Recovery)
  async recoverAfterReconnect(user = null) {
    const client = this.getClient();
    if ((!this.client && !isSupabaseConfigured()) || !client) {
      this.setStatus('offline', 'Supabase yapılandırılmamış');
      return { success: false, reason: 'unconfigured' };
    }

    let currentUser = user;
    if (!currentUser) {
      currentUser = (this.authService && typeof this.authService.getUser === 'function')
        ? this.authService.getUser()
        : authService.getUser();
    }

    if (!currentUser) {
      this.setStatus('idle');
      return { success: false, reason: 'not_authenticated' };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline', 'İnternet bağlantısı yok');
      return { success: false, reason: 'offline' };
    }

    if (this.isRecovering) {
      console.info('[SyncService] Zaten bir Reconnect Recovery çalışıyor, bekleniyor...');
      return { success: false, reason: 'already_recovering' };
    }

    this.isRecovering = true;
    this.isSyncing = true;
    this.lastSyncAttemptTime = Date.now();
    this.setStatus('syncing', 'Yeniden bağlanıldı, veriler eşitleniyor...');

    try {
      // A) Realtime kanalını yeniden bağla / doğrula
      this.resubscribeRealtimeIfDisconnected(currentUser);

      // B) Bu cihazda yerel unpushed/dirty değişiklik var mı?
      const outbox = this.getOutbox();
      const plannedOutbox = this.getPlannedCashflowOutbox();
      const hasDirty = Boolean(
        outbox.length > 0 ||
        plannedOutbox.length > 0 ||
        (this.store && this.store.hasUnsyncedChanges) ||
        (this.store && this.store.dirtySettings) ||
        (this.store && this.store.dirtyPresets) ||
        (this.getDeletedQueue().length > 0)
      );

      // C) Varsa önce PUSH et
      if (hasDirty) {
        console.info('[SyncService] [Recovery] Yerel bekleyen değişiklikler buluta PUSH ediliyor...');
        await this.pushLocalChanges(currentUser, client);
      }

      // D) Buluttan filtresiz tam CATCH-UP yap
      console.info('[SyncService] [Recovery] Buluttan tam CATCH-UP yapılıyor...');
      await this.runFullCloudCatchUp(currentUser, client);

      // E) Her iki adım da başarılı -> imleç güncelle, 'synced' durumuna geç
      const nowIso = new Date().toISOString();
      this.setLastSyncedAt(nowIso);
      this.realtimeDisconnected = false;
      this.lastFullCatchUpTime = Date.now();
      this.setStatus('synced', 'Bulut ile başarıyla eşitlendi');

      // F) Kademeli emniyet yoklaması (1.5s): Diğer cihazın olası geciken push'unu kaçırmamak için
      this.scheduleSafetyCatchUp(currentUser, 1500);

      return { success: true };
    } catch (err) {
      console.error('[SyncService] Reconnect Recovery hatası:', err);
      const isNet = (typeof navigator !== 'undefined' && navigator.onLine === false) || err.message?.includes('fetch') || err.message?.includes('network');
      this.setStatus(isNet ? 'offline' : 'error', err.message || 'Yeniden bağlanma senkronizasyonu başarısız');
      return { success: false, error: err };
    } finally {
      this.isRecovering = false;
      this.isSyncing = false;
    }
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

    if (cloudSettings && !this.store?.dirtySettings && cloudSettingsUpdated > localSettingsUpdated) {
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

      if (cp && !this.store?.dirtyPresets && cloudUpdated > localUpdated) {
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

    if (!pullOnly) {
      if (presetsToPush.length > 0) {
        const { error: pushPresetsErr } = await client
          .from('presets')
          .upsert(presetsToPush, { onConflict: 'user_id,preset_key' });

        if (pushPresetsErr) {
          throw new Error(`presets gönderilemedi: ${pushPresetsErr.message}`);
        }
        if (this.store) this.store.dirtyPresets = false;
        hasPushedData = true;
      } else {
        if (this.store) this.store.dirtyPresets = false;
      }
    }

    // --- PULL: transactions (Delta: Sadece updated_at > lastSyncedAt olanlar veya tümü) ---
    let txQuery = client
      .from('transactions')
      .select('*')
      .eq('user_id', user.id);

    if (lastSyncedAt) {
      const overlapTime = Math.max(0, new Date(lastSyncedAt).getTime() - 10000);
      const overlapIso = new Date(overlapTime).toISOString();
      txQuery = txQuery.gt('updated_at', overlapIso);
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
      if (typeof this.store.sortTransactions === 'function') {
        this.store.sortTransactions('date-desc');
      }
    }

    // --- PULL: planned_cashflows (Delta: Sadece updated_at > lastSyncedAt olanlar veya tümü) ---
    let plannedQuery = client
      .from('planned_cashflows')
      .select('*')
      .eq('user_id', user.id);

    if (lastSyncedAt) {
      const overlapTime = Math.max(0, new Date(lastSyncedAt).getTime() - 10000);
      const overlapIso = new Date(overlapTime).toISOString();
      plannedQuery = plannedQuery.gt('updated_at', overlapIso);
    }

    const { data: cloudPlanned, error: cloudPlannedErr } = await plannedQuery;

    if (cloudPlannedErr) {
      throw new Error(`planned_cashflows çekilemedi: ${cloudPlannedErr.message}`);
    }

    if (cloudPlanned && cloudPlanned.length > 0) {
      const localPlannedMap = new Map((this.store.state.plannedCashflows || []).map(p => [p.id, p]));
      const plannedOutbox = this.getPlannedCashflowOutbox();
      const pendingPlannedOutboxMap = new Map(plannedOutbox.map(item => [item.id, item]));

      cloudPlanned.forEach(cp => {
        const pendingItem = pendingPlannedOutboxMap.get(cp.id);

        if (cp.is_deleted) {
          if (pendingItem && (pendingItem.operation === 'create' || pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
            // Local outbox has pending write -> preserve local
          } else {
            localPlannedMap.delete(cp.id);
          }
        } else {
          const localItem = localPlannedMap.get(cp.id);
          const cloudUpdated = new Date(cp.updated_at).getTime();
          const localUpdated = localItem?.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;

          if (pendingItem && pendingItem.operation === 'delete') {
            // Local outbox delete tombstone wins over stale cloud row!
            localPlannedMap.delete(cp.id);
          } else if (pendingItem && (pendingItem.operation === 'create' || pendingItem.operation === 'insert' || pendingItem.operation === 'update')) {
            // Local outbox wins
          } else if (!localItem || cloudUpdated >= localUpdated) {
            localPlannedMap.set(cp.id, mapPlannedCashflowFromDb(cp));
          }
        }
      });

      this.store.state.plannedCashflows = Array.from(localPlannedMap.values());
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

      // --- PUSH: Planned cashflows (YALNIZCA pullOnly DEĞİLSE) ---
      const plannedOutbox = this.getPlannedCashflowOutbox();
      if (plannedOutbox.length > 0) {
        // Soft deletes
        const plannedDeletes = plannedOutbox.filter(item => item.operation === 'delete');
        if (plannedDeletes.length > 0) {
          const successfullyDeletedPlannedIds = [];
          for (const item of plannedDeletes) {
            const delAtIso = item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString();
            const { error: delErr } = await client
              .from('planned_cashflows')
              .update({
                is_deleted: true,
                deleted_at: delAtIso,
                updated_at: delAtIso
              })
              .eq('id', item.id)
              .eq('user_id', user.id);

            if (delErr) {
              if (successfullyDeletedPlannedIds.length > 0) {
                this.removeFromPlannedCashflowOutbox(successfullyDeletedPlannedIds);
              }
              throw new Error(`Planned cashflow soft-delete güncellenemedi (${item.id}): ${delErr.message}`);
            }
            successfullyDeletedPlannedIds.push(item.id);
          }
          if (successfullyDeletedPlannedIds.length > 0) {
            this.removeFromPlannedCashflowOutbox(successfullyDeletedPlannedIds);
            hasPushedData = true;
          }
        }

        // Upserts
        const localPlannedMap = new Map((this.store?.state?.plannedCashflows || []).map(p => [p.id, p]));
        const plannedUpserts = plannedOutbox.filter(item => item.operation === 'create' || item.operation === 'insert' || item.operation === 'update');
        const itemsToUpsert = [];
        for (const outItem of plannedUpserts) {
          const item = outItem.payload || localPlannedMap.get(outItem.id);
          if (item) itemsToUpsert.push(item);
        }

        if (itemsToUpsert.length > 0) {
          const plannedPayload = itemsToUpsert.map(p => {
            const upIso = p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString();
            this.recordLocalWrite(p.id, upIso);
            return mapPlannedCashflowToDb({ ...p, isDeleted: false }, user.id);
          });

          const { error: pushPlannedErr } = await client
            .from('planned_cashflows')
            .upsert(plannedPayload);

          if (pushPlannedErr) {
            throw new Error(`planned_cashflows gönderilemedi: ${pushPlannedErr.message}`);
          }

          this.removeFromPlannedCashflowOutbox(itemsToUpsert.map(p => p.id));
          hasPushedData = true;
        }
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
        state: this.store.state,
        plannedCashflows: (this.store && typeof this.store.getPlannedCashflows === 'function') ? this.store.getPlannedCashflows() : (this.store?.state?.plannedCashflows || [])
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
