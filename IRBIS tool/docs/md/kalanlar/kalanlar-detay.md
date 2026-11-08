# IRBIS × Nautilus — KALANLAR

**Güncelleme:** 6 Kasım 2026 ~00:10 · ChatGPT kesin sıra  
**Brifing:** `../nautilus/09-chatgpt-brifing-tile-zoom.md`  
**07 güncel:** `../nautilus/07-navionics-vs-nautilus-akicilik.md`

---

## Değiştirmeyeceğimizler

- Persistent C++ · PrintChart-primary yok  
- Vulkan / HWND / ChartServer erteli  
- Sabit maxZoom=16 **kalıcı çözüm değil** (yalnız soft koruma)

---

## ChatGPT kesin sıra

| Öncelik | İş | Durum |
|---------|-----|--------|
| **P0** | Zoom request scheduler | ✅ |
| **P0** | Anlık CSS zoom + overzoom | ✅ |
| **P0** | LOD z17/18 + rematch snap | ✅ |
| **P0** | Tile motoru | ⏸ **askıda** (8 Kas) — full-frame C++ PNG |
| **P0** | Full-frame setViewport + CSS zoom | ✅ geri alındı |
| **P1** | Tile/metatile yeniden | ⏳ full-frame stabil + onay |
| **P1** | Progressive LOD (eski z kalsın) | |
| **P1** | Projeksiyon / dikiş testleri | |
| **P2** | Disk `{cell}/{z}/{x}/{y}` + prefetch | |
| **P2** | 20 hareket benchmark | |
| — | Rotation / AIS native / S-63 | sonra |

---

## Neden önce scheduler?

ChatGPT: tekrarlayan isim kalite; **zoom donması kullanılabilirlik**.  
Log: `z18 n=88 miss=88` ~1.6s tek kuyruk.

---

## ChatGPT yapıştır

```text
ChatGPT sırası uygulandı kısmen: P0 scheduler (gen cancel, merkez-önce,
softMaxZ=16 geçici, margin↓, noop) kodda. Sırada P0 metatile 4×4.
P1 LOD + dikiş testi. P2 disk/prefetch/benchmark. Vulkan erteli.
07-navionics MD güncellendi (tek PNG anlatımı kaldırıldı).
```
