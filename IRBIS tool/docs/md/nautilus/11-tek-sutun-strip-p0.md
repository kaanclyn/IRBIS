# P0 — Tek sütun (~215px) şerit — 6 Kas 2026

## Belirti

z18, 54 karo, `coverage=1.00`, `LOD_COMMIT` OK, `cssScale=0.841` → ekranda **yalnız ~215px dikey şerit** (1 karo genişliği), geri kalan siyah.

Kamera örneği: `centerLon=60.94733 centerLat=-32.49655 zoomFloat=17.750 renderedZ=18`.

## Analiz

| Hipotez | Sonuç |
|---------|--------|
| PNG tamamen şeffaf | **Hayır** — unfilter sonrası alpha=255, RGB dolu (ör. deniz rengi) |
| `coverage=1` yalan | İstek tamamlanması doğru; **layout/görünür sütun** ayrı ölçülmüyordu |
| CSS overflow/clip | Stage `overflow:hidden` normal; asıl sorun konum |
| Absolute `left: x*256` @ z18 | `x≈175452 → ~4.5e7 px`. GPU **float32** ara değerlerinde sütun X’leri çöküyor → tek şerit |

Doğrulama (simülasyon): absolute float32 benzersiz X sayısı çöker; göreli origin ile 9 sütun korunur.

## Düzeltme

1. **Göreli tile origin:** `left/top = (t.x - originX) * 256` (merkeze göre, ±birkaç karo).
2. **Coverage ayrımı:** `coverageRequest` / `coverageLayout` / `coverageEnc`.
3. **LOD_COMMIT:** layout self-test (`relCols ≈ expectCols`); layout bozuksa commit yok.
4. **Debug:** chrome’da Debug → kırmızı çerçeve + `z/x/y` + `LAYOUT_AUDIT` / `TILE_RECT` log.

## Test (kullanıcı)

1. Yeniden başlat; aynı hücrede z18’e zoom.
2. Debug aç → 9 ayrı kırmızı sütun görünmeli.
3. Log: `uniqueX≈9`, `absF32Cols` düşük kalabilir (eski yol teşhisi).
4. Şerit yerine tam mozaik.

**Metatile / label:** yapılmadı (P0 bitmeden yok).

**ChartViewer A/B:** bu oturumda çalıştırılmadı; PNG unfilter + float simülasyonu ile kök neden bağlandı.
