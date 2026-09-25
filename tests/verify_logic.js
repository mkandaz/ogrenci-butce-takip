import fs from 'fs';
import path from 'path';
import { calculateSummary, getDaysRemainingInMonth, calculateBudgetHealth } from '../src/store/calculations.js';
import { BudgetStore } from '../src/store/BudgetStore.js';
import { formatCurrency, formatNumber, formatDate, formatMonthTitle, normalizeCurrency, getCurrencySymbol } from '../src/utils/formatters.js';
import { t, setLanguage, getLanguage } from '../src/i18n/index.js';
import tr from '../src/i18n/tr.js';
import en from '../src/i18n/en.js';

console.log('====================================================');
console.log('🚀 ÖĞRENCİ BÜTÇE TAKİP - FAZ 2 KAPSAMLI TEST PAKETİ');
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

console.log('\n====================================================');
console.log(`🏁 FAZ 2 TEST SONUCU: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
