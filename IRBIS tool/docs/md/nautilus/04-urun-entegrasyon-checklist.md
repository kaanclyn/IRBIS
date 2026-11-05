# Ürün entegrasyonu checklist — Nautilus × IRBIS

**Güncelleme:** 2026-11-05

## Mimari / köprü

- [x] Feature flag: Navionics ↔ Nautilus (`mapEngineStore`)
- [x] Electron IPC güvenlik sınırı (preload expose)
- [x] Native helper yaşam döngüsü: PrintChart spawn + PNG cache HTTP
- [x] Viewport sözleşmesi: `N/S/W/E` + pan/zoom IPC (`nautilusSetViewport`)
- [x] Pick: geo projection + `PickChart` ENC feature JSON (`nautilusPick`)
- [ ] Uzun ömürlü native process (sürekli frame) — D3’e bağlı
- [ ] HWND / Vulkan shared texture — bilinçli ertelendi (`NAUTILUS_D3_RENDER_PATH.md`)

## Harita / ENC

- [x] SDK testdata hücre listesi + seçim (Ayarlar → Seyir)
- [x] İlk ENC PNG (PrintChart Cairo)
- [x] Disk cache (viewport anahtarlı)
- [ ] Müşteri ENC klasörü / Chart Installer akışı
- [ ] S-63 cell permit / user permit UI
- [ ] Chart library kalıcı katalog

## Sensör overlay (ürün verisi — ENC’den değil)

- [x] AIS hedefleri Nautilus PNG üstünde (React overlay)
- [x] Own-ship / GNSS konumu overlay
- [x] Radar halkası (georef placeholder; cihaz protokolü ayrı)
- [ ] ARPA hedefleri Nautilus’ta
- [ ] FLIR FOV footprint (özel overlay)
- [ ] Native Nautilus AISOverlay API’ye sensör bağlama (opsiyonel; şu an React)

## SDK doğrulama (C)

- [x] CheckRegistration / CheckDevLicense
- [x] PrintChart
- [x] ChartViewer.exe
- [x] PickReport.exe
- [x] AISOverlay.exe
- [x] PickChart (IRBIS headless)

## Paketleme / lisans

- [ ] CodeMeter runtime dağıtım notları (Deployment Guide)
- [ ] Nautilus DLL’lerin installer’a dahil edilmesi (SDK commit yok)
- [ ] Eval → production lisans geçişi
- [ ] Offline açılış smoke (internetsiz)

## UX

- [x] Ayarlardan motor geçişi
- [x] Nautilus pan (sürükle) / zoom (tekerlek) / Fit
- [x] Tıklayınca özellik paneli
- [ ] Gece/gündüz paleti IPC
- [ ] Ölçüm VRM/EBL Nautilus modunda
