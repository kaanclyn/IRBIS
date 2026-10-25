# Bake NOAA sample ENC cells with tile57 (Windows).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$t57 = Join-Path $root "tools\tile57\tile57-0.4.0-x86_64-windows-gnu\bin\tile57.exe"
$encRoot = Join-Path $root "samples\enc-noaa\ENC_ROOT"
$out = Join-Path $root "samples\chart-bake"

# Default: all .000 under ENC_ROOT, or pass cell names as args
$cells = @($args)
if ($cells.Count -eq 0) {
  $cells = Get-ChildItem $encRoot -Recurse -Filter "*.000" | ForEach-Object {
    [IO.Path]::GetFileNameWithoutExtension($_.Name)
  } | Sort-Object -Unique
}

if (-not (Test-Path $t57)) { throw "tile57.exe missing: $t57" }

New-Item -ItemType Directory -Force -Path $out | Out-Null
& $t57 assets -o (Join-Path $out "assets")
& $t57 sprite-mln -o (Join-Path $out "assets")
# Day is the default alias; dusk/night enable Chart Library palette switch without remapping.
& $t57 style -o (Join-Path $out "style.json") --scheme day
& $t57 style -o (Join-Path $out "style-day.json") --scheme day
& $t57 style -o (Join-Path $out "style-dusk.json") --scheme dusk
& $t57 style -o (Join-Path $out "style-night.json") --scheme night

foreach ($name in $cells) {
  $cell = Join-Path $encRoot "$name\$name.000"
  if (-not (Test-Path $cell)) {
    Write-Warning "missing $cell"
    continue
  }
  Write-Host "Baking $name ..."
  & $t57 bake $cell -o $out
}

Write-Host "Bake OK -> $out ($($cells.Count) cells)"
