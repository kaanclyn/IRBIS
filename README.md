# IRBIS

Windows PC tabanlı denizcilik chartplotter ve cihaz entegrasyon platformu (IRMARINETECH).

Harita: **Navionics offline** (geçiş) + **Teledyne SevenCs Nautilus ENC** (hedef).

## Klasör yapısı

```
IRBIS/
├── apps/desktop/       # Electron + React + Vite
├── packages/           # core / connect / charts
├── native/             # nautilus-renderer (kalıcı C++)
├── maps/               # chart.info.txt + Nautilus PoC kaynak (PickChart, …)
├── samples/            # demo bake
├── tools/              # bake, mock NMEA
├── vendor/             # gitignore — Navionics JS, permits, ENC
├── IRBIS tool/         # marka + doküman + plan (kod değil)
│   ├── brand/
│   ├── docs/
│   │   ├── md/         # tüm geliştirme Markdown’ları
│   │   │   ├── nautilus/
│   │   │   ├── urun/
│   │   │   └── kabul/
│   │   └── pdf/
│   ├── plans/
│   └── html/
├── logs/               # gitignore
├── package.json
└── README.md
```

### `IRBIS tool/docs/md/nautilus/` (okuma sırası)

1. `01-handoff-guncel.md` — güncel Nautilus durumu  
2. `02-persistent-renderer-tasarim.md`  
3. `05-gunluk-check-list.md`  
4. `03-d3-vulkan-hwnd.md` · `04-urun-entegrasyon-checklist.md`  
5. `00-handoff-eski.md` — arşiv  

### `vendor/` (gitignore)

| Yol | Kullanım |
|-----|----------|
| `navionics/` | Offline Navionics tile server |
| `permits/` | S-63 user permit |
| `enc/` | Deneme Türkiye ENC |

Karolar: `%USERPROFILE%\Documents\NDataReader\bizim-harita` (`IRBIS_NAVIONICS_CACHE`).

### `maps/` (runtime + PoC)

Sadece `chart.info.txt` + `poc/` — MD’ler `IRBIS tool/docs/md/`’ye taşındı.

## Geliştirme

```bash
npm install
npm run dev
```

Log: `logs/irbis-main.log`. Ayarlar → Seyir: Navionics ↔ Nautilus.

```bash
npm start -w @irbis/mock-nmea-sender
```

## Yol haritası

- [`IRBIS tool/docs/md/urun/yol-haritasi.md`](IRBIS%20tool/docs/md/urun/yol-haritasi.md)
- Nautilus: [`IRBIS tool/docs/md/nautilus/01-handoff-guncel.md`](IRBIS%20tool/docs/md/nautilus/01-handoff-guncel.md)
