# IRBIS

Windows PC tabanlı denizcilik chartplotter ve cihaz entegrasyon platformu.

## Dizin

| Yol | İçerik |
|-----|--------|
| `apps/desktop` | Electron + React + Vite kabuk |
| `packages/core` | Canonical bus tipleri |
| `packages/connect` | NMEA intake (SEAPIR mantığı) |
| `packages/charts` | S-57 / tile57 chart library |
| `tools/mock-nmea-sender` | UDP 10110 test gönderici |
| `LIB/` | Referanslar (SEAPIR, NDATAREADER, raporlar, mockup) — uygulama kodu değil |

## Geliştirme (Windows)

```bash
npm install
npm run dev
```

Log dosyası: `logs/irbis-main.log` (boş ekran / yükleme hataları buraya yazılır). DevTools otomatik açılır.

Uygulama NOAA S-57 demo hücreleri (tile57 bake → PMTiles → MapLibre) ile açılır. İnternet gerekmez (loopback chart server `:17357`). Chart Library’den hücre seçilir (☰).

Bake (tüm `ENC_ROOT` hücreleri veya isim vererek):

```powershell
powershell -File tools/bake-noaa.ps1
powershell -File tools/bake-noaa.ps1 US5MD11M US5MD21M
```

NMEA: uygulama `0.0.0.0:10110` UDP dinler. Trafik yoksa dahili simülasyon; paket gelince **CANLI**.

```bash
npm start -w @irbis/mock-nmea-sender
```

## Yol haritası

Detaylı plan: [`LIB/IRBIS-Yol-Haritasi.md`](LIB/IRBIS-Yol-Haritasi.md)

**Faz 0–1:** tile57 + NOAA bake ✓ · MapLibre ✓ · NMEA UDP + AIS ✓ · Chart Library (BYO klasör) ✓ · sırada rota / MOB / day-night.
