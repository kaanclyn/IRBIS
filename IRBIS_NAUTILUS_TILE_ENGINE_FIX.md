# IRBIS × Nautilus — Native Tile Engine: Zoom/LOD Stabilizasyonu

**Tarih:** 6 Kasım 2026  
**Hedef:** Nautilus Kernel 1.10.2.4 ile mevcut **persistent C++ renderer + Electron/React + equirectangular 256×256 tile engine** yapısını koruyarak kaybolan zoom, eski görüntüye geri dönüş, gereksiz render ve tekrar eden etiket sorunlarını aşamalı gidermek.

> **Karar:** Şimdilik ChartServer / HWND / Vulkan geçişi yok. `PrintChart.exe` ana render yolu olmayacak. Doğru çalışan C++/CodeMeter/cache altyapısı korunacak. Önce zoom ve request yaşam döngüsü düzeltilecek; sonra metatile.

## 1. Son logda kesin görülenler

Kaynak: `Yapıştırılan metin(20261105-213642).txt` (~1.538 satır; 5 Kasım 2026, 21:33–21:34 UTC).

- 25 adet `WHEEL`, 37 adet `ZOOM settle`, 10 adet `ZOOM lod-swap`, 3 adet `SCHED cancel` kaydı.
- 273 adet `CACHE MISS [DRAW]`, 278 adet `CACHE HIT [EXACT]` (aynı oturumda loglanan cache sayaçları). Yeni karo çizimlerinin medyan `drawMs` değeri ~12 ms. Tek tek karo çizim hızı birincil sorun görünmüyor.
- Cache açılışında `index=354 frames`; mevcut cache kullanılmış. Bu testin sorunu *cache sıfırlanması* değil.
- z18'e gerçekten ulaşılmış. Bazı z18 grupları 16 karo. Yine de tekrarlanan render çağrıları ve görünüm kararsızlığı sürüyor.
- `nautilus-renderer exit null` var; bu tek başına crash kanıtı değildir. `code`, `signal` ve `shutdownReason` eklenmeli.

### P0: İptal edilmiş istekten sonra bile LOD swap

Logda şu sıralama var:

```text
SCHED cancel gen=9 cur=11 · settle-zoom→z16
ZOOM lod-swap tileZ=16 ... zoomFloat=15.833
...
SCHED cancel gen=11 cur=13 · settle-zoom→z17
ZOOM lod-swap tileZ=17 ... zoomFloat=17.250
...
SCHED cancel gen=7 cur=13 · settle-zoom→z15
ZOOM lod-swap tileZ=15 ... zoomFloat=14.833
```

**Teşhis:** Scheduler eski işi iptal ediyor, fakat iptalin ardından eski async devam kodu `tileZ`/zoom/scale state'ini güncelliyor olabilir. Görünümün geriye sıçramasına neden olabilecek güçlü, log destekli aday. Kodda `await` sonrası state commit yolları incelenip doğrulanmalı.

### P0: Tekrarlanan settle ve karo üretimi

Aynı `zoomFloat=16.833` değeri birçok `gen` için tekrar ediyor; aynı `zoomFloat=17.250` de defalarca settle oluyor. Örneğin z17 için ardışık `n=24` grupları bazen 7 hit / 17 miss, bazen 9 hit / 15 miss. Bu durum kamera merkezinin, bbox'ın veya istek anahtarının beklenmedik şekilde değiştiğini düşündürüyor; **tek başına logdan kesin neden belirlenemez**. `centerLon/Lat`, bbox, tile key set hash, pan/wheel input kaynağı ve nesil bilgisi loglanmalı.

## 2. Cursor için kesin uygulama görevleri

### A. Tek kamera state'i ve matematik (P0)

`NautilusViewport.tsx` içindeki birbirinden kopuk `scale`, `tileZ`, `zoomFloat` güncellemelerini tek reducer/store mantığına topla:

```ts
type Camera = {
  centerLon: number;
  centerLat: number;
  zoomFloat: number;      // Kullanıcının niyeti: tek otorite
  renderedZ: number;      // Şu an ekranda bulunan karoların LOD'u
  viewportWidth: number;
  viewportHeight: number;
  revision: number;
};

const cssScale = 2 ** (camera.zoomFloat - camera.renderedZ);
```

- `zoomFloat` **yalnızca kullanıcı girdisi / kamera komutuyla** değişsin; async tile sonucundan geri yazılmasın.
- `renderedZ` karoların hangi seviyeden görüntülendiğini bildirsin; `zoomFloat` yerine geçmesin.
- Wheel geldiğinde görünür zoom hemen CSS/canvas transform ile güncellensin; mouse imlecinin altındaki coğrafi nokta sabit kalsın.
- `desiredZ` kamera ölçeğinden türetilsin; z seçimi histerezis içersin (sınır civarında LOD ileri-geri sekmesin).
- z18 `renderMaxZ` performans koruması olarak kalabilir; z18 üstü isteklerde *overzoom* ile görsel büyütme devam etmeli. Bu, yeni ENC ayrıntısı üretmez; bunu UI açısından açık tut.

### B. Scheduler ve stale-result koruması (P0, ilk kodlanacak parça)

- Her kamera isteği bir **monoton artan `requestRevision`** taşısın.
- Yeni hareket gelince eski **bekleyen** tile işleri atılsın; in-flight C++ çağrısı güvenle iptal edilemiyorsa bitmesine izin verilsin ama çıktısı yalnızca cache'e yazılsın, görünür state'e commit edilmesin.
- **Her `await` sonrasında**, state commit veya LOD swap öncesinde `requestRevision === latestRevision` kontrolü olsun; kontrol callback'in başında yapılmış olmakla yetinme.
- Eski callback'lerin **asla** `zoomFloat`, `renderedZ`, `center`, transform veya tile layer'ı değiştirmesine izin verme.
- LOD geçişi *atomik* olsun: hazır yeni tile grubu (en azından görünür merkez karolar) + güncel kamera revizyonu doğrulandıktan sonra `renderedZ` değişsin; CSS ölçeği `zoomFloat` üzerinden yeniden türetilsin.
- `NOOP` sadece tile fetch/Draw'u atlamalı; kullanıcı zoom animasyonunu engellememeli.

Örnek yaklaşım (SDK API kodu değil, durum kontrolü örneği):

```ts
const revision = ++latestRevision.current;
const snapshot = getCurrentCamera();
const targetZ = chooseLOD(snapshot.zoomFloat, snapshot.renderedZ);
const result = await ensureVisibleTiles(snapshot, targetZ);
if (revision !== latestRevision.current) return; // kritik
if (!sameCameraIntent(snapshot, getCurrentCamera())) return;
if (!result.centerTilesReady) return; // eski LOD ekranda kalsın
commitRenderedZ(targetZ); // zoomFloat'a DOKUNMA
```

> Önemli: `latestRevision` yalnızca wheel değil pan, resize ve diğer kamera değişimlerinde de güncellenmeli; `sameCameraIntent` hassas koordinat karşılaştırması / normalize edilmiş tile anahtarı kullanmalı.

### C. Gereksiz render için deduplikasyon (P0/P1)

- Aynı `{cell, z, x, y, renderStyle, palette, SDK/config revision}` anahtarı için tek in-flight Promise (`single-flight`) kullan.
- Viewport tile-set aynıysa ve cache hazırsa `NOOP`; aynı veriyi tekrar IPC'den isteme.
- Bekleyen işleri `priority = viewportCenter > visibleEdge > overscan/prefetch` ile sırala.
- Naif şekilde paralel C++ render işlemlerini artırma: daha önce CodeMeter 212 yaşandı; **concurrency=1** korunacak, ancak öncelikli kuyruk ve eski işi düşürme uygulanacak.
- `ensureTile` ile *görüntüye commit* ayrılmalı: cache'e tamamlanan iş eski nesilden de gelebilir, fakat eski işin görsel swap yetkisi olamaz.

### D. Zoom sonuçlandıktan sonra kartografik tutarlılık (P1)

- 256² bağımsız Nautilus `Draw` karolarında tekrar eden S-52 ad/sembol yerleşimini önce 2×2, sonra 4×4 **metatile + gutter + crop** yaklaşımı ile test et.
- S-52 yazıları metatile sınırında da tekrar edebilir; bu yüzden 2 komşu metatile ve harita ölçeği arasında label tekrar/kesilme testleri şart.
- Mevcut **equirectangular** ızgarayı (şimdilik) koru. Web Mercator XYZ'nin doğrudan Kernel lon/lat bbox'ına bağlanması geçmişte patchwork üretti; projeksiyon dönüştürmesi doğrulanmadan değiştirme.
- Metatile, zoom/state kararlılığı sağlanmadan ana öncelik olmasın.

### E. Telemetri ve doğrulama (P0)

Her hareket için tek satır log:

```text
CAMERA event=wheel|pan|resize|settle rev=... zFloat=... renderedZ=...
       desiredZ=... cssScale=... center=lon,lat bbox=... tileSetHash=...
TILE_REQUEST rev=... z=... hit=... miss=... queued=... skippedStale=...
LOD_COMMIT rev=... from=... to=... zFloatBefore=... zFloatAfter=...
```

Her `LOD_COMMIT` için invariant: `rev == latestRevision`, `zoomFloatBefore == zoomFloatAfter`, dünya koordinatları (imleç altı merkez) değişmemeli. Eski `rev` için `LOD_COMMIT` sayısı **sıfır**.

## 3. Kabul testleri

1. İleri doğru **15 wheel**: her adım anında görsel karşılık bulur, son wheel ile `zoomFloat` aynı yönde ilerler, hiçbir eski LOD swap kamerayı geri götürmez.
2. Geri doğru **15 wheel**: anchor sabit, harita zıplamıyor; zoomFloat tutarlı azalıyor.
3. Zoom sırasında hızlı yön değişimi + drag: UI donmadan en son kameraya gelir; stale commit **0**.
4. Sabit kamera ve sıcak cache: gereksiz yeni `Draw` **0** (palet/ayar değişikliği yokken).
5. Aynı zoomFloat için tekrar `settle` olursa: *gerçek kamera/bbox/visible tile-set değişmediyse* yeni render **0**.
6. `z17` ve `z18` geçişinde önce merkez karolar görünür olur, kenarlar kademeli tamamlanır; görsel boşluk oluşmaz.
7. Zoom stabil hale gelince metatile A/B ekran görüntüsü: tekrar eden yer isimleri, pembe seyir sembolleri, dikişler ve kıyı hizası karşılaştırılır.

## 4. Çalışma sırası ve sınırlar

1. Önce `NautilusViewport.tsx` ve ilgili hook/store içindeki async `settleZoom`, `ensureTiles`, `LOD swap`, `wheel`, `pan` akışını incele; **özellikle logdaki `SCHED cancel` sonrasında `ZOOM lod-swap`** olasılığını düzelt.
2. Ardından scheduler'da priority + single-flight + stale commit guards.
3. Yukarıdaki testleri çalıştır, log ve kısa ekran kaydıyla kontrol et.
4. **Bundan sonra** metatile ve disk `nautilus-tiles/{cell}/{z}/{x}/{y}.png` düzenini geliştir.

**Değiştirilmeyecek:** mevcut Electron + React UI, persistent C++ Nautilus renderer, ENC/CodeMeter entegrasyonu, AIS overlay yapısı. Yeni bir harita ürünü veya GPU backend bu aşamanın şartı değil.
