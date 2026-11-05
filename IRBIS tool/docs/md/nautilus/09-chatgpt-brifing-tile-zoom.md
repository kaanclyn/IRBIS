# IRBIS × Nautilus — ChatGPT brifing (yapıştır)

**Tarih:** 6 Kasım 2026 ~00:10  
**ChatGPT cevabı işlendi:** önce scheduler (P0), sonra metatile (P0).  
**Scheduler kodda ✅** · metatile sırada · `07` MD güncellendi.

---

## ChatGPT’ye yapıştır (güncel)

```text
ChatGPT sıran uygulandı (kısmi):

P0 Zoom + stale LOD ✅ (FIX.md / log 213642)
  - Bug: SCHED cancel → yine ZOOM lod-swap (geri zıplama)
  - Fix: requestRev, await sonrası guard, zoomFloat otorite,
    LOD_COMMIT atomik (centerReady), cssScale=2^(zf−rz)
  - C++ dokunulmadı · metatile sonra

P0 Metatile 🔄 zoom kabul testinden sonra

P1 LOD + dikiş testi · P2 disk/prefetch/benchmark

Kernel hâlâ hızlı (medyan ~13ms); sorun 88×serial zoom yağmuru + S-52 per-tile label.
Vulkan/HWND erteli. Persistent C++ aynı.
```

---

## Ekran (kullanıcı)

- Harita “oluyor gibiydi” sonra takıldı / dondu  
- Sonra **aynı isim her yerde**: “Mickleth Firth Sound” + pembe ikon, karo ızgarasında tekrar  
- Dikey dikiş çizgileri (256 karo sınırları)

---

## Log özeti (`logs/irbis-main.log` ~20:58–20:59)

| An | Olay |
|----|------|
| fit | z14 n=28 miss→sonra HIT |
| zoom | z16 / z17 / **z18** settle-zoom zinciri |
| z18 | **n=88 miss=88** → donma hissi (tek sıra × 88) |
| sonrası | z17↔z18 settle spam, HIT/MISS karışık |
| son | `nautilus-renderer exit null` |
| toplam | ~hit 299 / miss 229 |

Örnek satırlar:
```
TILES z=18 n=88 hit=0 miss=88 · settle-zoom→z18
TILE DRAW 256² GB5X01SW z18/175425/89211 …
TILES z=18 n=77 hit=56 miss=21 · settle-zoom→z18
nautilus-renderer exit null
```

---

## Teşhis (kod yazmadan)

| Belirti | Muhtemel kök |
|---------|----------------|
| Aynı isim her karoda | S-52 label per-tile; **metatile şart** |
| Zoom donması | z18’de 70–88 karo × serial Draw; max-z yok |
| Settle spam | Her tekerlek tick → settle-zoom; no-op yok |
| Dikiş çizgileri | Beklenen (henüz blend/metatile yok) |

---

## Navionics vs biz (kısa)

| | Navionics | Biz |
|--|-----------|-----|
| Disk | `{z}/{x}/{y}.png` 256 | hash frame-cache |
| Label | Bake’te bir kez | Her 256 Draw’da tekrar |
| Zoom | LOD hazır karo | Canlı Draw yağmuru → takılma |

---

## Kalan öncelik (ChatGPT onayı için)

1. **Metatile** (isim tekrarı + kenar)  
2. **Max z + LOD** (donma)  
3. Settle no-op / debounce  
4. Disk `{cell}/{z}/{x}/{y}`  
5. Prefetch · benchmark · rotation/AIS/S-63
