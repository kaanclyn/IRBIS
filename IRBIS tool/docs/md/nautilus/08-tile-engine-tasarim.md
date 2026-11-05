# Nautilus Tile Engine — tasarım (ChatGPT 6 Kas)

## Mimari

```
React Tile Viewport
  · generationId scheduler (P0)
  · merkez-önce kuyruk · softMaxZ=16 geçici
  · equirectangular z/x/y · 256²
        ↓
ensureTile / (sonra) ensureMetatile
        ↓
Persistent nautilus-renderer
```

## P0 — Zoom scheduler ✅ / Metatile 🔄

### Scheduler (uygulandı)

- Yeni pan/zoom → `loadGen++` → eski kuyruk sonuçları atılır (`SCHED cancel`)  
- Merkez karo `dist` sıralı  
- z≥15 margin=0  
- softMaxZ=16 (geçici; kalıcı tavan değil)  
- Hepsi cache’te → noop log  

### Metatile (sırada — ChatGPT P0 #2)

```
4×4 metatile: bir Draw 1024×1024 (+ gutter)
        ↓ dilim
16 × 256 PNG  → cache keys z/x/y
```

Amaç: S-52 label/sembol bir kez → “Mickleth Firth Sound” ızgarası azalır.  
Not: Kernel etiketleri viewport’a göre yeniden koyabilir; metatile tüm tekrarları %100 kesmeyebilir — test şart.

## P1 — Progressive LOD

- Eski z mozaiği kalsın (z-1 zaten publish’te)  
- Yeni z gelince fade/swap  
- Görüntü zoom sırasında kaybolmasın  

## P1 — Projeksiyon / dikiş

- Equirectangular vs Kernel gerçek map doğrula  
- Kenar piksel testi  

## P2

- Disk: `nautilus-tiles/{cell}/{z}/{x}/{y}.png`  
- Prefetch komşular  
- `06-render-benchmark.md` 20 hareket  

## Navionics ref

`bizim-harita/navionics/{z}/{x}/{y}.png` @ 256 Web-Mercator — klasör fikri aynı, projeksiyon farklı.
