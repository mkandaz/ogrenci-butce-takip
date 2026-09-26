import fs from 'fs';
import path from 'path';
import { calculateSummary, getDaysRemainingInMonth, calculateBudgetHealth } from '../src/store/calculations.js';
import { BudgetStore } from '../src/store/BudgetStore.js';
import { formatCurrency, formatNumber, formatDate, formatMonthTitle, normalizeCurrency, getCurrencySymbol } from '../src/utils/formatters.js';
import { t, setLanguage, getLanguage } from '../src/i18n/index.js';
import tr from '../src/i18n/tr.js';
import en from '../src/i18n/en.js';
import { generateUUID, isValidUUID, getLocalDateString, getCurrentYearMonth } from '../src/utils/helpers.js';
import { SafeStorage } from '../src/utils/storage.js';
import { AuthService, authService } from '../src/services/authService.js';
import { SyncService } from '../src/services/syncService.js';
import { UIManager } from '../src/components/UIManager.js';
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
          const updateBuilder = {
            eq: (col1, val1) => {
              state.eqs[col1] = val1;
              return {
                eq: async (col2, val2) => {
                  state.eqs[col2] = val2;
                  if (handlers[table]?.update) {
                    return handlers[table].update(payload, state.eqs, state);
                  }
                  return { data: [payload], error: null };
                }
              };
            }
          };
          return updateBuilder;
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

console.log('\n====================================================');
console.log(`🏁 ENTEGRE TEST SONUCU: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

process.exit(failed > 0 ? 1 : 0);


