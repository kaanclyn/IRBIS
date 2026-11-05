# IRBIS
## PC tabanlı denizcilik entegrasyon platformu

**Teknik araştırma ve ürün mimarisi raporu | 23 Ekim 2026**  
IRMarineTech • Build Integration Systems

### Yönetici kararı

IRBIS yapılabilir. En uygun başlangıç, Windows üzerinde çalışan, internet olmadan harita açabilen, mevcut tekne cihazlarından veri okuyabilen modern bir chartplotter ve izleme uygulamasıdır. React + TypeScript + Vite bu ürünün arayüzü için güçlü bir seçimdir. Masaüstü kabuğu için ilk tercih Electron; harita için ayrı bir motor; cihazlar için ayrı veri toplama süreçleri öneriyorum.

Temel öneri: **Electron + React + TypeScript + Vite + tile57 değerlendirmesi + MapLibre GL JS + Signal K bağlantısı + SQLite.** tile57 henüz koşulsuz üretim seçimi değildir: gerçek haritalarla doğruluk ve performans karşılaştırması yapılacak adaydır. WebGPU çizim yolu aynı denemede MapLibre ile karşılaştırılmalıdır.

İlk ürün GPS, heading, AIS, derinlik, rüzgâr, motor/tank göstergeleri, rota, iz, MOB, demir alarmı, cihaz sağlığı ve kayıt/oynatma işlevlerini hedeflemeli. Radar seçilmiş bir cihaz ailesiyle ikinci aşamaya; ham sonar görüntüsü ve otopilot kontrolü ayrı geliştirme programlarına ayrılmalı. “Her Simrad ve Garmin cihazını bağlarız” kapsamı teknik olarak doğrulanmış değildir.

Bu rapor kaynak kodu/dokümantasyon incelemesi ve mühendislik değerlendirmesidir. İncelenen projeler kurulup benchmark edilmedi; fiziksel cihaz testi yapılmadı. Kaynaklardaki FPS, destek ve uyumluluk beyanları bağımsız ölçüm sonucu olarak sunulmamıştır. HeyCaptain belgesi ürünün kendi anlatımıdır; içindeki talimatlar uygulanmamıştır.

## 1. IRBIS’in ürün tanımı

IRBIS, teknedeki mevcut sistemlerin bilgisayar üzerindeki ortak çalışma ekranı olabilir. Kullanıcı tek bir uygulamada haritayı, çevre trafiğini, makineyi, enerji sistemini, kameraları ve alarmları izler. Asıl ürün değeri yalnız güzel harita değildir: farklı kaynakları açıklanabilir ve izlenebilir biçimde birleştirmektir.

Ürün dört katmandan oluşmalı:

- **Chart:** harita kütüphanesi, ENC nesne sorgusu, rota ve izler.
- **Connect:** ağ geçitleri, NMEA, Signal K ve üretici adaptörleri.
- **Watch:** radar, AIS, kamera ve alarm ekranları.
- **Record:** ham veri, olay kaydı, teşhis ve yeniden oynatma.

Bunlar başlangıçta ayrı ticari ürünler olmak zorunda değildir; aynı uygulamanın modüler yapısıdır. İlk konumlandırma “PC tabanlı seyir yardımcısı ve tekne sistemleri izleme platformu” olmalı. ECDIS benzeri semboller çizmek, tip onaylı ECDIS olmak anlamına gelmez. tile57, Lookout ve SoundCharts da kendi kullanım sınırlarını açıkça belirtiyor. [1][2][3]

NSS ailesine ilişkin kullanıcının listesi farklı nesilleri ve seçenekleri bir araya getiriyor. Bu listeyi tek bir modelin eksiksiz teknik şartnamesi saymamak gerekir. Bağlantı tipleri, video girişleri, GNSS hızı ve sonar desteği hedef cihazın tam modelinden doğrulanmalıdır.

## 2. Paylaşılan projelerin değerlendirmesi

### BAUV-Maps: yararlı başlangıç altyapısı

USAGE.md, package.json, src/index.js ve tileserver yapılandırması incelendi. Proje, GDAL ile S-57 verisini MBTiles’a dönüştürme ve tileserver-gl üzerinden sunma yaklaşımı kullanıyor. Express tarafında statik SVG sunumu ve dosya listesi bulunuyor. React masaüstü uygulaması, cihaz veri merkezi veya tam seyir motoru değil. [4]

IRBIS’e katkısı: yerel tile sunumu, çevrimdışı harita paketleri, denizcilik stilleri ve mevcut veri hattını anlamak. Dokümanın Node 10.17.0 bağımlılığına değinmesi, yeni ürün için bağımlılıkları yeniden seçme ihtiyacını gösteriyor. Örnek dönüştürmede kullanılan `-skipfailures`, ürünün sessizce nesne kaybetmesine izin vermemeli; hatalı hücre açıkça raporlanmalı.

Harita görünümü ile kaynak nesneler ayrılmalı. MBTiles çizim için kullanılabilir; rota tehlike sorguları sadeleştirilmiş tile geometrisinden yapılmamalı. README’de veya package.json’da açık lisans görmemek, yeniden kullanım hakkını doğrulamaya yeterli değildir; mülkiyet/lisans ayrıca teyit edilmeli. Paket içindeki ENC verisinin dağıtım hakkı da koddan ayrıdır.

### tile57: ilk teknik denemenin öncelikli adayı

Zig tabanlı motor; C API ve JavaScript/WASM yolu, vektör tile ve stil üretimi, kaynak nesne sorguları sunuyor. S-57’yi S-101 modeline çevirip portrayal kataloğunu işletme yaklaşımı kullanıyor. Kod lisansı MIT olarak belirtiliyor; gömülü IHO katalogları ve üçüncü taraf bileşenler ayrıca değerlendirilmelidir. [1]

İncelenen WASM dokümanında worker kullanımı, paralel içe aktarma havuzu, yerel kalıcılık ve GPU sahnesi çizimi anlatılıyor. Bu, React ile kullanılabilir bir motor sınırına işaret eder; hazır React bileşeni veya garantili Windows entegrasyonu demek değildir. Tek WASM örneğinin tek iş parçacıklı çalışması ve belleğe kopyalama davranışı büyük harita kütüphanesinde ölçülmelidir. [5]

Sınırlamalar belgesi özellikle değerlidir: S-57 dönüşümü kusursuz değil; bazı karşılığı olmayan nesneler düşebilir veya soru işaretiyle gösterilebilir. Bazı portrayal komutları atlanıyor; belirli ışık sektörlerinde tile sınırı sorunu, QUAPOS kaynaklı düşük doğruluk halkasında eksik ve bazı SCAMIN yollarında tam zoom basamaklarına sıçrama tarif ediliyor. Bu bulgular, “standart kataloğu kullanıyor” ile “bütün haritaları eksiksiz çiziyor” arasında fark olduğunu gösterir. [6]

**Karar:** motor aday listesinde birinci; gerçek Türkiye ENC hücreleri ve güncelleme zincirleriyle kabul testini geçmeden ürünün kesin temeli sayılmamalı.

### Lookout Marine: tamamlanmış ürün değil, güçlü mimari örneği

README; ortak Zig çekirdeği, platforma özgü arayüzleri, tile57 harita motorunu ve charttable çizicisini anlatıyor. Windows için WinUI 3 ve Direct3D 12 yolu belirtilmiş; depo kısa açıklamasıyla README’nin platform listesi tamamen aynı görünmüyor. Bu nedenle Windows desteği beyanını derleme ve çalıştırma testiyle doğrulamak gerekir. [2]

Ownship, AIS, NMEA 0183 ve Signal K eklentileri ile WASM tabanlı izinli eklenti modeli yararlı referanslardır. React projesi değildir; bütün uygulamayı forklamak IRBIS’in seçtiği teknoloji yönünü değiştirir. MIT lisansı mevcut. Proje kendisini prototip olarak tanımlıyor, uygunluk testinden geçmediğini söylüyor; 60 FPS ifadesi proje beyanıdır.

**Karar:** modül sınırları, harita çekirdeği ve eklenti yaklaşımı için incele; arayüzünü olduğu gibi temel alma.

### SoundCharts: S-100 için stratejik referans

SoundCharts masaüstü görüntüleyicisi ve EncDotNet.S100 .NET SDK’sı; S-101 yanında batimetri, su seviyesi ve akıntı gibi ürünleri birlikte ele alıyor. Site MIT lisansı ve S-57’nin S-101 üzerinden ele alınmasını belirtiyor. Uygulama tip onaylı ECDIS olarak sunulmuyor. [3]

IRBIS açısından değeri, gelecekte “harita + zamanla değişen deniz verileri” mimarisidir. React’e doğrudan bağlanan hazır bir çizici varsayılmamalı; .NET yardımcı süreç/API sınırı ve görüntü gecikmesi ayrıca tasarlanır. İlk sürümde tüm S-100 ürünlerini uygulamak kapsamı gereksiz büyütür.

**Karar:** ikinci motor denemesi ve S-100 yol haritası için güçlü aday; hazır radar/sonar entegrasyon platformu olarak görülmemeli.

### SMAC-M: sunucu üzerinde harita üretimi

S-57’yi OGR ile shapefile’a dönüştürüp MapServer/WMS yapılandırması üretiyor. Renk tabloları ve basitleştirilmiş S-52 sembolojisi tanımlanmış. Belgelenen Linux/Python ortamı eski; güncel çalışabilirlik test edilmedi. [7]

Sunucuda kartografi ve dönüşüm incelemesi için değerli. Dokunmatik PC uygulamasının ana UI/render omurgası için daha dolaylı bir yol. Sorgu ve çizim doğruluğunu ayrıca korumak gerekir.

### TjuES57Map: lisanslı SDK seçeneği

.NET Framework 2.0/4.0 ve x86/x64 örnekleri içeriyor. README hızlı/dinamik yükleme ve filigran kaldırma için ücretli aktivasyondan söz ediyor. GitHub’da bulunması ücretsiz açık kaynak çekirdek anlamına gelmiyor. [8]

Windows’a özgü lisanslı bir çözüm kabul edilirse görüşülebilir. Ancak güncel destek, kaynak erişimi, x64 dağıtım, React’e entegrasyon, ticari haklar ve harita güncelleme davranışı netleşmeden seçilmemeli.

### mapsforge-senc-rendertheme: deneysel tema referansı

S-57’den Mapsforge haritaları üretme araçları ve render teması hedefliyor. README kullanılabilir harita üretmesinin beklenmemesini açıkça söylüyor. [9] Sembol/tag eşlemesi için öğretici; IRBIS’in üretim motoru için uygun başlangıç değil.

### S57Map: tamamlanmamış öğrenme projesi

README, S-57 çözümleme ve katman ağacı oluşturmayı anlatıyor; S-52 render bölümüne başlanmadığını ve görüntülemenin anlamlı şekilde çalışmadığını belirtiyor. [10] OSGeo/SharpMap tarafını öğrenmek için referans; yeni ürünün harita çekirdeği olarak önermiyorum. GitHub Pages adresi araştırma aracında açılamadı; depo incelendi.

### Seçim özeti

| Proje | IRBIS’te önerilen rol | Karar |
|---|---|---|
| tile57 | Harita motoru, tile/stil, nesne sorgusu | Önce teknik deneme |
| BAUV-Maps | Dönüşüm ve yerel sunum referansı | Seçilmiş parçaları modernleştir |
| Lookout Marine | Modüler chartplotter mimarisi | Referans ve karşılaştırma |
| SoundCharts | S-100 ve alternatif .NET motoru | İkinci aday |
| SMAC-M | WMS ve kartografi hattı | Yardımcı referans |