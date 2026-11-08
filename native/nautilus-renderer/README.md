# nautilus-renderer

Kalıcı SevenCs Nautilus süreç: `EnKernel` + `EnChartDisplay` bir kez açılır; Electron stdin JSON ile `setViewport` / `render` / `pick` çağırır.

## Derleme

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 ^
  -DCMAKE_PREFIX_PATH=K:\SevenCs\Nautilus\1.10.2.4;C:\Qt\5.15.2\msvc2019_64
cmake --build build --config Release --target nautilus-renderer
```

PATH: `K:\SevenCs\Nautilus\1.10.2.4\bin` + Qt `bin` / `plugins`.

## IPC (satır JSON)

```json
{"cmd":"loadCell","requestId":1,"path":".../GB5X01NE.000","width":1280,"height":720,"dpi":96}
{"cmd":"setViewport","requestId":2,"north":-32.45,"south":-32.53,"west":60.97,"east":61,"width":1280,"height":720}
{"cmd":"render","requestId":3,"out":"C:/tmp/frame.png"}
{"cmd":"pick","requestId":4,"x":100,"y":200,"radius":12}
{"cmd":"quit","requestId":5}
```

### S-63 / chart library

Kernel Init sonrası (sırayla tipik akış):

```json
{"cmd":"configureS63","requestId":10,"userPermit":"...","mKey":"...","certificate":".../IHO.CRT"}
{"cmd":"openLibrary","requestId":11,"path":"C:/charts/library"}
{"cmd":"importPermits","requestId":12,"path":".../PERMIT.TXT"}
{"cmd":"importExchange","requestId":13,"path":".../ENC_ROOT_parent_or_enc_file"}
{"cmd":"listLibrary","requestId":14}
{"cmd":"loadLibraryCell","requestId":15,"name":"GB5X01NE","width":1280,"height":720,"dpi":96}
```

`listLibrary` yanıtı: `cells:[{name,canLoad}]`. `loadCell` (düz `.000`) eskisi gibi çalışır.

## Electron

`IRBIS_NAUTILUS_MODE=persistent` (exe varsa varsayılan) · `printchart` = eski spawn.
