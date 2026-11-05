# IRBIS

Windows PC tabanlı denizcilik chartplotter ve cihaz entegrasyon platformu (IRMARINETECH).

Harita: **Navionics offline** (geçiş dönemi) + **Teledyne SevenCs Nautilus ENC** (hedef motor).

## Klasör yapısı

```
IRBIS/
├── apps/desktop/          # Electron + React + Vite uygulama kabuğu
├── packages/              # core / connect / charts (monorepo paketleri)
├── native/                # Kalıcı Nautilus C++ renderer (nautilus-renderer)
├── maps/                  # Nautilus handoff, PoC kaynak, check list
├── samples/               # Demo bake / chart örnekleri
├── tools/                 # bake, mock NMEA, yardımcı scriptler
├── vendor/                # Yerel runtime (gitignore) — Navionics JS + permit + ENC
├── IRBIS tool/            # Marka / doküman / plan (kod değil)
├── logs/                  # Çalışma logları (gitignore)
├── package.json           # Workspace kökü
└── README.md
```

### `vendor/` (gitignore — makinede kalır)

| Yol | Ne için |
|-----|---------|
| `vendor/navionics/` | `NavionicsTileServer.js` + cache helper → offline karo |
| `vendor/permits/` | S-63 user permit dosyaları |
| `vendor/enc/` | Deneme Türkiye ENC (Hafta 17) |

Navionics karo **cache klasörü** (binlerce PNG): varsayılan  
`%USERPROFILE%\Documents\NDataReader\bizim-harita`  
(`IRBIS_NAVIONICS_CACHE` ile override).

### `IRBIS tool/` (doküman / marka)

| Yol | Ne için |
|-----|---------|
| `brand/` | Logolar |
| `docs/` | Yol haritası, fizibilite, acceptance |
| `plans/` | Radar / ONVIF / ürün planları |
| `html/` | Marine topbar HTML prototipi |

### Kod vs doküman

| Kod / ürün | Doküman / marka | Yerel veri |
|------------|-----------------|------------|
| `apps/`, `packages/`, `native/`, `maps/`, `tools/` | `IRBIS tool/` | `vendor/`, `logs/`, `node_modules/` |

Eski kök `LIB/` (SEAPIR, tam NDATAREADER, PDF yığını) kaldırıldı; sadece kullanılan parçalar `vendor/`’a alındı.

## Geliştirme (Windows)

```bash
npm install
npm run dev
```

Log: `logs/irbis-main.log`.

Ayarlar → Seyir: **Navionics** ↔ **Nautilus ENC** geçişi.

```bash
# NMEA test
npm start -w @irbis/mock-nmea-sender
```

## Yol haritası

- Ürün / faz notları: [`IRBIS tool/docs/IRBIS-Yol-Haritasi.md`](IRBIS%20tool/docs/IRBIS-Yol-Haritasi.md)
- Nautilus entegrasyon: [`maps/IRBIS_NAUTILUS_CURSOR_HANDOFF_UPDATED.md`](maps/IRBIS_NAUTILUS_CURSOR_HANDOFF_UPDATED.md)
