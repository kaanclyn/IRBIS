# D3 — Yüksek performanslı render yolu (değerlendirme)

**Tarih:** 2026-11-05  
**SDK:** Nautilus 1.10.2.4 · IRBIS Electron/React

## Karar (şimdilik)

**Üretim yolu D2:** PrintChart / Cairo offscreen → PNG → yerel HTTP → React `<img>` + SVG overlay.  
**D3 (Vulkan HWND / shared texture):** ertele — Electron/Chromium ile GPU texture paylaşımı üretici referansı yok; ayrı prototip gerekir.

## SDK’da görülen seçenekler

| Yol | Kaynak | Electron’a taşıma | Not |
|---|---|---|---|
| Cairo / Qt offscreen PNG | `PrintChart`, `EnCairoPainterTarget` | Kolay (dosya/buffer) | D1/D2 PoC — çalışıyor |
| OpenGL offscreen | `EnGLOffscreenTarget` | Buffer kopyası | PNG’den biraz daha hızlı olabilir; hâlâ kopya |
| Vulkan offscreen | `EnVkOffscreenTarget`, `VulkanTest` | Buffer kopyası | Aynı IPC modeli |
| Qt `EnChartWidget` | ChartViewer / PickReport | Ayrı native pencere | Pan/zoom/pick native; UI Qt |
| Vulkan surface / HWND child | Widgets adapters | Embed zor | Chromium compositing + HWND yaşam döngüsü riskli |
| Shared `VkImage` → WebGL | Dokümantasyon | **Varsayılmamalı** | Device/context/sync ayrı PoC |

## Neden D2’de kalıyoruz

1. SevenCs’in resmi Electron/React mimarisi yok.
2. IRBIS UI React’te kalmalı; Qt ChartViewer yalnızca SDK doğrulama.
3. PNG + disk cache + viewport IPC pan/zoom ve geo/ENC pick için yeterli iskelet.
4. AIS/GNSS/radar overlay React katmanında zaten bağlandı (ürün sensör verisi).

## Sonraki D3 tetikleyicileri

- Pan/zoom’da sürekli yeniden render gecikmesi ölçülüp kabul edilemezse
- ≥15–30 FPS sürekli hareket ihtiyacı
- Native ENC pick/overlay’in SDK widget’ına taşınması zorunluysa

O zaman sırayla: (1) uzun ömürlü native process + shared memory frame, (2) HWND embed denemesi, (3) ancak sonra Vulkan external image.

## Doğrulanan SDK örnekleri (C)

- `ChartViewer.exe` — pan/zoom widget
- `PickReport.exe` — sağ tık feature pick
- `AISOverlay.exe` — AIS simülasyon overlay (SDK tarafı)
- `PickChart.exe` (IRBIS) — headless `GetPickReport` → JSON
