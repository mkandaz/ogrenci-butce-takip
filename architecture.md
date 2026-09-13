# Öğrenci Bütçe Takip Uygulaması (Student Budget Tracker)
## Sistem Mimarisi, Veri Modelleri ve Tasarım Direktifleri

Bu doküman, üniversite öğrencilerinin finansal durumlarını basit, hızlı ve öngörülebilir bir şekilde yönetebilmeleri amacıyla geliştirilen **Öğrenci Bütçe Takip Uygulaması**'nın mimari standartlarını, veri modellerini, matematiksel formüllerini, depolama şemasını ve geliştirici/QA yönergelerini tanımlar.

---

## 1. Genel Bakış ve Temel Prensipler

- **Öğrenci Odaklılık:** Karmaşık muhasebe terimleri yerine anlaşılır, anında içgörü sunan metrikler (Örn: "Bugün ne kadar harcayabilirim?").
- **Gizlilik ve Çevrimdışı Çalışma (Offline-First):** Tüm veriler kullanıcının tarayıcısında (`LocalStorage`) saklanır. Sunucu bağımlılığı yoktur, veri gizliliği tamdır.
- **Hafiflik ve Hız:** Hızlı açılış süresi, minimum bağımlılık ve mobil uyumlu (Mobile-First responsive) arayüz.
- **Güvenilirlik ve Taşınabilirlik:** JSON formatında dışa/içe aktarım (Export/Import), şema doğrulaması ve veri kurtarma mekanizmaları.

---

## 2. Veri Modelleri ve Tip Tanımları (TypeScript)

Uygulamanın veri modeli tip güvenliği ve genişletilebilirlik esas alınarak tasarlanmıştır.

```typescript
/**
 * İşlem Tipi
 */
export type TransactionType = 'income' | 'expense';

/**
 * Bütçe Sağlık Durumu
 */
export type BudgetHealthStatus = 'healthy' | 'warning' | 'critical' | 'depleted';

/**
 * Kategori Arayüzü
 */
export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;       // Lucide ikon adı veya SVG identifier
  color: string;      // HEX veya Tailwind renk sınıfı (#10B981, #EF4444 vb.)
  isCustom?: boolean; // Kullanıcı tarafından sonradan eklenip eklenmediği
}

/**
 * Finansal İşlem (Gelir/Gider) Şeması
 */
export interface Transaction {
  id: string;             // UUID v4 veya crypto.randomUUID()
  title: string;          // İşlem başlığı / açıklaması (örn: "KYK Bursu", "Yemekhane Fişi")
  amount: number;         // Pozitif sayısal değer (TL cinsinden, örn: 125.50)
  type: TransactionType;  // 'income' veya 'expense'
  categoryId: string;     // İlgili Category id'si
  date: string;           // ISO 8601 formatında tarih: "YYYY-MM-DD"
  notes?: string;         // İsteğe bağlı ek detay / not
  createdAt: number;      // Unix timestamp (ms)
  updatedAt: number;      // Unix timestamp (ms)
}

/**
 * Bütçe Ayarları ve Kullanıcı Tercihleri
 */
export interface UserSettings {
  currency: string;             // Varsayılan '₺' veya 'TL'
  monthStartDay: number;        // Burs/Kredi yatış günü (Varsayılan: 1 veya 6 - KYK bursları genelde ayın 6-10'u yatar)
  warningThresholdPercent: number; // Kritik uyarı eşiği yüzdesi (Varsayılan: 15)
  theme: 'system' | 'light' | 'dark';
}

/**
 * Uygulama Genel State Modeli
 */
export interface AppState {
  version: string;              // Şema versiyonu (örn: "1.0.0")
  transactions: Transaction[];
  categories: Category[];
  settings: UserSettings;
}

/**
 * Hesaplanan Özet Metrikleri
 */
export interface FinancialSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  daysRemainingInMonth: number;
  dailySafeSpendLimit: number;
  budgetHealth: BudgetHealthStatus;
  expenseRatio: number; // Harcama / Gelir yüzdesi (0 - 100+)
}
```

---

## 3. Öğrenciye Özel Kategori Taksonomisi

Öğrencilerin bütçe dinamiklerine özel olarak ayrıştırılmış varsayılan kategori listesi aşağıdadır:

### 3.1 Gelir Kategorileri (`income`)
| ID | Kategori Adı | İkon | Renk | Açıklama |
|---|---|---|---|---|
| `inc_kyk` | KYK Burs / Kredi | `GraduationCap` | `#3B82F6` (Mavi) | Devlet burs ve öğrenim kredileri |
| `inc_allowance` | Aile Harçlığı | `HandCoins` | `#10B981` (Zümrüt) | Aileden gelen düzenli/düzensiz destekler |
| `inc_part_time` | Part-Time / Freelance | `Briefcase` | `#8B5CF6` (Mor) | Yarı zamanlı işler, özel ders, freelance |
| `inc_scholarship`| Özel Kurum Bursu | `Award` | `#06B6D4` (Camgöbeği) | Vakıf, dernek veya şirket bursları |
| `inc_other` | Diğer Gelirler | `PiggyBank` | `#64748B` (Kayrak) | İkinci el eşya satışı, hediye vb. |

### 3.2 Gider Kategorileri (`expense`)
| ID | Kategori Adı | İkon | Renk | Açıklama |
|---|---|---|---|---|
| `exp_housing` | Yurt / Ev Kirası | `Home` | `#6366F1` (İndigo) | KYK/Özel yurt ücreti, kira payı |
| `exp_food` | Yemek & Market | `UtensilsCrossed` | `#F59E0B` (Kehribar) | Yemekhane, kafe, süpermarket alışverişi |
| `exp_transport`| Ulaşım | `Bus` | `#0EA5E9` (Gökyüzü) | Öğrenci abonmanı, dolmuş, tren/otobüs biletleri |
| `exp_bills` | Faturalar & Abonelikler | `Receipt` | `#EF4444` (Kırmızı) | Telefon hattı, internet, Spotify, yurt çamaşır vb. |
| `exp_education`| Kitap & Kırtasiye | `BookOpen` | `#14B8A6` (Turkuaz) | Ders kitapları, fotokopi, defter, sınav harçları |
| `exp_social` | Sosyal & Eğlence | `PartyPopper` | `#EC4899` (Pembe) | Sinema, konser, kahve buluşmaları, oyun |
| `exp_health` | Sağlık & Kişisel Bakım | `HeartPulse` | `#10B981` (Zümrüt) | İlaç, berber/kuaför, hijyen ürünleri |
| `exp_tech` | Teknoloji & Donanım | `Laptop` | `#8B5CF6` (Mor) | Bilgisayar/telefon aksesuarları, yazılım |
| `exp_other` | Diğer Giderler | `CircleEllipsis` | `#94A3B8` (Gri) | Beklenmeyen acil harcamalar |

---

## 4. Formüller ve Algoritmalar

### 4.1 Kalan Bütçe (Net Bakiye)
$$Kalan\ Bütçe\ (Balance) = \sum Gelirler - \sum Giderler$$

- **Pozitif Sonuç:** Tasarruf potansiyeli veya harcanabilir likit bakiye.
- **Negatif Sonuç:** Bütçe açığı (Öğrencinin borçlandığı veya eksiye düştüğü durum).

### 4.2 Ayda Kalan Gün Sayısı Hesabı (`daysRemainingInMonth`)
Öğrencinin bütçe döngüsü takvim ayı (1'inden son gününe) veya ayarlanabilir burs günü döngüsüne (örneğin ayın 6'sından bir sonraki ayın 5'ine) göre hesaplanabilir. Varsayılan takvim ayı formülü:

```javascript
function getDaysRemainingInMonth(referenceDate = new Date()): number {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const today = referenceDate.getDate();
  
  // Ayın son gününü bul (0 bir sonraki ayın 0. günü = bu ayın son günü)
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Bugün dahil kalan gün sayısı
  return Math.max(1, totalDaysInMonth - today + 1);
}
```

### 4.3 Günlük Güvenli Harcama Limiti (Daily Safe-to-Spend)
Öğrencinin ayın geri kalanında bütçesini tüketmeden günde ortalama ne kadar harcayabileceğini gösteren en kritik metriktir:

$$Günlük\ Güvenli\ Harcama\ Limiti = \frac{\max(0,\ Kalan\ Bütçe)}{Ayda\ Kalan\ Gün\ Sayısı}$$

#### Özel / Uç Durum Kuralları:
1. **Negatif Bakiye ($Balance \le 0$):**
   - Limit `0.00 TL` olarak sabitlenir.
   - Arayüzde "Bütçe Tükendi! Günlük harcama limiti kalmadı" uyarısı gösterilir.
2. **Ayın Son Günü ($Kalan\ Gün = 1$):**
   - Kalan bakiyenin tamamı o günün harcama limiti olarak yansıtılır.
3. **Sıfır Gelir Durumu:**
   - Eğer henüz gelir girilmemiş ancak gider varsa, limit 0 TL gösterilir ve "Gelir Ekle" yönlendirmesi yapılır.

### 4.4 Kritik Bütçe Sağlığı ve Uyarı Eşikleri
Bütçe durumu dinamik olarak 4 seviyede sınıflandırılır:

```typescript
function calculateBudgetHealth(totalIncome: number, balance: number): BudgetHealthStatus {
  // İşlem listesi tamamen boşsa nötr ve sağlıklı kabul edilir (uyarı paneli gösterilmez)
  if (totalIncome === 0 && balance === 0) {
    return 'healthy';
  }

  // Bakiye tükendi veya eksiye düştü
  if (balance <= 0) {
    return 'depleted';
  }
  
  // Gelir sıfır ama bakiye negatif/harcama var
  if (totalIncome === 0) {
    return 'depleted';
  }
  
  const remainingPercentage = (balance / totalIncome) * 100;
  
  if (remainingPercentage <= 15) {
    return 'critical'; // %15 veya daha az kaldı (Turuncu/Kırmızı Uyarı)
  } else if (remainingPercentage <= 35) {
    return 'warning';  // %15 - %35 arası (Sarı Dikkat Seviyesi)
  }
  
  return 'healthy';    // > %35 (Yeşil - Güvenli)
}
```

#### Uyarı Eşik Görselleştirme Tablosu:
| Bütçe Sağlığı | Kriter | Renk Kodu | Kullanıcı Bildirimi |
|---|---|---|---|
| **Sağlıklı (Healthy)** | Kalan $\ge$ %35 | `Emerald` (#10B981) | "Bütçeniz kontrol altında. Güvenli şekilde harcayabilirsiniz." |
| **Dikkat (Warning)** | %15 < Kalan < %35 | `Amber` (#F59E0B) | "Bütçeniz azalıyor. Zorunlu olmayan harcamaları kısın." |
| **Kritik (Critical)** | 0 < Kalan $\le$ %15 | `Orange/Red` (#F97316) | "Kritik Eşik! Ay sonuna kadar günlük limiti aşmayın." |
| **Tükendi (Depleted)** | Kalan $\le$ 0 | `Rose` (#E11D48) | "Bütçe Açığı! Kalan bakiye tükendi veya eksiye düştü." |

### 4.5 Kategori Bazlı Dağılım Hesaplaması
Her kategorinin toplam gider içerisindeki payı:

$$Kategori\ Yüzdesi\ (\%) = \left( \frac{\sum Gider_{kategori}}{Toplam\ Gider} \right) \times 100$$

---

## 5. LocalStorage Kalıcılık Şeması ve Veri Yönetimi

### 5.1 Storage Anahtarları
- `student_budget_app_state_v1`: Ana veri deposu (JSON string).
- `student_budget_theme`: Tema tercihi ('light' | 'dark' | 'system').

### 5.2 Depolama JSON Şeması
```json
{
  "version": "1.0.0",
  "lastSyncedAt": 1726257144000,
  "settings": {
    "currency": "₺",
    "monthStartDay": 1,
    "warningThresholdPercent": 15,
    "theme": "light"
  },
  "categories": [ ... ],
  "transactions": [ ... ]
}
```

### 5.3 Dışa ve İçe Aktarma (JSON Export / Import)
- **Export Mantığı:**
  - Veri `student_budget_export_YYYY-MM-DD.json` adıyla tarayıcıdan indirilir.
  - JSON içinde şema versiyonu ve dışa aktarım zaman damgası (`exportedAt`) yer alır.
- **Import Mantığı & Validasyon:**
  - Yüklenen dosyanın geçerli bir JSON olup olmadığı kontrol edilir.
  - Şemada `transactions` dizisinin varlığı, her işlemin `id`, `amount`, `type`, `date`, `categoryId` alanlarının tipi doğrulanır.
  - Geçersiz dosya durumunda kullanıcıya anlaşılır hata mesajı verilir ve mevcut veri ezilmez.
  - Kullanıcıya iki seçenek sunulabilir: "Mevcut Verilerle Birleştir (Merge)" veya "Mevcut Verilerin Üzerine Yaz (Replace)".

### 5.4 Varsayılan Seed Veri Seti (İlk Açılış Örnek Verileri)
Kullanıcı uygulamayı ilk kez açtığında boş bir ekran yerine rehber niteliğinde gerçekçi bir Türk üniversite öğrencisi bütçesiyle karşılaşır:

```json
{
  "version": "1.0.0",
  "settings": {
    "currency": "₺",
    "monthStartDay": 1,
    "warningThresholdPercent": 15,
    "theme": "light"
  },
  "transactions": [
    {
      "id": "seed-tx-001",
      "title": "KYK Lisans Bursu",
      "amount": 2000.00,
      "type": "income",
      "categoryId": "inc_kyk",
      "date": "2026-09-06",
      "notes": "Eylül ayı burs ödemesi",
      "createdAt": 1725609600000,
      "updatedAt": 1725609600000
    },
    {
      "id": "seed-tx-002",
      "title": "Aile Destek Harçlığı",
      "amount": 4000.00,
      "type": "income",
      "categoryId": "inc_allowance",
      "date": "2026-09-01",
      "notes": "Eylül başı kira ve harçlık desteği",
      "createdAt": 1725177600000,
      "updatedAt": 1725177600000
    },
    {
      "id": "seed-tx-003",
      "title": "Özel Ders Ücreti",
      "amount": 1200.00,
      "type": "income",
      "categoryId": "inc_part_time",
      "date": "2026-09-10",
      "notes": "Lise matematik 2 seans",
      "createdAt": 1725955200000,
      "updatedAt": 1725955200000
    },
    {
      "id": "seed-tx-004",
      "title": "KYK Yurt Ücreti",
      "amount": 1100.00,
      "type": "expense",
      "categoryId": "exp_housing",
      "date": "2026-09-02",
      "notes": "Eylül yurt taksiti",
      "createdAt": 1725264000000,
      "updatedAt": 1725264000000
    },
    {
      "id": "seed-tx-005",
      "title": "İstanbulkart Öğrenci Abonman",
      "amount": 250.00,
      "type": "expense",
      "categoryId": "exp_transport",
      "date": "2026-09-03",
      "notes": "Aylık 200 basım",
      "createdAt": 1725350400000,
      "updatedAt": 1725350400000
    },
    {
      "id": "seed-tx-006",
      "title": "Haftalık Market & Kahvaltılık",
      "amount": 750.00,
      "type": "expense",
      "categoryId": "exp_food",
      "date": "2026-09-05",
      "notes": "Yulaf, süt, peynir, yumurta",
      "createdAt": 1725523200000,
      "updatedAt": 1725523200000
    },
    {
      "id": "seed-tx-007",
      "title": "Dönem Ders Kitapları & Fotokopi",
      "amount": 420.00,
      "type": "expense",
      "categoryId": "exp_education",
      "date": "2026-09-08",
      "notes": "Mühendislik ders notları",
      "createdAt": 1725782400000,
      "updatedAt": 1725782400000
    },
    {
      "id": "seed-tx-008",
      "title": "Spotify & Telefon Faturası",
      "amount": 210.00,
      "type": "expense",
      "categoryId": "exp_bills",
      "date": "2026-09-09",
      "notes": "Öğrenci paketi",
      "createdAt": 1725868800000,
      "updatedAt": 1725868800000
    },
    {
      "id": "seed-tx-009",
      "title": "Kampüs Kahve & Sinema",
      "amount": 340.00,
      "type": "expense",
      "categoryId": "exp_social",
      "date": "2026-09-11",
      "notes": "Kulüp etkinliği sonrası",
      "createdAt": 1726041600000,
      "updatedAt": 1726041600000
    }
  ]
}
```

---

## 6. Frontend Geliştirici Direktifleri

Geliştirme yapacak frontend mühendisinin uyması gereken temel mimari prensipler:

### 6.1 Teknoloji Yığını ve Kod Yapısı
- **Core:** HTML5, Modern Vanilla ES6+ veya React + TypeScript.
- **Stil & Tasarım:** Tailwind CSS (modern, temiz ve responsive kart mimarisi).
- **İkonlar:** Lucide Icons (CDN veya SVG/npm).
- **Grafikler:** Chart.js veya hafif SVG bazlı pasta/çubuk grafikler (Kategori harcama analizi için).

### 6.2 Bileşen Mimarisi (Component Hierarchy)
1. **Header / Navbar:** Uygulama logosu, ay seçici (Date Filter), tema değiştirici ve Veri Yönetimi (Export/Import/Reset) butonları.
2. **Hero Dashboard (Özet Kartları):**
   - **Bakiye Kartı:** Kalan Net Bütçe, Sağlık Rozeti (`Healthy` / `Critical` vb.).
   - **Günlük Güvenli Harcama Kartı:** "Bugün Harcayabileceğin Tutar: XX ₺" (vurgulu büyük tipografi).
   - **Toplam Gelir & Gider Kartları:** Yeşil ve kırmızı minimal göstergeler.
3. **Hızlı İşlem Ekleme Formu (Quick Transaction Form):**
   - Başlık, Tutar, Tip (Gelir / Gider toggle butonu), Kategori seçimi (ikonlu pill butonlar), Tarih ve Not alanı.
   - Hızlı ekleme butonları (Örn: "Yemekhane 30 ₺", "Kahve 60 ₺").
4. **Harcama Grafiği ve Analiz Kartı:**
   - Kategori bazlı harcama dağılımı (Donut / Progress barlar).
5. **İşlem Geçmişi (Transaction List):**
   - Tarihe göre gruplanmış liste.
   - Filtreleme (Gelir/Gider, Kategori bazlı filtre).
   - Arama kutusu (Canlı arama).
   - Düzenleme (`Edit`) ve Silme (`Delete`) modal/aksiyonları.
6. **Kritik Uyarı Bildirimi (Alert Banner):**
   - Kalan bütçe %15'in altına düştüğünde veya negatife geçtiğinde sayfa üstünde görünen, kapatılabilir veya sabit uyarı paneli.

### 6.3 State & Store Yönetimi
- **Single Source of Truth:** Tüm işlemler merkezi bir `BudgetStore` üzerinden okunmalı ve mutasyona uğratılmalıdır.
- **Tetikleyiciler (Reactivity):** Her ekleme, silme, güncelleme işlemi sonrasında `LocalStorage` senkronize edilmeli ve UI otomatik re-render edilmelidir.
- **Formatlama Standartları:** Para birimi gösterimi Türk Lirası standartlarına uygun olmalıdır (`1.250,50 ₺` son ekli para birimi formatı).

---

## 7. QA ve Test Direktifleri

QA ekibinin doğrulaması gereken temel test senaryoları ve sınır durumlar (Edge Cases):

### 7.1 Formül ve Hesaplama Testleri
| Test ID | Senaryo | Girdi | Beklenen Çıktı |
|---|---|---|---|
| **TC-01** | Standart Bütçe Hesabı | Gelir: 5000 ₺, Gider: 2000 ₺ | Kalan: 3000 ₺, Durum: `healthy` (%60) |
| **TC-02** | Kritik Bütçe Eşiği (%15) | Gelir: 10000 ₺, Gider: 8600 ₺ | Kalan: 1400 ₺ (%14), Durum: `critical` (Uyarı paneli aktif) |
| **TC-03** | Negatif Bakiye Durumu | Gelir: 3000 ₺, Gider: 3500 ₺ | Kalan: -500 ₺, Durum: `depleted`, Günlük Limit: 0 ₺ |
| **TC-04** | Günlük Limit Hesabı | Kalan: 1500 ₺, Kalan Gün: 15 | Günlük Limit: 100.00 ₺/gün |
| **TC-05** | Ayın Son Günü Limiti | Kalan: 200 ₺, Kalan Gün: 1 (Ayın 30/31'i) | Günlük Limit: 200.00 ₺/gün |
| **TC-06** | Gelirsiz Sadece Gider | Gelir: 0 ₺, Gider: 100 ₺ | Kalan: -100 ₺, Günlük Limit: 0 ₺, Durum: `depleted` |
| **TC-07** | Sıfır Bakiye (Gelir = Gider) | Gelir: 2000 ₺, Gider: 2000 ₺ | Kalan: 0 ₺, Günlük Limit: 0 ₺, Durum: `depleted` |
| **TC-08** | Boş İşlem Listesi (Başlangıç) | Gelir: 0 ₺, Gider: 0 ₺ | Kalan: 0 ₺, Günlük Limit: 0 ₺, Durum: `healthy` (Uyarı yok, boş durum ekranı) |

### 7.2 Doğrulama (Validation) & Güvenlik Testleri
- **Negatif Tutar Girişi:** Tutar alanına `<= 0` değer girilmesi engellenmeli ("Tutar 0'dan büyük olmalıdır" hatası).
- **Boş Alanlar:** Başlık boş bırakıldığında veya kategori seçilmediğinde form submit olmamalıdır.
- **Tarih Kontrolü:** İleri veya geçmiş tarihli işlemler doğru kronolojik sırayla listelenmelidir.
- **XSS Koruması:** Başlık ve Not alanlarına HTML/Script enjeksiyonu (`<script>alert(1)</script>`) yapıldığında metin escape edilmelidir.

### 7.3 Depolama ve Taşınabilirlik Testleri
- **İlk Yükleme (Cold Start):** `LocalStorage` boşken açıldığında varsayılan `seed` verileri ve kategoriler yüklenmeli, uygulama hatasız açılmalıdır.
- **Export Testi:** Dışa aktarılan dosya geçerli bir `.json` olmalı, tüm işlemleri ve ayarları içermelidir.
- **Bozuk Dosya Import Testi:** Hatalı JSON veya eksik şemalı dosya yüklendiğinde kullanıcıya bildirim gösterilmeli ve mevcut veriler korunmalıdır.
- **Sayfa Yenileme:** Yapılan ekleme/silme işlemleri sayfa yenilendiğinde (F5) korunmalıdır.

---

## 8. Onay ve Sürüm Takibi
- **Doküman Versiyonu:** 1.0.0
- **Tarih:** 2026-09-13
- **Rol:** Yazılım Mimarı (Software Architect)
- **Durum:** Onaylandı & Uygulamaya Hazır
