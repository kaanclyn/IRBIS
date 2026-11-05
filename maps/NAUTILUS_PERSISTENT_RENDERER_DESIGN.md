# Persistent Nautilus Renderer — Tasarım (05.11.2026)

## Belge doğrulaması: `IRBIS_NAUTILUS_CURSOR_HANDOFF_UPDATED.md`

**Sonuç: Evet — kök neden ve yön doğru.** Küçük nüanslar aşağıda.

| İddia | Doğruluk |
|---|---|
| Yavaşlık = her viewport’ta `PrintChart.exe` yeniden init/ENC/Cairo | ✅ Kanıtlı (~3–5 sn CACHE MISS) |
| SevenCs Kernel = C++/C# native; resmi Electron mimarisi yok | ✅ Üretici Q&A + SDK örnekleri |
| ChartViewer = bellekte widget + `SetViewPort` + sürekli repaint (60 Hz hedef) | ✅ `enmainwindow.cpp` / `EnChartWidget` |
| PrintChart PoC doğrulama için OK, üretim motoru değil | ✅ |
| ChartServer şart değil; alternatif Web/OGC ürünü | ✅ |
| Kalıcı C++ süreç + IPC = bizim mühendislik tercihi (SevenCs “Electron şunu yap” demedi) | ✅ Belge bunu doğru ayırıyor (0B) |
| “Electron/Node’a çevirmek hata” | ⚠️ Nüans: UI Electron kalabilir. Hata olan **Kernel’i Node’da yeniden başlatmak**. UI≠render motoru. |

**Özet cümle (ChatGPT / ekip):**  
IRBIS UI Electron+React kalır; ENC motoru SevenCs’in tasarladığı gibi **uzun ömürlü native C++ süreçte** yaşamalı. `PrintChart` spawn zinciri PoC’dir, chartplotter değildir.

## SDK kanıtı (uydurma API yok)

- `EnChartDisplay` — `PrintChart` / `PickChart`: init → load → `GetViewPort`/`SetViewPort` → `Draw` → PNG.
- `EnChartWidget` — `ChartViewer`: aynı Kernel; Qt widget + `SetTargetFPS(60)` + `sigViewportChanged`.
- Headless kalıcı servis için **ilk hedef `EnChartDisplay` + Cairo/GL offscreen** (Qt penceresiz). ChartViewer yaşam döngüsünü taklit ederiz, UI’yi Qt’ye taşımayız.

## Hedef mimari

```
React NautilusViewport
  → preload IPC
  → Electron main (tek child process yönetir)
  → nautilus-renderer.exe  [kalıcı]
       EnKernel::Init (1×)
       EnChartDisplay + ENC load (hücre değişene kadar)
       stdin JSON: setViewport | render | pick | loadCell | quit
       stdout JSON: {ok, requestId, pngPath|bytes, viewport, ms}
```

## IPC sözleşme (uygulama adı — SDK değil)

```json
{"cmd":"loadCell","requestId":1,"path":"...GB4X0000.000"}
{"cmd":"setViewport","requestId":2,"north":..,"south":..,"west":..,"east":..,"width":1600,"height":1000,"dpi":96}
{"cmd":"render","requestId":3}
{"cmd":"pick","requestId":4,"x":100,"y":200,"radius":12}
{"cmd":"quit"}
```

## Fazlar

1. **P1** — `native/nautilus-renderer` CMake exe; stdin loop; tek hücre; Cairo PNG dosyası.  
2. **P2** — `nautilusBridge` feature flag `persistent-native`; PrintChart fallback.  
3. **P3** — requestId/revision; stale frame yok; benchmark MD.  
4. **P4** — GL/Vulkan offscreen; isteğe bağlı HWND (ayrı PoC).

## Ölçüm (05.11.2026 smoke — GB5X01NE 1280×720 Cairo)

| Metrik | PrintChart (önceki) | Persistent `nautilus-renderer` |
|---|---|---|
| Kernel+ENC+1. Draw | ~3–5 sn / spawn | **2216 ms** (tek süreçte ilk `render`) |
| 2. Draw (aynı süreç, yeni viewport) | yine ~3–5 sn spawn | **405 ms** |
| Disk CACHE HIT | ~anında | aynı (bridge cache korunuyor) |

Kanıt: `native/nautilus-renderer/smoke/frame1.png` + `frame2.png`. Electron: `IRBIS_NAUTILUS_MODE=persistent` (exe varsa varsayılan); `printchart` ile eski yol.

## Korunacaklar

Navionics motoru, PrintChart fallback, AIS React overlay, CodeMeter, SDK binary commit yok.
