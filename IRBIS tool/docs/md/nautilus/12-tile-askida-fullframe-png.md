# Tile motoru askıda — full-frame C++ PNG (8 Kas 2026)

## Karar

256×256 tile / LOD / metatile yolu **şimdilik askıda**. UI tekrar ilk çalışan modele döndü:

- Persistent C++ `nautilus-renderer` → tek viewport PNG
- Electron `nautilusSetViewport` (`fit` / `set`)
- React: CSS pan/zoom, settle’da yeni frame
- `overscan: false` (gerilmiş overscan yok)

`nautilusEnsureTile` bridge’de duruyor ama warn log’u ile askıda; UI çağırmıyor.

## Cache

Silindi: `nautilus-frame-cache`, `nautilus-frames`, Electron GPU/Code Cache.

## Sonraki

Tile/metatile ancak full-frame stabil ve kullanıcı onayı sonrası.
