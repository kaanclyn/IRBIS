# Nautilus Zoom/Tile P0 rapor — 6 Kas 2026 ~00:55

## Teşhis (log `irbis-main.log` ~21:44–21:45)

| Bulgu | Etki |
|--------|------|
| Wheel her seferinde `requestRev++` → `SCHED cancel` + `LOD_COMMIT blocked` | Gerekli z17/z18 yükü yarıda kesiliyor; zoom “takılı” hissediliyor |
| `publishTiles(z \|\| z-1)` aynı yüzeyde | Çift obje / bölünmüş görüntü |
| `maxTiles` (16/24) + `centerReady` ile commit | Kenarlar boş → siyah ekran |
| `cameraRevision` = tile iptal anahtarı | Spesifikasyona aykırı |

## Yapılan kod (P0)

**Dosyalar:** `NautilusViewport.tsx`, `nautilusTiles.ts`, `styles.css`

1. **Kamera:** `zoomFloat` otorite; `renderedZ` / `targetZ`; `cssScale = 2^(zf−rz)`; wheel anında CSS.
2. **Kuyruk ayrımı:** `cameraRevision` yalnız telemetri. Tile iptali yalnız **farklı `lodJob` (targetZ/merkez)** ile.
3. **Active layer:** Ekranda **tek Z**. Pending hazır + `visibleCoverage ≥ 0.92` olmadan commit yok; eski LOD CSS ile kalır.
4. **`maxTiles` kaldırıldı** — görünür set tam yüklenir.
5. **Grid check:** `assertEquirectGrid` (kenar birleşimi, lon/lat roundtrip, parent/child). Fit’te `GRID_CHECK` log.
6. **Pick:** `pickLat/pickLon` + `cursorLat/cursorLon` ayrı — sıra karışıklığı ayırt edilir.
7. **Metatile (P1):** yapılmadı.

## Test durumu

| Senaryo | Durum |
|---------|--------|
| Kod derleme / HMR | Uygulandı; agent canlı UI testi yapmadı |
| 10× in / 10× out | **Kullanıcı doğrulamalı** |
| Siyah ekran / çift görüntü | Beklenen düzelme; **görsel doğrulama şart** |
| `GRID_CHECK ok=true` | Runtime log’da doğrulanacak |
| Etiket tekrarı (S-52) | **Açık** — metatile P1 |
| Cache soğuk/sıcak | Test edilmedi |

## Kalan gerçek sorunlar

- S-52 isim/sembol tekrarı → metatile (P1), zoom P0 geçmeden başlanmayacak.
- Coverage defer sonrası otomatik retry zayıf (sonraki settle’a bağlı).
- Yüksek z’de tam görünür set yavaş olabilir (concurrency=1, CodeMeter koruması).

## Log’da aranacaklar

```
GRID_CHECK ok=true
CAMERA event=wheel … (her tekerlek)
LOD_COMMIT … coverage=0.9x
SCHED cancel … cancelReason=lod-superseded   ← cameraRev yüzünden olmamalı
pendingLayer keep …                         ← siyah yerine eski LOD
```
