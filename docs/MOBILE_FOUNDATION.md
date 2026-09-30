# Öğrenci Bütçem — Mobil Temel & Teknik Değerlendirme Raporu (FAZ 6.0)

Bu doküman, web platformunda başarıyla çalışan ve dondurulan (Web MVP Freeze) **Öğrenci Bütçe** uygulamasının Capacitor aracılığıyla iOS platformuna aktarılmasına ilişkin teknik değerlendirmeyi, mimari kararları, geçici yapılandırmaları ve sonraki adımları özetler.

---

## 1. Mimari Genel Bakış & Capacitor Yaklaşımı

### 1.1 Neden Capacitor Test Ediliyor?
Projenin ana hedefi, Web MVP sürecinde geliştirilen ve 1600+ otomatik test ile doğrulanan **deterministik finans motorlarını, senkronizasyon mantığını ve zengin arayüzü** baştan sıfırdan yazmadan iOS ortamında gerçek bir native kabuk (`WKWebView`) içinde çalıştırmaktır.

Capacitor bu aşamada kalıcı bir mimari taahhüt değil; **teknik doğrulama ve hızlı prototipleme stratejisi** olarak değerlendirilmektedir.

### 1.2 Web ile Ortak Paylaşılan Çekirdek (Shared Product Core)
Aşağıdaki modüller Web ve iOS arasında **birebir aynı** kaynak dosyalarını paylaşır; iOS için asla kopyalanmış veya çatallanmış (duplicate) bir kod tabanı oluşturulmaz:
- **Finansal Motorlar:**
  - `src/services/analyticsEngine.js`
  - `src/services/forecastEngine.js`
  - `src/services/insightEngine.js`
  - `src/services/whatIfEngine.js`
  - `src/services/cashflowPlannerEngine.js`
  - `src/services/whatIfDecisionSupportService.js`
- **Veri & Durum Yönetimi:**
  - `src/store/BudgetStore.js`
  - `src/store/calculations.js`
  - `src/utils/storage.js` (`SafeStorage`)
  - `src/services/syncService.js` (Durable Outbox & Sync)
- **Arayüz & Yerelleştirme:**
  - `index.html` (Responsive Layout & Modals)
  - `src/components/UIManager.js`
  - `src/components/modalManager.js`
  - `src/charts/chartManager.js`
  - `src/i18n/` (TR & EN sözlükleri)

---

## 2. Geçici Geliştirici Kimliği (Temporary Identity)

> [!WARNING]
> **ÖNEMLİ:** Aşağıdaki `appId` değeri geçici bir geliştirme kimliğidir. TestFlight / App Store dağıtımı, Sign in with Apple yetkilendirmesi veya kalıcı Keychain/Push Notification konfigürasyonundan **ÖNCE** kurumsal/nihai alan adına göre güncellenmelidir.

* **App Name:** `Öğrenci Bütçe`
* **App ID (Geçici):** `com.mkandaz.ogrencibutce.dev`
* **Web Dir:** `dist`
* **Yapılandırma Dosyası:** [`capacitor.config.json`](file:///Users/fatihkandaz/Downloads/Antigravity%20deneme%20projesi/capacitor.config.json)

---

## 3. Web vs Native PWA Service Worker Ayrımı

Web tarayıcısında (özellikle PWA olarak masaüstü veya mobil Safari'de) çevrimdışı önbellekleme Workbox Service Worker ile sağlanır.

Ancak yerel iOS uygulamasında web dosyaları zaten yerel uygulama bundle'ı (`App.app/public`) içinden servis edilir. Yerel kabukta Service Worker kaydı açıldığında:
- Eski Workbox önbelleklerinin native bundle ile çakışması,
- Güncellemelerde stale cache oluşması,
- Ekstra RAM ve disk karmaşası yaşanmaktadır.

### Çözüm:
[`src/utils/platform.js`](file:///Users/fatihkandaz/Downloads/Antigravity%20deneme%20projesi/src/utils/platform.js) modülü eklendi:
```javascript
import { Capacitor } from '@capacitor/core';

export function isNativePlatform() {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

export function shouldRegisterPWA() {
  return !isNativePlatform();
}
```
[`src/main.js`](file:///Users/fatihkandaz/Downloads/Antigravity%20deneme%20projesi/src/main.js) içerisinde `registerSW()` çağrısı yalnızca `shouldRegisterPWA() === true` (yani web tarayıcısı ortamında) çalışacak şekilde izole edildi. Capacitor yerel ortamında Service Worker kaydı temiz bir şekilde atlanır.

---

## 4. Ön Denetim (Audit) & Bilinen iOS / WKWebView Riskleri

1. **PWA Cache vs Native Bundle:**
   - Web PWA service worker'ı native ortamda devre dışı bırakılarak olası çakışmalar önlendi.
2. **`window.location.origin` & Yerel URL:**
   - WKWebView içerisinde `window.location.origin` değeri `capacitor://localhost` (veya `http://localhost`) döner.
   - Web'deki Supabase `redirectTo: window.location.origin` mantığı native kabukta doğrudan tarayıcı yönlendirmesiyle çalışmaz.
3. **Google OAuth & Supabase Auth Durumu (FAZ 6.1'e Devredildi):**
   - Google OAuth, güvenlik politikaları gereği embedded webview'ler içinde kimlik doğrulamayı kısıtlar.
   - Native iOS'ta Google girişi için ASWebAuthenticationSession / `@capacitor/browser` ve özel URL şeması (`com.mkandaz.ogrencibutce://auth/callback`) gereklidir.
   - Bu fazda (FAZ 6.0) güvenlikten ödün vermemek adına hack'li çözümlere girilmemiş; **Yerel / Misafir Modu (Guest Mode)** hedeflenmiştir.
4. **LocalStorage Dayanıklılığı (Storage Eviction):**
   - iOS, cihazda disk alanı daraldığında WKWebView'a ait LocalStorage verilerini silebilir.
   - Misafir modunda cihazda uzun süreli veri saklanacaksa ileriki fazlarda `@capacitor/preferences` veya SQLite eklentisi değerlendirilmelidir.
5. **Yaşam Döngüsü (App Lifecycle):**
   - Web'deki `visibilitychange` ve `pageshow` olayları iOS uygulamasının tamamen arka plana atılması (background suspend) veya kilitlenmesi durumlarında her zaman tetiklenmeyebilir.
   - FAZ 6.1'de `@capacitor/app` (`appStateChange`) dinleyicisi eklenmelidir.
6. **Safe Area & Ekran Çentiği (Notch / Dynamic Island):**
   - iOS'ta üst durum çubuğu ve alt Home Indicator için `env(safe-area-inset-top)` ve `env(safe-area-inset-bottom)` değerlerinin doğru okunabilmesi `<meta name="viewport" content="... viewport-fit=cover">` gerektirebilir.
7. **Chart.js & Canvas:**
   - Retina ekranlarda (3x ölçek) yüksek çözünürlüklü çizimler WKWebView içinde sorunsuz render edilmeli; pencere yeniden boyutlandırma olaylarında gereksiz yeniden çizimlerden kaçınılmalıdır.

---

## 5. Capacitor'dan Vazgeçme ve SwiftUI'a Geçiş Kriterleri (Exit Criteria)

Capacitor test edildikten sonra aşağıdaki alanlarda çözülemeyen veya ürün kalitesini düşüren engellerle karşılaşılırsa hibrit yaklaşım terk edilip **SwiftUI** mimarisine geçiş değerlendirilecektir:

1. **Performans & Akıcılık (60/120 FPS):** Sayfa kaydırma, grafik animasyonları veya modal açılışlarında hissedilir takılma veya gecikme yaşanması.
2. **Klavye & Form Deneyimi:** Tutar girişlerinde sanal klavyenin ekranı hatalı itmesi, zıplatması veya inputları kapatması.
3. **Auth & Deep Links:** Supabase Google OAuth / Apple Sign In akışının native deep link ile pürüzsüz ve güvenilir biçimde kurulamaması.
4. **Arka Plan Senkronizasyonu & Bildirimler:** iOS Background Fetch ve APNs bildirimlerinin hibrit kabukta güvenle çalıştırılamaması.
5. **Veri Kalıcılığı:** LocalStorage'ın iOS bellek temizliği tarafından silinmesi ve güvenli yerel depolama kurulamaması.
6. **App Store İnceleme Kısıtları:** Apple'ın WebKit kabuğu yerine native UI beklentisiyle ret vermesi.

---

## 6. Geliştirici Komutları

* **Web Geliştirme Sunucusu:**
  ```bash
  npm run dev
  ```
* **Web & Test Doğrulama:**
  ```bash
  npm test
  npm run build
  ```
* **iOS Senkronizasyonu (Build + Cap Sync):**
  ```bash
  npm run mobile:sync
  ```
* **Xcode ile Projeyi Açma:**
  ```bash
  npm run mobile:open
  # veya:
  npx cap open ios
  ```

---

## 7. Fiziksel iPhone Cihazında Çalıştırma Adımları

Geliştiricinin uygulamayı kendi iPhone'unda çalıştırması için izleyeceği adımlar:

1. iPhone'u kablo ile Mac'e bağlayın ve cihazda "Bu Bilgisayara Güven" onayını verin.
2. iPhone üzerinde **Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu (Developer Mode)** seçeneğini açın (cihaz yeniden başlar).
3. Terminalde derleme ve senkronizasyonu çalıştırın:
   ```bash
   npm run mobile:sync
   npm run mobile:open
   ```
4. Açılan Xcode penceresinde sol menüden `App` projesini seçin.
5. **Signing & Capabilities** sekmesine gelin:
   - *Team:* Kişisel Apple Hesabınızı (Personal Team) seçin.
   - *Bundle Identifier:* `com.mkandaz.ogrencibutce.dev`
6. Üst menüdeki cihaz hedefi (Device Target) açılır kutusundan bağlı fiziksel iPhone'unuzu seçin.
7. **Run (Cmd+R)** butonuna basarak derleyin ve yükleyin.
8. Telefonda ilk açılışta *"Güvenilmeyen Geliştirici"* uyarısı çıkarsa:
   - iPhone'da **Ayarlar > Genel > VPN ve Cihaz Yönetimi** menüsünden geliştirici sertifikanıza "Güven" deyin.
9. Uygulamayı açarak **"Üyeliksiz devam et" (Misafir Modu)** ile onboarding ve dashboard akışlarını test edin.
