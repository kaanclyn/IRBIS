> **Konum:** `IRBIS tool/docs/md/nautilus/` — runtime PoC: `maps/`

---
# IRBIS × Nautilus — Chart Günlüğü / Check List

> Adım adım çalışma günlüğü.  
> SDK kök: `K:\SevenCs\Nautilus\1.10.2.4`  
> Başlangıç: 5 Kasım 2026 · Son güncelleme: 5 Kasım 2026 (akşam)

---

## Durum panosu

| # | Adım | Durum | Not |
|---|---|---|---|
| 0 | Handoff + SDK keşfi | ✅ | `IRBIS_NAUTILUS_CURSOR_HANDOFF.md` |
| 1 | CheckRegistration derleme | ✅ | Release OK |
| 2 | Lisans smoke (Development) | ✅ | `CheckDevLicense` SUCCESS |
| 2b | CheckRegistration Production | ⚠️ | Eval → production reddi (beklenen) |
| 3a | Qt 5.15.2 MSVC64 | ✅ | `C:\Qt\5.15.2\msvc2019_64` |
| 3b | PrintChart + ENC PNG | ✅ | GB5X01NE Cairo |
| 4 | ChartViewer | ✅ | Qt pan/zoom |
| 5 | PickReport | ✅ | Qt + `maps/poc/PickChart` JSON |
| 5b | AISOverlay (SDK örneği) | ✅ | derlendi |
| 6 | Electron D1: Navionics↔Nautilus | ✅ | feature flag + PNG sunucu |
| 7 | D2 viewport IPC | ✅ | setViewport / pick |
| 8 | E: AIS/GNSS/radar overlay | ✅ | React üst katman (ENC’den değil) |
| 9 | D3 Vulkan/HWND | ⏸ | `NAUTILUS_D3_RENDER_PATH.md` |
| 10 | Ürün checklist | ✅ | `NAUTILUS_PRODUCT_INTEGRATION_CHECKLIST.md` |
| 11 | Full-bleed viewport | ✅ | sahneyi doldurur |
| 12 | z/x/y karo disk cache | ❌ kaldırıldı | live SetViewPort frame |
| 13 | Doğrusal zoom hissi | ✅ | CSS preview → settle redraw |
| 14 | ChartServer / gerçek tile motoru | ❌ | teslim edilmedi |
| 15 | Handoff v2 doğrulama (C++ vs spawn) | ✅ | `IRBIS_NAUTILUS_CURSOR_HANDOFF_UPDATED.md` doğru |
| 16 | Persistent C++ renderer | ✅ | `native/nautilus-renderer` · 2. frame **405 ms** |
| 17 | Electron persistent flag | ✅ | `nautilusBridge` · PrintChart fallback |

---

## Yapılanlar (özet — bu oturumlar)

### SDK / lisans
- Nautilus 1.10.2.4 `K:\SevenCs\...` doğrulandı; CodeMeter Development init OK.
- PrintChart, ChartViewer, PickReport, AISOverlay Release derlendi.
- IRBIS `PickChart` headless pick → JSON (GetPickReport).

### Electron entegrasyonu
- `nautilusBridge.cjs`: ENC listesi (testdata), PrintChart spawn, yerel HTTP PNG (`:18768`).
- `mapEngineStore`: `navionics` | `nautilus` persist.
- Ayarlar → Seyir: kaynak seçimi + hücre listesi.
- `NautilusViewport`: full-bleed ENC, pan/zoom, pick, AIS/own-ship overlay.
- Disk cache dizini: `%AppData%\Roaming\@irbis\desktop\nautilus-cache\tiles\`
- Karo anahtarı örn: `GB4X0000_z1_x1_y1_1600x1000.png`
- PrintChart sıraya alındı (CodeMeter Error 212 / max users önlemi).
- Log’da `CACHE HIT` / `CACHE MISS` görülüyor (HIT doğrulandı).

### Mimari gerçek (önemli)
- **Navionics:** önceden üretilmiş binlerce küçük karo (TMS/XYZ), GPU’da birleştirme → anında pan/zoom.
- **Eski PoC:** Her yeni karo = `PrintChart.exe` spawn (~3–5 sn).
- **Şimdi (P1):** `native/nautilus-renderer.exe` kalıcı süreç — Kernel/ENC bir kez; `setViewport`+`Draw` → PNG. Smoke: 1. frame 2216 ms, 2. frame **405 ms**.
- Electron UI aynı; bridge `persistent` mod (varsayılan exe varsa) + PrintChart fallback.
- ChartServer hâlâ yok / zorunlu değil. Sonraki: GL/Vulkan, prefetch, benchmark MD.

---

## İstenen ama TAM OLMAYAN / sorunlu şeyler

Bunları ChatGPT / SevenCs / ekibe yapıştırmak için:

### 1) “Neden her seferinde cache açılıyor / yavaş?”
- **İlk ziyaret edilen her z/x/y karo** zorunlu CACHE MISS → PrintChart ~3–5 sn. Bu Navionics’te önceden bake edilmiş karo; bizde anlık çizim.
- Aynı karoya **geri dönüşte** log’da `CACHE HIT` var (çalışıyor). Kullanıcı hissi: settle her seferinde “karo…” yazısı + bazen gereksiz fit/yeniden yükleme.
- Açılışta bir süre **çift çizim** vardı (hash key + z0); düzeltilmeye çalışıldı — tek PrintChart + z0’a kopya.
- Pencere boyutu kovası değişince (`1280` vs `1600x1000`) **yeni cache anahtarı** → yine MISS.

### 2) “Navionics gibi adım adım karolar açılmıyor”
- Navionics: ekranda **birden fazla küçük karo** yan yana, zoom seviyesinde pyramid, komşu karolar prefetch.
- Bizde: ekranı dolduran **tek büyük PNG karo** (z seviyesinde grid hücresi). Komşu karolar arka planda prefetch **yok**.
- Zoom: CSS ile doğrusal hissedilir; bırakınca tek karoya snap. Ara seviyelerde Navionics’teki gibi sürekli karo akışı yok.

### 3) “Neden daha hızlı çizilmiyor?”
- PrintChart her seferinde: Kernel init + ENC yükle + Cairo offscreen + PNG yaz + process çıkış. Bellekte tutulan `EnChartDisplay` yok.
- Gerçek hız için seçenekler:
  1. **Nautilus ChartServer** (üretici web/tile ürünü) — henüz alınmadı.
  2. **Uzun ömürlü native C++ süreç** (ChartViewer modeli): SetViewPort + Draw → shared memory/PNG pipe; process her frame’de yeniden açılmaz.
  3. **Önceden bake**: hücre için z0…zN tüm karoları offline üret (TMS ChartServer / kendi batch) → Navionics benzeri anında okuma.

### 4) Diğer eksikler
- [ ] Kullanıcı ENC yükleme / S-63 permit UI
- [ ] Chart Installer entegrasyonu
- [ ] Native HWND/Vulkan Electron gömme (D3)
- [ ] Nautilus palet gün/gece IPC
- [ ] Prefetch komşu karolar (z, tx±1, ty±1)
- [ ] Boyut kovası değişince eski karoyu ölçekleyip gösterme (MISS’i gizle)
- [ ] AISOverlay SDK native’e sensör bağlama (şimdi React)
- [ ] Türkiye ENC / own-ship bölgesi ile testdata GB hücreleri örtüşmeyebilir

---

## ChatGPT’ye yapıştırılacak metin (kopyala)

```text
Bağlam: IRBIS, Electron + React chartplotter. Harita motoru olarak Teledyne SevenCs Nautilus ECDIS Kernel SDK 1.10.2.4 (Windows) entegre ediyoruz. ChartServer YOK; sadece Kernel + PrintChart CLI.

Mevcut PoC:
- Electron main PrintChart.exe spawn ederek ENC’yi Cairo PNG çiziyor.
- PNG’ler disk cache: %AppData%\@irbis\desktop\nautilus-cache\tiles\
- Anahtar formatı: CELL_z{Z}_x{TX}_y{TY}_{W}x{H}.png (Navionics XYZ’ye benzer ama tek büyük karo).
- UI: pan/zoom önce CSS (doğrusal his), bırakınca bakış en yakın z/x/y karosuna snap; cache hit ise PNG diskten, miss ise PrintChart ~3–5 sn.
- Log örneği: ilk z1 MISS 3483ms; sonra aynı z1 HIT; fit z0 HIT. Yani cache çalışıyor ama ilk ziyaret yavaş.
- Sorun hissedilenler:
  1) Kullanıcı Navionics gibi “adım adım küçük karoların hızla açılmasını” istiyor; bizde tek büyük karo + ilk sefer PrintChart.
  2) Zoom Navionics kadar akıcı/sürekli karo geçişli değil (CSS + settle snap).
  3) Her yeni bakış/zoom seviyesi ilk seferinde saniyeler sürüyor; kullanıcı kabul etmez.
  4) Açılışta bazen çift render (fit keşfi + z0) görüldü.

SevenCs tarafı: Web için Nautilus ChartServer (WMS/OGC Tiles) öneriliyor. Kernel’de doğru yol uzun ömürlü EnChartDisplay + SetViewPort/Draw (Qt ChartViewer örneği). Electron için resmi referans mimari yok.

Soru: Bu kısıtlarla (sadece Kernel, Electron, PrintChart veya native bridge) Navionics benzeri hızlı tile pan/zoom için en doğru mimari nedir? ChartServer şart mı? Yoksa persistent C++ render process + tile bake + prefetch yeterli mi? Adım adım öner.
```

---

## Günlük notlar

### 2026-11-05 — performans / cache turu
- Şikayet: yavaş çizim, zoom doğrusal değil, geri dönüşte yeniden çiziyormuş gibi.
- Yapılan: CSS-first zoom; settle → z/x/y karo; disk tiles/; serialize PrintChart; CACHE HIT log kanıtı.
- Kalan: prefetch yok; ChartServer yok; native persistent renderer yok; ilk karo hâlâ ~3–5 sn.
- Açılış çift MISS (hash + z0): ensureFit tek çizim + z0 kopya ile giderildi.
