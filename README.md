# 🎓 Öğrenci Bütçe Takip Uygulaması (Student Budget Tracker)

Üniversite ve lise öğrencilerinin burs, harçlık ve yarı zamanlı gelirleri ile yurt, yemekhane, ulaşım, kitap gibi giderlerini kolayca yönetebilmeleri için tasarlanmış modern, çevrimdışı öncelikli (offline-first) web uygulaması.

Bu proje **üç uzman yapay zeka ajanı** (Yazılım Mimarı, Frontend Geliştiricisi ve QA/UX Denetçisi) tarafından adım adım tasarlanmış, kodlanmış ve test edilmiştir.

---

## 🚀 Hızlı Başlangıç (Kurulum Gerektirmez)

Uygulama herhangi bir bağımlılık veya sunucu kurulumu gerektirmez.

1. `index.html` dosyasına çift tıklayarak doğrudan tarayıcınızda açabilirsiniz.
2. Veya bir yerel web sunucusu ile çalıştırmak isterseniz:
   ```bash
   # Python ile
   python -m http.server 8000
   ```
   Ardından tarayıcınızda `http://localhost:8000` adresine gidin.

---

## ✨ Temel Özellikler

- 💰 **Kalan Net Bütçe ve Devreden Bakiye:** Önceki aylardan devreden net bakiye (pozitif veya negatif) ayrı bir kalem olarak sonraki aya aktarılır. Bu tutar kesinlikle bu ayın geliriyle karıştırılmaz; "Bu Ay Gelir", "Bu Ay Gider" ve "Devreden Bakiye" şeffafça ayrı listelenir.
- 📅 **Aylık Dönem Gezgini:** Üst bardaki önceki/sonraki butonları veya ay seçici ile geçmiş ve gelecek aylara geçiş yapabilir; seçilen aya ait bütçe kartlarını, grafikleri ve işlem geçmişini filtreleyebilirsiniz.
- 🎓 **Günlük Güvenli Harcama Limiti:** `Kalan Bütçe / Ayda Kalan Gün` formülüyle ay sonuna kadar her gün için aşmamanız gereken harcama sınırını canlı hesaplar. Eksi bakiyede asla yanıltıcı negatif limit göstermez.
- 📊 **İnteraktif Grafikler (Chart.js):** 
  - Kategori Bazlı Gider Dağılımı (Doughnut Chart - seçilen aya özel)
  - Aylık Bütçe Dengesi (Devreden bakiye, gelir, gider ve kalan bakiye karşılaştırma çubuğu)
- ⚡ **Özelleştirilebilir Hızlı Harcamalar:** Yemekhane, Kahve, Market, Dolmuş, Fotokopi presetlerinin tutarları kullanıcı tarafından kolayca düzenlenebilir ("Tutarları Düzenle" butonu ile) ve `LocalStorage` üzerinde kalıcı saklanır. Tek tıkla hızlı ekleme işlevi korunur.
- 🚀 **Kişisel Onboarding Ekranı:** İlk açılışta veriler otomatik yüklenmez; "Kendi bütçemle başla" (başlangıç bakiyesi, aylık gelir ve ay seçimi) veya "Demo verilerle dene" seçenekleri sunulur.
- 🔍 **Arama ve Çoklu Filtreleme:** Başlık/not araması, Gelir/Gider sekmeleri, kategori filtreleri, tarihe ve tutara göre sıralama.
- 💾 **Tam Çevrimdışı ve Veri Gizliliği:** Tüm veriler tarayıcınızın `LocalStorage` belleğinde saklanır. Sunucuya veri gönderilmez.
- 🔄 **Yedekleme ve Geri Yükleme (Export / Import / Reset):** Bütçe verilerinizi JSON formatında tek tıkla indirebilir, geri yükleyebilir veya "Verileri Sıfırla / Yeni Başlangıç Yap" ile temizleyebilirsiniz.
- 🌓 **Karanlık / Aydınlık Mod:** Göz yormayan, kontrast standartlarına (WCAG) uygun gece modu.
- 📱 **Tam Mobil Uyumlu:** Telefon, tablet ve masaüstü ekranlarında rahat kullanım, minimum 44px dokunma alanları.
