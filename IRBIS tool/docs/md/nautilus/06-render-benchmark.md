# Nautilus render benchmark (+ cache v4 akıcılık)

**Tarih:** 5 Kasım 2026  
**Hücre:** GB5X01SW · 1920×1024 · persistent Cairo  
**Kural:** Persistent kalsın; pan = CSS only (LIVE mid-pan yok).

## Önceki smoke

| Senaryo | Süre |
|---------|------|
| Persistent 2. frame | ~405 ms |
| PrintChart spawn | ~3–5 s |
| MISS draw (ısınmış) | ~120–280 ms |
| HIT | draw=NO · rewrite=NO |

## v3 oturum notu (LIVE açıktı — sıçrama)

- Index ~416 · hit≈31 · miss≈44  
- Pan’da `CACHE LIVE [EXACT]` A↔B → **sıçrama** (v4’te kapatıldı)

## v4 beklenen

| Senaryo | Beklenen |
|---------|----------|
| Pan sürükleme | Log’da LIVE yok; harita CSS ile kayar |
| Settle aynı yer | HIT EXACT · fade · 0 draw |
| Yeni yer | MISS DRAW ~150–400 ms · fade |
| Prefetch sonrası komşu | HIT veya hızlı MISS |

## 20 hareket (doldur)

| # | Hareket | HIT/MISS | wall ms | drawMs | atlama? |
|---|---------|----------|---------|--------|---------|
| 1–20 | | | | | |

**Özet:** HIT=__/20 · ort. MISS ms=__ · pan sıçrama var mı? __
