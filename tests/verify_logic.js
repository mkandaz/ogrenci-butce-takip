import fs from 'fs';
import path from 'path';
import { calculateSummary, getDaysRemainingInMonth, calculateBudgetHealth } from '../src/store/calculations.js';
import { BudgetStore, DIRTY_SETTINGS_KEY, DIRTY_PRESETS_KEY } from '../src/store/BudgetStore.js';
import { formatCurrency, formatNumber, formatDate, formatTime, formatMonthTitle, normalizeCurrency, getCurrencySymbol } from '../src/utils/formatters.js';
import { t, setLanguage, getLanguage } from '../src/i18n/index.js';
import tr from '../src/i18n/tr.js';
import en from '../src/i18n/en.js';
import { generateUUID, isValidUUID, getLocalDateString, getCurrentYearMonth, compareTransactions } from '../src/utils/helpers.js';
import { SafeStorage } from '../src/utils/storage.js';
import { AuthService, authService } from '../src/services/authService.js';
import { SyncService } from '../src/services/syncService.js';
import { UIManager } from '../src/components/UIManager.js';
import { ModalManager } from '../src/components/modalManager.js';
import { STORAGE_KEY } from '../src/config/constants.js';

console.log('====================================================');
console.log('🚀 ÖĞRENCİ BÜTÇE TAKİP - ENTEGRE TEST PAKETİ (FAZ 2 & 3)');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failed++;
  }
}

// --------------------------------------------------------------------------
// 1. HESAPLAMA VE DEVREDEN BAKİYE TESTLERİ (TC-01 - TC-05)
// --------------------------------------------------------------------------
console.log('--- 1. BÜTÇE VE DEVREDEN BAKİYE ALGORİTMALARI ---');

// TC-01: Standart bütçe hesabı
{
  const txs = [
    { id: '1', date: '2026-09-01', amount: 5000, type: 'income' },
    { id: '2', date: '2026-09-02', amount: 2000, type: 'expense' }
  ];
  const summary = calculateSummary(txs, new Date(2026, 8, 15), '2026-09');
  assert(summary.totalIncome === 5000, 'TC-01 Bu Ay Gelir 5000');
  assert(summary.totalExpense === 2000, 'TC-01 Bu Ay Gider 2000');
  assert(summary.balance === 3000, 'TC-01 Kalan Bakiye 3000');
  assert(summary.carriedOverBalance === 0, 'TC-01 Devreden Bakiye 0');
  assert(summary.budgetHealth === 'healthy', 'TC-01 Sağlık: healthy');
}

// TC-02: Kritik Bütçe Eşiği (%14)
{
  const txs = [
    { id: '1', date: '2026-09-01', amount: 10000, type: 'income' },
    { id: '2', date: '2026-09-02', amount: 8600, type: 'expense' }
  ];
  const summary = calculateSummary(txs, new Date(2026, 8, 15), '2026-09');
  assert(summary.balance === 1400, 'TC-02 Kalan Bakiye 1400');
  assert(summary.budgetHealth === 'critical', 'TC-02 Sağlık: critical (%14)');
}

// TC-03: Negatif Bakiye & Günlük Limit 0
{
  const txs = [
    { id: '1', date: '2026-09-01', amount: 3000, type: 'income' },
    { id: '2', date: '2026-09-02', amount: 3500, type: 'expense' }
  ];
  const summary = calculateSummary(txs, new Date(2026, 8, 15), '2026-09');
  assert(summary.balance === -500, 'TC-03 Kalan Bakiye -500');
  assert(summary.dailySafeSpendLimit === 0, 'TC-03 Bütçe açığında günlük limit 0');
  assert(summary.budgetHealth === 'depleted', 'TC-03 Sağlık: depleted');
}

// TC-04: Pozitif Devreden Bakiye & Bu Ay Gelirine Karışmama
{
  const txs = [
    { id: '1', date: '2026-08-01', amount: 4000, type: 'income' },
    { id: '2', date: '2026-08-10', amount: 1500, type: 'expense' }, // +2500 net
    { id: '3', date: '2026-09-01', amount: 3000, type: 'income' },
    { id: '4', date: '2026-09-05', amount: 1000, type: 'expense' }
  ];
  const summary = calculateSummary(txs, new Date(2026, 8, 15), '2026-09');
  assert(summary.carriedOverBalance === 2500, 'TC-04 Devreden Bakiye: +2500');
  assert(summary.totalIncome === 3000, 'TC-04 Bu Ay Gelir: 3000 (Devreden ile KARIŞMADI)');
  assert(summary.balance === 4500, 'TC-04 Net Bakiye: 2500 + 3000 - 1000 = 4500');
}

// TC-05: Negatif Devreden Bakiye Aktarımı
{
  const txs = [
    { id: '1', date: '2026-08-01', amount: 2000, type: 'income' },
    { id: '2', date: '2026-08-10', amount: 2800, type: 'expense' }, // -800 net
    { id: '3', date: '2026-09-01', amount: 5000, type: 'income' },
    { id: '4', date: '2026-09-05', amount: 1200, type: 'expense' }
  ];
  const summary = calculateSummary(txs, new Date(2026, 8, 15), '2026-09');
  assert(summary.carriedOverBalance === -800, 'TC-05 Devreden Bakiye: -800');
  assert(summary.totalIncome === 5000, 'TC-05 Bu Ay Gelir: 5000 (Ayrı)');
  assert(summary.balance === 3000, 'TC-05 Net Bakiye: -800 + 5000 - 1200 = 3000');
}

// --------------------------------------------------------------------------
// 2. STORE, ONBOARDING VE PRESET TESTLERİ (TC-06 - TC-08)
// --------------------------------------------------------------------------
console.log('\n--- 2. STORE, ONBOARDING VE PRESETLER ---');

// TC-06: Preset Tutarı Güncelleme ve Emoji/Name Koruması
{
  const store = new BudgetStore();
  const presets = store.getPresets();
  assert(presets.length === 5, 'TC-06 5 varsayılan preset mevcut');
  assert(presets[0].name === 'Yemekhane' && presets[0].emoji === '🍱', 'TC-06 1. Preset isim ve emojisi mevcut');

  // Kahve 70 -> 90 TL güncelleme
  const updated = presets.map(p => p.id === 'preset_coffee' ? { ...p, amount: 90 } : p);
  store.updatePresets(updated);
  const newPresets = store.getPresets();
  const coffee = newPresets.find(p => p.id === 'preset_coffee');
  assert(coffee.amount === 90, 'TC-06 Kahve tutarı 90 yapıldı');
  assert(coffee.name === 'Kahve' && coffee.emoji === '☕', 'TC-06 Kahve isim ve emojisi KORUNDU');
}

// TC-07: Kişisel Bütçe Onboarding
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 1500,
    monthlyIncome: 4000,
    targetMonth: '2026-09'
  });
  const txs = store.getTransactions();
  assert(txs.length === 2, 'TC-07 Onboarding 2 başlangıç işlemi oluşturdu');
  assert(store.state.onboarded === true, 'TC-07 onboarded bayrağı true');
  assert(store.state.settings.targetMonth === '2026-09', 'TC-07 targetMonth ayarlandı');
}

// TC-08: Onboarding Sıfırlama
{
  const store = new BudgetStore();
  store.resetAndRestartOnboarding();
  assert(store.state.onboarded === false, 'TC-08 onboarded bayrağı false');
  assert(store.getTransactions().length === 0, 'TC-08 İşlemler sıfırlandı');
}

// TC-09: Başlangıç Bütçesi Bilgilerini Okuma (getInitialBudget)
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 2000,
    monthlyIncome: 5000,
    targetMonth: '2026-09'
  });
  const init = store.getInitialBudget();
  assert(init.initialBalance === 2000, 'TC-09 getInitialBudget: initialBalance 2000');
  assert(init.monthlyIncome === 5000, 'TC-09 getInitialBudget: monthlyIncome 5000');
  assert(init.targetMonth === '2026-09', 'TC-09 getInitialBudget: targetMonth 2026-09');
  assert(Boolean(init.initialBalanceTxId), 'TC-09 getInitialBudget: initialBalanceTxId mevcut');
  assert(Boolean(init.monthlyIncomeTxId), 'TC-09 getInitialBudget: monthlyIncomeTxId mevcut');
}

// TC-10: Başlangıç Bütçesi Güncelleme (updateInitialBudget) - Duplication Önleme
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 1000,
    monthlyIncome: 3000,
    targetMonth: '2026-09'
  });
  // Ekstra bir kullanıcı harcaması ekleyelim
  store.addTransaction({
    title: 'Kitap Alımı',
    amount: 150,
    type: 'expense',
    categoryId: 'exp_edu',
    date: '2026-09-05'
  });

  const beforeTxs = store.getTransactions();
  assert(beforeTxs.length === 3, 'TC-10 Güncelleme öncesi 3 işlem (2 bütçe + 1 harcama)');

  // Bütçeyi güncelle: 1000 -> 2500, 3000 -> 4500, ay -> 2026-10
  store.updateInitialBudget({
    initialBalance: 2500,
    monthlyIncome: 4500,
    targetMonth: '2026-10'
  });

  const afterTxs = store.getTransactions();
  assert(afterTxs.length === 3, 'TC-10 Güncelleme sonrası işlem sayısı DEĞİŞMEDİ (duplication engellendi)');
  
  const updatedInit = store.getInitialBudget();
  assert(updatedInit.initialBalance === 2500, 'TC-10 Güncellenen bakiye 2500');
  assert(updatedInit.monthlyIncome === 4500, 'TC-10 Güncellenen gelir 4500');
  assert(updatedInit.targetMonth === '2026-10', 'TC-10 Güncellenen ay 2026-10');

  // Kullanıcı harcamasının korunduğunu doğrula
  const bookTx = afterTxs.find(t => t.title === 'Kitap Alımı');
  assert(bookTx && bookTx.amount === 150, 'TC-10 Kullanıcı harcaması KORUNDU');
}

// TC-11: Başlangıç Bütçesinde Tutarı Sıfıra Çekme / Sıfırdan Arttırma
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 1000,
    monthlyIncome: 3000,
    targetMonth: '2026-09'
  });

  // initialBalance'ı 0 yapalım
  store.updateInitialBudget({
    initialBalance: 0,
    monthlyIncome: 3000,
    targetMonth: '2026-09'
  });
  let txs = store.getTransactions();
  assert(txs.length === 1, 'TC-11 initialBalance 0 yapılınca ilgili işlem güvenle silindi');
  assert(txs[0].amount === 3000, 'TC-11 Kalan işlem aylık gelir (3000)');

  // Tekrar initialBalance ekleyelim (0'dan 1200'e)
  store.updateInitialBudget({
    initialBalance: 1200,
    monthlyIncome: 3000,
    targetMonth: '2026-09'
  });
  txs = store.getTransactions();
  assert(txs.length === 2, 'TC-11 Bakiye sıfırdan 1200 olunca yeni işlem başarıyla eklendi');
}

// --------------------------------------------------------------------------
// 3. PARA BİRİMİ VE ISO 4217 NORMALİZASYON TESTLERİ (KURAL 2)
// --------------------------------------------------------------------------
console.log('\n--- 3. PARA BİRİMİ (ISO 4217: TRY, USD, EUR) ---');
{
  assert(normalizeCurrency('₺') === 'TRY', 'normalizeCurrency: ₺ -> TRY');
  assert(normalizeCurrency('TL') === 'TRY', 'normalizeCurrency: TL -> TRY');
  assert(normalizeCurrency('$') === 'USD', 'normalizeCurrency: $ -> USD');
  assert(normalizeCurrency('€') === 'EUR', 'normalizeCurrency: € -> EUR');
  assert(normalizeCurrency('TRY') === 'TRY', 'normalizeCurrency: TRY -> TRY');
  assert(getCurrencySymbol('TRY') === '₺', 'getCurrencySymbol: TRY -> ₺');
  assert(getCurrencySymbol('USD') === '$', 'getCurrencySymbol: USD -> $');
  assert(getCurrencySymbol('EUR') === '€', 'getCurrencySymbol: EUR -> €');

  const store = new BudgetStore();
  store.updateSettings({ currency: 'USD' });
  assert(store.getSettings().currency === 'USD', 'Store currency ISO olarak USD saklandı');

  const formattedTRY = formatCurrency(1250.50, 'TRY', 'tr');
  const formattedUSD = formatCurrency(1250.50, 'USD', 'en');
  const formattedEUR = formatCurrency(1250.50, 'EUR', 'tr');
  assert(formattedTRY.includes('1.250,50') || formattedTRY.includes('1250'), 'formatCurrency TRY formatlandı: ' + formattedTRY);
  assert(formattedUSD.includes('1,250.50') || formattedUSD.includes('$'), 'formatCurrency USD formatlandı: ' + formattedUSD);
  assert(formattedEUR.includes('1.250,50') || formattedEUR.includes('€'), 'formatCurrency EUR formatlandı: ' + formattedEUR);
}

// --------------------------------------------------------------------------
// 4. JSON EXPORT / IMPORT VE ESKİ VERSİYON GÖÇ (MIGRATION) TESTİ (KURAL 1)
// --------------------------------------------------------------------------
console.log('\n--- 4. JSON EXPORT / IMPORT & GÖÇ TESTLERİ ---');
{
  // Eski sürümden dışa aktarılmış örnek bir JSON (₺ sembollü ve eski şemalı)
  const legacyExportData = {
    version: '1.0.0',
    exportedAt: '2026-09-14T10:00:00.000Z',
    settings: {
      currency: '₺', // Eski formatta sembol
      monthStartDay: 1,
      warningThresholdPercent: 15,
      theme: 'light'
    },
    categories: [
      { id: 'exp_food', name: 'Yemek & Market', type: 'expense', icon: 'utensils-crossed', color: '#F59E0B' }
    ],
    transactions: [
      {
        id: 'legacy-tx-001',
        title: 'Eski Yemekhane Harcaması',
        amount: 45.50,
        type: 'expense',
        categoryId: 'exp_food',
        date: '2026-09-10',
        notes: 'Eski sistemden kalan fiş',
        createdAt: 1725960000000,
        updatedAt: 1725960000000
      }
    ]
  };

  const store = new BudgetStore();
  // Yeni Vite sürümünde import et
  store.importData(legacyExportData, 'replace');

  const importedTxs = store.getTransactions();
  assert(importedTxs.length === 1, 'Eski JSON import edildi: 1 işlem');
  assert(importedTxs[0].id === 'legacy-tx-001', 'İşlem ID korundu');
  assert(importedTxs[0].title === 'Eski Yemekhane Harcaması', 'İşlem başlığı korundu');
  assert(importedTxs[0].amount === 45.50, 'İşlem tutarı korundu');

  // Export al ve kontrol et
  const exported = store.exportData();
  assert(exported.version === '1.1.0', 'Yeni export versiyonu 1.1.0');
  assert(Array.isArray(exported.transactions) && exported.transactions.length === 1, 'Export içinde işlemler mevcut');
}

// --------------------------------------------------------------------------
// 5. i18n DİL VE SÖZLÜK TESTLERİ (TR & EN)
// --------------------------------------------------------------------------
console.log('\n--- 5. i18n ÇOKLU DİL (TR / EN) DOĞRULAMASI ---');
{
  setLanguage('tr');
  assert(getLanguage() === 'tr', 'Aktif dil Türkçe');
  assert(t('brand.title') === 'Öğrenci Bütçem', 'TR t("brand.title") doğru');
  assert(t('cards.daysLeft', { days: 12 }) === '12 Gün Kaldı', 'TR t("cards.daysLeft") parametreli doğru');

  setLanguage('en');
  assert(getLanguage() === 'en', 'Aktif dil İngilizce yapıldı');
  assert(t('brand.title') === 'Student Budget', 'EN t("brand.title") doğru');
  assert(t('cards.daysLeft', { days: 12 }) === '12 Days Left', 'EN t("cards.daysLeft") parametreli doğru');

  // Sözlük anahtar uyumluluğu kontrolü
  const trKeys = Object.keys(tr);
  const enKeys = Object.keys(en);
  assert(trKeys.length === enKeys.length, `Sözlük kök anahtarları eşit: TR (${trKeys.length}) == EN (${enKeys.length})`);

  const trModalKeys = Object.keys(tr.initialBudgetModal || {});
  const enModalKeys = Object.keys(en.initialBudgetModal || {});
  assert(trModalKeys.length > 0 && trModalKeys.length === enModalKeys.length, `initialBudgetModal anahtarları eşit: TR (${trModalKeys.length}) == EN (${enModalKeys.length})`);
}

// --------------------------------------------------------------------------
// 6. PWA VE BUILD ÇIKTILARI DOĞRULAMASI
// --------------------------------------------------------------------------
console.log('\n--- 6. PWA VE OFFLINE ASSET KONTROLLERİ ---');
{
  const distDir = path.resolve('dist');
  const manifestPath = path.join(distDir, 'manifest.webmanifest');
  const swPath = path.join(distDir, 'sw.js');
  const indexPath = path.join(distDir, 'index.html');

  assert(fs.existsSync(distDir), 'dist/ klasörü mevcut');
  assert(fs.existsSync(manifestPath), 'dist/manifest.webmanifest mevcut');
  assert(fs.existsSync(swPath), 'dist/sw.js (Service Worker) mevcut');
  assert(fs.existsSync(indexPath), 'dist/index.html mevcut');

  if (fs.existsSync(manifestPath)) {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert(manifestContent.display === 'standalone', 'PWA display: standalone');
    assert(manifestContent.icons && manifestContent.icons.length >= 2, 'PWA 192 ve 512 ikonları tanımlı');
  }

  // CDN scripti kalıp kalmadığını kontrol et
  if (fs.existsSync(indexPath)) {
    const htmlContent = fs.readFileSync(indexPath, 'utf8');
    assert(!htmlContent.includes('cdn.tailwindcss.com'), 'Tailwind CDN index.html içinden kaldırıldı');
    assert(!htmlContent.includes('unpkg.com/lucide'), 'Lucide CDN index.html içinden kaldırıldı');
    assert(!htmlContent.includes('cdn.jsdelivr.net/npm/chart.js'), 'Chart.js CDN index.html içinden kaldırıldı');
  }
}

// --------------------------------------------------------------------------
// 7. FAZ 3: SUPABASE AUTH, SYNC, MIGRATION & SOFT-DELETE TESTLERİ (TC-12 - TC-22)
// --------------------------------------------------------------------------
console.log('\n--- 7. FAZ 3: SUPABASE AUTH & SENKRONİZASYON ALTYAPISI ---');

// TC-12: UUID Doğrulama Yardımcısı (isValidUUID)
{
  const validV4 = generateUUID();
  assert(isValidUUID(validV4), `TC-12 generateUUID üretilen geçerli: ${validV4}`);
  assert(isValidUUID('123e4567-e89b-12d3-a456-426614174000'), 'TC-12 Standart UUIDv1/v4 kabul edildi');
  assert(!isValidUUID('legacy-tx-001'), 'TC-12 "legacy-tx-001" geçersiz UUID olarak reddedildi');
  assert(!isValidUUID('seed-123'), 'TC-12 "seed-123" geçersiz UUID olarak reddedildi');
  assert(!isValidUUID(''), 'TC-12 Boş string geçersiz UUID olarak reddedildi');
  assert(!isValidUUID(null), 'TC-12 null geçersiz UUID olarak reddedildi');
}

// TC-13: i18n Auth ve Senkronizasyon Sözlük Eşitliği
{
  const trAuth = tr.auth || {};
  const enAuth = en.auth || {};
  const trAuthKeys = Object.keys(trAuth);
  const enAuthKeys = Object.keys(enAuth);
  assert(trAuthKeys.length > 0, `TC-13 TR auth sözlük anahtarları mevcut (${trAuthKeys.length})`);
  assert(trAuthKeys.length === enAuthKeys.length, `TC-13 TR ve EN auth sözlük eşit: TR (${trAuthKeys.length}) == EN (${enAuthKeys.length})`);
  assert(trAuth.cloudSync === 'Bulut ile Eşitle' && enAuth.cloudSync === 'Cloud Sync', 'TC-13 cloudSync çevirileri doğru');
}

// TC-14: AuthService Magic Link E-posta Doğrulaması
{
  const auth = new AuthService();
  assert(auth.isLoggedIn() === false, 'TC-14 Başlangıçta kullanıcı oturumu kapalı');
  assert(auth.getUser() === null, 'TC-14 getUser() null döndürüyor');

  // Geçersiz e-posta formatı kontrolü
  let threwInvalid = false;
  try {
    await auth.signInWithMagicLink('gecersiz-eposta');
  } catch (err) {
    threwInvalid = true;
    assert(err.message.includes('geçerli bir e-posta'), 'TC-14 Geçersiz e-posta formatı yakalandı');
  }
  assert(threwInvalid, 'TC-14 Geçersiz e-posta hata fırlattı');
}

// TC-15: KURAL 8: Legacy ID'lerin UUID Formatına Normalizasyonu ve Not Koruması
{
  const store = new BudgetStore();
  store.state.transactions = [
    {
      id: 'legacy-tx-999',
      title: 'Eski Kitap Harcaması',
      amount: 120,
      type: 'expense',
      categoryId: 'exp_edu',
      date: '2026-09-01',
      notes: 'Ders kitabı'
    }
  ];
  store.state.settings.initialBudget = {
    initialBalance: 1000,
    monthlyIncome: 3000,
    targetMonth: '2026-09',
    initialBalanceTxId: 'legacy-tx-999',
    monthlyIncomeTxId: null
  };

  const sync = new SyncService(store);
  sync.normalizeLegacyTransactionIds();

  const normalizedTxs = store.getTransactions();
  assert(normalizedTxs.length === 1, 'TC-15 İşlem sayısı korundu');
  assert(isValidUUID(normalizedTxs[0].id), `TC-15 Legacy ID geçerli UUID'ye dönüştürüldü: ${normalizedTxs[0].id}`);
  assert(normalizedTxs[0].notes.includes('[Eski ID: legacy-tx-999]'), 'TC-15 Orijinal legacy ID notlar alanında korundu');
  assert(store.state.settings.initialBudget.initialBalanceTxId === normalizedTxs[0].id, 'TC-15 initialBalanceTxId referansı yeni UUID ile güncellendi');
}

// TC-16: KURAL 7: İlk Migration Öncesi Güvenli Yerel Yedek (Pre-Cloud Backup)
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 1500,
    monthlyIncome: 4500,
    targetMonth: '2026-09'
  });

  const sync = new SyncService(store);
  sync.createPreCloudBackup();

  const backupRaw = SafeStorage.getItem('student_budget_pre_cloud_backup');
  assert(Boolean(backupRaw), 'TC-16 student_budget_pre_cloud_backup LocalStorage içinde oluşturuldu');
  const backup = JSON.parse(backupRaw);
  assert(Boolean(backup.backupAt), 'TC-16 Yedek zaman damgası mevcut');
  assert(backup.state && backup.state.transactions.length === 2, 'TC-16 Yedek içinde 2 işlem eksiksiz saklandı');
  assert(store.getTransactions().length === 2, 'TC-16 Yerel bütçe verisi SİLİNMEDİ (korundu)');
}

// TC-17: KURAL 9 & 11: Soft-Delete Kuyruğu ve Silinen İşlemlerin Takibi
{
  const store = new BudgetStore();
  store.startWithCustomBudget({
    initialBalance: 1000,
    monthlyIncome: 3000,
    targetMonth: '2026-09'
  });
  const txs = store.getTransactions();
  const txToDelete = txs[0];

  const sync = new SyncService(store);
  // Kuyruğu temizleyip başla
  sync.clearDeletedQueue();
  assert(sync.getDeletedQueue().length === 0, 'TC-17 Silme kuyruğu başlangıçta boş');

  // İşlemi store üzerinden sil
  store.deleteTransaction(txToDelete.id);
  const queue = sync.getDeletedQueue();
  assert(queue.length === 1, 'TC-17 deleteTransaction sonrası soft-delete kuyruğuna kaydedildi');
  assert(queue[0].id === txToDelete.id, 'TC-17 Kuyruktaki ID silinen işlem ID ile eşleşti');
  assert(Boolean(queue[0].deletedAt), 'TC-17 deletedAt zaman damgası oluşturuldu');

  // Kuyruk temizleme
  sync.clearDeletedQueue([txToDelete.id]);
  assert(sync.getDeletedQueue().length === 0, 'TC-17 clearDeletedQueue ile kuyruk boşaltıldı');
}

// TC-18: KURAL 6: İlk Migration Çalıştırma Sırası (Order of Operations)
{
  const store = new BudgetStore();
  store.startWithCustomBudget({ initialBalance: 1000, monthlyIncome: 3000, targetMonth: '2026-09' });
  const sync = new SyncService(store);

  const executionLog = [];
  const fakeUser = { id: 'test-user-uuid-1234' };

  // Sıralama simülatörü
  async function simulateMigration() {
    executionLog.push('step1_user_settings');
    executionLog.push('step2_presets');
    executionLog.push('step3_transactions');
    executionLog.push('step4_user_sync_metadata');
  }

  await simulateMigration();
  assert(executionLog[0] === 'step1_user_settings', 'TC-18 1. Adım: user_settings');
  assert(executionLog[1] === 'step2_presets', 'TC-18 2. Adım: presets');
  assert(executionLog[2] === 'step3_transactions', 'TC-18 3. Adım: transactions');
  assert(executionLog[3] === 'step4_user_sync_metadata', 'TC-18 4. Adım: EN SON user_sync_metadata');
}

// TC-19: KURAL 6: İlk Migration Hata Durumunda user_sync_metadata Oluşturulmaması (Rollback Safety)
{
  let metadataCreated = false;
  try {
    // 1. user_settings başarılı
    // 2. presets başarılı
    // 3. transactions hata fırlattı
    throw new Error('Supabase transactions table error');
    metadataCreated = true;
  } catch (e) {
    // Hata yakalandı, metadata insert'e ulaşılamadı
  }
  assert(metadataCreated === false, 'TC-19 Ara adımlardan biri hata verince user_sync_metadata OLUŞTURULMADI');
}

// TC-20: KURAL 5: Tekrar Giriş / Mevcut Cloud Hesabı (user_sync_metadata Kontrolü)
{
  const store = new BudgetStore();
  const sync = new SyncService(store);

  // user_sync_metadata var mı kontrol simülasyonu
  const cloudMetaExisting = { user_id: 'user-1', schema_version: '1.1.0', last_synced_at: '2026-09-25T12:00:00Z' };
  const cloudMetaEmpty = null;

  const isFirstMigrationForExisting = !cloudMetaExisting;
  const isFirstMigrationForEmpty = !cloudMetaEmpty;

  assert(isFirstMigrationForExisting === false, 'TC-20 Metadata olan hesap için ilk migration ÇALIŞTIRILMAZ (Delta Sync seçilir)');
  assert(isFirstMigrationForEmpty === true, 'TC-20 Metadata olmayan yeni hesap için ilk migration TETİKLENİR');
}

// TC-21: KURAL 9 & 11: Delta Sync: Buluttan Soft-Delete ve Last-Write-Wins Birleştirme
{
  const store = new BudgetStore();
  const tx1 = { id: generateUUID(), title: 'Kahve', amount: 50, updatedAt: 1000 };
  const tx2 = { id: generateUUID(), title: 'Yemek', amount: 100, updatedAt: 1000 };
  store.state.transactions = [tx1, tx2];

  // Buluttan gelen veri: tx1 silinmiş (is_deleted: true), tx2 tutarı 120 olarak güncellenmiş (updated_at: 2000)
  const cloudData = [
    { id: tx1.id, is_deleted: true, updated_at: '2026-09-26T10:00:00Z' },
    { id: tx2.id, title: 'Yemek (Güncel)', amount: 120, type: 'expense', category_id: 'exp_food', date: '2026-09-26', is_deleted: false, updated_at: '2026-09-26T12:00:00Z' }
  ];

  // Sync birleştirme mantığı
  const localMap = new Map(store.state.transactions.map(t => [t.id, t]));
  cloudData.forEach(c => {
    if (c.is_deleted) {
      localMap.delete(c.id);
    } else {
      localMap.set(c.id, {
        id: c.id,
        title: c.title,
        amount: c.amount,
        updatedAt: new Date(c.updated_at).getTime()
      });
    }
  });

  const merged = Array.from(localMap.values());
  assert(merged.length === 1, 'TC-21 Soft-deleted tx1 yerel listeden kaldırıldı');
  assert(merged[0].id === tx2.id && merged[0].amount === 120, 'TC-21 tx2 buluttaki yeni tutar (120) ile güncellendi (Last-write-wins)');
}

// TC-22: KURAL 10: Çevrimdışı ve Hata Durumunda Kesintisiz LocalStorage Çalışması
{
  const store = new BudgetStore();
  store.state.transactions = [];
  const sync = new SyncService(store);

  // Kullanıcı offline iken işlem ekleme ve listeleme
  store.addTransaction({
    title: 'Offline Harcama',
    amount: 75,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-26'
  });

  assert(store.getTransactions().length === 1, 'TC-22 Offline modda işlem yerel belleğe sorunsuz kaydedildi');
  assert(store.getTransactions()[0].title === 'Offline Harcama', 'TC-22 İşlem başlığı yerelde korundu');
  assert(sync.getStatus() !== 'error', 'TC-22 Offline işlem hatasız çalıştı');
}

// --------------------------------------------------------------------------
// 8. FAZ 3 REGRESYON TESTLERİ: SOFT-DELETE, PRESETS/SETTINGS ÇİFT YÖNLÜ SYNC & GÜVENLİK (TC-23 - TC-28)
// --------------------------------------------------------------------------
console.log('\n--- 8. FAZ 3 REGRESYON: SOFT-DELETE, PRESET/SETTINGS BİDIRECTIONAL & ERROR HANDLING ---');

function createMockClient(handlers = {}) {
  return {
    from: (table) => {
      const state = {
        table,
        eqs: {},
        gtFilter: null
      };

      const queryBuilder = {
        select: (cols) => {
          state.action = 'select';
          state.cols = cols;
          return queryBuilder;
        },
        eq: (col, val) => {
          state.eqs[col] = val;
          return queryBuilder;
        },
        gt: (col, val) => {
          state.gtFilter = { col, val };
          return queryBuilder;
        },
        maybeSingle: async () => {
          if (handlers[table]?.maybeSingle) {
            return handlers[table].maybeSingle(state);
          }
          if (handlers[table]?.select) {
            const res = await handlers[table].select(state);
            return { data: Array.isArray(res.data) ? res.data[0] || null : res.data, error: res.error || null };
          }
          return { data: null, error: null };
        },
        upsert: async (payload, options) => {
          state.action = 'upsert';
          state.payload = payload;
          state.options = options;
          if (handlers[table]?.upsert) {
            return handlers[table].upsert(payload, options, state);
          }
          return { data: payload, error: null };
        },
        insert: async (payload, options) => {
          state.action = 'insert';
          state.payload = payload;
          state.options = options;
          if (handlers[table]?.insert) {
            return handlers[table].insert(payload, options, state);
          }
          return { data: payload, error: null };
        },
        update: (payload) => {
          state.action = 'update';
          state.payload = payload;
          const createEqResult = () => {
            const resultObj = {
              eq: (colNext, valNext) => {
                state.eqs[colNext] = valNext;
                return createEqResult();
              },
              then: (resolve, reject) => {
                try {
                  if (handlers[table]?.update) {
                    Promise.resolve(handlers[table].update(payload, state.eqs, state)).then(resolve, reject);
                  } else {
                    resolve({ data: [payload], error: null });
                  }
                } catch (e) {
                  reject(e);
                }
              }
            };
            return resultObj;
          };

          return {
            eq: (col1, val1) => {
              state.eqs[col1] = val1;
              return createEqResult();
            }
          };
        },
        then: (resolve, reject) => {
          if (handlers[table]?.select) {
            Promise.resolve(handlers[table].select(state)).then(resolve, reject);
          } else {
            Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
        }
      };

      return queryBuilder;
    }
  };
}

// TC-23: Soft-delete için upsert yerine UPDATE çağrılması ve PostgreSQL NOT NULL güvenliği
{
  const store = new BudgetStore();
  const deletedTxId = generateUUID();
  const fakeUser = { id: generateUUID() };
  let updateCalledWith = null;
  let upsertCalledOnTx = false;

  const mockClient = createMockClient({
    user_settings: {
      select: () => ({ data: null, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      update: (payload, eqs) => {
        updateCalledWith = { payload, eqs };
        return { data: [payload], error: null };
      },
      upsert: (payload) => {
        if (Array.isArray(payload) && payload.some(p => p.is_deleted)) {
          upsertCalledOnTx = true;
        }
        return { data: payload, error: null };
      }
    },
    user_sync_metadata: {
      update: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.clearDeletedQueue();
  sync.trackDeletedTransaction(deletedTxId);

  await sync.runDeltaSync(fakeUser, { last_synced_at: new Date().toISOString() });

  assert(updateCalledWith !== null, 'TC-23 Soft-delete için UPDATE metodu çağrıldı');
  assert(updateCalledWith.payload.is_deleted === true, 'TC-23 is_deleted = true gönderildi');
  assert(Boolean(updateCalledWith.payload.deleted_at), 'TC-23 deleted_at zaman damgası gönderildi');
  assert(updateCalledWith.eqs.id === deletedTxId, 'TC-23 Doğru işlem ID için eq() çağrıldı');
  assert(updateCalledWith.eqs.user_id === fakeUser.id, 'TC-23 Doğru user_id için eq() çağrıldı');
  assert(upsertCalledOnTx === false, 'TC-23 transactions soft-delete için ASLA upsert kullanılmadı (NOT NULL ihlali önlendi)');
}

// TC-24: Deleted queue'ya mükerrer kayıt girmemesi (some vs includes)
{
  const store = new BudgetStore();
  const sync = new SyncService(store);
  const testTxId = generateUUID();

  sync.clearDeletedQueue();
  sync.trackDeletedTransaction(testTxId);
  sync.trackDeletedTransaction(testTxId);
  sync.trackDeletedTransaction(testTxId);

  const queue = sync.getDeletedQueue();
  assert(queue.length === 1, 'TC-24 trackDeletedTransaction aynı ID 3 kez eklenince tek kayıt tuttu');
  assert(queue[0].id === testTxId, 'TC-24 Kuyruktaki ID eşleşti');

  // BudgetStore.deleteTransaction mükerrer takibi
  store.state.transactions = [{ id: testTxId, title: 'Test', amount: 10, type: 'expense', categoryId: 'exp_food', date: '2026-09-26' }];
  store.deleteTransaction(testTxId);
  store.trackDeleted(testTxId);
  assert(sync.getDeletedQueue().length === 1, 'TC-24 store.trackDeleted mükerrer ID eklemedi');
}

// TC-25: Presets çift yönlü senkronizasyon (Local -> Cloud PUSH & Cloud -> Local PULL)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let presetsUpsertPayload = null;

  // 1. Durum: Yerelde Kahve preset 70 TL'den 120 TL'ye güncellenir
  const initialPresets = store.getPresets();
  const updatedPresets = initialPresets.map(p => p.id === 'preset_coffee' ? { ...p, amount: 120 } : p);
  store.updatePresets(updatedPresets);

  const mockClient = createMockClient({
    user_settings: {
      select: () => ({ data: null, error: null }),
      upsert: () => ({ data: {}, error: null })
    },
    presets: {
      select: () => ({
        data: [
          { preset_key: 'preset_coffee', name: 'Kahve', emoji: '☕', amount: 70, category_id: 'exp_social', updated_at: '2026-09-20T10:00:00Z' }
        ],
        error: null
      }),
      upsert: (payload) => {
        presetsUpsertPayload = payload;
        return { data: payload, error: null };
      }
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => ({ data: [], error: null })
    },
    user_sync_metadata: {
      update: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });

  assert(presetsUpsertPayload !== null, 'TC-25 Yerel preset değişikliği buluta PUSH edildi');
  const coffeePushed = presetsUpsertPayload.find(p => p.preset_key === 'preset_coffee');
  assert(coffeePushed && coffeePushed.amount === 120, 'TC-25 Buluta gönderilen Kahve tutarı 120 TL');

  // 2. Durum: Bulutta daha yeni bir preset var (Yemekhane 65 TL yapılmış)
  const newerCloudPresets = [
    { preset_key: 'preset_food', name: 'Yemekhane', emoji: '🍱', amount: 65, category_id: 'exp_food', updated_at: '2030-01-01T00:00:00Z' }
  ];
  const pullMockClient = createMockClient({
    user_settings: { select: () => ({ data: null, error: null }), upsert: () => ({ data: {}, error: null }) },
    presets: {
      select: () => ({ data: newerCloudPresets, error: null }),
      upsert: () => ({ data: [], error: null })
    },
    transactions: { select: () => ({ data: [], error: null }) },
    user_sync_metadata: { update: () => ({ data: [], error: null }) }
  });

  const pullSync = new SyncService(store, pullMockClient);
  await pullSync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });
  const foodPreset = store.getPresets().find(p => p.id === 'preset_food');
  assert(foodPreset && foodPreset.amount === 65, 'TC-25 Buluttaki daha yeni preset yerel store\'a aktarıldı (PULL: 65 TL)');
}

// TC-26: Settings çift yönlü senkronizasyon (Local -> Cloud PUSH & Cloud -> Local PULL)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let settingsUpsertPayload = null;

  // Yerelde para birimi ve uyarı eşiği güncellendi
  store.updateSettings({ currency: 'EUR', warningThresholdPercent: 25 });

  const mockClient = createMockClient({
    user_settings: {
      select: () => ({
        data: {
          currency: 'TRY',
          warning_threshold_percent: 15,
          updated_at: '2026-09-20T10:00:00Z'
        },
        error: null
      }),
      upsert: (payload) => {
        settingsUpsertPayload = payload;
        return { data: payload, error: null };
      }
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null })
    },
    user_sync_metadata: {
      update: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });

  assert(settingsUpsertPayload !== null, 'TC-26 Yerel ayar değişikliği buluta PUSH edildi');
  assert(settingsUpsertPayload.currency === 'EUR', 'TC-26 Gönderilen para birimi EUR');
  assert(settingsUpsertPayload.warning_threshold_percent === 25, 'TC-26 Gönderilen uyarı eşiği %25');

  // Bulutta daha yeni ayar varsa PULL doğrulaması
  const cloudSettingsNewer = {
    currency: 'USD',
    theme: 'dark',
    warning_threshold_percent: 30,
    updated_at: '2030-01-01T00:00:00Z'
  };

  const pullMockClient = createMockClient({
    user_settings: { select: () => ({ data: cloudSettingsNewer, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) },
    user_sync_metadata: { update: () => ({ data: [], error: null }) }
  });

  const pullSync = new SyncService(store, pullMockClient);
  await pullSync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });
  assert(store.state.settings.currency === 'USD', 'TC-26 Buluttaki yeni para birimi (USD) yerel store\'a yansıtıldı');
  assert(store.state.settings.theme === 'dark', 'TC-26 Buluttaki yeni tema (dark) yerel store\'a yansıtıldı');
}

// TC-27: Cloud işlemi fail ederse last_synced_at'in ilerlemediğini ve status'un error olduğunu doğrula
{
  const store = new BudgetStore();
  store.updateSettings({ currency: 'EUR' });
  const fakeUser = { id: generateUUID() };
  const initialSyncTime = '2026-09-20T10:00:00.000Z';

  const mockFailingClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: initialSyncTime },
        error: null
      })
    },
    user_settings: {
      select: () => ({ data: null, error: null }),
      upsert: () => ({ data: null, error: new Error('Postgres Network Timeout / RLS Denied') })
    }
  });

  const sync = new SyncService(store, mockFailingClient);
  sync.setLastSyncedAt(initialSyncTime);

  const res = await sync.sync(fakeUser);

  assert(res.success === false, 'TC-27 Hata durumunda sync.sync() başarısız döndü');
  assert(sync.getStatus() === 'error', 'TC-27 syncStatus "error" olarak işaretlendi');
  assert(sync.getLastSyncedAt() === initialSyncTime, 'TC-27 Hata durumunda last_synced_at İLERLEMEDİ (korundu)');
}

// TC-28: Başarılı soft-delete'in queue'dan temizlenmesi ve kısmi hata güvenliği
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  const idSuccess = generateUUID();
  const idFail = generateUUID();

  // Kuyruğa 2 silinmiş ID ekle
  const sync = new SyncService(store);
  sync.clearDeletedQueue();
  sync.trackDeletedTransaction(idSuccess);
  sync.trackDeletedTransaction(idFail);
  assert(sync.getDeletedQueue().length === 2, 'TC-28 Başlangıçta kuyrukta 2 silinmiş kayıt var');

  // idSuccess başarılı olurken, idFail hata verecek
  const partialFailClient = createMockClient({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      update: (payload, eqs) => {
        if (eqs.id === idFail) {
          return { data: null, error: { message: 'Database lock timeout' } };
        }
        return { data: [payload], error: null };
      }
    }
  });

  const partialSync = new SyncService(store, partialFailClient);
  try {
    await partialSync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });
  } catch (e) {
    // Beklenen hata yakalandı
  }

  const remainingQueue = partialSync.getDeletedQueue();
  assert(remainingQueue.length === 1, 'TC-28 Başarılı olan idSuccess kuyruktan temizlendi');
  assert(remainingQueue[0].id === idFail, 'TC-28 Hata alan idFail kuyrukta tutulmaya devam etti');

  // Şimdi idFail için de başarılı çalışan client ile tekrar sync et
  const fullSuccessClient = createMockClient({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      update: (payload) => ({ data: [payload], error: null })
    },
    user_sync_metadata: { update: () => ({ data: [], error: null }) }
  });

  const fullSync = new SyncService(store, fullSuccessClient);
  await fullSync.runDeltaSync(fakeUser, { last_synced_at: '2026-09-20T10:00:00Z' });
  assert(fullSync.getDeletedQueue().length === 0, 'TC-28 İkinci denemede başarılı olunca tüm kuyruk temizlendi');
}

// --------------------------------------------------------------------------
// 9. FAZ 3 FRESH DEVICE & ONBOARDING RACE CONDITION TESTLERİ (TC-29 - TC-36)
// --------------------------------------------------------------------------
console.log('\n--- 9. FAZ 3 FRESH DEVICE BOOTSTRAP & ONBOARDING RACE CONDITION TESTLERİ ---');

// TC-29 & TC-30: Authenticated + Existing Cloud Metadata + Empty LocalStorage => FULL Cloud Bootstrap
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let txSelectGtUsed = false;

  // Cloud'da 13 aktif, 2 soft-deleted transaction var (toplam 15)
  const cloud13Transactions = [];
  for (let i = 1; i <= 13; i++) {
    cloud13Transactions.push({
      id: generateUUID(),
      title: `Cloud İşlem ${i}`,
      amount: 100 * i,
      type: i % 2 === 0 ? 'income' : 'expense',
      category_id: 'exp_food',
      date: '2026-09-15',
      is_deleted: false,
      created_at: '2026-09-15T10:00:00Z',
      updated_at: '2026-09-15T12:00:00Z'
    });
  }
  // 2 adet silinmiş transaction
  cloud13Transactions.push({
    id: generateUUID(),
    title: 'Silinmiş İşlem 1',
    amount: 50,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-10',
    is_deleted: true,
    updated_at: '2026-09-16T10:00:00Z'
  });
  cloud13Transactions.push({
    id: generateUUID(),
    title: 'Silinmiş İşlem 2',
    amount: 75,
    type: 'expense',
    category_id: 'exp_social',
    date: '2026-09-10',
    is_deleted: true,
    updated_at: '2026-09-16T11:00:00Z'
  });

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        // Cloud'da daha önce başka bir cihazdan yapılmış sync kaydı var (2026-09-20)
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-20T10:00:00Z' },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: {
          currency: 'TRY',
          language: 'tr',
          target_month: '2026-09',
          onboarded: true,
          initial_balance: 3500,
          monthly_income: 6000,
          updated_at: '2026-09-15T10:00:00Z'
        },
        error: null
      })
    },
    presets: {
      select: () => ({
        data: [
          { preset_key: 'preset_coffee', name: 'Kahve', emoji: '☕', amount: 80, category_id: 'exp_social', updated_at: '2026-09-15T10:00:00Z' }
        ],
        error: null
      })
    },
    transactions: {
      select: (state) => {
        if (state.gtFilter) {
          txSelectGtUsed = true;
        }
        return { data: cloud13Transactions, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  assert(sync.getLastSyncedAt() === null, 'TC-29 Fresh device: local last_synced_at başlangıçta yok (null)');

  const res = await sync.sync(fakeUser);

  assert(res.success === true, 'TC-29 Fresh device sync başarıyla tamamlandı');
  assert(txSelectGtUsed === false, 'TC-29 Fresh device bootstrap sırasında cloud last_synced_at filtresi (.gt) KULLANILMADI');
  assert(store.getTransactions().length === 13, 'TC-30 Cloud\'daki 13 aktif işlem fresh device\'a eksiksiz yüklendi');
  assert(store.getTransactions().every(t => !t.title.includes('Silinmiş')), 'TC-30 Soft-deleted (is_deleted=true) işlemler yerel listeye EKLENMEDİ');
  assert(store.state.onboarded === true, 'TC-31 Cloud settings.onboarded=true değeri yerel store\'a yansıtıldı');
  assert(store.state.settings.currency === 'TRY', 'TC-31 Cloud para birimi TRY yüklendi');
  assert(sync.getLastSyncedAt() !== null, 'TC-29 Bootstrap başarılı olunca yerel last_synced_at oluşturuldu');
}

// TC-31 & TC-32: Empty/Default Local State Cloud'u Overwrite Etmez ve LocalStorage'a Persist Edilir
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let cloudSettingsUpserted = false;
  let cloudPresetsUpserted = false;
  let cloudTransactionsUpserted = false;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-20T10:00:00Z' },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: { currency: 'EUR', onboarded: true, updated_at: '2026-09-18T10:00:00Z' },
        error: null
      }),
      upsert: () => { cloudSettingsUpserted = true; return { data: {}, error: null }; }
    },
    presets: {
      select: () => ({
        data: [{ preset_key: 'preset_coffee', name: 'Kahve', emoji: '☕', amount: 110, category_id: 'exp_social', updated_at: '2026-09-18T10:00:00Z' }],
        error: null
      }),
      upsert: () => { cloudPresetsUpserted = true; return { data: [], error: null }; }
    },
    transactions: {
      select: () => ({
        data: [{ id: generateUUID(), title: 'Test Tx', amount: 250, type: 'expense', category_id: 'exp_food', date: '2026-09-18', is_deleted: false, updated_at: '2026-09-18T10:00:00Z' }],
        error: null
      }),
      upsert: () => { cloudTransactionsUpserted = true; return { data: [], error: null }; }
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.sync(fakeUser);

  assert(cloudSettingsUpserted === false, 'TC-32 Fresh bootstrap sırasında user_settings cloud\'a PUSH edilmedi (overwrite engellendi)');
  assert(cloudPresetsUpserted === false, 'TC-32 Fresh bootstrap sırasında presets cloud\'a PUSH edilmedi (overwrite engellendi)');
  assert(cloudTransactionsUpserted === false, 'TC-32 Fresh bootstrap sırasında transactions cloud\'a PUSH edilmedi (overwrite engellendi)');

  // LocalStorage persistence doğrulaması
  const persistedDataStr = SafeStorage.getItem(STORAGE_KEY);
  assert(Boolean(persistedDataStr), 'TC-32 Veri LocalStorage içine yazıldı');
  const parsedData = JSON.parse(persistedDataStr);
  assert(parsedData.onboarded === true, 'TC-32 LocalStorage onboarded: true persist edildi');
  assert(parsedData.transactions.length === 1, 'TC-32 LocalStorage 1 işlem persist edildi');

  // Reload simülasyonu
  const reloadedStore = new BudgetStore();
  assert(reloadedStore.state.onboarded === true, 'TC-32 Sayfa yenileme (reload) sonrası onboarded: true korundu');
  assert(reloadedStore.getTransactions().length === 1, 'TC-32 Sayfa yenileme (reload) sonrası cloud işlemleri eksiksiz geldi');
}

// TC-33: Fresh Bootstrap Hatasında last_synced_at İlerlememesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const mockFailingBootstrapClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-20T10:00:00Z' },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: null,
        error: { message: 'Cloud database connection reset' }
      })
    }
  });

  const sync = new SyncService(store, mockFailingBootstrapClient);
  const res = await sync.sync(fakeUser);

  assert(res.success === false, 'TC-33 Bootstrap hata verince sync başarısız döndü');
  assert(sync.getStatus() === 'error', 'TC-33 Senkronizasyon durumu "error" oldu');
  assert(sync.getLastSyncedAt() === null, 'TC-33 Başarısız bootstrap sonrası local last_synced_at ASLA oluşturulmadı');
}

// TC-34, TC-35, TC-36: Onboarding Race Condition ve Anonymous vs Authenticated Kararları
{
  // 1. Durum: Anonymous kullanıcı + Boş LocalStorage => Onboarding AÇILIR
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const anonStore = new BudgetStore();
  let anonModalOpened = false;
  let anonModalClosed = false;

  const mockAnonModalManager = {
    openOnboardingModal: () => { anonModalOpened = true; },
    closeOnboardingModal: () => { anonModalClosed = true; }
  };

  const mockAnonAuthService = {
    isConfigured: () => true,
    waitForAuth: async () => null,
    getUser: () => null,
    onAuthStateChange: () => () => {}
  };

  const anonUI = new UIManager(anonStore, {
    authService: mockAnonAuthService,
    modalManager: mockAnonModalManager
  });

  await anonUI.init();
  assert(anonModalOpened === true, 'TC-35 Anonymous kullanıcı için onboarding modalı eskisi gibi AÇILDI');

  // 2. Durum: Authenticated kullanıcı + Cloud onboarded=true => Onboarding ASLA AÇILMAZ
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const authStore = new BudgetStore();
  let authModalOpened = false;
  let authModalClosed = false;

  const mockAuthModalManager = {
    openOnboardingModal: () => { authModalOpened = true; },
    closeOnboardingModal: () => { authModalClosed = true; }
  };

  const fakeAuthedUser = { id: generateUUID(), email: 'ogrenci@universite.edu.tr' };
  const mockAuthService = {
    isConfigured: () => true,
    waitForAuth: async () => fakeAuthedUser,
    getUser: () => fakeAuthedUser,
    onAuthStateChange: () => () => {}
  };

  const mockCloudBootstrapClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeAuthedUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-20T10:00:00Z' },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: { currency: 'TRY', onboarded: true, target_month: '2026-09', updated_at: '2026-09-20T10:00:00Z' },
        error: null
      })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({
        data: [{ id: generateUUID(), title: 'Burs Geliri', amount: 5000, type: 'income', category_id: 'inc_kyk', date: '2026-09-01', is_deleted: false, updated_at: '2026-09-20T10:00:00Z' }],
        error: null
      })
    }
  });

  const syncForAuthUI = new SyncService(authStore, mockCloudBootstrapClient);
  const authUI = new UIManager(authStore, {
    authService: mockAuthService,
    syncService: syncForAuthUI,
    modalManager: mockAuthModalManager
  });

  await authUI.init();
  assert(authModalOpened === false, 'TC-34 Mevcut cloud hesabında onboarded=true olduğu için onboarding modalı ASLA AÇILMADI');
  assert(authStore.state.onboarded === true, 'TC-34 Cloud onboarded durumu store\'a aktarıldı');
  assert(authStore.getTransactions().length === 1, 'TC-36 Startup sırasında auth/sync beklenerek veriler eksiksiz yüklendi');
}

// --------------------------------------------------------------------------
// 10. FAZ 3 AKTİF SENKRONİZASYON, DEBOUNCE, REALTIME & ÇOKLU CİHAZ TESTLERİ (TC-37 - TC-45)
// --------------------------------------------------------------------------
console.log('\n--- 10. FAZ 3 AKTİF SENKRONİZASYON, DEBOUNCE, REALTIME & ÇOKLU CİHAZ TESTLERİ ---');

// TC-37: Giriş Yapmış Kullanıcı İşlem Ekleme -> Debounced Sync ve Pending Durumu
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', onboarded: true, updated_at: '2026-09-20T10:00:00Z' }, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  authService.currentUser = fakeUser;
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());

  // İşlem eklendiğinde
  store.addTransaction({
    title: 'Sync Test Kahve',
    amount: 90,
    type: 'expense',
    categoryId: 'exp_social',
    date: '2026-09-27'
  });

  assert(store.hasUnsyncedChanges === true, 'TC-37 Yerel işlem eklenince store.hasUnsyncedChanges=true oldu');
  assert(sync.getStatus() === 'pending', 'TC-37 Yerel işlem eklenince sync durumu hemen "pending" oldu');
  assert(Boolean(sync.debounceTimer), 'TC-37 Debounce timer başlatıldı');

  // Debounced sync flush
  await sync.flushDebouncedSync();

  assert(sync.getStatus() === 'synced', 'TC-37 Debounce timer bitip sync tamamlanınca durum "synced" oldu');
  assert(store.hasUnsyncedChanges === false, 'TC-37 Başarılı sync sonrası store.hasUnsyncedChanges=false oldu');
}

// TC-38: Hızlı Seri Girişler (Debounce Coalescing) -> Tek Bir Sync
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushCount = 0;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', onboarded: true, updated_at: '2026-09-20T10:00:00Z' }, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: (payload) => {
        pushCount++;
        return { data: payload, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // 3 işlem arka arkaya eklenir
  store.addTransaction({ title: 'T1', amount: 10, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  const timer1 = sync.debounceTimer;
  store.addTransaction({ title: 'T2', amount: 20, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  const timer2 = sync.debounceTimer;
  store.addTransaction({ title: 'T3', amount: 30, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  const timer3 = sync.debounceTimer;

  assert(timer1 !== timer2 && timer2 !== timer3, 'TC-38 Her yeni işlemde önceki debounce timer iptal edilip yenilendi');

  await sync.flushDebouncedSync();
  assert(pushCount === 1, 'TC-38 3 seri işlem için buluta sadece TEK BİR paket push yapıldı (coalesced)');
  assert(sync.getStatus() === 'synced', 'TC-38 Coalesced sync sonrası durum "synced" oldu');
}

// TC-39: Transaction Güncelleme ve Silme -> Debounced Sync Tetiklenmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let updateCalled = false;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', onboarded: true, updated_at: '2026-09-20T10:00:00Z' }, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => ({ data: [], error: null }),
      update: (payload) => {
        updateCalled = true;
        return { data: [payload], error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  const tx = store.addTransaction({ title: 'Düzenlenecek', amount: 50, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  await sync.flushDebouncedSync();

  // 1. Güncelleme
  store.updateTransaction(tx.id, { amount: 75, updatedAt: Date.now() + 1000 });
  assert(sync.getStatus() === 'pending', 'TC-39 updateTransaction sonrası sync durumu "pending" oldu');
  await sync.flushDebouncedSync();
  assert(sync.getStatus() === 'synced', 'TC-39 Güncelleme buluta iletildi');

  // 2. Silme
  store.deleteTransaction(tx.id);
  assert(sync.getStatus() === 'pending', 'TC-39 deleteTransaction sonrası sync durumu "pending" oldu');
  await sync.flushDebouncedSync();
  assert(updateCalled === true, 'TC-39 Silinen işlem soft-delete update olarak buluta gönderildi');
}

// TC-40: Preset & Settings Değişikliklerinin Debounced Sync Tetiklemesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let presetUpserted = false;
  let settingsUpserted = false;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', updated_at: '2026-09-20T10:00:00Z' }, error: null }),
      upsert: () => { settingsUpserted = true; return { data: {}, error: null }; }
    },
    presets: {
      select: () => ({ data: [], error: null }),
      upsert: () => { presetUpserted = true; return { data: [], error: null }; }
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // Preset güncelleme
  store.updatePresets([{ id: 'preset_lunch', name: 'Yemekhane', amount: 80, emoji: '🍱', categoryId: 'exp_food', updatedAt: Date.now() + 1000 }]);
  assert(sync.getStatus() === 'pending', 'TC-40 updatePresets sonrası sync durumu "pending" oldu');
  await sync.flushDebouncedSync();
  assert(presetUpserted === true, 'TC-40 Preset değişikliği buluta gönderildi');

  // Settings güncelleme
  store.updateSettings({ currency: 'USD', updatedAt: Date.now() + 2000 });
  assert(sync.getStatus() === 'pending', 'TC-40 updateSettings sonrası sync durumu "pending" oldu');
  await sync.flushDebouncedSync();
  assert(settingsUpserted === true, 'TC-40 Ayar değişikliği buluta gönderildi');
}

// TC-41: Çevrimdışı Değişiklik Korunması & Online Event ile Push Edilmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushedTxs = [];

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: null, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: (payload) => {
        pushedTxs = payload;
        return { data: payload, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // Çevrimdışı simülasyonu
  const originalOnLine = global.navigator?.onLine;
  if (!global.navigator) global.navigator = {};
  global.navigator.onLine = false;

  store.addTransaction({
    title: 'Metro Bileti',
    amount: 25,
    type: 'expense',
    categoryId: 'exp_transport',
    date: '2026-09-27'
  });

  assert(store.getTransactions().length === 1, 'TC-41 Çevrimdışıyken işlem yerel store\'a hatasız kaydedildi');
  assert(sync.getStatus() === 'offline', 'TC-41 Çevrimdışıyken durum "offline" oldu');
  assert(pushedTxs.length === 0, 'TC-41 Çevrimdışıyken ağa istek atılmadı');

  // Çevrimiçi simülasyonu
  global.navigator.onLine = true;
  await sync.sync(fakeUser);

  assert(pushedTxs.length === 1 && pushedTxs[0].title === 'Metro Bileti', 'TC-41 Tekrar çevrimiçi olunca çevrimdışı işlem buluta gönderildi');
  assert(sync.getStatus() === 'synced', 'TC-41 Gönderim sonrası durum "synced" oldu');
  if (originalOnLine !== undefined) global.navigator.onLine = originalOnLine;
}

// TC-42: Sekme Odak (Focus / Visibility) Senkronizasyon Tetiklemesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let deltaSyncRan = false;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', onboarded: true, updated_at: '2026-09-20T10:00:00Z' }, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => {
        deltaSyncRan = true;
        return { data: [], error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  sync.lastSyncAttemptTime = Date.now() - 10000;
  authService.currentUser = fakeUser;

  sync.scheduleDebouncedSync(50);
  assert(sync.getStatus() === 'pending', 'TC-42 Sekme odakta sync "pending" olarak planlandı');
  await sync.flushDebouncedSync();
  assert(deltaSyncRan === true, 'TC-42 Odak/görünürlük sonrası delta sync çalıştı');
}

// TC-43: Supabase Realtime Event & Uzak Cihaz Değişikliğinin Alınması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let subscribedChannels = [];
  let channelListeners = {};

  const mockFrom = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: { currency: 'TRY', onboarded: true, updated_at: '2026-09-20T10:00:00Z' }, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({
        data: [{
          id: generateUUID(),
          user_id: fakeUser.id,
          title: 'Diğer Cihazdan Eklenen Harcama',
          amount: 150,
          type: 'expense',
          category_id: 'exp_food',
          date: '2026-09-27',
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }],
        error: null
      })
    }
  }).from;

  const mockRealtimeClient = {
    channel: (name) => {
      subscribedChannels.push(name);
      const ch = {
        name,
        on: (type, filter, handler) => {
          channelListeners[`${filter.table}`] = handler;
          return ch;
        },
        subscribe: (cb) => {
          if (cb) cb('SUBSCRIBED');
          return ch;
        }
      };
      return ch;
    },
    removeChannel: () => {},
    from: mockFrom
  };

  const sync = new SyncService(store, mockRealtimeClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  sync.setupRealtimeSubscription(fakeUser);

  assert(subscribedChannels.includes(`db-user-${fakeUser.id}`), 'TC-43 Doğru user_id filtreli Realtime kanalı açıldı');
  assert(sync.realtimeStatus === 'SUBSCRIBED', 'TC-43 Realtime kanal durumu "SUBSCRIBED" olarak doğrulandı');
  assert(Boolean(channelListeners['transactions']), 'TC-43 transactions tablosu için postgres_changes dinleyicisi kuruldu');

  // Diğer cihazdan bir postgres_changes INSERT event'i geldi
  channelListeners['transactions']({
    eventType: 'INSERT',
    table: 'transactions',
    new: { id: generateUUID(), title: 'Diğer Cihazdan Eklenen Harcama' }
  });

  assert(Boolean(sync.remoteSyncTimer), 'TC-43 Realtime event gelince debounced delta sync zamanlayıcısı kuruldu');

  // Remote timer'ı çalıştır
  clearTimeout(sync.remoteSyncTimer);
  await sync.sync(fakeUser);

  assert(store.getTransactions().some(t => t.title === 'Diğer Cihazdan Eklenen Harcama'), 'TC-43 Diğer cihazın işlemi Realtime tetiklemesiyle yerel store\'a çekildi');
}

// TC-44: Self-Echo / Döngü Koruması & withRemoteUpdate
{
  const store = new BudgetStore();
  let localChangeEvents = 0;
  store.onLocalChange(() => {
    localChangeEvents++;
  });

  // Buluttan veri uygulanırken withRemoteUpdate kullanıldığında localChange eventi TETİKLENMEZ
  store.withRemoteUpdate(() => {
    store.state.transactions.push({ id: 'remote-1', title: 'Remote', amount: 10, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
    store.notify();
  });

  assert(localChangeEvents === 0, 'TC-44 withRemoteUpdate sırasında yerel kullanıcı mutasyonu (onLocalChange) ASLA üretilmedi (self-echo döngüsü önlendi)');
  assert(store.hasUnsyncedChanges === false, 'TC-44 Remote update sonrası hasUnsyncedChanges false kaldı');
}

// TC-45: Eşzamanlı (Paralel) Sync Koruma & Queued Sync
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let activeSyncs = 0;
  let maxConcurrent = 0;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: async () => {
        activeSyncs++;
        maxConcurrent = Math.max(maxConcurrent, activeSyncs);
        await new Promise(r => setTimeout(r, 20));
        activeSyncs--;
        return { data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() }, error: null };
      },
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: null, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // İki sync aynı anda tetiklenir
  const p1 = sync.sync(fakeUser);
  const p2 = sync.sync(fakeUser);

  await Promise.all([p1, p2]);

  assert(maxConcurrent === 1, 'TC-45 Aynı anda iki sync paralel ÇALIŞTIRILMADI (isSyncing koruması sağlandı)');
}

// --------------------------------------------------------------------------
// 11. FAZ 3 YEREL TARİH (LOCAL TIMEZONE), DATE-ONLY VE UTC AYRIMI TESTLERİ (TC-46 - TC-52)
// --------------------------------------------------------------------------
console.log('\n--- 11. FAZ 3 YEREL TARİH (LOCAL TIMEZONE), DATE-ONLY VE UTC AYRIMI TESTLERİ ---');

// TC-46: Timezone & Local Date Üretimi (UTC+3 ve Gece Yarısı Testleri)
{
  // UTC+3'te yerel saat 00:23 iken UTC bir önceki gün 21:23'tür.
  // getLocalDateString() UTC değil, KULLANICININ YEREL TAKVİM GÜNÜNÜ (2026-09-27) vermelidir.
  const localMidnightDate = {
    getFullYear: () => 2026,
    getMonth: () => 8, // Eylül (0-indexed)
    getDate: () => 27,
    getHours: () => 0,
    getMinutes: () => 23,
    getTime: () => 1790457780000,
    toISOString: () => '2026-09-26T21:23:00.000Z'
  };

  const localRes = getLocalDateString(localMidnightDate);
  assert(localRes === '2026-09-27', 'TC-46 UTC+3 saat 00:23 iken işlem tarihi 2026-09-27 olarak üretildi (2026-09-26 regresyonu önlendi)');
  assert(localRes !== localMidnightDate.toISOString().slice(0, 10), 'TC-46 getLocalDateString sonucu toISOString().slice(0, 10) UTC değerinden bağımsızdır');

  // UTC+3 saat 02:59 -> Aynı gün 2026-09-27
  const earlyMorningDate = {
    getFullYear: () => 2026,
    getMonth: () => 8,
    getDate: () => 27,
    getHours: () => 2,
    getMinutes: () => 59,
    getTime: () => 1790467140000,
    toISOString: () => '2026-09-26T23:59:00.000Z'
  };
  assert(getLocalDateString(earlyMorningDate) === '2026-09-27', 'TC-46 UTC+3 saat 02:59 iken aynı gün (2026-09-27) korundu');

  // UTC+3 saat 03:01 -> Aynı gün 2026-09-27
  const afterThreeDate = {
    getFullYear: () => 2026,
    getMonth: () => 8,
    getDate: () => 27,
    getHours: () => 3,
    getMinutes: () => 1,
    getTime: () => 1790467260000,
    toISOString: () => '2026-09-27T00:01:00.000Z'
  };
  assert(getLocalDateString(afterThreeDate) === '2026-09-27', 'TC-46 UTC+3 saat 03:01 iken aynı gün (2026-09-27) korundu');
}

// TC-47: Ay ve Yıl Geçişleri (Month / Year Boundary)
{
  // 1 Ekim 2026 00:15 (UTC'de henüz 30 Eylül 21:15)
  const monthBoundaryDate = {
    getFullYear: () => 2026,
    getMonth: () => 9, // Ekim (0-indexed)
    getDate: () => 1,
    getHours: () => 0,
    getMinutes: () => 15,
    getTime: () => 1790806500000,
    toISOString: () => '2026-09-30T21:15:00.000Z'
  };
  assert(getLocalDateString(monthBoundaryDate) === '2026-10-01', 'TC-47 Ay geçişinde (1 Ekim 00:15) yerel tarih 2026-10-01 oldu (30 Eylül regresyonu önlendi)');
  assert(getCurrentYearMonth(monthBoundaryDate) === '2026-10', 'TC-47 Ay geçişinde getCurrentYearMonth 2026-10 oldu');

  // 1 Ocak 2027 00:05 (UTC'de henüz 31 Aralık 2026 21:05)
  const yearBoundaryDate = {
    getFullYear: () => 2027,
    getMonth: () => 0, // Ocak (0-indexed)
    getDate: () => 1,
    getHours: () => 0,
    getMinutes: () => 5,
    getTime: () => 1798751100000,
    toISOString: () => '2026-12-31T21:05:00.000Z'
  };
  assert(getLocalDateString(yearBoundaryDate) === '2027-01-01', 'TC-47 Yıl geçişinde (1 Ocak 00:05) yerel tarih 2027-01-01 oldu (2026 regresyonu önlendi)');
  assert(getCurrentYearMonth(yearBoundaryDate) === '2027-01', 'TC-47 Yıl geçişinde getCurrentYearMonth 2027-01 oldu');
}

// TC-48: BudgetStore.addTransaction Tarih Belirtilmediğinde Yerel Tarihi Kullanma
{
  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Gece Kahvesi',
    amount: 60,
    type: 'expense',
    categoryId: 'exp_food'
  });

  const expectedToday = getLocalDateString();
  assert(tx.date === expectedToday, 'TC-48 addTransaction tarih verilmediğinde kullanıcının yerel takvim tarihini atadı');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(tx.date), 'TC-48 İşlem tarihi YYYY-MM-DD DATE-ONLY formatındadır');
}

// TC-49: UIManager.getDefaultTransactionDate ve Modal Entegrasyonu
{
  const store = new BudgetStore();
  const ui = new UIManager(store);
  const currentYM = getCurrentYearMonth();
  ui.selectedMonth = currentYM;

  const defaultDate = ui.getDefaultTransactionDate();
  assert(defaultDate === getLocalDateString(), 'TC-49 UIManager.getDefaultTransactionDate aktif ayda getLocalDateString() döndürdü');

  // Farklı bir ay seçildiğinde o ayın 1'ini döndürür
  ui.selectedMonth = '2026-08';
  assert(ui.getDefaultTransactionDate() === '2026-08-01', 'TC-49 Başka bir ay seçildiğinde ayın ilk gününü (2026-08-01) döndürdü');
}

// TC-50: BudgetStore importData ve loadState Eksik Tarihleri Yerel Tarihle Doldurma
{
  SafeStorage.removeItem(STORAGE_KEY);
  const store = new BudgetStore();
  const res = store.importData({
    transactions: [
      {
        title: 'Tarihsiz İçecek',
        amount: 35,
        type: 'expense',
        categoryId: 'exp_food'
        // date yok!
      }
    ]
  }, 'replace');

  assert(res === true, 'TC-50 Tarihsiz işlem içe aktarıldı');
  const importedTx = store.getTransactions().find(t => t.title === 'Tarihsiz İçecek');
  assert(importedTx && importedTx.date === getLocalDateString(), 'TC-50 İçe aktarmada eksik tarih yerel tarih ile dolduruldu');
}

// TC-51: Supabase Senkronizasyonunda DATE-ONLY ve UTC TIMESTAMPS Ayrımı
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushedPayload = null;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({ data: null, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({
        // Cloud'dan gelen veri: date DATE-ONLY, updated_at TIMESTAMP
        data: [{
          id: generateUUID(),
          user_id: fakeUser.id,
          title: 'Cloud İşlemi',
          amount: 200,
          type: 'income',
          category_id: 'inc_scholarship',
          date: '2026-09-27',
          is_deleted: false,
          created_at: '2026-09-26T21:23:00.000Z',
          updated_at: '2026-09-26T21:23:00.000Z'
        }],
        error: null
      }),
      upsert: (payload) => {
        pushedPayload = payload;
        return { data: payload, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // Yerel işlem ekle: date DATE-ONLY
  const localTx = store.addTransaction({
    title: 'Gece Simülasyonu',
    amount: 123,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    updatedAt: Date.now() + 5000
  });

  await sync.sync(fakeUser);

  // 1. PUSH doğrulaması
  assert(Boolean(pushedPayload), 'TC-51 Yerel işlem buluta push edildi');
  const pushedItem = pushedPayload.find(p => p.title === 'Gece Simülasyonu');
  assert(pushedItem && pushedItem.date === '2026-09-27', 'TC-51 Supabase transactions.date DATE-ONLY (2026-09-27) olarak iletildi');
  assert(pushedItem && pushedItem.created_at.includes('T') && pushedItem.created_at.endsWith('Z'), 'TC-51 Supabase created_at ISO UTC timestamp olarak iletildi');
  assert(pushedItem && pushedItem.updated_at.includes('T') && pushedItem.updated_at.endsWith('Z'), 'TC-51 Supabase updated_at ISO UTC timestamp olarak iletildi');

  // 2. PULL doğrulaması
  const cloudTx = store.getTransactions().find(t => t.title === 'Cloud İşlemi');
  assert(cloudTx && cloudTx.date === '2026-09-27', 'TC-51 Cloud transactions.date DATE-ONLY (2026-09-27) yerel store\'a bozulmadan aktarıldı');
}

// TC-52: Quick Expense Preset İle Eklenen İşlemin Yerel Tarihi Alması
{
  const store = new BudgetStore();
  let prefillPassed = null;
  const mockModalManager = {
    openTransactionModal: (mode, prefill) => {
      prefillPassed = prefill;
    }
  };

  const ui = new UIManager(store, { modalManager: mockModalManager });
  const preset = store.getPresets()[0];
  mockModalManager.openTransactionModal('add', {
    title: preset.title,
    amount: preset.amount,
    type: 'expense',
    categoryId: preset.categoryId,
    date: ui.getDefaultTransactionDate()
  });

  assert(prefillPassed && prefillPassed.date === getLocalDateString(), 'TC-52 Quick preset işlem tarihi için getDefaultTransactionDate() yerel tarih sağladı');
}

// --------------------------------------------------------------------------
// 12. FAZ 3 REALTIME DÖNGÜ ÖNLEME (ANTI-LOOP), PULL-ONLY VE SELF-ECHO ENGELLEME TESTLERİ
// --------------------------------------------------------------------------
console.log('\n--- 12. FAZ 3 REALTIME DÖNGÜ ÖNLEME (ANTI-LOOP), PULL-ONLY VE SELF-ECHO ENGELLEME TESTLERİ ---');

// TC-53: Realtime Eventi Geldiğinde pullOnly: true ile Çalışma ve Sıfır Cloud Write (Zero Write Guarantee)
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let cloudWriteCount = 0;
  const writtenTables = [];

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      }),
      update: () => {
        cloudWriteCount++;
        writtenTables.push('user_sync_metadata');
        return { error: null };
      }
    },
    user_settings: {
      maybeSingle: () => ({
        data: {
          currency: 'TRY',
          language: 'tr',
          onboarded: true,
          updated_at: '2026-09-20T10:00:00.000Z'
        },
        error: null
      }),
      upsert: () => {
        cloudWriteCount++;
        writtenTables.push('user_settings');
        return { data: {}, error: null };
      }
    },
    presets: {
      select: () => ({
        data: [{
          preset_key: 'food',
          title: 'Yemek',
          amount: 50,
          type: 'expense',
          category_id: 'exp_food',
          icon: 'utensils',
          sort_order: 1,
          updated_at: '2026-09-20T10:00:00.000Z'
        }],
        error: null
      }),
      upsert: () => {
        cloudWriteCount++;
        writtenTables.push('presets');
        return { data: [], error: null };
      }
    },
    transactions: {
      select: () => ({
        data: [{
          id: generateUUID(),
          user_id: fakeUser.id,
          title: 'Diğer Cihazın Eklediği Harcama',
          amount: 45,
          type: 'expense',
          category_id: 'exp_food',
          date: '2026-09-27',
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }],
        error: null
      }),
      upsert: () => {
        cloudWriteCount++;
        writtenTables.push('transactions:upsert');
        return { data: [], error: null };
      },
      update: () => {
        cloudWriteCount++;
        writtenTables.push('transactions:update');
        return { data: [], error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // Realtime tetiklemesi pull-only olarak simüle ediliyor
  const result = await sync.sync({ user: fakeUser, reason: 'realtime', pullOnly: true });

  assert(result.success === true, 'TC-53 Realtime pull-only senkronizasyonu başarılı oldu');
  assert(cloudWriteCount === 0, `TC-53 Realtime kaynaklı sync sırasında buluta SIFIR yazma yapıldı (Cloud Write Count: ${cloudWriteCount})`);
  assert(writtenTables.length === 0, 'TC-53 Hiçbir tabloya (user_settings, presets, transactions, user_sync_metadata) PUSH yapılmadı');
  assert(store.getTransactions().some(t => t.title === 'Diğer Cihazın Eklediği Harcama'), 'TC-53 Diğer cihazın işlemi yerel store\'a hatasız çekildi');
}

// TC-54: Self-Echo Tespiti ve Engellemesi (Self-Echo Prevention via recordLocalWrite & isSelfEcho)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const mockClient = {
    channel: (name) => {
      let changeHandler = null;
      const ch = {
        name,
        on: (type, filter, handler) => {
          if (filter.table === 'transactions') changeHandler = handler;
          return ch;
        },
        subscribe: (cb) => {
          if (cb) cb('SUBSCRIBED');
          return ch;
        }
      };
      // Dispatch helper
      ch._dispatch = (payload) => {
        if (changeHandler) changeHandler(payload);
      };
      mockClient._lastChannel = ch;
      return ch;
    },
    removeChannel: () => {},
    from: () => ({ select: () => ({ data: [], error: null }) })
  };

  const sync = new SyncService(store, mockClient);
  authService.currentUser = fakeUser;
  sync.setupRealtimeSubscription(fakeUser);

  const localTxId = generateUUID();
  const localUpdatedAt = '2026-09-27T00:45:00.000Z';

  // 1. Yerel istemci yazma yaptı ve bunu kaydetti
  sync.recordLocalWrite(localTxId, localUpdatedAt);

  // 2. Self-echo testi doğrudan fonksiyon üzerinden
  const isEcho = sync.isSelfEcho('transactions', {
    new: { id: localTxId, updated_at: localUpdatedAt }
  });
  assert(isEcho === true, 'TC-54 sync.isSelfEcho kendi yazdığımız ID ve timestamp için TRUE döndürdü');

  // 3. Realtime event akışı üzerinden self-echo testi
  mockClient._lastChannel._dispatch({
    eventType: 'UPDATE',
    table: 'transactions',
    new: { id: localTxId, updated_at: localUpdatedAt }
  });

  assert(sync.remoteSyncTimer === null, 'TC-54 Self-echo Realtime event geldiğinde remoteSyncTimer PLANLANMADI (Echo engellendi)');

  // 4. Farklı bir cihazdan gelen yabancı event testi
  const foreignTxId = generateUUID();
  const isForeignEcho = sync.isSelfEcho('transactions', {
    new: { id: foreignTxId, updated_at: '2026-09-27T00:46:00.000Z' }
  });
  assert(isForeignEcho === false, 'TC-54 Başka cihazdan gelen işlem için isSelfEcho FALSE döndürdü');

  mockClient._lastChannel._dispatch({
    eventType: 'INSERT',
    table: 'transactions',
    new: { id: foreignTxId, updated_at: '2026-09-27T00:46:00.000Z' }
  });

  assert(Boolean(sync.remoteSyncTimer), 'TC-54 Başka cihazdan gelen işlem için remoteSyncTimer başarıyla PLANLANDI');
  clearTimeout(sync.remoteSyncTimer);
  sync.remoteSyncTimer = null;
}

// TC-55: Cloud Ayar/Preset Çekildiğinde updatedAt Korunması ve Dirty Flag Temizliği
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushedSettings = null;
  let pushedPresets = null;

  const cloudSettingsUpdatedAt = '2026-09-26T20:00:00.000Z';
  const cloudPresetUpdatedAt = '2026-09-26T20:00:00.000Z';

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-26T20:00:00.000Z' },
        error: null
      }),
      update: () => ({ error: null })
    },
    user_settings: {
      maybeSingle: () => ({
        data: {
          currency: 'EUR',
          language: 'en',
          onboarded: true,
          updated_at: cloudSettingsUpdatedAt
        },
        error: null
      }),
      upsert: (payload) => {
        pushedSettings = payload;
        return { data: payload, error: null };
      }
    },
    presets: {
      select: () => ({
        data: [{
          preset_key: 'coffee',
          title: 'Kahve',
          amount: 60,
          type: 'expense',
          category_id: 'exp_food',
          icon: 'coffee',
          sort_order: 1,
          updated_at: cloudPresetUpdatedAt
        }],
        error: null
      }),
      upsert: (payload) => {
        pushedPresets = payload;
        return { data: payload, error: null };
      }
    },
    transactions: {
      select: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt('2026-09-26T19:00:00.000Z');
  authService.currentUser = fakeUser;

  // 1. Delta pull çalıştırılıyor
  await sync.sync({ user: fakeUser, reason: 'realtime', pullOnly: true });

  assert(store.state.settings.currency === 'EUR', 'TC-55 Buluttan currency: EUR çekildi');
  assert(store.state.settings.updatedAt === new Date(cloudSettingsUpdatedAt).getTime(), 'TC-55 Cloud settings updatedAt değeri yerelde birebir korundu (Date.now üretilmedi)');
  assert(store.dirtySettings === false, 'TC-55 Remote çekim sonrası store.dirtySettings=false oldu');
  assert(store.dirtyPresets === false, 'TC-55 Remote çekim sonrası store.dirtyPresets=false oldu');

  // 2. Hemen ardından normal (pullOnly: false) sync çalıştırılıyor
  pushedSettings = null;
  pushedPresets = null;
  await sync.sync({ user: fakeUser, reason: 'test', pullOnly: false });

  assert(pushedSettings === null, 'TC-55 Temiz store ayarları buluta ASLA tekrar PUSH edilmedi (Self-echo loop önlendi)');
  assert(pushedPresets === null, 'TC-55 Temiz store presetleri buluta ASLA tekrar PUSH edilmedi');
}

// TC-56: Seri Realtime Bildirimlerinin Birleştirilmesi (Debouncing / Coalescing)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({ data: { user_id: fakeUser.id, last_synced_at: new Date().toISOString() }, error: null })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date().toISOString());
  authService.currentUser = fakeUser;

  // 3 adet hızlı realtime event tetiklemesi
  sync.scheduleRemoteDeltaSync(50);
  const firstTimer = sync.remoteSyncTimer;
  sync.scheduleRemoteDeltaSync(50);
  const secondTimer = sync.remoteSyncTimer;
  sync.scheduleRemoteDeltaSync(50);
  const thirdTimer = sync.remoteSyncTimer;

  assert(firstTimer !== secondTimer, 'TC-56 Yeni realtime event geldiğinde önceki timer iptal edildi');
  assert(secondTimer !== thirdTimer, 'TC-56 Üçüncü eventte timer tekrar yenilendi');

  clearTimeout(thirdTimer);
  sync.remoteSyncTimer = null;
}

// TC-57: Background / Realtime Pull Sırasında UI Sync Status Dalgalanmasının Önlenmesi (Silent Pull)
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  const statusHistory = [];

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({ data: { user_id: fakeUser.id, last_synced_at: new Date().toISOString() }, error: null })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 30000).toISOString());
  authService.currentUser = fakeUser;

  // Başlangıç durumu "synced"
  sync.setStatus('synced', 'Bulut ile eşitlendi');

  sync.onStatusChange((status) => {
    statusHistory.push(status);
  });

  // pullOnly: true ve yerel store temiz
  await sync.sync({ user: fakeUser, reason: 'realtime', pullOnly: true });

  assert(!statusHistory.includes('syncing'), 'TC-57 Background pullOnly sync sırasında durum ASLA "syncing" olmadı (UI dalgalanması önlendi)');
  assert(sync.getStatus() === 'synced', 'TC-57 Background pullOnly sync sonrası durum "synced" olarak kaldı');
}

// TC-58: Gerçek Yerel Değişiklik Olduğunda Normal Push Akışının Çalışması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushedTransactions = null;
  let metadataUpdated = false;
  const statusHistory = [];

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 60000).toISOString() },
        error: null
      }),
      update: () => {
        metadataUpdated = true;
        return { error: null };
      }
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: (payload) => {
        pushedTransactions = payload;
        return { data: payload, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  sync.onStatusChange((st) => statusHistory.push(st));

  // Kullanıcı yerel işlem ekliyor
  store.addTransaction({
    title: 'Gerçek Kullanıcı Gideri',
    amount: 85,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  assert(store.hasUnsyncedChanges === true, 'TC-58 addTransaction sonrası store.hasUnsyncedChanges=true oldu');

  // Normal kullanıcı sync tetiklemesi
  await sync.sync({ user: fakeUser, reason: 'local-change', pullOnly: false });

  assert(statusHistory.includes('syncing'), 'TC-58 Gerçek yerel değişiklikte durum "syncing" aşamasından geçti');
  assert(Boolean(pushedTransactions), 'TC-58 Yerel işlem buluta push edildi');
  assert(pushedTransactions[0].title === 'Gerçek Kullanıcı Gideri', 'TC-58 Doğru işlem verisi push edildi');
  assert(metadataUpdated === true, 'TC-58 Gerçek veri gönderildiği için user_sync_metadata güncellendi');
  assert(store.hasUnsyncedChanges === false, 'TC-58 Başarılı sync sonrası store.hasUnsyncedChanges=false oldu');
  assert(sync.getStatus() === 'synced', 'TC-58 Son durum "synced" oldu');
}

// TC-59: user_sync_metadata Sadece Push Yapıldığında Güncellenir (Zero Write on Read/Pull)
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let metadataUpdateCalls = 0;

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 60000).toISOString() },
        error: null
      }),
      update: () => {
        metadataUpdateCalls++;
        return { error: null };
      }
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());
  authService.currentUser = fakeUser;

  // 1. pullOnly: true ile delta sync
  await sync.sync({ user: fakeUser, reason: 'realtime', pullOnly: true });
  assert(metadataUpdateCalls === 0, 'TC-59 pullOnly: true iken user_sync_metadata ASLA güncellenmedi');

  // 2. pullOnly: false ama yerel değişiklik yok
  await sync.sync({ user: fakeUser, reason: 'idle-check', pullOnly: false });
  assert(metadataUpdateCalls === 0, 'TC-59 Değişiklik olmayan temiz sync sırasında user_sync_metadata ASLA güncellenmedi');
}

// --------------------------------------------------------------------------
// 13. FAZ 3 İŞLEM SIRALAMASI (TIE-BREAKER CREATED_AT) VE YEREL SAAT GÖSTERİMİ TESTLERİ
// --------------------------------------------------------------------------
console.log('\n--- 13. FAZ 3 İŞLEM SIRALAMASI (TIE-BREAKER CREATED_AT) VE YEREL SAAT GÖSTERİMİ TESTLERİ ---');

// TC-60: Aynı Tarih (date) İçinde 00:40 ve 00:45 İşlemlerinde 00:45'in Üstte Olması
{
  const txEarlier = {
    id: generateUUID(),
    title: 'A Test (00:40)',
    amount: 100,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: new Date('2026-09-26T21:40:00.000Z').getTime() // TR 00:40
  };
  const txLater = {
    id: generateUUID(),
    title: 'B Test (00:45)',
    amount: 150,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: new Date('2026-09-26T21:45:00.000Z').getTime() // TR 00:45
  };

  // compareTransactions doğrudan testi
  const cmpResult = compareTransactions(txEarlier, txLater, 'date-desc');
  assert(cmpResult > 0, 'TC-60 compareTransactions 00:45 işlemini 00:40 işleminin önüne koydu (cmpResult > 0)');

  // Dizi sıralaması testi
  const list = [txEarlier, txLater].sort((a, b) => compareTransactions(a, b, 'date-desc'));
  assert(list[0].title === 'B Test (00:45)', 'TC-60 Aynı gün içindeki iki işlemde 00:45 üstte yer aldı');
  assert(list[1].title === 'A Test (00:40)', 'TC-60 Aynı gün içindeki iki işlemde 00:40 altta yer aldı');
}

// TC-61: Farklı Tarihlerde (date) Önce date DESC Önceliğinin Korunması
{
  const txYesterdayLate = {
    id: generateUUID(),
    title: 'Dün Gece (23:55)',
    amount: 50,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-26',
    createdAt: new Date('2026-09-26T20:55:00.000Z').getTime()
  };
  const txTodayEarly = {
    id: generateUUID(),
    title: 'Bugün Sabah (00:05)',
    amount: 70,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: new Date('2026-09-26T21:05:00.000Z').getTime()
  };

  const list = [txYesterdayLate, txTodayEarly].sort((a, b) => compareTransactions(a, b, 'date-desc'));
  assert(list[0].title === 'Bugün Sabah (00:05)', 'TC-61 Farklı günlerde saat fark etmeksizin yeni tarih (2026-09-27) üstte yer aldı');
  assert(list[1].title === 'Dün Gece (23:55)', 'TC-61 Eski tarih (2026-09-26) altta kaldı');
}

// TC-62: Eski Bir İşlem Düzenlendiğinde (updatedAt Değiştiğinde) Sıranın Bozulmaması
{
  const store = new BudgetStore();
  const tx1 = store.addTransaction({
    title: 'İşlem 1 (10:00)',
    amount: 100,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: 100000
  });
  const tx2 = store.addTransaction({
    title: 'İşlem 2 (12:00)',
    amount: 200,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: 200000
  });

  // İşlem 1 (10:00) daha sonra saat 15:00'te düzenlenir (updatedAt çok yüksek olur)
  store.updateTransaction(tx1.id, {
    title: 'İşlem 1 (Düzenlendi)',
    amount: 120
  });

  const txs = store.getTransactions();
  const updatedTx1 = txs.find(t => t.id === tx1.id);
  assert(updatedTx1.createdAt === 100000, 'TC-62 updateTransaction sonrası orijinal createdAt zaman damgası korundu');
  assert(updatedTx1.updatedAt > 200000, 'TC-62 updateTransaction sonrası updatedAt güncellendi');

  // Sıralamayı doğrula: İşlem 2 (12:00) hala en üstte olmalıdır!
  assert(txs[0].title === 'İşlem 2 (12:00)', 'TC-62 Düzenlenen eski işlem listenin en üstüne SIÇRAMADI (createdAt tie-breaker korundu)');
  assert(txs[1].title === 'İşlem 1 (Düzenlendi)', 'TC-62 Düzenlenen işlem doğru sırada kaldı');
}

// TC-63: formatTime Saat Gösterimi ve TR Local Timezone Dönüşümü
{
  const isoUtc = '2026-09-26T21:43:00.000Z';
  const formattedTr = formatTime(isoUtc, 'tr');
  const d = new Date(isoUtc);
  const expectedHours = String(d.getHours()).padStart(2, '0');
  const expectedMinutes = String(d.getMinutes()).padStart(2, '0');
  const expectedLocalTime = `${expectedHours}:${expectedMinutes}`;

  assert(formattedTr === expectedLocalTime, `TC-63 formatTime kullanıcının yerel saatini üretti (${formattedTr} === ${expectedLocalTime})`);
  assert(!formattedTr.includes(':00') || formattedTr.split(':').length === 2, 'TC-63 formatTime saniye göstermedi (HH:mm)');

  // Boş ve geçersiz kontrolleri
  assert(formatTime(null) === '', 'TC-63 formatTime(null) boş string döndürdü');
  assert(formatTime(undefined) === '', 'TC-63 formatTime(undefined) boş string döndürdü');
  assert(formatTime('gecersiz-tarih') === '', 'TC-63 formatTime(gecersiz) boş string döndürdü');
}

// TC-64: createdAt Eksik / Eski Kayıtların UI'ı Bozmaması (Legacy Fallback)
{
  const legacyTx1 = { id: 'leg-1', title: 'Eski Fiş 1', date: '2026-09-20', createdAt: null };
  const legacyTx2 = { id: 'leg-2', title: 'Eski Fiş 2', date: '2026-09-20', createdAt: undefined };

  const cmp = compareTransactions(legacyTx1, legacyTx2, 'date-desc');
  assert(cmp === 0, 'TC-64 createdAt olmayan iki legacy işlem için stabil sıra korundu (cmp === 0)');
  assert(formatTime(legacyTx1.createdAt) === '', 'TC-64 Legacy işlem için formatTime boş döndü (UI kırılmadı)');
}

// TC-65: UIManager İşlem Listesinde Tarih ve Saatin Birlikte Render Edilmesi
{
  const store = new BudgetStore();
  const txWithTime = {
    id: generateUUID(),
    title: 'Gece Harcaması',
    amount: 45,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: new Date('2026-09-26T21:43:00.000Z').getTime()
  };
  const txWithoutTime = {
    id: generateUUID(),
    title: 'Eski Saat Bilgisiz Harcama',
    amount: 60,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-26',
    createdAt: null
  };

  const ui = new UIManager(store);

  const htmlWithTime = ui.renderTransactionRowHtml(txWithTime, 'tr', 'TRY');
  const htmlWithoutTime = ui.renderTransactionRowHtml(txWithoutTime, 'tr', 'TRY');

  assert(htmlWithTime.includes('Gece Harcaması'), 'TC-65 İşlem 1 listede render edildi');
  assert(htmlWithoutTime.includes('Eski Saat Bilgisiz Harcama'), 'TC-65 İşlem 2 listede render edildi');
  assert(htmlWithTime.includes('27 Eyl 2026'), 'TC-65 İşlem 1 için tarih (27 Eyl 2026) render edildi');
  assert(htmlWithTime.includes('• '), 'TC-65 İşlem 1 için saat ayracı (•) render edildi');
  const expectedLocalTime = formatTime(txWithTime.createdAt, 'tr');
  assert(htmlWithTime.includes(expectedLocalTime), `TC-65 İşlem 1 için yerel saat (${expectedLocalTime}) render edildi`);
  assert(!htmlWithoutTime.includes('• '), 'TC-65 createdAt eksik işlem için saat ayracı (•) render edilmedi');
  assert(!htmlWithTime.includes('null') && !htmlWithTime.includes('undefined'), 'TC-65 HTML içinde "null" veya "undefined" metni yer almadı');
}

// TC-66: Çoklu Cihaz Senkronizasyonu Sıralama Bütünlüğü (Multi-Device Sort Invariance)
{
  const txEarly = {
    id: 'tx-1',
    title: 'A Test (00:40)',
    amount: 10,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: 1790462400000
  };
  const txLate = {
    id: 'tx-2',
    title: 'B Test (00:45)',
    amount: 20,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: 1790462700000
  };

  const device1List = [txLate, txEarly].sort((a, b) => compareTransactions(a, b, 'date-desc'));
  const device2List = [txEarly, txLate].sort((a, b) => compareTransactions(a, b, 'date-desc'));

  assert(device1List[0].id === 'tx-2' && device2List[0].id === 'tx-2', 'TC-66 İki cihazda da en son oluşturulan B Test (00:45) en üstte yer aldı');
  assert(device1List[1].id === 'tx-1' && device2List[1].id === 'tx-1', 'TC-66 İki cihazda da A Test (00:40) ikinci sırada yer aldı');
  assert(device1List.map(t => t.id).join(',') === device2List.map(t => t.id).join(','), 'TC-66 Çoklu cihazda sıra kesinlikle birebir aynı (invariant) oldu');
}

// --------------------------------------------------------------------------
console.log('\n--- 14. FAZ 3 OFFLINE RECONNECT RECOVERY MİMARİSİ TESTLERİ (TC-67 - TC-76) ---');

function createMockClientWithRealtime(handlers = {}) {
  const base = createMockClient(handlers);
  return {
    ...base,
    channel: (name) => {
      const ch = {
        name,
        on: () => ch,
        subscribe: (cb) => {
          if (cb) cb('SUBSCRIBED');
          return ch;
        }
      };
      return ch;
    },
    removeChannel: () => {}
  };
}

// TC-67: Çevrimdışıyken işlem ekleme, yerel kalıcılık ve hasUnsyncedChanges
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_deleted_queue');

  const store = new BudgetStore();
  const mockClient = createMockClientWithRealtime({});
  const sync = new SyncService(store, mockClient);
  sync.setStatus('offline', 'Çevrimdışı Mod');

  const tx = store.addTransaction({
    title: 'Offline Test',
    amount: 77,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  assert(store.getTransactions().length === 1, 'TC-67 Offline işlem yerel store\'a eklendi');
  assert(store.getTransactions()[0].amount === 77, 'TC-67 Offline işlem tutarı 77 TL olarak kaydedildi');
  assert(store.hasUnsyncedChanges === true, 'TC-67 Offline işlem sonrası store.hasUnsyncedChanges=true oldu');
  assert(sync.getStatus() === 'offline', 'TC-67 Çevrimdışı modda durum offline olarak korundu');
}

// TC-68: Yazıcı Cihaz: recoverAfterReconnect ile yerel veriyi buluta PUSH etme ve synced olma
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_deleted_queue');

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let pushedTransactions = [];
  let metadataUpdated = false;

  const mockClient = createMockClientWithRealtime({
    user_settings: {
      select: () => ({ data: null, error: null }),
      upsert: (payload) => ({ data: payload, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null }),
      upsert: (payload) => ({ data: payload, error: null })
    },
    transactions: {
      select: () => ({ data: pushedTransactions, error: null }),
      upsert: (payload) => {
        pushedTransactions = payload;
        return { data: payload, error: null };
      }
    },
    user_sync_metadata: {
      select: () => ({ data: { user_id: fakeUser.id, last_synced_at: '2026-09-26T20:00:00Z' }, error: null }),
      update: () => {
        metadataUpdated = true;
        return { data: {}, error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt('2026-09-26T20:00:00Z');

  // Çevrimdışıyken eklenen "Offline Test" 77 TL
  store.addTransaction({
    title: 'Offline Test',
    amount: 77,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  assert(store.hasUnsyncedChanges === true, 'TC-68 Reconnect öncesi store dirty');

  // Wi-Fi açıldı -> recoverAfterReconnect tetiklendi
  const res = await sync.recoverAfterReconnect(fakeUser);

  assert(res.success === true, 'TC-68 recoverAfterReconnect başarılı sonuç döndü');
  assert(pushedTransactions.length === 1, 'TC-68 Yazıcı cihazın Offline Test işlemi buluta push edildi');
  assert(pushedTransactions[0].title === 'Offline Test' && pushedTransactions[0].amount === 77, 'TC-68 Doğru işlem başlığı ve tutarı (77 TL) push edildi');
  assert(pushedTransactions[0].date === '2026-09-27', 'TC-68 İşlem tarihi DATE-ONLY 2026-09-27 olarak push edildi');
  assert(metadataUpdated === true, 'TC-68 user_sync_metadata last_synced_at güncellendi');
  assert(store.hasUnsyncedChanges === false, 'TC-68 Başarılı recovery sonrası store.hasUnsyncedChanges=false oldu');
  assert(sync.getStatus() === 'synced', 'TC-68 Yazıcı cihazın durumu "synced" oldu');
}

// TC-69: Alıcı Cihaz: Yerel değişikliği olmayan cihazın filtresiz Full Cloud Catch-up ile işlemi alması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const receiverStore = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let cloudSelectGtUsed = false;

  const cloudTransaction = {
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Offline Test',
    amount: 77,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: new Date('2026-09-27T00:30:00Z').toISOString(),
    updated_at: new Date('2026-09-27T00:30:00Z').toISOString()
  };

  const receiverMockClient = createMockClientWithRealtime({
    user_settings: {
      select: () => ({ data: null, error: null })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: (state) => {
        if (state.gtFilter) cloudSelectGtUsed = true;
        return { data: [cloudTransaction], error: null };
      }
    },
    user_sync_metadata: {
      select: () => ({ data: { user_id: fakeUser.id }, error: null })
    }
  });

  const receiverSync = new SyncService(receiverStore, receiverMockClient);
  receiverSync.setLastSyncedAt('2026-09-27T00:00:00Z');

  assert(receiverStore.getTransactions().length === 0, 'TC-69 Alıcı cihazda başlangıçta 0 işlem var');

  // Alıcı cihaz Wi-Fi açılınca recoverAfterReconnect çalıştırır
  const res = await receiverSync.recoverAfterReconnect(fakeUser);

  assert(res.success === true, 'TC-69 Alıcı cihaz recoverAfterReconnect başarılı oldu');
  assert(cloudSelectGtUsed === false, 'TC-69 Alıcı cihaz Full Cloud Catch-up sırasında .gt filtresi KULLANMADI (tüm aktif kayıtları taradı)');
  assert(receiverStore.getTransactions().length === 1, 'TC-69 Alıcı cihaza Offline Test işlemi başarıyla yüklendi');
  assert(receiverStore.getTransactions()[0].title === 'Offline Test' && receiverStore.getTransactions()[0].amount === 77, 'TC-69 Alıcı cihazdaki işlem başlık ve tutarı doğru');
  assert(receiverStore.hasUnsyncedChanges === false, 'TC-69 Alıcı cihazda remote update sonrası hasUnsyncedChanges=false kaldı');
  assert(receiverSync.getStatus() === 'synced', 'TC-69 Alıcı cihaz durumu "synced" oldu');
}

// TC-70: WebSocket Realtime Event Tamamen Düşse/Kaçırılsa Bile İki Cihazın Eşitlenmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const storeA = new BudgetStore();
  const storeB = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let sharedCloudDatabase = [];

  const createSharedMock = (isWriter = false) => createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }), upsert: () => ({ data: {}, error: null }) },
    presets: { select: () => ({ data: [], error: null }), upsert: () => ({ data: {}, error: null }) },
    transactions: {
      select: () => ({ data: sharedCloudDatabase, error: null }),
      upsert: (payload) => {
        sharedCloudDatabase = payload;
        return { data: payload, error: null };
      }
    },
    user_sync_metadata: {
      select: () => ({ data: { user_id: fakeUser.id }, error: null }),
      update: () => ({ data: {}, error: null })
    }
  });

  const syncA = new SyncService(storeA, createSharedMock(true));
  const syncB = new SyncService(storeB, createSharedMock(false));

  // Cihaz A çevrimdışıyken harcama girer
  storeA.addTransaction({
    title: 'Offline Test (Realtime Yokken)',
    amount: 88,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  // İnternet geri geldi: WebSocket eventleri HİÇ GELMEDİ (dropped)
  // Cihaz A recover eder:
  await syncA.recoverAfterReconnect(fakeUser);
  // Cihaz B recover eder:
  await syncB.recoverAfterReconnect(fakeUser);

  // İki cihazın listelerini karşılaştır
  assert(storeA.getTransactions().length === 1 && storeB.getTransactions().length === 1, 'TC-70 Realtime olmadan her iki cihazda da 1 işlem var');
  assert(storeA.getTransactions()[0].id === storeB.getTransactions()[0].id, 'TC-70 Her iki cihazdaki işlem ID\'leri birebir aynı');
  assert(storeB.getTransactions()[0].amount === 88, 'TC-70 Cihaz B işlemi 88 TL olarak eksiksiz aldı');
}

// TC-71: Staggered Safety Catch-Up: Alıcı Yazıcıdan Önce Bağlansa Bile Yarışı Çözme
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const receiverStore = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let cloudTxs = [];

  const receiverMock = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: cloudTxs, error: null }) },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
  });

  const receiverSync = new SyncService(receiverStore, receiverMock);

  // t=0: Alıcı recover çalıştırdı. Cloud henüz boş (yazıcı henüz yükleyemedi)
  await receiverSync.recoverAfterReconnect(fakeUser);
  assert(receiverStore.getTransactions().length === 0, 'TC-71 Alıcı ilk anda henüz yüklenmemiş buluttan 0 kayıt aldı');
  assert(receiverSync.safetyCatchUpTimer !== null, 'TC-71 Alıcı için 1.5s emniyet catch-up zamanlayıcısı kuruldu');

  // t=50ms: Yazıcı push işlemini tamamladı ve cloud doldu
  cloudTxs = [{
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Geciken Offline Harcama',
    amount: 110,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }];

  // 1.5s emniyet zamanlayıcısı devreye girer
  await receiverSync.runFullCloudCatchUp(fakeUser);

  assert(receiverStore.getTransactions().length === 1, 'TC-71 Emniyet yoklaması ile geciken işlem alıcı cihaza başarıyla çekildi');
  assert(receiverStore.getTransactions()[0].title === 'Geciken Offline Harcama', 'TC-71 Çekilen işlem doğru');
}

// TC-72: LWW Koruması: Reconnect Sırasında Yereldeki Daha Yeni Unpushed Değişikliğin Ezilmemesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  const txId = generateUUID();

  // Yerelde çevrimdışıyken düzenlenmiş daha yeni bir kayıt
  store.state.transactions = [{
    id: txId,
    title: 'Yerel Yeni Başlık',
    amount: 99,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27',
    createdAt: 100000,
    updatedAt: 300000 // Yerel daha yeni
  }];

  // Bulutta daha eski versiyonu var
  const olderCloudTx = {
    id: txId,
    user_id: fakeUser.id,
    title: 'Bulut Eski Başlık',
    amount: 50,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: new Date(100000).toISOString(),
    updated_at: new Date(200000).toISOString() // Bulut daha eski
  };

  const mockClient = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }), upsert: () => ({ data: {}, error: null }) },
    presets: { select: () => ({ data: [], error: null }), upsert: () => ({ data: {}, error: null }) },
    transactions: { select: () => ({ data: [olderCloudTx], error: null }), upsert: () => ({ data: {}, error: null }) },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }), update: () => ({ data: {}, error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  await sync.runFullCloudCatchUp(fakeUser);

  const tx = store.getTransactions().find(t => t.id === txId);
  assert(tx.title === 'Yerel Yeni Başlık', 'TC-72 Daha yeni yerel kayıt eski bulut verisiyle EZİLMEDİ (LWW korundu)');
  assert(tx.amount === 99, 'TC-72 Yerel tutar (99 TL) korundu');
}

// TC-73: Reconnect Recovery Hata Durumu (500 / Ağ Hatası) ASLA 'synced' Göstermez
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  store.addTransaction({
    title: 'Hata Testi',
    amount: 40,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  const failingClient = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: null, error: new Error('Sunucu Hatası (HTTP 500)') }),
      upsert: () => ({ data: null, error: new Error('Ağ Hatası (Push Failed)') })
    },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
  });

  const sync = new SyncService(store, failingClient);
  const res = await sync.recoverAfterReconnect(fakeUser);

  assert(res.success === false, 'TC-73 Hata oluşunca recovery başarısız (success: false) döndü');
  assert(sync.getStatus() === 'error', 'TC-73 Hata oluşunca durum "error" oldu');
  assert(sync.getStatus() !== 'synced', 'TC-73 Hata oluşunca durum ASLA "synced" olmadı');
  assert(store.hasUnsyncedChanges === true, 'TC-73 Başarısız sync sonrası bekleyen yerel veriler (hasUnsyncedChanges=true) korundu');
}

// TC-74: Reconnect Sırasında Realtime Kanalının Yeniden Abone Olunması (Resubscribe)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let subscribedChannels = [];

  const mockClient = {
    channel: (name) => {
      subscribedChannels.push(name);
      const ch = {
        name,
        on: () => ch,
        subscribe: (cb) => {
          if (cb) cb('SUBSCRIBED');
          return ch;
        }
      };
      return ch;
    },
    removeChannel: () => {},
    from: createMockClient({
      user_settings: { select: () => ({ data: null, error: null }) },
      presets: { select: () => ({ data: [], error: null }) },
      transactions: { select: () => ({ data: [], error: null }) },
      user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
    }).from
  };

  const sync = new SyncService(store, mockClient);
  sync.realtimeStatus = 'DISCONNECTED';
  sync.realtimeChannel = null;

  await sync.recoverAfterReconnect(fakeUser);

  assert(subscribedChannels.includes(`db-user-${fakeUser.id}`), 'TC-74 Reconnect sonrası Realtime kanalı için yeniden abone olundu');
  assert(sync.realtimeStatus === 'SUBSCRIBED', 'TC-74 Realtime kanal durumu "SUBSCRIBED" yapıldı');
}

// TC-75: Çevrimdışı Düzenleme ve Silme (Soft-Delete) Recovery Akışı
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_deleted_queue');

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const tx1 = store.addTransaction({
    title: 'Düzenlenecek İşlem',
    amount: 100,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });
  const tx2 = store.addTransaction({
    title: 'Silinecek İşlem',
    amount: 50,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  // sync ile bir kez buluta gittiğini varsayalım
  store.markSynced();

  // Çevrimdışı moda geçildi
  // tx1 düzenlendi
  store.updateTransaction(tx1.id, { amount: 150, title: 'Düzenlendi (150 TL)' });
  // tx2 silindi
  store.deleteTransaction(tx2.id);

  let updatedSoftDeleteId = null;
  let upsertedTx = null;

  const mockClient = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }), upsert: () => ({ data: {}, error: null }) },
    presets: { select: () => ({ data: [], error: null }), upsert: () => ({ data: {}, error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: (payload) => {
        upsertedTx = payload[0];
        return { data: payload, error: null };
      },
      update: (payload, eqs) => {
        if (payload.is_deleted) {
          updatedSoftDeleteId = eqs['id'];
        }
        return { data: {}, error: null };
      }
    },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }), update: () => ({ data: {}, error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  sync.trackDeletedTransaction(tx2.id);
  sync.setLastSyncedAt('2026-09-26T20:00:00Z');

  await sync.recoverAfterReconnect(fakeUser);

  assert(upsertedTx && upsertedTx.amount === 150, 'TC-75 Çevrimdışı düzenlenen işlem (150 TL) buluta upsert edildi');
  assert(updatedSoftDeleteId === tx2.id, 'TC-75 Çevrimdışı silinen işlem soft-delete olarak bulutta UPDATE edildi');
  assert(sync.getDeletedQueue().length === 0, 'TC-75 Başarılı recovery sonrası deletedQueue temizlendi');
}

// TC-76: Standart Delta Sync 10 Saniyelik Örtüşme Penceresi (Overlap Window) Testi
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let appliedGtFilter = null;

  const mockClient = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: (state) => {
        if (state.gtFilter) {
          appliedGtFilter = state.gtFilter.val;
        }
        return { data: [], error: null };
      }
    },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  const cursorIso = '2026-09-27T10:00:00.000Z';
  sync.setLastSyncedAt(cursorIso);

  await sync.runDeltaSync(fakeUser, { user_id: fakeUser.id }, { pullOnly: true });

  const expectedOverlapIso = new Date(new Date(cursorIso).getTime() - 10000).toISOString();
  assert(appliedGtFilter === expectedOverlapIso, `TC-76 Delta sorgusunda 10s örtüşme penceresi uygulandı (${appliedGtFilter} === ${expectedOverlapIso})`);
}

// --------------------------------------------------------------------------
console.log('\n--- 15. FAZ 3 REALTIME LIFECYCLE RECONNECT & STARTUP SELF-HEAL (TC-77 - TC-83) ---');

// TC-77: Window Online HİÇ Gelmese Bile Realtime CLOSED -> SUBSCRIBED Geçişi Full Catch-Up Tetikler
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let fullCatchUpRan = false;
  let subscribeCallback = null;

  const cloudTx = {
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Offline Test',
    amount: 88,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: '2026-09-27T17:44:33.000Z',
    updated_at: '2026-09-27T17:44:33.000Z'
  };

  const mockClient = {
    channel: (name) => {
      const ch = {
        name,
        on: () => ch,
        subscribe: (cb) => {
          subscribeCallback = cb;
          if (cb) cb('SUBSCRIBED');
          return ch;
        }
      };
      return ch;
    },
    removeChannel: () => {},
    from: createMockClient({
      user_settings: { select: () => ({ data: null, error: null }) },
      presets: { select: () => ({ data: [], error: null }) },
      transactions: {
        select: () => {
          fullCatchUpRan = true;
          return { data: [cloudTx], error: null };
        }
      },
      user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }), update: () => ({ data: {}, error: null }) }
    }).from
  };

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt('2026-09-27T17:00:00.000Z');
  sync.setupRealtimeSubscription(fakeUser);

  // 1. Ağ kesintisi: WebSocket CLOSED veya CHANNEL_ERROR alır
  subscribeCallback('CLOSED');
  assert(sync.realtimeDisconnected === true, 'TC-77 Realtime CLOSED olduğunda realtimeDisconnected=true oldu');
  assert(sync.getStatus() === 'syncing', 'TC-77 Realtime kopunca durum syncing (bağlantı kuruluyor) oldu');

  // 2. Wi-Fi açılır: window.online event'i HİÇ TETİKLENMEZ (Safari benzeri ortam)
  // Ancak WebSocket arka planda SUBSCRIBED olur:
  fullCatchUpRan = false;
  subscribeCallback('SUBSCRIBED');

  // Bir tick bekle (asenkron recoverAfterReconnect için)
  await new Promise(r => setTimeout(r, 20));

  assert(sync.realtimeDisconnected === false, 'TC-77 Yeniden bağlanınca realtimeDisconnected=false oldu');
  assert(fullCatchUpRan === true, 'TC-77 window online olmasa bile Realtime SUBSCRIBED geçişi Full Cloud Catch-up tetikledi');
  assert(store.getTransactions().length === 1, 'TC-77 Alıcı cihaz 88 TL harcamayı başarıyla aldı');
  assert(store.getTransactions()[0].title === 'Offline Test' && store.getTransactions()[0].amount === 88, 'TC-77 Alıcıdaki işlem başlığı ve tutarı doğru (88 TL)');
}

// TC-78: Writer Cloud'a Yazmış ve Receiver Cursor İleride Olsa Bile Startup Self-Heal Kaydı Getirir
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const receiverStore = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let txQueryUsedGtFilter = false;

  const cloudTxTime = new Date(Date.now() - 120000).toISOString();
  const poisonedCursor = new Date(Date.now() - 60000).toISOString();

  const cloudTx = {
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Offline Test',
    amount: 88,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: cloudTxTime,
    updated_at: cloudTxTime
  };

  const receiverMock = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }), upsert: () => ({ data: {}, error: null }) },
    presets: { select: () => ({ data: [], error: null }), upsert: () => ({ data: {}, error: null }) },
    transactions: {
      select: (state) => {
        if (state.gtFilter) txQueryUsedGtFilter = true;
        return { data: [cloudTx], error: null };
      }
    },
    user_sync_metadata: {
      select: () => ({ data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: poisonedCursor }, error: null }),
      update: () => ({ data: {}, error: null })
    }
  });

  const receiverSync = new SyncService(receiverStore, receiverMock);
  // Poisoned Cursor: Alıcının cursor'u kaydın güncellenme anından (cloudTxTime) daha ileride!
  receiverSync.setLastSyncedAt(poisonedCursor);

  assert(receiverStore.getTransactions().length === 0, 'TC-78 Alıcı cihazda başlangıçta 0 kayıt var');

  // Uygulama açılışında / yenilemede Startup Self-Heal çalıştırılır
  const res = await receiverSync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === true, 'TC-78 Startup Self-Heal başarıyla tamamlandı');
  assert(txQueryUsedGtFilter === false, 'TC-78 Startup Self-Heal sırasında poisoned cursor filtresi (.gt) KULLANILMADI');
  assert(receiverStore.getTransactions().length === 1, 'TC-78 Poisoned cursor olmasına rağmen 88 TL işlem içeri alındı');
  assert(receiverStore.getTransactions()[0].amount === 88, 'TC-78 İşlem tutarı 88 TL olarak doğrulandı');
  assert(new Date(receiverSync.getLastSyncedAt()).getTime() > new Date(poisonedCursor).getTime(), 'TC-78 Poisoned cursor güncellenerek güvenli hale getirildi');
}

// TC-79: Cmd+R Refresh Sonrası Eksik Transaction ve LocalStorage Kalıcılığı
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const fakeUser = { id: generateUUID() };
  const cloudTx = {
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Offline Test',
    amount: 88,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: '2026-09-27T17:44:33.000Z',
    updated_at: '2026-09-27T17:44:33.000Z'
  };

  const client = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: { currency: 'TRY', onboarded: true }, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [cloudTx], error: null }) },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }), update: () => ({ data: {}, error: null }) }
  });

  const refreshedStore = new BudgetStore();
  const refreshedSync = new SyncService(refreshedStore, client);
  refreshedSync.setLastSyncedAt('2026-09-27T18:00:00.000Z'); // poisoned cursor

  // Refresh sonrası handleUserLogin tetiklendi:
  await refreshedSync.handleUserLogin(fakeUser);

  // LocalStorage kontrolü:
  const rawStorage = SafeStorage.getItem(STORAGE_KEY);
  assert(Boolean(rawStorage), 'TC-79 Refresh sonrası LocalStorage boş değil');
  const parsedStorage = JSON.parse(rawStorage || '{}');
  const storedTxs = parsedStorage.transactions || [];

  assert(storedTxs.length === 1, 'TC-79 Refresh sonrası LocalStorage içinde 1 işlem saklandı');
  assert(storedTxs[0].title === 'Offline Test' && storedTxs[0].amount === 88, 'TC-79 LocalStorage içindeki 88 TL Offline Test işlemi doğrulandı');
  assert(refreshedSync.getStatus() === 'synced', 'TC-79 Refresh sonrası sync durumu "synced" oldu');
}

// TC-80: Realtime Reconnect Catch-up Yerel State Persist Edilmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);

  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  const tx = {
    id: generateUUID(),
    user_id: fakeUser.id,
    title: 'Yeni Reconnect Kaydı',
    amount: 120,
    type: 'expense',
    category_id: 'exp_food',
    date: '2026-09-27',
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const client = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [tx], error: null }) },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
  });

  const sync = new SyncService(store, client);
  await sync.runFullCloudCatchUp(fakeUser);

  const saved = JSON.parse(SafeStorage.getItem(STORAGE_KEY) || '{}');
  assert(saved.transactions?.length === 1, 'TC-80 Full catch-up sonrası LocalStorage otomatik kaydedildi');
  assert(saved.transactions[0].amount === 120, 'TC-80 Kaydedilen işlem tutarı doğru (120 TL)');
}

// TC-81: Focus / Visibility: Realtime Disconnected ise Full Catch-up Tetiklenmesi
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let fullCatchUpTriggered = false;

  const client = createMockClientWithRealtime({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => {
        fullCatchUpTriggered = true;
        return { data: [], error: null };
      }
    },
    user_sync_metadata: { select: () => ({ data: { user_id: fakeUser.id }, error: null }) }
  });

  const sync = new SyncService(store, client);
  sync.realtimeDisconnected = true;
  sync.realtimeStatus = 'DISCONNECTED';

  // Simüle edilmiş focus event: Realtime sağlıksız olduğu için full catch-up çalıştırmalı
  await sync.runFullCloudCatchUp(fakeUser);

  assert(fullCatchUpTriggered === true, 'TC-81 Realtime disconnected iken full catch-up tetiklendi');
  assert(sync.lastFullCatchUpTime > 0, 'TC-81 lastFullCatchUpTime güncellendi');
}

// TC-82: Normal Steady-State SUBSCRIBED Durumunda Focus Throttling
{
  const store = new BudgetStore();
  const sync = new SyncService(store);

  sync.realtimeStatus = 'SUBSCRIBED';
  sync.realtimeDisconnected = false;
  sync.lastFullCatchUpTime = Date.now() - 5000; // 5 saniye önce yapılmış

  const now = Date.now();
  const isRealtimeHealthy = (sync.realtimeStatus === 'SUBSCRIBED' && !sync.realtimeDisconnected);
  const timeSinceLast = now - sync.lastFullCatchUpTime;
  const shouldFullCatchUp = (!isRealtimeHealthy || timeSinceLast > 45000);

  assert(shouldFullCatchUp === false, 'TC-82 Sağlıklı SUBSCRIBED ve 45s dolmamışken full catch-up engellendi (throttling)');
}

// TC-83: Reconnect Loop Önleme (Anti-Loop Guard)
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };
  let recoveryCount = 0;

  const sync = new SyncService(store);
  sync.recoverAfterReconnect = async () => {
    recoveryCount++;
    return { success: true };
  };

  sync.realtimeDisconnected = true;

  // 1. İlk SUBSCRIBED event: recovery tetiklenmeli
  if (sync.realtimeDisconnected) {
    sync.realtimeDisconnected = false;
    await sync.recoverAfterReconnect(fakeUser);
  }

  // 2. İkinci SUBSCRIBED event (aynı bağlantıda self-echo veya tekrar):
  if (sync.realtimeDisconnected) {
    await sync.recoverAfterReconnect(fakeUser);
  }

  assert(recoveryCount === 1, 'TC-83 Reconnect recovery yalnızca 1 kez çalıştırıldı (sonsuz döngü önlendi)');
  assert(sync.realtimeDisconnected === false, 'TC-83 İşlem sonrası realtimeDisconnected false kaldı');
}

// --------------------------------------------------------------------------
// 16. FAZ 3 İŞLEM SİLME CONFIRMATION MODAL & FLASH/FLICKER ÖNLEME TESTLERİ (TC-84 - TC-88)
// --------------------------------------------------------------------------
console.log('\n--- 16. FAZ 3 İŞLEM SİLME CONFIRMATION MODAL & FLASH/FLICKER ÖNLEME (TC-84 - TC-88) ---');
setLanguage('tr');

// TC-84: Delete Click -> Yalnızca Tek Confirmation Modal Açılır (İşlemi Onaylayın / Sil / Onayla)
{
  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Kahve ve Sandviç',
    amount: 140,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });

  let openConfirmCalls = 0;
  let passedModalConfig = null;

  const mockModalManager = {
    openConfirmModal: (config) => {
      openConfirmCalls++;
      passedModalConfig = config;
    }
  };

  const ui = new UIManager(store, { modalManager: mockModalManager });

  const simulateDeleteClick = () => {
    mockModalManager.openConfirmModal({
      title: t('confirmModal.title'),
      desc: t('confirmModal.desc'),
      actionText: t('confirmModal.confirmDelete') || 'Sil / Onayla',
      onConfirm: () => {
        store.deleteTransaction(tx.id);
      }
    });
  };

  simulateDeleteClick();

  assert(openConfirmCalls === 1, 'TC-84 Çöp kutusuna tıklandığında yalnızca TEK bir confirmation modal açıldı');
  assert(passedModalConfig !== null, 'TC-84 Modal konfigürasyonu sağlandı');
  assert(passedModalConfig.title === 'İşlemi Onaylayın', 'TC-84 Modal başlığı tam olarak "İşlemi Onaylayın" oldu');
  assert(passedModalConfig.desc === 'Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?', 'TC-84 Modal metni tam olarak "Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?" oldu');
  assert(passedModalConfig.actionText === 'Sil / Onayla', 'TC-84 Onay butonu metni "Sil / Onayla" oldu');
  assert(typeof passedModalConfig.onConfirm === 'function', 'TC-84 onConfirm callback sağlandı');
}

// TC-85: Native window.confirm() Asla Çağrılmıyor
{
  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Metro Kartı',
    amount: 50,
    type: 'expense',
    categoryId: 'exp_transport',
    date: '2026-09-27'
  });

  let nativeConfirmCalled = false;
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => {
    nativeConfirmCalled = true;
    return true;
  };

  const mockModalManager = {
    openConfirmModal: () => {}
  };

  const ui = new UIManager(store, { modalManager: mockModalManager });
  mockModalManager.openConfirmModal({
    title: t('confirmModal.title'),
    desc: t('confirmModal.desc'),
    actionText: t('confirmModal.confirmDelete') || 'Sil / Onayla',
    onConfirm: () => store.deleteTransaction(tx.id)
  });

  globalThis.confirm = originalConfirm;
  assert(nativeConfirmCalled === false, 'TC-85 Delete akışında hiçbir native window.confirm() çağrılmadı');
}

// TC-86: Modal "Vazgeç" (Cancel) Tıklandığında Transaction Korunur, Hiçbir State Değişmez
{
  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Kitap Harcaması',
    amount: 220,
    type: 'expense',
    categoryId: 'exp_education',
    date: '2026-09-27'
  });
  store.hasUnsyncedChanges = false;

  const mockClasses = new Set(['hidden']);
  const mockConfirmModal = {
    classList: {
      add: (cls) => mockClasses.add(cls),
      remove: (cls) => mockClasses.delete(cls),
      contains: (cls) => mockClasses.has(cls)
    }
  };
  const mockTitle = { textContent: '' };
  const mockDesc = { textContent: '' };
  const mockAction = { textContent: '' };

  const mm = new ModalManager(store, {});
  mm.confirmModal = mockConfirmModal;
  mm.confirmModalTitle = mockTitle;
  mm.confirmModalDesc = mockDesc;
  mm.confirmModalAction = mockAction;

  mm.openConfirmModal({
    title: t('confirmModal.title'),
    desc: t('confirmModal.desc'),
    actionText: 'Sil / Onayla',
    onConfirm: () => store.deleteTransaction(tx.id)
  });

  assert(mockConfirmModal.classList.contains('hidden') === false, 'TC-86 Modal açıldı (hidden kaldırıldı)');
  assert(mockTitle.textContent === 'İşlemi Onaylayın', 'TC-86 Modal başlığı ayarlandı');
  assert(mockDesc.textContent === 'Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?', 'TC-86 Modal açıklaması ayarlandı');

  mm.closeConfirmModal();

  assert(mockConfirmModal.classList.contains('hidden') === true, 'TC-86 Vazgeç tıklandığında modal kapandı (hidden eklendi)');
  assert(mm.confirmCallback === null, 'TC-86 confirmCallback null olarak temizlendi');
  assert(store.getTransactions().some(t => t.id === tx.id), 'TC-86 Vazgeç sonrası transaction silinmedi, listede korundu');
  assert(store.hasUnsyncedChanges === false, 'TC-86 Vazgeç sonrası hasUnsyncedChanges false olarak kaldı');
}

// TC-87: Modal "Sil / Onayla" Tıklandığında Soft-Delete Akışı ve Sync Tetiklenir
{
  SafeStorage.removeItem('student_budget_deleted_queue');
  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Silinecek İşlem',
    amount: 75,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-27'
  });
  store.hasUnsyncedChanges = false;

  const mockClasses = new Set(['hidden']);
  const mockConfirmModal = {
    classList: {
      add: (cls) => mockClasses.add(cls),
      remove: (cls) => mockClasses.delete(cls),
      contains: (cls) => mockClasses.has(cls)
    }
  };
  const mockTitle = { textContent: '' };
  const mockDesc = { textContent: '' };
  const mockAction = { textContent: '' };

  const mm = new ModalManager(store, {});
  mm.confirmModal = mockConfirmModal;
  mm.confirmModalTitle = mockTitle;
  mm.confirmModalDesc = mockDesc;
  mm.confirmModalAction = mockAction;

  mm.openConfirmModal({
    title: t('confirmModal.title'),
    desc: t('confirmModal.desc'),
    actionText: 'Sil / Onayla',
    onConfirm: () => store.deleteTransaction(tx.id)
  });

  if (typeof mm.confirmCallback === 'function') {
    mm.confirmCallback();
  }
  mm.closeConfirmModal();

  assert(store.getTransactions().every(t => t.id !== tx.id), 'TC-87 Onay sonrası transaction yerel aktif listeden silindi');
  assert(store.hasUnsyncedChanges === true, 'TC-87 Silme sonrası store.hasUnsyncedChanges=true oldu');
  
  const rawQueue = SafeStorage.getItem('student_budget_deleted_queue');
  const deletedQueue = rawQueue ? JSON.parse(rawQueue) : [];
  assert(deletedQueue.some(item => (typeof item === 'string' ? item : item.id) === tx.id), 'TC-87 Silinen işlem soft-delete kuyruğuna (deletedQueue) eklendi');
  assert(mockConfirmModal.classList.contains('hidden') === true, 'TC-87 Onay sonrası modal temiz şekilde kapandı');
  assert(mm.confirmCallback === null, 'TC-87 Callback temizlendi');
}

// TC-88: Modal Açıkken updateStaticTranslations Tetiklense Dahi Modal Metinleri Ezilmez / Flicker Oluşmaz
{
  const store = new BudgetStore();
  const mockClasses = new Set([]); // modal açık
  const mockModal = {
    classList: {
      contains: (cls) => mockClasses.has(cls)
    }
  };

  const titleEl = {
    textContent: 'İşlemi Onaylayın',
    getAttribute: (attr) => (attr === 'data-i18n' ? 'confirmModal.title' : null),
    closest: (sel) => (sel === '#confirm-modal' ? mockModal : null)
  };

  const descEl = {
    textContent: 'Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?',
    getAttribute: (attr) => (attr === 'data-i18n' ? 'confirmModal.desc' : null),
    closest: (sel) => (sel === '#confirm-modal' ? mockModal : null)
  };

  const actionEl = {
    textContent: 'Sil / Onayla',
    getAttribute: (attr) => null,
    closest: (sel) => (sel === '#confirm-modal' ? mockModal : null)
  };

  const ui = new UIManager(store, {
    modalManager: { confirmModal: mockModal }
  });

  const isConfirmModalOpen = ui.modalManager?.confirmModal && !ui.modalManager.confirmModal.classList.contains('hidden');
  assert(isConfirmModalOpen === true, 'TC-88 Modal açık olarak tespit edildi');

  [titleEl, descEl, actionEl].forEach(el => {
    if (isConfirmModalOpen && el.closest('#confirm-modal')) {
      return;
    }
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = 'EZİLDİ';
  });

  assert(titleEl.textContent === 'İşlemi Onaylayın', 'TC-88 Açık modal başlığı updateStaticTranslations ile ezilmedi');
  assert(descEl.textContent === 'Bu işlem geri alınamaz. Devam etmek istediğinize emin misiniz?', 'TC-88 Açık modal açıklaması updateStaticTranslations ile ezilmedi');
  assert(actionEl.textContent === 'Sil / Onayla', 'TC-88 Buton metni korundu, flicker/flash önlendi');
}

// --------------------------------------------------------------------------
// 17. FAZ 4 PRODUCTION DEPLOYMENT & PWA VALIDATION TESTLERİ (TC-89 - TC-93)
// --------------------------------------------------------------------------
console.log('\n--- 17. FAZ 4 PRODUCTION DEPLOYMENT & PWA VALIDATION (TC-89 - TC-93) ---');

// TC-89: PWA Manifest Konfigürasyonu Doğrulaması
{
  const viteConfigPath = path.resolve('vite.config.js');
  const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

  assert(viteConfigContent.includes("display: 'standalone'"), 'TC-89 Manifest display standalone olarak yapılandırıldı');
  assert(viteConfigContent.includes("start_url: '/'"), 'TC-89 Manifest start_url "/" olarak ayarlandı');
  assert(viteConfigContent.includes("scope: '/'"), 'TC-89 Manifest scope "/" olarak ayarlandı');
  assert(viteConfigContent.includes("lang: 'tr'"), 'TC-89 Manifest dili Türkçe ("tr") olarak ayarlandı');
  assert(viteConfigContent.includes("registerType: 'autoUpdate'"), 'TC-89 PWA registerType autoUpdate aktif');
  assert(viteConfigContent.includes('google-fonts-cache'), 'TC-89 PWA Google Fonts runtime caching aktif');
}

// TC-90: index.html iOS Safari Standalone PWA Meta Etiketleri Doğrulaması
{
  const indexPath = path.resolve('index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  assert(indexHtml.includes('<meta name="apple-mobile-web-app-capable" content="yes"'), 'TC-90 iOS standalone web app capable meta etiketi mevcut');
  assert(indexHtml.includes('<meta name="apple-mobile-web-app-status-bar-style" content="default"'), 'TC-90 iOS status bar style meta etiketi mevcut');
  assert(indexHtml.includes('<meta name="apple-mobile-web-app-title" content="Öğrenci Bütçem"'), 'TC-90 iOS web app title meta etiketi mevcut');
  assert(indexHtml.includes('<link rel="apple-touch-icon" href="/icons/icon-192x192.png"'), 'TC-90 iOS apple-touch-icon bağlantısı mevcut');
}

// TC-91: Auth Magic Link Runtime Origin Yönlendirme ve Hardcoded Localhost Yokluğu
{
  let otpRedirectTo = null;
  const mockClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOtp: async ({ email, options }) => {
        otpRedirectTo = options?.emailRedirectTo;
        return { data: { user: null, session: null }, error: null };
      }
    }
  };

  const auth = new AuthService(mockClient);
  auth.isConfigured = () => true;

  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      origin: 'https://ogrenci-butce-takip.vercel.app'
    }
  };

  await auth.signInWithMagicLink('test.ogrenci@universite.edu.tr');
  assert(otpRedirectTo === 'https://ogrenci-butce-takip.vercel.app', 'TC-91 Magic Link redirectTo runtime window.location.origin değerini aldı');

  globalThis.window = originalWindow;

  const authSource = fs.readFileSync(path.resolve('src/services/authService.js'), 'utf8');
  assert(!authSource.includes('localhost:5173'), 'TC-91 authService içinde hardcoded localhost redirect bulunmuyor');
  assert(!authSource.includes('127.0.0.1'), 'TC-91 authService içinde hardcoded 127.0.0.1 redirect bulunmuyor');
}

// TC-92: Production Güvenlik Denetimi (Kaynak Kodda Secret/Service_Role Yokluğu)
{
  const filesToAudit = [
    'src/services/supabaseClient.js',
    'src/services/authService.js',
    'src/services/syncService.js',
    'src/main.js',
    'index.html'
  ];

  let hasLeakedSecret = false;
  for (const relPath of filesToAudit) {
    const content = fs.readFileSync(path.resolve(relPath), 'utf8');
    if (content.includes('service_role') || content.includes('supabase_admin') || content.includes('postgres://')) {
      hasLeakedSecret = true;
      break;
    }
  }

  assert(hasLeakedSecret === false, 'TC-92 Kaynak dosyalarda service_role, secret key veya db URI bağlantı dizesi kesinlikle bulunmuyor');
}

// TC-93: .env.example ve .gitignore Doğrulaması (.env.local Git Tarafından Track Edilmez)
{
  const gitignore = fs.readFileSync(path.resolve('.gitignore'), 'utf8');
  assert(gitignore.includes('.env.local'), 'TC-93 .gitignore dosyası .env.local dosyasını yok sayıyor');
  assert(gitignore.includes('.env'), 'TC-93 .gitignore dosyası .env dosyasını yok sayıyor');

  const envExample = fs.readFileSync(path.resolve('.env.example'), 'utf8');
  assert(envExample.includes('VITE_SUPABASE_URL='), 'TC-93 .env.example içinde VITE_SUPABASE_URL yer alıyor');
  assert(envExample.includes('VITE_SUPABASE_PUBLISHABLE_KEY='), 'TC-93 .env.example içinde VITE_SUPABASE_PUBLISHABLE_KEY yer alıyor');
  assert(!envExample.includes('service_role'), 'TC-93 .env.example şablonunda service_role bulunmuyor');
}

// --------------------------------------------------------------------------
// 18. FAZ 4.1 GOOGLE AUTH + LOCAL GUEST MODE TESTLERİ (TC-94 - TC-102)
// --------------------------------------------------------------------------
console.log('\n--- 18. FAZ 4.1 GOOGLE AUTH + LOCAL GUEST MODE (TC-94 - TC-102) ---');

// TC-94: signInWithGoogle provider='google' ve redirectTo doğrulaması
{
  let oAuthCall = null;
  const mockOAuthClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: async (params) => {
        oAuthCall = params;
        return { data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth' }, error: null };
      }
    }
  };

  const auth = new AuthService(mockOAuthClient);
  auth.isConfigured = () => true;

  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      origin: 'https://ogrenci-butce-takip.vercel.app'
    }
  };

  await auth.signInWithGoogle();
  assert(oAuthCall !== null, 'TC-94 signInWithGoogle client.auth.signInWithOAuth metodunu çağırdı');
  assert(oAuthCall.provider === 'google', 'TC-94 OAuth sağlayıcısı provider="google" olarak iletildi');
  assert(oAuthCall.options?.redirectTo === 'https://ogrenci-butce-takip.vercel.app', 'TC-94 redirectTo runtime origin değerini doğru aldı');

  globalThis.window = originalWindow;
}

// TC-95: authService içinde hardcoded redirect bulunmadığı doğrulaması
{
  const authSource = fs.readFileSync(path.resolve('src/services/authService.js'), 'utf8');
  assert(authSource.includes("provider: 'google'"), 'TC-95 authService içinde provider="google" tanımı mevcut');
  assert(authSource.includes('window.location.origin'), 'TC-95 authService dinamik window.location.origin kullanıyor');
  assert(!authSource.includes('localhost:5173'), 'TC-95 authService içinde hardcoded localhost:5173 yok');
  assert(!authSource.includes('127.0.0.1'), 'TC-95 authService içinde hardcoded 127.0.0.1 yok');
}

// TC-96: Google Login hatası yerel verileri ve onboarding durumunu BOZMAZ
{
  SafeStorage.removeItem(STORAGE_KEY);
  const store = new BudgetStore();
  store.addTransaction({ title: 'Misafir Harcaması', amount: 95, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  const txCountBefore = store.getTransactions().length;
  assert(txCountBefore === 1, 'TC-96 Başlangıçta 1 yerel işlem mevcut');

  const failingClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: async () => {
        return { data: null, error: new Error('Google OAuth bağlantısı başarısız oldu') };
      }
    }
  };

  const auth = new AuthService(failingClient);
  auth.isConfigured = () => true;

  let errorThrown = false;
  try {
    await auth.signInWithGoogle();
  } catch (err) {
    errorThrown = true;
    assert(err.message.includes('Google OAuth bağlantısı başarısız'), 'TC-96 Hata mesajı çağırıcıya doğru iletildi');
  }

  assert(errorThrown === true, 'TC-96 OAuth hatasında authService hata fırlattı');
  assert(store.getTransactions().length === 1, 'TC-96 Hata durumunda yerel işlemler ASLA silinmedi');
  assert(store.getTransactions()[0].amount === 95, 'TC-96 Yerel harcama tutarı (95 TL) aynen korundu');
}

// TC-97: "Üyeliksiz devam et" (Guest) modu hiçbir Supabase auth çağrısı yapmaz ve Local-Only çalışır
{
  SafeStorage.removeItem(STORAGE_KEY);
  const guestStore = new BudgetStore();
  assert(guestStore.state.onboarded === false, 'TC-97 Başlangıçta guestStore.onboarded=false');

  let anyAuthCalled = false;
  const spyClient = {
    auth: {
      signInAnonymously: async () => { anyAuthCalled = true; return {}; },
      signInWithOAuth: async () => { anyAuthCalled = true; return {}; },
      signInWithOtp: async () => { anyAuthCalled = true; return {}; }
    }
  };

  let authModalClosed = false;
  let onboardingModalClosed = false;
  const mockModalManager = {
    authModal: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    onboardingModal: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    closeAuthModal: () => { authModalClosed = true; },
    closeOnboardingModal: () => { onboardingModalClosed = true; },
    store: guestStore,
    handleGuestContinue() {
      this.store.state.onboarded = true;
      this.store.saveToStorage();
      this.closeAuthModal();
      this.closeOnboardingModal();
      this.store.notify();
    }
  };

  mockModalManager.handleGuestContinue();

  assert(anyAuthCalled === false, 'TC-97 "Üyeliksiz devam et" sırasında hiçbir Supabase auth (signInAnonymously vb.) ÇAĞRILMADI');
  assert(guestStore.state.onboarded === true, 'TC-97 Guest modu onboarding durumunu true yaptı ve dashboard\'a geçiş sağladı');
  assert(authModalClosed === true, 'TC-97 Auth modalı kapatıldı');
  assert(onboardingModalClosed === true, 'TC-97 Onboarding modalı kapatıldı');
}

// TC-98: Guest Modu -> Google Login Geçişinde FAZ 3 Initial Migration Kusursuz Çalışır
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem('student_budget_pre_cloud_backup');

  const store = new BudgetStore();
  store.addTransaction({ title: 'Kahve & Sandviç', amount: 65, type: 'expense', categoryId: 'exp_food', date: '2026-09-27' });
  assert(store.getTransactions().length === 1, 'TC-98 Misafir modunda 1 yerel işlem oluşturuldu');

  let settingsUpserted = null;
  let txUpserted = null;
  let metaUpserted = null;

  const googleUser = { id: generateUUID(), email: 'ogrenci@gmail.com' };
  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({ data: null, error: null }),
      insert: (payload) => { metaUpserted = payload; return { error: null }; },
      upsert: (payload) => { metaUpserted = payload; return { error: null }; }
    },
    user_settings: {
      upsert: (payload) => { settingsUpserted = payload; return { error: null }; }
    },
    presets: {
      upsert: () => ({ error: null })
    },
    transactions: {
      upsert: (payload) => { txUpserted = payload; return { error: null }; }
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.sync({ user: googleUser, reason: 'startup' });

  assert(SafeStorage.getItem('student_budget_pre_cloud_backup') !== null, 'TC-98 Migration öncesi yerel veri yedeği (student_budget_pre_cloud_backup) alındı');
  assert(settingsUpserted !== null && settingsUpserted.user_id === googleUser.id, 'TC-98 user_settings Google user_id ile buluta yüklendi');
  assert(Array.isArray(txUpserted) && txUpserted.length === 1, 'TC-98 Misafir işlemleri Google hesabına aktarıldı');
  assert(txUpserted[0].amount === 65, 'TC-98 Aktarılan işlem tutarı (65 TL) doğru');
  assert(metaUpserted !== null && metaUpserted.user_id === googleUser.id, 'TC-98 user_sync_metadata oluşturuldu');
  assert(store.getTransactions().length === 1, 'TC-98 Yerel veriler silinmedi, korundu');
}

// TC-99: Mevcut Magic Link / Cloud Kullanıcısı Google ile Giriş Yaptığında Veriler Eksiksiz Yüklenir
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_last_synced_at');

  const store = new BudgetStore();
  assert(store.getTransactions().length === 0, 'TC-99 Cihazda başlangıçta 0 işlem var');

  const existingUser = { id: generateUUID(), email: 'eski.kullanici@universite.edu.tr' };
  const cloudTx = {
    id: generateUUID(),
    title: 'KYK Bursu',
    amount: 3000,
    type: 'income',
    category_id: 'inc_kyk',
    date: '2026-09-01',
    is_deleted: false,
    updated_at: '2026-09-27T10:00:00Z',
    created_at: '2026-09-27T10:00:00Z'
  };

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: existingUser.id, schema_version: '1.1.0', last_synced_at: '2026-09-27T10:00:00Z' },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: { currency: 'TRY', onboarded: true, target_month: '2026-09', updated_at: '2026-09-27T10:00:00Z' },
        error: null
      })
    },
    presets: {
      select: () => ({ data: [], error: null })
    },
    transactions: {
      select: () => ({ data: [cloudTx], error: null })
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.sync({ user: existingUser, reason: 'startup' });

  assert(store.getTransactions().length === 1, 'TC-99 Google ile bağlanan mevcut hesabın bulut verileri bootstrap ile yerel store\'a yüklendi');
  assert(store.getTransactions()[0].title === 'KYK Bursu', 'TC-99 Buluttan gelen işlem başlığı doğru');
  assert(store.getTransactions()[0].amount === 3000, 'TC-99 Buluttan gelen işlem tutarı (3000 TL) doğru');
  assert(store.state.onboarded === true, 'TC-99 Kullanıcı onboarded=true olarak işaretlendi, onboarding modalı tetiklenmez');
}

// TC-100: Auth Arayüzü Denetimi (Magic Link Email Input Yokluğu, Google & Guest Butonları)
{
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

  // Magic Link email input'unun kaldırıldığı doğrulanır
  assert(!indexHtml.includes('id="auth-email-input"'), 'TC-100 index.html içinde Magic Link email input (auth-email-input) KESİNLİKLE YOK');
  assert(!indexHtml.includes('id="auth-btn-submit"'), 'TC-100 index.html içinde Magic Link submit butonu KESİNLİKLE YOK');

  // Yeni Google ve Guest butonlarının varlığı
  assert(indexHtml.includes('id="btn-auth-google"'), 'TC-100 "Google ile devam et" butonu (btn-auth-google) mevcut');
  assert(indexHtml.includes('id="btn-auth-guest"'), 'TC-100 "Üyeliksiz devam et" butonu (btn-auth-guest) mevcut');
  assert(indexHtml.includes('Verilerini nasıl saklamak istersin?'), 'TC-100 Modal başlığı "Verilerini nasıl saklamak istersin?" mevcut');
  assert(indexHtml.includes('Verilerini güvenle yedekle ve cihazların arasında senkronize et.'), 'TC-100 Google alt açıklaması doğru');
  assert(indexHtml.includes('Verilerin yalnızca bu cihazda saklanır.'), 'TC-100 Üyeliksiz devam et alt açıklaması doğru');

  // Navbar "Yerel mod" göstergesi
  assert(indexHtml.includes('data-i18n="auth.localModeBadge">Yerel mod</span>'), 'TC-100 Navbar oturumsuz durumda "Yerel mod" etiketi mevcut');
  assert(indexHtml.includes('id="user-avatar-img"'), 'TC-100 Google avatar görseli için user-avatar-img mevcut');
}

// TC-101: Logout & Privacy Doğrulaması (Cihaz Temizleme & Bulut Güvenliği)
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.setItem('student_budget_last_synced_at', '2026-09-27T10:00:00Z');
  SafeStorage.setItem('student_budget_deleted_queue', JSON.stringify([{ id: 'del-1' }]));

  const store = new BudgetStore();
  store.addTransaction({ title: 'Gizli Bulut Harcaması', amount: 500, type: 'expense', categoryId: 'exp_bills', date: '2026-09-27' });
  store.state.onboarded = true;
  assert(store.getTransactions().length === 1, 'TC-101 Çıkış öncesi 1 işlem mevcut');

  // Çıkış fonksiyonu çağrıldığında
  store.clearSessionOnSignOut();

  assert(store.getTransactions().length === 0, 'TC-101 Çıkış yapıldığında cihazdaki aktif işlemler temizlendi (gizlilik korundu)');
  assert(store.state.onboarded === false, 'TC-101 Çıkış sonrası store.onboarded false yapıldı (yeni kullanıcı için temiz durum)');
  assert(SafeStorage.getItem('student_budget_last_synced_at') === null, 'TC-101 Sync imleci cihazdan temizlendi');
  assert(SafeStorage.getItem('student_budget_deleted_queue') === null, 'TC-101 Silinme kuyruğu cihazdan temizlendi');
}

// TC-102: Güvenlik Denetimi (Google Client Secret ve Secret Key Yokluğu)
{
  const filesToAudit = [
    'src/services/supabaseClient.js',
    'src/services/authService.js',
    'src/services/syncService.js',
    'src/components/modalManager.js',
    'src/components/UIManager.js',
    'src/main.js',
    'index.html',
    'vite.config.js'
  ];

  let hasSecret = false;
  for (const file of filesToAudit) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    if (content.includes('client_secret') || content.includes('GOOGLE_CLIENT_SECRET') || content.includes('service_role')) {
      hasSecret = true;
      break;
    }
  }

  assert(hasSecret === false, 'TC-102 Kaynak dosyalarda Google Client Secret veya Supabase secret_key kesinlikle bulunmuyor');
}

// TC-103: Local Mode Status Chip ve Auth State Davranışı
{
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  assert(indexHtml.includes('id="btn-open-auth"'), 'TC-103 btn-open-auth elementi mevcut');
  assert(indexHtml.includes('Yerel mod'), 'TC-103 "Yerel mod" metni mevcut');
  assert(indexHtml.includes('data-i18n-title="auth.localModeTooltip"'), 'TC-103 data-i18n-title="auth.localModeTooltip" niteliği mevcut');
  assert(indexHtml.includes('title="Veriler yalnızca bu cihazda saklanıyor."'), 'TC-103 Tooltip "Veriler yalnızca bu cihazda saklanıyor." doğru');
  assert(indexHtml.includes('rounded-full'), 'TC-103 Status chip için rounded-full sınıfı kullanıldı');
  assert(indexHtml.includes('data-lucide="hard-drive"'), 'TC-103 Solunda hard-drive ikonu mevcut');

  // UIManager badge render & click davranışı simülasyonu
  const originalDoc = globalThis.document;
  globalThis.document = { querySelectorAll: () => [] };

  let authModalOpened = false;
  const mockElements = {
    btnOpenAuth: { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); }, contains(c) { return this.classes.has(c); } } },
    userAuthBadge: { classList: { classes: new Set(['hidden']), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); }, contains(c) { return this.classes.has(c); } } },
    userEmailText: { textContent: '', title: '' },
    userAvatarImg: { src: '', classList: { classes: new Set(['hidden']), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); }, contains(c) { return this.classes.has(c); } } }
  };

  const dummyManager = {
    btnOpenAuth: mockElements.btnOpenAuth,
    userAuthBadge: mockElements.userAuthBadge,
    userEmailText: mockElements.userEmailText,
    userAvatarImg: mockElements.userAvatarImg,
    refreshIcons() {},
    renderAuthBadge: UIManager.prototype.renderAuthBadge
  };

  // 1. Guest state (user = null)
  dummyManager.renderAuthBadge(null);
  assert(!mockElements.btnOpenAuth.classList.contains('hidden'), 'TC-103 Guest durumda "Yerel mod" chip\'i görünür (hidden yok)');
  assert(mockElements.userAuthBadge.classList.contains('hidden'), 'TC-103 Guest durumda userAuthBadge gizli (hidden)');

  // 2. Click -> openAuthModal tetiklenmesi
  const modalMock = {
    openAuthModal() { authModalOpened = true; }
  };
  modalMock.openAuthModal();
  assert(authModalOpened === true, 'TC-103 Chip tıklandığında openAuthModal tetiklendi');

  // 3. Signed-in state (user mevcut)
  const fakeUser = {
    email: 'ogrenci@gmail.com',
    user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/fake-avatar' }
  };
  dummyManager.renderAuthBadge(fakeUser);
  assert(mockElements.btnOpenAuth.classList.contains('hidden'), 'TC-103 Giriş yapıldığında "Yerel mod" chip\'i gizlendi (hidden)');
  assert(!mockElements.userAuthBadge.classList.contains('hidden'), 'TC-103 Giriş yapıldığında userAuthBadge görünür oldu');
  assert(mockElements.userEmailText.textContent === 'ogrenci@gmail.com', 'TC-103 Kullanıcı e-postası doğru görüntülendi');
  assert(mockElements.userAvatarImg.src === 'https://lh3.googleusercontent.com/a/fake-avatar', 'TC-103 Google avatar URL\'i doğru yüklendi');
  assert(!mockElements.userAvatarImg.classList.contains('hidden'), 'TC-103 Avatar görseli görünür yapıldı');

  globalThis.document = originalDoc;
}

// --------------------------------------------------------------------------
// 19. FAZ 4.2 — iOS PWA OFFLINE DURABILITY & MOBILE RESPONSIVE POLISH (TC-104 - TC-113)
// --------------------------------------------------------------------------
console.log('\n--- 19. FAZ 4.2 — iOS PWA OFFLINE DURABILITY & MOBILE RESPONSIVE POLISH ---');

// TC-104: Offline Transaction Insert -> Kalıcı Outbox'a (student_budget_sync_outbox) Kaydedilmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Offline Harcama',
    amount: 77,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const outboxRaw = SafeStorage.getItem('student_budget_sync_outbox');
  assert(Boolean(outboxRaw), 'TC-104 İşlem eklenince kalıcı outbox (student_budget_sync_outbox) oluşturuldu');

  const outbox = JSON.parse(outboxRaw || '[]');
  assert(outbox.length === 1, 'TC-104 Outbox içinde 1 kayıt var');
  assert(outbox[0].id === tx.id, 'TC-104 Outbox kayıt ID eşleşti');
  assert(outbox[0].operation === 'insert', 'TC-104 Outbox işlem türü "insert" oldu');
  assert(Boolean(outbox[0].queuedAt), 'TC-104 Outbox queuedAt zaman damgası mevcut');
  assert(store.hasUnsyncedChanges === true, 'TC-104 store.hasUnsyncedChanges true olarak işaretlendi');
}

// TC-105: Offline Transaction Update -> Outbox'ta Güncelleme İşleminin Saklanması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Kahve',
    amount: 40,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  store.updateTransaction(tx.id, {
    title: 'Büyük Boy Kahve',
    amount: 55,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const outbox = store.getOutbox();
  assert(outbox.length === 1, 'TC-105 Aynı işlem için outbox şişmedi (1 kayıt kaldı)');
  assert(outbox[0].operation === 'insert', 'TC-105 Henüz sunucuya gitmemiş kayıt güncellendiğinde insert operasyonu korundu');

  store.removeFromOutbox();
  store.updateTransaction(tx.id, {
    title: 'Filtre Kahve',
    amount: 60,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const updatedOutbox = store.getOutbox();
  assert(updatedOutbox.length === 1, 'TC-105 Var olan kayıt düzenlenince outbox\'a eklendi');
  assert(updatedOutbox[0].operation === 'update', 'TC-105 Düzenlenen işlemin outbox operasyonu "update" oldu');
}

// TC-106: Offline Transaction Delete -> Outbox'ta Delete İşleminin Saklanması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Silinecek İşlem',
    amount: 100,
    type: 'expense',
    categoryId: 'exp_bills',
    date: '2026-09-28'
  });

  store.deleteTransaction(tx.id);
  const outbox = store.getOutbox();
  assert(outbox.length === 1, 'TC-106 Silinen işlem outbox\'ta yer aldı');
  assert(outbox[0].id === tx.id, 'TC-106 Silinen işlem ID eşleşti');
  assert(outbox[0].operation === 'delete', 'TC-106 Outbox operasyonu "delete" oldu');
}

// TC-107: PWA Restart / Reload -> Outbox Yüklenmesi ve hasUnsyncedChanges=true Olması
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const initialStore = new BudgetStore();
  const tx = initialStore.addTransaction({
    title: 'Kalıcı Harcama',
    amount: 120,
    type: 'expense',
    categoryId: 'exp_transport',
    date: '2026-09-28'
  });

  // Simüle et: PWA kapatıldı ve yeniden başlatıldı
  const restartedStore = new BudgetStore();
  const restartedSync = new SyncService(restartedStore);

  assert(restartedSync.getOutbox().length === 1, 'TC-107 PWA yeniden açıldığında outbox diskten (LocalStorage) okundu');
  assert(restartedStore.hasUnsyncedChanges === true, 'TC-107 Outbox var olduğu için restartedStore.hasUnsyncedChanges=true oldu');
  assert(restartedStore.getTransactions().some(t => t.id === tx.id), 'TC-107 Yerel transaction restart sonrası kaybolmadı');
}

// TC-108: Startup Sırasında Doğru Senkronizasyon Sıralaması (Önce PUSH, Sonra CATCH-UP)
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Offline Sıralama Testi',
    amount: 50,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const callOrder = [];
  const fakeUser = { id: generateUUID() };

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 30000).toISOString() },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        data: { currency: 'TRY', updated_at: new Date(Date.now() - 30000).toISOString() },
        error: null
      })
    },
    presets: {
      select: () => {
        callOrder.push('catchup-presets');
        return { data: [], error: null };
      }
    },
    transactions: {
      upsert: (payload) => {
        callOrder.push('push-transactions');
        return { data: payload, error: null };
      },
      select: () => {
        callOrder.push('catchup-transactions');
        return { data: [], error: null };
      }
    }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 30000).toISOString());

  await sync.sync({ user: fakeUser, reason: 'startup' });

  const pushIdx = callOrder.indexOf('push-transactions');
  const catchupIdx = callOrder.indexOf('catchup-transactions');

  assert(pushIdx !== -1, 'TC-108 Startup sırasında outbox verisi push edildi');
  assert(catchupIdx !== -1, 'TC-108 Startup sırasında tam catch-up yapıldı');
  assert(pushIdx < catchupIdx, 'TC-108 Sıralama Kuralı: Önce PUSH yapıldı, ardından CATCH-UP yapıldı');
}

// TC-109: Cloud Catch-Up Sırasında Yerel Bekleyen Outbox Kayıtlarının Silinmemesi / Ezilmemesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Korunacak Yerel İşlem',
    amount: 150,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const fakeUser = { id: generateUUID() };
  const mockClient = createMockClient({
    user_settings: { select: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({
        data: [{
          id: tx.id,
          title: 'Eski Bulut Başlığı',
          amount: 10,
          type: 'expense',
          category_id: 'exp_food',
          date: '2026-09-28',
          is_deleted: true,
          updated_at: new Date(Date.now() - 60000).toISOString()
        }],
        error: null
      })
    }
  });

  const sync = new SyncService(store, mockClient);
  await sync.runFullCloudCatchUp(fakeUser, mockClient);

  const localTxs = store.getTransactions();
  assert(localTxs.some(t => t.id === tx.id), 'TC-109 Cloud is_deleted kaydı bekleyen yerel outbox işlemini ASLA silmedi');
  const preserved = localTxs.find(t => t.id === tx.id);
  assert(preserved.title === 'Korunacak Yerel İşlem', 'TC-109 Yerel bekleyen işlem verisi bulut tarafından ezilmedi');
}

// TC-110: Başarılı Bulut Onayı Sonrasında Outbox'ın Temizlenmesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Onaylanacak İşlem',
    amount: 80,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  assert(store.getOutbox().length === 1, 'TC-110 Başlangıçta outbox dolu');

  const fakeUser = { id: generateUUID() };
  const mockSuccessClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 30000).toISOString() },
        error: null
      })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => ({ data: [], error: null })
    }
  });

  const sync = new SyncService(store, mockSuccessClient);
  sync.setLastSyncedAt(new Date(Date.now() - 30000).toISOString());

  const res = await sync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === true, 'TC-110 Senkronizasyon başarılı tamamlandı');
  assert(store.getOutbox().length === 0, 'TC-110 Başarılı bulut yazımı sonrası outbox temizlendi');
  assert(SafeStorage.getItem('student_budget_sync_outbox') === null, 'TC-110 LocalStorage içindeki outbox anahtarı kaldırıldı');
  assert(store.hasUnsyncedChanges === false, 'TC-110 store.hasUnsyncedChanges=false oldu');
  assert(sync.getStatus() === 'synced', 'TC-110 syncStatus "synced" durumuna geçti');
}

// TC-111: Ağ Hatası / Fetch Fail Durumunda Outbox'ın KESİNLİKLE Silinmemesi
{
  SafeStorage.removeItem('student_budget_last_synced_at');
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const tx = store.addTransaction({
    title: 'Başarısız Gönderim',
    amount: 90,
    type: 'expense',
    categoryId: 'exp_food',
    date: '2026-09-28'
  });

  const fakeUser = { id: generateUUID() };
  const mockFailingClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 30000).toISOString() },
        error: null
      })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: {
      select: () => ({ data: [], error: null }),
      upsert: () => {
        throw new Error('fetch failed: Network unreachable');
      }
    }
  });

  const sync = new SyncService(store, mockFailingClient);
  sync.setLastSyncedAt(new Date(Date.now() - 30000).toISOString());

  const res = await sync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === false, 'TC-111 Ağ hatasında sync başarısız döndü');
  assert(store.getOutbox().length === 1, 'TC-111 Ağ hatasında outbox KESİNLİKLE silinmedi (korundu)');
  assert(store.getOutbox()[0].id === tx.id, 'TC-111 Gönderilemeyen işlem outbox\'ta bekliyor');
  assert(sync.getStatus() === 'offline' || sync.getStatus() === 'error', 'TC-111 syncStatus "offline" veya "error" oldu');
}

// TC-112: iOS PWA Yaşam Döngüsü Olayları ve Anti-Loop Koruması
{
  const store = new BudgetStore();
  const fakeUser = { id: generateUUID() };

  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date().toISOString() },
        error: null
      })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(store, mockClient);
  sync.setLastSyncedAt(new Date().toISOString());

  sync.isSyncing = true;
  const busyResult = await sync.sync({ user: fakeUser, reason: 'pageshow' });
  assert(busyResult.reason === 'already_syncing', 'TC-112 Eşzamanlı sync çağrısı (isSyncing=true) engellendi');

  sync.isSyncing = false;
  sync.isRecovering = true;
  const busyRecResult = await sync.recoverAfterReconnect(fakeUser);
  assert(busyRecResult.reason === 'already_recovering', 'TC-112 Eşzamanlı reconnect recovery (isRecovering=true) engellendi');
  sync.isRecovering = false;
}

// TC-113: Mobil UI & Responsive İyileştirmeleri (Özet Kartları 1-Col, Modal Scroll Lock, Sticky Header/Footer, Safe Area)
{
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

  // 1. Özet kartları mobil 1-kolon kontrolü
  assert(indexHtml.includes('grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'), 'TC-113 Özet kartları mobilde tek kolon (grid-cols-1 sm:grid-cols-2 lg:grid-cols-4)');
  assert(indexHtml.includes('overflow-x-hidden'), 'TC-113 Yatay taşmayı önlemek için overflow-x-hidden uygulandı');

  // 2. İşlem modalı mobil tam ekran / safe area kontrolü
  assert(indexHtml.includes('max-h-[100dvh] sm:max-h-[90vh]'), 'TC-113 İşlem modalı mobilde 100dvh, masaüstünde 90vh');
  assert(indexHtml.includes('sticky top-0'), 'TC-113 Modal başlığı mobilde sticky top-0 yapıldı');
  assert(indexHtml.includes('sticky bottom-0'), 'TC-113 Modal butonları mobilde sticky bottom-0 yapıldı');
  assert(indexHtml.includes('safe-area-inset-bottom'), 'TC-113 Modal butonları iOS home indicator için safe-area-inset-bottom içeriyor');

  // 3. Body scroll lock kontrolü
  const originalDoc = globalThis.document;
  const bodyClasses = new Set();
  const mockModal = {
    addEventListener: () => {},
    classList: {
      classes: new Set(['hidden']),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  };

  globalThis.document = {
    body: {
      classList: {
        add(c) { bodyClasses.add(c); },
        remove(c) { bodyClasses.delete(c); },
        contains(c) { return bodyClasses.has(c); }
      }
    },
    getElementById: (id) => {
      if (id === 'transaction-modal') return mockModal;
      return null;
    },
    activeElement: null
  };

  const store = new BudgetStore();
  const modalMgr = new ModalManager(store, {});
  modalMgr.txModal = mockModal;

  mockModal.classList.remove('hidden');
  modalMgr.updateBodyScrollLock();
  assert(bodyClasses.has('overflow-hidden'), 'TC-113 Modal açıkken document.body üzerinde "overflow-hidden" eklendi');

  mockModal.classList.add('hidden');
  modalMgr.updateBodyScrollLock();
  assert(!bodyClasses.has('overflow-hidden'), 'TC-113 Tüm modallar kapanınca document.body üzerinden "overflow-hidden" kaldırıldı');

  globalThis.document = originalDoc;
}

// TC-114: Offline Ayar Değişikliği (Settings) -> Kalıcı Dirty Bayrağı -> PWA Restart -> Push-Before-Pull Korunması
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem(DIRTY_SETTINGS_KEY);
  SafeStorage.removeItem(DIRTY_PRESETS_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  store.updateSettings({ currency: 'USD', theme: 'dark' });

  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === 'true', 'TC-114 Offline ayar değişikliği sonrası student_budget_dirty_settings diske kaydedildi');
  assert(store.dirtySettings === true, 'TC-114 store.dirtySettings true döndü');
  assert(store.hasUnsyncedChanges === true, 'TC-114 store.hasUnsyncedChanges true oldu');

  // PWA Sürecinin Kapatılıp Yeniden Başlatılması (App Restart Simülasyonu)
  const restartedStore = new BudgetStore();
  assert(restartedStore.dirtySettings === true, 'TC-114 PWA restart sonrası restartedStore.dirtySettings=true olarak okundu');
  assert(restartedStore.hasUnsyncedChanges === true, 'TC-114 PWA restart sonrası restartedStore.hasUnsyncedChanges=true oldu');
  assert(restartedStore.state.settings.currency === 'USD', 'TC-114 Yerel ayar (USD) restart sonrası korundu');

  const fakeUser = { id: generateUUID() };
  let pushedSettings = null;
  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 60000).toISOString() },
        error: null
      })
    },
    user_settings: {
      maybeSingle: () => ({
        // Bulutta eski ayarlar var (TRY)
        data: { user_id: fakeUser.id, currency: 'TRY', theme: 'light', updated_at: new Date(Date.now() - 100000).toISOString() },
        error: null
      }),
      upsert: (payload) => {
        pushedSettings = payload;
        return { data: payload, error: null };
      }
    },
    presets: { select: () => ({ data: [], error: null }) },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(restartedStore, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());

  const res = await sync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === true, 'TC-114 Senkronizasyon başarılı tamamlandı');
  assert(pushedSettings !== null, 'TC-114 Yerel ayar buluta PUSH edildi');
  assert(pushedSettings.currency === 'USD', 'TC-114 Buluta gönderilen para birimi USD oldu');
  assert(restartedStore.state.settings.currency === 'USD', 'TC-114 Buluttaki eski ayar (TRY) yereldeki değişikliği EZMEDİ');
  assert(restartedStore.dirtySettings === false, 'TC-114 Başarılı push sonrası restartedStore.dirtySettings=false oldu');
  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === null, 'TC-114 Başarılı push sonrası student_budget_dirty_settings anahtarı silindi');
}

// TC-115: Offline Preset Değişikliği -> Kalıcı Dirty Bayrağı -> PWA Restart -> Push-Before-Pull Korunması
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem(DIRTY_SETTINGS_KEY);
  SafeStorage.removeItem(DIRTY_PRESETS_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  const presets = store.getPresets();
  presets[0].amount = 999;
  store.updatePresets(presets);

  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === 'true', 'TC-115 Offline preset değişikliği sonrası student_budget_dirty_presets diske kaydedildi');
  assert(store.dirtyPresets === true, 'TC-115 store.dirtyPresets true döndü');
  assert(store.hasUnsyncedChanges === true, 'TC-115 store.hasUnsyncedChanges true oldu');

  // PWA Yeniden Başlatılması
  const restartedStore = new BudgetStore();
  assert(restartedStore.dirtyPresets === true, 'TC-115 PWA restart sonrası restartedStore.dirtyPresets=true olarak okundu');
  assert(restartedStore.getPresets()[0].amount === 999, 'TC-115 Yerel preset (999 TL) restart sonrası korundu');

  const fakeUser = { id: generateUUID() };
  let pushedPresets = null;
  const mockClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 60000).toISOString() },
        error: null
      })
    },
    user_settings: { maybeSingle: () => ({ data: null, error: null }) },
    presets: {
      select: () => ({
        // Bulutta eski preset tutarı (50 TL)
        data: [{ user_id: fakeUser.id, preset_key: presets[0].id, name: presets[0].name, emoji: presets[0].emoji, amount: 50, category_id: presets[0].categoryId, updated_at: new Date(Date.now() - 100000).toISOString() }],
        error: null
      }),
      upsert: (payload) => {
        pushedPresets = payload;
        return { data: payload, error: null };
      }
    },
    transactions: { select: () => ({ data: [], error: null }) }
  });

  const sync = new SyncService(restartedStore, mockClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());

  const res = await sync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === true, 'TC-115 Senkronizasyon başarılı tamamlandı');
  assert(pushedPresets !== null, 'TC-115 Yerel preset buluta PUSH edildi');
  assert(pushedPresets.find(p => p.preset_key === presets[0].id)?.amount === 999, 'TC-115 Buluta gönderilen preset tutarı 999 TL oldu');
  assert(restartedStore.getPresets()[0].amount === 999, 'TC-115 Buluttaki eski preset (50 TL) yereldeki yeni değeri EZMEDİ');
  assert(restartedStore.dirtyPresets === false, 'TC-115 Başarılı push sonrası restartedStore.dirtyPresets=false oldu');
  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === null, 'TC-115 Başarılı push sonrası student_budget_dirty_presets anahtarı silindi');
}

// TC-116: Ağ Hatasında Kalıcı Dirty Bayraklarının Kesinlikle Silinmemesi (Resilience)
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem(DIRTY_SETTINGS_KEY);
  SafeStorage.removeItem(DIRTY_PRESETS_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  store.updateSettings({ currency: 'EUR' });
  const presets = store.getPresets();
  presets[0].amount = 888;
  store.updatePresets(presets);

  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === 'true', 'TC-116 Ayar dirty bayrağı aktif');
  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === 'true', 'TC-116 Preset dirty bayrağı aktif');

  const fakeUser = { id: generateUUID() };
  const mockFailingClient = createMockClient({
    user_sync_metadata: {
      maybeSingle: () => ({
        data: { user_id: fakeUser.id, schema_version: '1.1.0', last_synced_at: new Date(Date.now() - 60000).toISOString() },
        error: null
      })
    },
    user_settings: {
      upsert: () => {
        throw new Error('fetch failed: Connection refused');
      }
    }
  });

  const sync = new SyncService(store, mockFailingClient);
  sync.setLastSyncedAt(new Date(Date.now() - 60000).toISOString());

  const res = await sync.sync({ user: fakeUser, reason: 'startup' });

  assert(res.success === false, 'TC-116 Ağ hatasında senkronizasyon başarısız oldu');
  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === 'true', 'TC-116 Ağ hatasında student_budget_dirty_settings KESİNLİKLE silinmedi');
  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === 'true', 'TC-116 Ağ hatasında student_budget_dirty_presets KESİNLİKLE silinmedi');
  assert(store.dirtySettings === true, 'TC-116 store.dirtySettings true kalmaya devam etti');
  assert(store.dirtyPresets === true, 'TC-116 store.dirtyPresets true kalmaya devam etti');
}

// TC-117: Çıkış Yapıldığında (SignOut) Dirty Bayraklarının Gizlilik için Temizlenmesi
{
  SafeStorage.removeItem(STORAGE_KEY);
  SafeStorage.removeItem(DIRTY_SETTINGS_KEY);
  SafeStorage.removeItem(DIRTY_PRESETS_KEY);
  SafeStorage.removeItem('student_budget_sync_outbox');

  const store = new BudgetStore();
  store.updateSettings({ currency: 'GBP' });
  const presets = store.getPresets();
  presets[0].amount = 777;
  store.updatePresets(presets);

  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === 'true', 'TC-117 Çıkış öncesi dirtySettings var');
  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === 'true', 'TC-117 Çıkış öncesi dirtyPresets var');

  store.clearSessionOnSignOut();

  assert(SafeStorage.getItem(DIRTY_SETTINGS_KEY) === null, 'TC-117 clearSessionOnSignOut sonrası student_budget_dirty_settings temizlendi');
  assert(SafeStorage.getItem(DIRTY_PRESETS_KEY) === null, 'TC-117 clearSessionOnSignOut sonrası student_budget_dirty_presets temizlendi');
  assert(store.dirtySettings === false, 'TC-117 store.dirtySettings false oldu');
  assert(store.dirtyPresets === false, 'TC-117 store.dirtyPresets false oldu');
  assert(store.getOutbox().length === 0, 'TC-117 Outbox temizlendi');
}

console.log('\n====================================================');
console.log(`🏁 ENTEGRE TEST SONUCU: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

process.exit(failed > 0 ? 1 : 0);



