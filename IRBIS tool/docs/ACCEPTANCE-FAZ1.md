# ACCEPTANCE — Faz 1 (Yol Haritası §12)

**Tarih:** 2026-10-24  
**Kapsam:** Chart / Connect / Nav kabul kriterleri — kod incelemesi (grep + dosya okuma).  
**Kapsam dışı:** Radar (Faz 3), S-63 decrypt (MVP dışı; yalnızca “unsupported” işaretleme beklenir).  
**Smoke:** `tools/smoke-faz1.ps1`

Durumlar: **PASS** = kodda doğrulandı · **FAIL** = beklenen davranış yok / kırık · **TODO** = tip/iskelet var veya eksik kablo.

---

## Chart

| §12 kriter | Durum | Kanıt / not |
|------------|-------|-------------|
| Plain S-57 klasörü → tara + bake → hücre meta + offline çizim | **PASS** (demo yolu) | `chartLibrary.cjs` ENC/bake tarama; `samples/chart-bake` PMTiles + `style.json`; MapLibre offline (`ChartMap.tsx`, `chartServer.cjs`). In-app bake yok — bake `tools/bake-noaa.ps1` / tile57 CLI. |
| `.001` update → edition/updateNo + görünüm tutarlı | **TODO** | `scanEncRoot` `updateNo` / `updateFiles` sayıyor; edition parse + rebake tutarlılığı yok. |
| Bozuk hücre → karantina; diğerleri çalışır | **TODO** | `BakeStatus` + UI etiketi (`quarantine`); hiçbir path `bakeStatus: "quarantine"` set etmiyor. |
| Kapsamasız bölge → açık “harita yok” | **TODO** | ENC bbox coverage katmanları var (`enc-coverage-*`); ayrı “harita yok” rozeti/mesajı yok. |
| S-63 → unsupported (MVP) | **TODO** | `PermitStatus` / `unsupported-s63` tipi var; tarama her hücreyi `plain` yazıyor; S-63 tespiti yok. *(Decrypt iddiası yok.)* |
| Nesne sorgu → kaynak ENC indeksinden sınıf+hücre | **TODO** | Kaynak ENC feature index / query UI yok (tile geometrisinden uydurma da yok). |
| Chart Library UI (klasör, hücre listesi) | **PASS** | `ChartLibraryPanel.tsx` + `pickEncFolder` / `setActiveCell` / `rescanCharts`. |

---

## Connect

| §12 kriter | Durum | Kanıt / not |
|------------|-------|-------------|
| RMC → position / SOG / COG; heading’e yazılmaz | **PASS** | `parse0183.ts` / `nmeaService.cjs`: RMC yalnız lat/lon/sog/cogTrue. |
| HDT → yalnız `headingTrue` | **PASS** | `parseHdgFamily` / nmea: HDT → `headingDegTrue`. |
| AIS 5 / 18 / 19 / 24 alanları dolar | **PASS** | `aisDecode.cjs`: tip 1–3, 5, 18, 19, 24 + çok parçalı AIVDM. |
| Checksum hata → sayılır, state bozulmaz | **PASS** | `checksumErrors++`; patch uygulanmaz. |
| İki GPS → kanal priority tercih edileni seçer | **TODO** | `@irbis/core` `SourcePriorityConfig` tipi var; live ingest last-write-wins (`udp:ip:port`), priority seçici yok. |
| ageMs > eşik → STALE | **PASS** | `STALE_MS` + `channelAgeMs` (`@irbis/connect`); `useOwnShip` metric/position `stale`. |
| AIS timeout / lost | **PASS** | `AIS_LOST_MS` + `lost` bayrağı (`nmeaService.cjs`, AIS listesi CSS). |

---

## Nav

| §12 kriter | Durum | Kanıt / not |
|------------|-------|-------------|
| MVP MOB → görsel + çerçeve | **TODO** | `MobPoint` + `ensureMobLayers` / `mobGeoJson` hazır; `App.tsx` MOB state/CTA bağlamıyor (`mob` prop geçilmiyor). |
| Faz 2 demir aşımı → histerezisli alarm | **TODO** | `AnchorWatch` + katmanlar/geo helper var; App kablosu + histerezis yok *(Faz 2)*. |
| Stale AIS → CPA yok veya “eski veri” | **TODO** | CPA/TCPA hesaplayıcı yok; lost AIS stil var, CPA gate yok. |
| Rota / WP (destek) | **TODO** | `Waypoint` + route katmanları + GPX helper; App henüz bağlamıyor. |

---

## Smokeable (otomasyon)

| Kontrol | Durum |
|---------|-------|
| `samples/chart-bake/style.json` + ≥1 `*.pmtiles` | smoke script |
| `samples/enc-noaa/ENC_ROOT` ≥1 `*.000` | smoke script |
| `GET http://127.0.0.1:17357/health` (server açıksa) | smoke script (optional SKIP) |
| Root `workspaces` + `dev`/`build` → `@irbis/desktop` | smoke script |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke-faz1.ps1
```

---

## Özet (kod incelemesi)

| Alan | PASS | FAIL | TODO |
|------|------|------|------|
| Chart | 2 | 0 | 5 |
| Connect | 6 | 0 | 1 |
| Nav | 0 | 0 | 4 |

**Kritik Faz 1 boşlukları:** kanal priority, kaynak ENC nesne sorgusu, karantina/S-63 işaretleme, App’e MOB (ve rota) kablosu.  
**Radar / S-63 decrypt:** bu kabul listesinde iddia edilmez.
