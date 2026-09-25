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
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
    this.statusListeners = [];
    this.isSyncing = false;

    // Online/Offline tarayıcı dinleyicileri
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.setStatus(navigator.onLine ? 'idle' : 'offline');
        if (authService.isLoggedIn()) {
          this.sync();
        }
      });
      window.addEventListener('offline', () => {
        this.setStatus('offline');
      });
    }

    // Auth durum değişikliklerinde senkronizasyonu tetikle
    authService.onAuthStateChange((user, session, event) => {
      if (user) {
        this.handleUserLogin(user);
      } else {
        this.setStatus('idle');
      }
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
    if (!user || this.isSyncing) return;
    try {
      await this.sync(user);
    } catch (err) {
      console.error('[SyncService] Giriş sonrası senkronizasyon hatası:', err);
    }
  }

  getClient() {
    return this.client || supabase;
  }

  // 2. Ana Senkronizasyon Akışı
  async sync(passedUser = null) {
    const client = this.getClient();
    if ((!this.client && !isSupabaseConfigured()) || !client) {
      this.setStatus('offline', 'Supabase yapılandırılmamış');
      return { success: false, reason: 'unconfigured' };
    }

    const user = passedUser || authService.getUser();
    if (!user) {
      this.setStatus('idle');
      return { success: false, reason: 'not_authenticated' };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus('offline', 'İnternet bağlantısı yok');
      return { success: false, reason: 'offline' };
    }

    if (this.isSyncing) {
      return { success: false, reason: 'already_syncing' };
    }

    this.isSyncing = true;
    this.setStatus('syncing', 'Bulut ile eşitleniyor...');

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

      if (!meta) {
        // İLK MIGRATION (Bu hesap bulutta henüz ilklendirilmemiş)
        console.info('[SyncService] İlk bulut ilklendirmesi (Initial Migration) başlatılıyor...');
        await this.runInitialMigration(user);
      } else {
        // DELTA SYNC (Daha önce ilklendirilmiş hesap)
        console.info('[SyncService] Çift yönlü delta senkronizasyonu başlatılıyor...');
        await this.runDeltaSync(user, meta);
      }

      const nowIso = new Date().toISOString();
      this.setLastSyncedAt(nowIso);
      this.setStatus('synced', 'Bulut ile başarıyla eşitlendi');
      return { success: true };
    } catch (err) {
      console.error('[SyncService] Senkronizasyon hatası:', err);
      this.setStatus('error', err.message || 'Senkronizasyon başarısız');
      return { success: false, error: err };
    } finally {
      this.isSyncing = false;
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

  // 4. İki Yönlü Delta Senkronizasyonu (Pull + Push)
  async runDeltaSync(user, cloudMeta) {
    const client = this.getClient();
    const lastSyncedAt = this.getLastSyncedAt() || cloudMeta?.last_synced_at || null;
    const lastSyncedTime = lastSyncedAt ? (new Date(lastSyncedAt).getTime() || 0) : 0;

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
      // Buluttaki ayarlar daha güncel -> Yereli güncelle
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
    } else if (!cloudSettings || localSettingsUpdated > cloudSettingsUpdated) {
      // Yerel ayarlar daha güncel veya bulutta henüz yok -> Buluta gönder
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
          updatedAt: localUpdated || Date.now()
        });

        if (!cp || localUpdated > cloudUpdated) {
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

    if (presetsToPush.length > 0) {
      const { error: pushPresetsErr } = await client
        .from('presets')
        .upsert(presetsToPush, { onConflict: 'user_id,preset_key' });

      if (pushPresetsErr) {
        throw new Error(`presets gönderilemedi: ${pushPresetsErr.message}`);
      }
    }

    this.store.state.settings.presets = mergedPresets;

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

    // --- PUSH: Soft-delete kuyruğundakileri bulutta UPDATE et (Asla INSERT/UPSERT değil) ---
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
      }
    }

    // --- PUSH: Yerel güncel işlemleri buluta gönder (Delta: updatedAt > lastSyncedTime olanlar) ---
    const localTxs = this.store.getTransactions();
    const txToPush = lastSyncedTime > 0
      ? localTxs.filter(t => !t.updatedAt || new Date(t.updatedAt).getTime() > lastSyncedTime)
      : localTxs;

    if (txToPush.length > 0) {
      const txPayload = txToPush.map(t => ({
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

      const { error: pushTxErr } = await client
        .from('transactions')
        .upsert(txPayload);

      if (pushTxErr) {
        throw new Error(`transactions gönderilemedi: ${pushTxErr.message}`);
      }
    }

    // --- METADATA: user_sync_metadata last_synced_at güncelle ---
    const syncTimestamp = new Date().toISOString();
    const { error: metaUpdateErr } = await client
      .from('user_sync_metadata')
      .update({
        last_synced_at: syncTimestamp
      })
      .eq('user_id', user.id);

    if (metaUpdateErr) {
      throw new Error(`user_sync_metadata güncellenemedi: ${metaUpdateErr.message}`);
    }

    // Yerel store'u kaydet ve UI'ı güncelle
    this.store.notify();
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
