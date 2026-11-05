# Navionics akıcılık vs IRBIS Nautilus — güncel mimari

**Tarih:** 6 Kasım 2026  
**Eski tek-PNG anlatımı geçersiz** — aşağısı tile viewport dönemi.

---

## Navionics (referans)

```
Documents/NDataReader/bizim-harita/navionics/{z}/{x}/{y}.png  → 256×256 Web-Mercator
```

| Özellik | Navionics |
|---------|-----------|
| Harita | z/x/y karo (~96k) |
| Pan | Karolar CSS/canvas ile kayar |
| Zoom | LOD; üst seviye kalır, yeniler gelir |
| Etiket | Bake’te bir kez (karo içinde sabit) |

---

## IRBIS Nautilus (şimdi)

```
React Tile Viewport (equirectangular z/x/y, 256²)
        ↓ generationId scheduler · merkez-önce · softMaxZ=16 (geçici)
        ↓ nautilusEnsureTile
Persistent C++ nautilus-renderer (SetViewPort + Draw)
```

| Özellik | Biz |
|---------|-----|
| Izgara | **Equirectangular** (Kernel lon/lat; Mercator XYZ patchwork’tü) |
| Boyut | 256² exact |
| Pan | CSS + TILE skip / HIT |
| Zoom | settle-zoom + **scheduler** (eski gen iptal) |
| Etiket | Hâlâ per-tile S-52 → **metatile P0** (ChatGPT) |
| Cache | frame-cache hash; ileride `{cell}/{z}/{x}/{y}` |

**Korunan:** Persistent C++ · PrintChart-primary yok · Vulkan/HWND erteli.

---

## Neden Navionics kadar değil (güncel engeller)

1. **Zoom donması** — z18’de 88 miss serial → scheduler + softMaxZ (yapılıyor)  
2. **Aynı isim her karoda** — Mickleth Firth Sound ızgarası → **4×4 metatile**  
3. LOD fade / prefetch / disk klasörü — P1–P2  

---

## ChatGPT karar sırası (6 Kas)

| Öncelik | İş |
|---------|-----|
| **P0** | Zoom request scheduler (generationId, merkez önce, soft maxZ geçici) |
| **P0** | Metatile 4×4 (1024→16×256 + gutter) |
| P1 | Progressive LOD |
| P1 | Projeksiyon / dikiş testleri |
| P2 | Disk cache + prefetch |
| P2 | 20 hareket benchmark |

Detay: `09-chatgpt-brifing-tile-zoom.md` · `08-tile-engine-tasarim.md`
