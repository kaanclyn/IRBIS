# IRBIS — Ürün Yol Haritası ve Uygulama Planı

**PC tabanlı denizcilik chartplotter ve cihaz entegrasyon platformu**  
IRMarineTech · Build Integration Systems  
**Tarih:** 24 Ekim 2026 · **Revizyon:** saha durumu (Faz 0 kabuk + NOAA demo yolu)  
**Durum:** Faz 0 laboratuvar kabuğu canlı; Faz 1 MVP kısmen tamamlandı (plain S-57 + NMEA/AIS)  
**Platform:** Windows 10 / 11 x64 only

---

## 0. Yönetici özeti

IRBIS, teknedeki mevcut cihazların bilgisayar üzerindeki ortak çalışma ekranıdır: gerçek **S-57 ENC** harita, GNSS/AIS/NMEA enstrümanları, ileride Navico HALO radar, kamera ve kayıt. Hedef Simrad/Garmin yazılımını kopyalamak değil; kullanıcının kendi cihazlarını ve kendi harita hücrelerini bağlayan bağımsız Windows uygulamasıdır.

**Çekirdek stack (değişmez):** Electron + React + TypeScript + Vite · tile57 (S-57 bake) + MapLibre GL JS · Node.js · SEAPIR-tarzı NMEA 0183 UDP · SQLite · (Faz 3) NDATAREADER-tarzı HALO multicast · FLIR/kamera ayrı adaptör.

**Güncel durum (Ekim 2026):**
- **Faz 0 laboratuvar kabuğu canlı:** `apps/desktop` Electron + React + Vite; loopback chart sunucusu; seyir uyarısı.
- **NOAA demo yolu kuruldu:** `samples/enc-noaa` → tile57 bake → PMTiles → MapLibre (şifresiz / plain S-57).
- **Operasyonel müşteri örneği (şifreli):** `vendor/enc/2022_Hafta_17` (S-63 TR, ~402 hücre) + `vendor/permits` (kullanıcı permit’leri). Chart Library bu hücreleri **OEM/SDK gelene kadar `unsupported-s63`** olarak işaretlemelidir — decrypt tamamlanmış sayılmaz.
- **Hedef UX:** modern chartplotter (üstte telemetri, üç küreli hub navigasyon, harita öncelikli). **ECDIS iddiası yok.**

**Harita politikası (HeyCaptain BYO):** Uygulama ENC satmaz. Lab/sergi: **NOAA açık S-57** (`samples/enc-noaa`). Müşteri şifresiz S-57 klasörünü yükler (BYO). **S-63:** lisanslı OEM/SDK olmadan decrypt yok; kalıcı çözülmüş PMTiles yazılmaz. İnternet olmadan tam çalışma zorunlu.

**Yasal konum:** Seyir yardımcısı / ECS. Tip onaylı ECDIS değildir. Açılışta seyir uyarısı zorunludur.

**Doğrulama notu:** Aşağıda “DONE” / “NEXT” ve “SEAPIR’de doğrulandı” / “hedeflenen” ayrımı yapılır. Referans kodda veya kabul listesinde görülmeyen özellik tamamlanmış sayılmaz. S-63 decrypt iddiası yoktur.

---

## 1. Ürün tanımı ve sınırlar

### 1.1 IRBIS nedir

| Katman | İş |
|--------|-----|
| **Chart** | S-57 kütüphanesi, bake, offline PMTiles/stil, MapLibre, nesne sorgusu, rota/iz |
| **Connect** | NMEA 0183 UDP, kanal bazlı kaynak önceliği, AIS, teşhis |
| **Watch** | AIS; sonra radar PPI/overlay; kamera radar’dan bağımsız |
| **Record** | Ham NMEA, olay, replay |

### 1.2 IRBIS nedir değil

- Tip onaylı ECDIS
- C-MAP / Navionics kart okuyucu (varsayılan aktarım yok)
- “Her Simrad ve Garmin cihazını bağlarız” iddiası
- SEAPIR veya NDATAREADER UI / ürün kopyası
- MVP’de S-63 decrypt, ham sonar waterfall, otopilot yazma

### 1.3 NSS özellik listesinin fazlara ayrımı

| Grup | Faz |
|------|-----|
| GNSS, heading, SOG/COG, derinlik, rüzgâr (NMEA 0183) | Faz 0 iskelet → Faz 1 MVP |
| S-57 harita, day/dusk/night, query, rota, iz | Faz 0–1 |
| Temel MOB, demir noktası, görsel uyarı | **MVP (Faz 1)** |
| Kalıcı alarm, histerezis, geçmiş, veri kaybı, replay, CPA/TCPA sert | **Faz 2** |
| HALO radar, overlay | Faz 3 |
| IP/FLIR kamera, GRIB | Faz 3 (radar’dan bağımsız) |
| Motor/tank, J1939 | Faz 4 |
| S-63 lisans, S-100 | Faz 4+ |
| CHIRP/SideScan, otopilot yazma, CZone kumanda | Ayrı programlar |

---

## 2. Referans matrisi — al / alma / doğrulama durumu

| Kaynak | Rol | Alınacak | Alınmayacak | Doğrulama |
|--------|-----|----------|-------------|-----------|
| **HeyCaptain kılavuzu** | Ürün/UX | BYO S-57, simülasyon ayrımı, teşhis, kara kutu dili | Kod; unlock key varsayımı | Kılavuz beyanı (kod yok) |
| **SEAPIR** | NMEA intake | UDP 10110, envelope, RMC, HDG/HDT/HDM, AIS 1–3, source-IP | Flutter UI; TCP (UI’da var, kod yok) | Kodda doğrulandı: UDP+0183+1–3. Tip 5/18/19/24 **hedeflenen**, SEAPIR’de yok |
| **NDATAREADER** | Radar | Multicast, spoke unpack, TX/kontrol mantığı | PPI/UI; radar_pi GPL kopyası | Faz 3 öncesi kaynak + LICENSE satır satır doğrulanacak |
| **tile57** | ENC motoru | Bake, PMTiles, stil | “Kusursuz S-52/ECDIS” iddiası | Faz 0’da Win x64 + gerçek `.000` ile kapı |
| **Fizibilite PDF** | Mimari | Yol A, canonical bus, riskler | — | Araştırma; cihaz benchmark yok |
| **BAUV / SMAC-M** | Dönüşüm fikri | Offline tile fikirleri | Ana motor GDAL→MBTiles | Lisans/çalışırlık ayrı |
| **SoundCharts** | S-100 lab | Sonra | MVP bağımlılığı | — |

---

## 3. Kilitlenen teknik kararlar

| Konu | Karar |
|------|--------|
| OS | Windows 10/11 x64 only |
| Shell | Electron (`contextIsolation=true`, `nodeIntegration=false`) |
| UI | React + TypeScript + Vite |
| ENC motoru | tile57 (birinci aday; başarısızlıkta karar noktası §6.6) |
| Harita UI | MapLibre GL JS (MLT için ≥ 5.12 veya MVT modu) |
| Offline | Zorunlu: PMTiles, sprite, font, stil yerel; internet şart değil |
| Harita veri | BYO plain S-57; demo `samples/enc-noaa`; S-63 örnek `vendor/enc/2022_Hafta_17` → `unsupported-s63` (OEM sonra) |
| Render vs güvenlik geometrisi | **Ayrı:** çizim tile’ı ≠ navigasyon/tehlike hesabı kaynağı |
| NMEA | SEAPIR hattı: UDP `0.0.0.0:10110`, 0183 |
| AIS kapsamı (hedef) | Tip 1–3, 5, 18, 19, 24 + çok parçalı + timeout |
| Radar | NDATAREADER/HALO; child-process; Faz 3; Ethernet |
| Kamera | Radar’dan bağımsız adaptör; Faz 3 |
| Store | SQLite |
| Bus | Canonical envelope; `ageMs` damgadan dinamik |
| Signal K | İkincil/opsiyonel |

---

## 4. Sistem mimarisi

```
Ethernet / UDP / (sonra Serial)
        │
┌───────┴────────────────────────────────┐
│  IRBIS Connect (main veya child)       │
│  Simulator · UdpNmea · Parsers         │
│  Kanal bazlı source priority           │
└───────┬────────────────────────────────┘
        │ canonical events (ageMs canlı)
┌───────┴────────────────────────────────┐
│  Electron Main · IPC · SQLite          │
│  Chart: bake worker + offline tile     │
│  Chart: source ENC index (query/nav)   │
│  Record service                        │
│  (Faz 3) Radar child · Native HALO     │
│  (Faz 3) Camera child (ayrı)           │
└───────┬────────────────────────────────┘
        │ tipli preload API
┌───────┴────────────────────────────────┐
│  Renderer: React + MapLibre            │
│  Chart · Instruments · AIS · Settings  │
│  (sonra) Radar PPI · Cameras           │
└────────────────────────────────────────┘
```

**Kural:** UDP multicast, seri, radar spoke, RTSP **renderer’da değil**.  
**Offline kuralı:** Loopback tile/stil sunucusu; dış CDN yok.

### 4.1 Canonical measurement envelope

```json
{
  "path": "navigation.headingTrue",
  "value": 1.57,
  "unit": "rad",
  "source": "udp:192.168.4.1:10110",
  "receivedAtUtc": "2026-10-23T11:00:00.000Z",
  "valid": true,
  "ageMs": 45,
  "quality": "measured"
}
```

- `ageMs` = `now − receivedAtUtc` (saklanan sabit değil; her okumada hesaplanır).
- Eşik aşımında `valid=false` veya UI **STALE** / `--`.
- İçeride SI/radyan; ekranda kn / nm / ° / m.
- **`headingTrue`, `headingMagnetic`, `courseOverGroundTrue` asla birbirine map edilmez.**

### 4.2 Kanal bazlı kaynak önceliği

Her kanal kendi sırasına sahip (kullanıcı değiştirilebilir):

| Kanal | Örnek path’ler |
|-------|----------------|
| GPS konum | `navigation.position` |
| SOG | `navigation.speedOverGround` |
| COG | `navigation.courseOverGroundTrue` |
| Heading | `navigation.headingTrue` / `headingMagnetic` |
| Derinlik | `environment.depth.belowTransducer` |

Simülatör her kanalda en düşük önceliktedir; simülasyon kipinde bile rozet **SİMÜLASYON** zorunlu.

---

## 5. Veri modelleri (çekirdek)

| Varlık | Alanlar (özet) |
|--------|----------------|
| **OwnShip** | lat, lon, sog, cog, headingTrue, headingMagnetic, depth, wind*, fixQuality, per-channel sources |
| **AisTarget** | mmsi, lat, lon, sog, cog, heading, name?, callSign?, shipType?, dim?, lastSeen, class (A/B), msgTypes[], lost |
| **ChartCell** | name, band, edition, updateNo, path, bakeStatus, cachePath, permitStatus (`plain`/`unsupported-s63`/`future`), error?, quarantine |
| **Waypoint / Route / Track** | id, geometry, meta, GPX |
| **Alarm** | type, severity, active, acked, source, payload, historyId (Faz 2) |
| **RawFrame** | transport, sourceIp, payload, ts |

---

## 6. Harita hattı — S-57 zorunlu (en yüksek öncelik)

### 6.1 Politika (BYO + offline demo)

1. Uygulama harita satmaz / göndermez.
2. Geliştirme ve sergi: NOAA açık S-57 (`samples/enc-noaa` — plain lab).
3. Müşteri: şifresiz S-57 klasörü (`Ayarlar › Harita` / Chart Library BYO).
4. S-63: Chart Library **`unsupported-s63`** gösterir; lisanslı OEM/SDK olmadan decrypt yok.
5. **Tamamen offline:** PMTiles + sprite + font + style.json yerel.
6. ENC kapsamı olmayan / yüklenmeyen alanlar UI’da açıkça işaretlenir (“Harita yok” / boş kapsama).
7. MBTiles / dünya altlığı yalnız opsiyonel basemap; ENC yerine geçmez.

### 6.1.1 Demo ve örnek veri yolları (Ekim 2026)

| Yol | Rol |
|-----|-----|
| `samples/enc-noaa` | Plain S-57 lab / sergi (NOAA); bake → PMTiles → MapLibre |
| `vendor/enc/2022_Hafta_17` | Operasyonel S-63 TR müşteri örneği (~402 hücre); **şifreli** — bake/decrypt yok |
| `vendor/permits` | Kullanıcı S-63 permit dosyaları (meta / ileride OEM); tek başına çözümleyici değil |

**Kural:** `2022_Hafta_17` hücreleri Chart Library’de `permitStatus: unsupported-s63` (veya eşdeğeri) olmalıdır. Plain NOAA yolu ile karıştırılmaz.

### 6.2 İki katmanlı veri (zorunlu ayrım)

| Katman | Kullanım | Kullanılmayacak |
|--------|----------|-----------------|
| **Görsel** | PMTiles / stil → MapLibre çizimi | Tehlike, sığlık, rota güvenlik hesabı |
| **Kaynak ENC** | Nesne sorgusu, güvenlik konturu mantığı, ileri bakış (sonra) | Sadeleştirilmiş tile geometrisinden “kesin derinlik” |

### 6.3 MVP pipeline (Yol A)

```
Klasör/ZIP (plain .000 + .001 + .002…)
    → doğrulama / karantina
    → update zinciri uygula (doğruluk testi şart)
    → tile57 bake → PMTiles + style + sprite + font (yerel)
    → loopback tile endpoint (offline)
    → MapLibre
    → query → kaynak ENC indeksi
```

### 6.4 Chart Library

- Klasör / ZIP / Yeniden tara
- Hücre listesi: band, baskı, update, sürüm, bake/cache durumu, hata
- Bozuk hücre → karantina; uygulama ayakta
- Cache + rebake + hata raporu
- Day / Dusk / Night
- Temel / Standart / Tümü (mümkün olduğunca)
- SCAMIN davranışı ölçülür / dokümante
- Güvenlik / sığ / derin kontur + güvenlik derinliği
- Nesne sorgusu
- Overscale uyarısı
- `permitStatus` alanı S-63’e hazır (`plain` | `unsupported-s63`); birincil müşteri örneği `vendor/enc/2022_Hafta_17` + `vendor/permits` → OEM’e kadar **unsupported-s63** (decrypt yok)

### 6.5 S-63 (OEM öncesi politika — değişmez)

- Chart Library permit/lisans meta’sına hazır; tarama S-63’ü **`unsupported-s63`** olarak işaretler (decrypt “bitti” demek değildir).
- Lisanslı OEM/SDK şartları doğrulanmadan: **şifresi çözülmüş S-63’ün kalıcı PMTiles olarak diske yazılması planlanmaz.**
- Yetkisiz / yasadışı üçüncü parti çözücü DLL yok; illegal decrypt yok.
- Operasyonel örnek set: `vendor/enc/2022_Hafta_17` + `vendor/permits` — yalnız tespit, meta ve UX; bake değil.
- **CodeMeter / CmStick ≠ S-63 açma (IRBIS’te):** Wibu dongle uygulama/ürün lisans taşıyıcısıdır. IHO S-63 için ayrıca OEM **M_KEY/M_ID**, kurulum **HW_ID** ve o HW_ID’ye basılmış **PERMIT.TXT** gerekir. Stick takmak IRBIS’te hücre decrypt etmez.
- **Referans ürün (S-63 gerçekten açan):** SEAPIR / NDATAREADER S-63 açmaz. Operasyonel referans **Zuni Pars V4** (`C:\Program Files\Zuni\Pars\ParsV4.exe`):
  - Chart çekirdeği: **SevenCs Nautilus 1.4** (`Nautilus-1.4-dynr.dll` + Cairo) — S-63 / `ENC_ROOT` / `PERMIT.TXT` / UserPermit
  - Köprü: `LibMarley.dll` (`TSImportENC`, `TSCreateUserPermit`, tile gen) · `LibChart.dll`
  - Lisans: **Wibu CodeMeter** (`WupiEngine64.dll`); CmStick üzerinde SevenCs firm code + **Fematek** Nautilus ECS modülü (ürün lisansı)
  - Veri: Pars V4 `S63 Harita\2022_Hafta_17` ile `vendor/enc/2022_Hafta_17` **aynı exchange** (`SERIAL.ENC` / sertifikalar eşleşir)
  - IRBIS yasal yollar: (A) SevenCs Nautilus OEM/SDK lisansı, (B) Zuni/Fematek ticari entegrasyon, (C) Pars yan yana görüntüleyici + IRBIS NMEA/AIS — **Nautilus/Wupi DLL kopyası, RE, M_KEY sızıntısı, kalıcı decrypt PMTiles yok**
- Üçüncü taraf lisansları (tile57 MIT + gömülü kataloglar, NDATAREADER, Mayara, vb.) üretim öncesi dosya bazında kontrol edilir.

### 6.5.1 Kendi motor / IHO OEM yolu (etik ürün hattı)

**İlke / Principle:** Rakip ECDIS (Pars / SevenCs Nautilus / Wibu firm) **kopyalanmaz, RE edilmez.** Motor **yayımlanmış IHO standartlarından** ve IRBIS’in kendi kodundan yazılır. S-63 algoritması standartta açıktır; gizli olan rakibin anahtarı değil — **IHO Scheme Administrator’dan alınan kendi OEM kimliğidir (M_ID / M_KEY).**

**Yasak / Hard bans:** `ChartEncMKey` · Nautilus DLL · LibMarley export’tan yeniden yazım · CodeMeter firm klonu · `vendor/enc/2022_Hafta_17` decrypt · kalıcı redistributable plaintext ENC dump.

---

#### A) Roller — Roles (S-63 §1.2)

| Rol / Role | TR | EN (public definition) |
|------------|----|------------------------|
| **Scheme Administrator (SA)** | Şemayı tek başına yönetir (IHO Secretariat). Üyelik, üst sertifika, dokümantasyon, OEM/Data Server kaydı. | Sole coordinator; issues membership credentials; holds top-level digital certificate. |
| **Data Server (DS)** | ENC’yi sıkıştırır/şifreler/imzalar; UserPermit’ten HW_ID çözer; Cell Permit üretir (HO / RENC / VAR). | Encrypts ENCs, issues cell permits to licensed users. |
| **OEM (Data Client system manufacturer)** | S-63’e uygun yazılım yazar; kendi **M_ID/M_KEY** alır; kurulum başına **HW_ID** üretir; UserPermit verir; hücre anahtarlarını HW_ID ile çözer. | Builds compliant app; self-validates with SA test data; receives unique M_ID/M_KEY per Usage Category. |
| **Data Client / end user** | OEM sistemini kullanan son kullanıcı; UserPermit’i Data Server’a vererek hücre lisansı alır. | End-user of OEM software who purchases licences with the UserPermit. |

**Usage Category (Ed 1.2.2):** SOLAS · Non-SOLAS (ECS, &lt;300 gt navigasyon) · Shore-based navigation support. IRBIS hedefi tipik olarak **Non-SOLAS / ECS** (ECDIS iddiası yok). Kategori başına ayrı M_ID/M_KEY çifti.

---

#### B) OEM ne alır; UserPermit / HW_ID (yüksek seviye)

**OEM must obtain from SA (yasal / legal):**
- **M_ID** — üretici kimliği (UserPermit’in son 4 karakteri; Data Server hangi M_KEY’i kullanacağını bundan bilir).
- **M_KEY** — üreticiye özel anahtar; **HW_ID’yi şifreleyerek UserPermit üretir** (OEM tarafı). Data Server listesinde tutulur; OEM M_KEY’ini güvende saklar (S-63 §10.10.3).

**HW_ID:** Her kurulum için OEM’in atadığı benzersiz donanım/kurulum kimliği (dongle / soft-lock). Son kullanıcıya düz metin olarak verilmez.

**UserPermit oluşturma (algoritma adımları — §4.2, §10.4):**
1. HW_ID al / ata  
2. **Blowfish** ile M_KEY kullanarak HW_ID’yi şifrele (§3.2.3)  
3. Şifreli HW_ID üzerinde **CRC32** hesapla ve ekle  
4. **M_ID** ekle → 28 ASCII karakter UserPermit (16 hex encrypted HW_ID + 8 hex CRC + 4 M_ID)

**Akış:** Kullanıcı UserPermit’i Data Server’a verir → DS, M_ID ile doğru M_KEY’i seçer → HW_ID’yi çözer → o HW_ID ile Cell Key’leri şifreleyip **PERMIT.TXT** (Cell Permit) basar → yalnız o kurulum açabilir (§4.1–4.3).

**Geliştirme notu:** IHO, pazar öncesi için S-64 / S-164 içindeki **generic M_ID/M_KEY** kullanılmasını önerir; nihai OEM kimlikleri genelde ürün piyasaya çıkmaya hazırken verilir. → [ENC Data Protection](https://iho.int/en/enc-data-protection)

---

#### C) Cell permit + hücre decrypt hattı (yalnız yayımlanmış adım adları)

Kaynak: **S-63 Ed 1.2.x** — OEM/Data Client süreçleri **§10**; şifreleme **§2–§5**.

**Data Server üretim (özet, §9.5 / §2–§5):** ZIP sıkıştır (§2) → Blowfish ENC şifrele, 40-bit Cell Key (§3) → DSA imza / sertifika zinciri (§5) → Cell Permit: Cell Key’leri HW_ID ile Blowfish (48-bit) (§4.3, §9.6).

**OEM / Data Client tüketim (§10) — adım adları:**

| # | Adım | Bölüm |
|---|------|--------|
| 1 | UserPermit oluştur | §10.4 |
| 2 | Cell Permit kurulum kontrolleri (var mı, format, HW_ID eşleşmesi, checksum, expiry, Data Server ID) | §10.5.1–10.5.6 |
| 3 | Kimlik doğrulama: SA sertifikası → Data Server sertifikası → ENC hücre imzası | §10.6 |
| 4 | Abonelik / permit uyarıları | §10.7.1 |
| 5 | Cell Permit içinden **Cell Key** çöz (HW_ID ile Blowfish) | §10.7.2 |
| 6 | Şifreli `.000` / update dosyasını Cell Key ile **Blowfish decrypt** | §10.7.3 |
| 7 | **ZIP decompress** → düz S-57 | §10.7.4 |
| 8 | (Ürün) SENC / bake — IRBIS’te mevcut plain S-57 hattına bağlanır | uygulama katmanı |

**Algoritma isimleri (standart):** Blowfish (ECB; padding §3.2.3) · ZIP (§2.2) · CRC32 · DSA / SHA-1 imza zinciri (§5). Uygulama ayrıntıları ve test vektörleri: S-63 Test Data + [Test Data Implementation Guide](https://iho.int/uploads/user/Services%20and%20Standards/ENC_ECDIS/data_protection/S-63_Test_Data_Implementation_Guide_v1.1.pdf) · S-64.

**S-57 / S-52 bağlamı (görüntü ≠ koruma):**
- **S-57** — ENC transfer / içerik standardı ([Standards in Force](https://iho.int/en/standards-in-force); [Standards & Specifications](https://iho.int/en/standards-and-specifications)).
- **S-52** — ECDIS görüntü / Presentation Library (renk, sembol, look-up). Tam Annex A ücretli; ECS için “tam S-52 parity” zorunlu değil. IRBIS: tile57 stil + MapLibre; ECDIS iddiası yok.

---

#### D) S-63 OEM nasıl olunur — How to apply

1. **Okuma:** [S-63 Ed 1.2.2 FINAL](https://iho.int/uploads/user/pubs/standards/s-63/S-63_Ed1.2.2_FINAL.pdf) · Annex B (Manufacturer Information Request).  
2. **Portal / formlar:** [IHO ENC Data Protection](https://iho.int/en/enc-data-protection) · [S-57 protection page](https://iho.int/en/enc-data-protection-s-57) — **OEM Request Form** + **OEM Agreement (Ver. 3.0.0)** (S-63 ve S-100 ortak).  
3. **Süreç (2024–26 güncellemesi):** IHO anlaşmaları ve Online Application Platform’u yeniliyor; bazı sayfalar “elektronik imza / hard copy artık gerekmez”, İngilizce ana sayfa hâlâ kağıt + Monaco adresi belirtiyor — **başvuru öncesi `info@iho.int` ile güncel prosedürü doğrula.** IHO Portal hesabı gerekir (DPA formu).  
4. **Geliştirme:** S-64 / S-164 **generic credentials** ile laboratuvar; self-verify (S-63 §1.2.4, §10.10.2).  
5. **Nihai M_ID/M_KEY:** Normalde ürün pazara hazırken; erken ihtiyaçta IHO ile görüş.  
6. **İletişim:** `info@iho.int` · +377 93 10 81 00 · IHO, 4b Quai Antoine 1er, B.P. 445, MC 98011 Monaco Cedex.  
7. **Kayıtlı OEM listesi (referans):** [portal.iho.int … S63_OEM](https://portal.iho.int/iho-ohi/stakeholders/S63_OEM.php)  
8. **Tipik gereksinimler:** Gizlilik / OEM Agreement · Usage Category beyanı · HW_ID güvenli üretimi ve kaydı (§10.10.4–10.10.5) · S-63/S-64 test uyumu · M_KEY güvenli saklama.

**ENC lisansı ayrıdır:** OEM olmak hücre satmaz. Kullanıcı (veya IRBIS üzerinden) Data Server / RENC’ten **IRBIS UserPermit’e basılmış** Cell Permit satın alır. Mevcut `vendor/permits` başka OEM HW_ID’sine basılmışsa IRBIS kendi M_KEY/HW_ID’si ile açamaz — Data Server’dan yeniden permit gerekir.

---

#### E) IRBIS’te ne var vs OEM sonra ne ekler

| Zaten var (plain / BYO) | OEM / S-63 modülü sonra |
|-------------------------|-------------------------|
| Electron + React + TS + Vite kabuk | Yasal **M_ID / M_KEY** (IHO) |
| tile57 bake → PMTiles + stil | Kurulum **HW_ID** + UserPermit UI |
| MapLibre offline çizim | PERMIT.TXT doğrulama (§10.5) |
| NOAA / müşteri **plain S-57** BYO | İmza zinciri (§10.6) |
| Chart Library `permitStatus: plain \| unsupported-s63` | Cell Key çöz → Blowfish → ZIP → **ephemeral** düz S-57 → mevcut bake hattı |
| S-63 örnek set yalnız meta / UX (decrypt yok) | S-64 test seti ile self-verify; Non-SOLAS Usage Category |
| NMEA / AIS Connect | (İsteğe bağlı) lisanslı üçüncü parti SDK — **DLL kopyası değil** |

**Faz tablosu:**

| Faz | Ne | Not |
|-----|----|-----|
| A | Plain S-57 + tile57 + MapLibre | Bake/quilt/SCAMIN/feature query derinleştir; BYO/NOAA |
| B | Chart Library ürünleştirme | Multi-root BYO; `.001+` update; permit **meta**; S-63 `unsupported-s63` |
| C | Resmi IHO OEM modülü (`packages/charts-oem-s63`) | Kendi HW_ID + IHO’dan M_KEY; ephemeral decrypt→tile57 bake; S-64 doğrulama; kalıcı plain ENC dump yok |
| D | S-100 (ileride) | Ayrı paket/track |

**Modül iskeleti (hedef):** `packages/charts` (tipler/policy/inventory) · `electron/chart/*` (bake/compose/query) · UI PickPanel/SCAMIN · OEM paketi yalnız Faz C.

**Açık kaynak notu:** OpenCPN vb. yalnızca mimari okuma; GPL kod Electron’a dikkatsiz gömülmez. GDAL = lab prototip, sessiz üretim motoru değil.

---

#### F) Kamu URL özeti — Public URLs

- ENC Data Protection (hub): https://iho.int/en/enc-data-protection  
- S-57 protection mirror: https://iho.int/en/enc-data-protection-s-57  
- S-63 Ed 1.2.2 PDF: https://iho.int/uploads/user/pubs/standards/s-63/S-63_Ed1.2.2_FINAL.pdf  
- Standards in Force (S-57 / S-52 / S-63 sürümleri): https://iho.int/en/standards-in-force  
- Standards & Specifications (indirme): https://iho.int/en/standards-and-specifications  
- S-63 Test Data Implementation Guide: https://iho.int/uploads/user/Services%20and%20Standards/ENC_ECDIS/data_protection/S-63_Test_Data_Implementation_Guide_v1.1.pdf  
- Registered S-63 OEMs: https://portal.iho.int/iho-ohi/stakeholders/S63_OEM.php  
- İletişim: info@iho.int

### 6.6 tile57 karar noktası (Faz 0)

Faz 0 kabul testleri başarısız olursa (bake yok, çizim anlamsız, Win x64 kırık):

1. Gap’ler yazılı listelenir.
2. **Karar toplantısı:** (A) tile57’ye devam + workaround, (B) SoundCharts/EncDotNet lab, (C) sınırlı GDAL prototip (üretim motoru değil).
3. Ana stack kararı bilinçli değişir; sessizce MBTiles’a düşülmez.

### 6.7 tile57 kabul checklist

- [x] Win x64 bake (gerçek `.000`) — NOAA lab yolu (`samples/enc-noaa`)
- [ ] `.001` / `.002` update doğru uygulanır
- [x] MapLibre zoom/pan/rotate, **offline**
- [x] Day / Dusk / Night
- [ ] LIGHTS / BOY / DEPARE sorgusu (kaynak indeksten) — **NEXT**
- [ ] Güvenlik konturu ayarı yansır
- [ ] SCAMIN / bilinen tile57 sınırları not edilir
- [ ] Kapsamasız alan işaretli
- [ ] S-63 → `unsupported-s63` (OEM öncesi; decrypt yok)

---

## 7. Connect hattı — SEAPIR referansı + genişletilmiş AIS

**Referans:** `SEAPIR/lib/data/datasources/nmea/`  
**SEAPIR’de doğrulanan:** UDP 10110, 0183, RMC, HDG/HDT/HDM, AIS 1–3, envelope, source-IP.  
**SEAPIR’de yok / IRBIS hedefi:** AIS 5, 18, 19, 24; kanal bazlı priority; dinamik ageMs UI.

### 7.1 Pipeline

```
UDP datagram
  → NmeaEnvelope { sourceIp, port, payload, timestamp }
  → checksum (geçersiz → sayaç + at)
  → route:
       $ → RMC, HDG/HDT/HDM, DPT/DBT, MWV…
       ! → AIS fragment buffer → tip 1,2,3,5,18,19,24
  → kanal priority
  → canonical bus (ageMs dinamik)
  → UI (~100 ms throttle) + STALE/lost
```

### 7.2 AIS kuralları

| Tip | Anlam | Faz |
|-----|--------|-----|
| 1–3 | Class A pozisyon | Faz 0–1 (SEAPIR’de var) |
| 5 | Statik / yolculuk | Faz 1 |
| 18–19 | Class B pozisyon | Faz 1 |
| 24 | Class B statik | Faz 1 |

- Çok parçalı birleştirme; timeout’ta yarım paket atılır.
- `lastSeen` + kayıp hedef: eşik aşımında `lost` / listeden soluk / alarm (sert alarm Faz 2).
- CPA/TCPA yalnız **taze** konum+hız ile; stale hedefte hesap yok veya “veri eski” (Faz 2 sertleştirme).

### 7.3 Teşhis

- Port / NIC, msg/s, checksum hata, son mesaj
- Ham satır (filtre, duraklat)
- Source IP keşfi + kanal priority UI
- **SİMÜLASYON** vs **CANLI** kesin ayrım (rozet + ayar; karışık besleme yok)

### 7.4 Simülasyon

Mock UDP `127.0.0.1:10110` (`tools/mock-nmea-sender`). Simülasyon kipinde gerçek socket’e yazma yok; gerçek kipte sim üretici kapalı.

---

## 8. Radar ve kamera (Faz 3)

### 8.1 Radar — NDATAREADER referansı

**Kaynak:** `NDATAREADER/src/radar/` · `RADAR_HALO_RESEARCH.md`  
Faz 3 başlamadan: multicast, spoke, komutlar ve **LICENSE** gerçek dosyadan doğrulanır; dokümandaki tablo iddia değil kanıt olur.

| Kanal | Adres | Port |
|-------|-------|------|
| Discovery | 236.6.7.5 | 6878 |
| Spokes | 236.6.7.8 | 6678 |
| Reports | 236.6.7.9 | 6679 |
| Commands | 236.6.7.10 | 6680 |
| Heading NKOE | 239.238.55.73 | 7527 |

- Bağımsız **native/child-process**
- Kablolu Ethernet zorunlu
- Heading kaybı / stale → overlay **otomatik durur** + sebep
- Unlock key varsayılmaz
- radar_pi GPL **kopyalanmaz**

### 8.2 Kamera

- FLIR / ONVIF / RTSP **radar paketinden bağımsız** child/adaptör
- Aynı IPC bus’a olay basar; radar çökmesi kamerayı düşürmez

---

## 9. Navigasyon ve alarm güvenliği

### 9.1 Faz ayrımı (çelişki giderildi)

| Özellik | MVP (Faz 1) | Faz 2 |
|---------|-------------|-------|
| MOB | Nokta + harita çerçeve + görsel uyarı | Kalıcı alarm, onay, geçmiş |
| Demir | Nokta + yarıçap çizimi + görsel uyarı | Histerezis, sesli/kalıcı alarm, “konum yok” |
| CPA/TCPA | İsteğe bağlı basit gösterim | Tazelik zorunlu; alarm kuralları |
| Veri kaybı | STALE rozeti | Güvenli durum + alarm |
| Replay | Ham log iskeleti | Black-box + olay replay |

### 9.2 Güvenli durum

| Kayıp | Davranış |
|-------|----------|
| GPS | OwnShip donar/ `--`; seyir ETA güvenilmez uyarısı; demir/MOB konum bağımlı uyarı |
| Heading | Pruva-yukarı ve radar overlay güvenli moda; COG ile heading **ikame edilmez** |
| ENC / kapsama yok | İleri bakış / güvenlik hesabı çalışmaz; “Harita yok – denetlenemedi” |
| Simülasyon | Tüm alarmlar SİM etiketli; gerçek alarm geçmişine karışmaz (Faz 2) |

---

## 10. UI bilgi mimarisi

**Hedef UX (ECDIS değil):** modern chartplotter — üstte telemetri şeridi, **üç küreli hub** navigasyon, harita birinci sınıf / map-first. Tip onaylı ECDIS görünümü veya iddiası yok.

| Ekran | MVP | Sonra |
|-------|-----|-------|
| Harita (büyük alan, map-first) | Evet | — |
| Veri çubuğu (SOG/COG/HDG ayrık, üst telemetri) | Evet | — |
| Üç küreli hub navigasyon | Evet (hedef) | — |
| Göstergeler | Evet | Grid |
| Seyir (WP/rota/iz/GPX) | Evet | ENC ileri bakış |
| Temel MOB / demir görsel | Evet | — |
| AIS listesi | Evet (1–3,5,18,19,24) | — |
| CPA/TCPA + kalıcı alarm | Temel / — | Faz 2 |
| Teşhis | Evet | — |
| Radar / Kamera | — | Faz 3 (ayrı) |
| Kara kutu | İskelet | Faz 2 |

---

## 11. Faz planı

### Faz 0 — Laboratuvar — S-57 önce · **DURUM: canlı (Ekim 2026)**

**İlk 10 gün (§15) büyük ölçüde tamamlandı.**  
**Kabul (lab):** Electron kabuk + NOAA plain S-57 bake + MapLibre offline + NMEA/AIS simülasyon yolu çalışıyor.  
**Yapılmayacak / yapılmadı:** Radar, S-63 decrypt, NSIS zorunluluğu, “MBTiles = başarı”, ECDIS iddiası.

### Faz 1 — MVP Chart + NMEA · **DONE vs NEXT (Ekim 2026)**

**DONE (lab / plain yol):**
- NMEA 0183 UDP + AIS (1–3 / 5 / 18 / 19 / 24), canonical bus, STALE / lost
- Chart Library BYO (klasör tara, hücre listesi, aktif hücre)
- MapLibre + tile57 (yalnız **plain** S-57; NOAA demo bake)
- Dünya basemap (ENC yerine geçmez)
- MOB / rota / WP / GPX iskeleti ve harita katmanları
- Day / Dusk / Night
- Ruflo MCP (opsiyonel geliştirme yardımcısı; ürün bağımlılığı değil)

**NEXT / TODO:**
- S-63 OEM / lisanslı SDK; `unsupported-s63` tespiti ve permit meta (decrypt yok)
- Kaynak ENC nesne sorgu indeksi
- SQLite kalıcılık
- Kanal bazlı kaynak önceliği (live seçici)
- Faz 2 kalıcı alarm / histerezis / CPA sertleştirme
- Faz 3 HALO radar

**Çıkış (kalan):**

- [x] Plain S-57 offline (NOAA lab yolu)
- [ ] S-63 hücreleri `unsupported-s63` (OEM öncesi; decrypt iddiası yok)
- [ ] MBTiles / basemap yalnız başına MVP sayılmaz (zaten politika)
- [ ] headingTrue / magnetic / COG ayrımı testli
- [ ] Performans: §14 ölçütleri
- [ ] SQLite + kanal priority + kaynak ENC query

### Faz 2 — Alarm, kayıt, paket (3–5 hafta) · **TODO**

- Kalıcı alarm, histerezis, geçmiş, veri kaybı
- CPA/TCPA tazelik kontrolü
- Black-box replay
- NSIS; saha 0183 gateway

### Faz 3 — Radar + (opsiyonel) kamera · **TODO**

- HALO child-process; overlay fail-safe
- Kamera ayrı adaptör
- Kaynak/lisans doğrulama kapısı

### Faz 4+

- S-63 OEM (kalıcı bake ancak lisanslı SDK sonrası; illegal decrypt yok)
- S-100 lab; motor/J1939; sonar görüntü; otopilot yazma

---

## 12. Modül kabul kriterleri

### Chart

- **Given** plain S-57 klasörü, **when** tara+bake, **then** hücre meta + offline çizim.
- **Given** `.001` update, **then** edition/updateNo ve görünüm tutarlı.
- **Given** bozuk hücre, **then** karantina; diğerleri çalışır.
- **Given** kapsamasız bölge, **then** açık “harita yok” işareti.
- **Given** S-63, **then** unsupported (MVP).
- **Given** nesne sorgu, **then** kaynak ENC indeksinden sınıf+hücre (tile geometrisinden uydurma yok).

### Connect

- **Given** RMC, **then** position/SOG/COG kanalları güncellenir; heading’e yazılmaz.
- **Given** HDT, **then** yalnız `headingTrue`.
- **Given** AIS 5/18/19/24, **then** ilgili alanlar dolar.
- **Given** checksum hata, **then** sayılır, state bozulmaz.
- **Given** iki GPS, **then** kanal priority tercih edileni seçer.
- **Given** ageMs > eşik, **then** STALE.

### Nav

- **Given** MVP MOB, **then** görsel + çerçeve (kalıcı alarm motoru şart değil).
- **Given** Faz 2 demir aşımı, **then** histerezisli alarm.
- **Given** stale AIS, **then** CPA hesaplanmaz veya “eski veri”.

### Radar (Faz 3)

- **Given** heading stale, **then** overlay durur.
- **Given** radar process çöker, **then** harita/UI ayakta.

---

## 13. Repo yapısı

```
IRBIS/
  apps/desktop/
  packages/
    core/       # envelope, units, ageMs, priority
    connect/    # udp, parsers, ais, simulator
    charts/     # library, bake, offline serve, source index
    radar/      # Faz 3 child
    camera/     # Faz 3 child (ayrı)
    ui/
  tools/
    mock-nmea-sender/
    bake-noaa.ps1 / chart-bake
  samples/enc-noaa/          # plain NOAA lab
  samples/chart-bake/        # PMTiles + stil (lab çıktısı)
  vendor/enc/2022_Hafta_17/         # S-63 TR operasyonel örnek (şifreli)
  vendor/permits/                # kullanıcı permit’leri
```

`Eski `LIB/SEAPIR` ve tam `NDATAREADER` ağaçları kaldırıldı; Navionics helper `vendor/navionics/` altında.

---

## 14. Doğrulama ve ölçülebilir performans

1. **Unit (Vitest):** checksum, AIS fragment, update zinciri meta, ageMs, priority, birim dönüşümü  
2. **Chart:** NOAA checklist §6.7  
3. **Replay:** kayıtlı NMEA → aynı OwnShip/AIS  
4. **Offline:** NIC kapalı / hosts engelli iken harita+stil açılır  
5. **Perf (ölçülür, iddia edilmez):**
   - Geliştirme PC sınıfı not edilir (CPU/GPU/RAM)
   - Hedef: harita + OwnShip + ≥20 AIS iken **p95 kare ≤ 33 ms** (≈30 FPS) veya gerekçeli sapma raporu
   - Bake süresi hücre başına loglanır
6. **Referans kod:** Faz 3 öncesi NDATAREADER LICENSE + protokol satır doğrulama  
7. **Saha:** gerçek 0183 gateway; sonra HALO Ethernet

---

## 15. Faz 0 — İlk 10 gün (revize)

| Gün | Hedef |
|-----|--------|
| **1–2** | Electron/React/TS/Vite iskeleti + seyir uyarısı; **tile57 Windows x64 testi** (kurulum/build) |
| **3–4** | Gerçek **NOAA S-57 `.000` bake** + MapLibre render; offline PMTiles/stil; `.001` denemesi |
| **5–6** | NMEA UDP 10110, GNSS (RMC), heading (HDT/HDG); envelope + ageMs; instruments |
| **7–8** | AIS (1–3 + fragment; 5/18/19/24 iskelet), kanal kaynak yönetimi, simülasyon rozeti |
| **9** | Chart Library (klasör, hücre listesi), offline doğrulama, Day/Dusk/Night |
| **10** | Entegre demo; nesne sorgu; performans + hata notları; tile57 karar noktası gerekiyorsa tetik |

**Faz 0 kabul:** Gerçek S-57 açılır · nesneler sorgulanır · GPS/AIS simülasyonu görünür · internetsiz çalışır.

---

## 16. Riskler

| Risk | Mitigasyon |
|------|------------|
| tile57 yetersiz | §6.6 karar noktası; sessiz MBTiles’a düşme yok |
| Render≠nav karışması | Çift katman zorunlu |
| AIS eksik tip | 5/18/19/24 Faz 1 kapsamı; SEAPIR’de yok diye “bitti” denmez |
| Stale ile yanlış alarm | ageMs + CPA tazelik |
| S-63 illegal bake | Kalıcı PMTiles yok (lisanslı SDK öncesi) |
| Üçüncü parti lisans | Üretim öncesi LICENSE taraması |
| Radar WiFi | Ethernet zorunlu |
| GPL radar_pi | Kopyalama yok |
| ECDIS algısı | Uyarı metni + pazarlama kontrolü |

---

## 17. Açık / bilinçli ertelemeler

- S-63 OEM / Türkiye ENC ticari anlaşma (örnek set `vendor/enc/2022_Hafta_17` + `vendor/permits` — yalnızca unsupported meta)
- Kaynak ENC query indeksi; SQLite; kanal priority (Faz 1 kalan)
- TCP/seri NMEA
- Native N2K PGN
- Signal K Server zorunluluğu
- Soft ARPA
- Tam S-52 parity
- EN dil; macOS/Linux

---

## 18. Kaynak dosyalar

| Dosya | Kullanım |
|-------|----------|
| `IRBIS_Teknik_Fizibilite_Raporu.pdf` | Mimari |
| `Teknik araştırma ve ürün mimarisi raporu.md` | Açık kaynak |
| `HeyCaptain-Bridge-Kilavuz-TR.pdf` | BYO / UX |
| `SEAPIR/` | NMEA (doğrulanmış kapsam §2) |
| `NDATAREADER/` | Radar (Faz 3 doğrulama) |
| `iyileştirme.md` | Bu revizyonun talimatı |
| `chatgpt ye yazdığım yaz.txt` | Vizyon |

---

## 19. Sonuç

**Stack aynı:** Electron + React + TS + Vite + tile57 + MapLibre + Node + SQLite.  
**Durum (Ekim 2026):** Faz 0 lab kabuğu canlı; NOAA plain demo yolu çalışıyor; NMEA/AIS + Chart Library BYO + MapLibre (plain) + basemap + MOB/rota/GPX + Day/Dusk/Night hazır.  
**Sıradaki:** S-63 `unsupported-s63` tespiti (OEM öncesi; **decrypt yok**), kaynak ENC query indeksi, SQLite, kanal priority → Faz 2 alarm → Faz 3 HALO.  
**Veri:** `samples/enc-noaa` (lab) · `vendor/enc/2022_Hafta_17` (S-63 TR örnek) · `vendor/permits` (permit).  
**UX:** modern chartplotter (telemetri üstte, üç küreli hub, map-first) — ECDIS değil.  
**Politika:** BYO + NOAA sergi; lisanslı SDK olmadan S-63 kalıcı PMTiles / illegal decrypt yok.

Sonraki ürün adımı: **Faz 1 kalan TODO’lar (S-63 işaretleme, ENC query, SQLite, priority)** — S-63 decrypt “tamamlandı” sayılmaz.
