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

## Electron

`IRBIS_NAUTILUS_MODE=persistent` (exe varsa varsayılan) · `printchart` = eski spawn.
