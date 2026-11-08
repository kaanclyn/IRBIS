# IRBIS × Nautilus — YAPILANLAR

**Tarih:** 5 Kasım 2026 ~23:55  
**ChatGPT brifing (yapıştır):** `../nautilus/09-chatgpt-brifing-tile-zoom.md`  
**Tasarım:** `../nautilus/08-tile-engine-tasarim.md`

---

## 0. Özet

Persistent C++ doğru. Görüntüleme = **256² equirectangular karo** (Navionics klasör fikri, Kernel projeksiyonuna uygun ızgara).

| Aşama | Sonuç |
|-------|--------|
| Tek PNG + LIVE mid-pan | Sıçrama → kapatıldı |
| Overscan×2 (geo×2 / px×1.35) | Gerilmiş + pahalı MISS → **UI terk** |
| Mercator XYZ karo | Patchwork / kıyı kırığı → **terk** |
| Equirectangular 256 + exactSize | ✅ pan HIT / skip |
| Zoom settle z hesabı | ✅ scale reset’ten **önce** nextZ |

**Cache:** `%APPDATA%\@irbis\desktop\nautilus-frame-cache\`  
**Navionics ref:** `Documents/NDataReader/bizim-harita/navionics/{z}/{x}/{y}.png` @ 256

---

## 1. Neden Navionics gibi değildi?

| Navionics | Biz (eski) |
|-----------|------------|
| `{z}/{x}/{y}` 256 bake | Tek full PNG / yanlış ızgara |
| Kaydırınca karo kayar | Settle’da tüm kare değişir |
| Zoom = LOD karo | CSS scale sonra yanlış z |

---

## 2. Denemeler → karar

| # | Denenen | Karar |
|---|---------|--------|
| A–N | PrintChart, LIVE, dual-buffer, cache v1–v3 | Persistent + cache kalsın |
| O | Overscan×2 | Denendi → UI terk |
| P | Mercator tile | Patchwork → equirectangular |
| Q | 256 exact + noNear + tek kuyruk | ✅ (CodeMeter 212 kesildi) |
| R | Zoom: nextZ before cam reset | ✅ az önce |

---

## 3. Overscan → terk (UI)

Gerilmiş görüntü + settle MISS zinciri. Bridge’te yedek API; viewport karo.

---

## 4. Tile engine ✅

- `nautilusTiles.ts` — lon/lat derece ızgarası (Kernel uyumlu)  
- `ensureTile` 256 · `exactBBox` · `noPrintFallback` · concurrency **1**  
- Log: `TILE DRAW 256² … z14/x/y` · `TILE skip` · settle HIT  
- Zoom LOD fade / disk `{cell}/{z}/{x}/{y}` / metatile: **kalan**

---

## 5. Son log

**İyi (z14 pan):**
```
TILE DRAW 256² z14/…  (28 karo fit)
TILES hit=28 miss=0 · settle / TILE skip
CodeMeter 212 yok
```

**Kötü (zoom 20:59 — `irbis-main.log`):**
```
settle-zoom→z18 n=88 hit=0 miss=88   ← donma
hit≈299 miss≈229 · renderer exit null
```
Ekran: aynı “Mickleth Firth Sound” + ikon her 256 karoda (S-52 per-tile label).

---

## 6. ChatGPT P0 scheduler ✅

- `loadGen++` · merkez önce · softMaxZ=16 tile-only · noop  

## 7. Anlık zoom (Navionics hissi) ✅ 6 Kas ~00:20

Wheel CSS + rematch keep (ilk tur).

## 8. Zoom LOD kalıcı fix ✅ 6 Kas ~00:28

RENDER_MAX_Z=18 · rematch snap yok · parent LOD 2×

## 9. Tile engine P0 (FIX.md) ✅ 6 Kas ~00:41

requestRev stale guard (ilk tur).

## 10. Zoom P0 kalıcı (active/pending) ✅ kod 6 Kas ~00:55

`nautilus/10-zoom-p0-rapor.md`

## 11. Tek sütun şerit P0 ✅ kod 6 Kas ~01:15

`nautilus/11-tek-sutun-strip-p0.md` (tile yolu; sonra askıya alındı)

## 12. Tile askıda → full-frame C++ PNG ✅ 8 Kas

- `NautilusViewport` → 317325e full-frame model (CSS pan/zoom + settle PNG)
- `overscan: false` · `ensureTile` warn + askıda
- Cache silindi · not: `nautilus/12-tile-askida-fullframe-png.md`
