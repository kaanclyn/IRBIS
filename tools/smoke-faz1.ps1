#Requires -Version 5.1
<#
.SYNOPSIS
  IRBIS Faz 1 smoke checks (Yol Haritasi section 12 smokeable items).

.DESCRIPTION
  Verifies sample bake/ENC assets, optional chart-server health, and
  monorepo package.json workspaces / desktop scripts. Windows PowerShell friendly.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\smoke-faz1.ps1
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$HealthUrl = "http://127.0.0.1:17357/health",
  [int]$HealthTimeoutSec = 2
)

if (-not $RepoRoot) {
  $here = $PSScriptRoot
  if (-not $here -and $MyInvocation.MyCommand.Path) {
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  if (-not $here) { $here = (Get-Location).Path }
  $RepoRoot = Split-Path -Parent $here
}

$ErrorActionPreference = "Continue"
$fail = 0
$pass = 0
$skip = 0

function Write-Check {
  param(
    [ValidateSet("PASS", "FAIL", "SKIP")]
    [string]$Status,
    [string]$Name,
    [string]$Detail = ""
  )
  $color = switch ($Status) {
    "PASS" { "Green" }
    "FAIL" { "Red" }
    "SKIP" { "Yellow" }
  }
  $line = "[{0}] {1}" -f $Status, $Name
  if ($Detail) { $line = "$line - $Detail" }
  Write-Host $line -ForegroundColor $color
  switch ($Status) {
    "PASS" { $script:pass++ }
    "FAIL" { $script:fail++ }
    "SKIP" { $script:skip++ }
  }
}

Write-Host "IRBIS Faz 1 smoke - $RepoRoot"
Write-Host ("=" * 60)

# --- 1) chart-bake: style.json + >=1 *.pmtiles ---
$bakeRoot = Join-Path $RepoRoot "samples\chart-bake"
$stylePath = Join-Path $bakeRoot "style.json"
if (-not (Test-Path -LiteralPath $stylePath)) {
  Write-Check FAIL "chart-bake style.json" "missing: $stylePath"
} else {
  Write-Check PASS "chart-bake style.json" $stylePath
}

$pmtiles = @()
if (Test-Path -LiteralPath $bakeRoot) {
  $pmtiles = @(Get-ChildItem -LiteralPath $bakeRoot -Recurse -Filter "*.pmtiles" -File -ErrorAction SilentlyContinue)
}
if ($pmtiles.Count -lt 1) {
  Write-Check FAIL "chart-bake *.pmtiles" "need >=1 under samples\chart-bake"
} else {
  Write-Check PASS "chart-bake *.pmtiles" ("{0} file(s), e.g. {1}" -f $pmtiles.Count, $pmtiles[0].Name)
}

# --- 2) enc-noaa ENC_ROOT: >=1 .000 ---
$encRoot = Join-Path $RepoRoot "samples\enc-noaa\ENC_ROOT"
$cells000 = @()
if (Test-Path -LiteralPath $encRoot) {
  $cells000 = @(Get-ChildItem -LiteralPath $encRoot -Recurse -Filter "*.000" -File -ErrorAction SilentlyContinue)
}
if ($cells000.Count -lt 1) {
  Write-Check FAIL "enc-noaa *.000" "need >=1 under samples\enc-noaa\ENC_ROOT"
} else {
  Write-Check PASS "enc-noaa *.000" ("{0} cell(s), e.g. {1}" -f $cells000.Count, $cells000[0].Name)
}

# --- 3) Optional: GET /health if chart server is up ---
try {
  $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec $HealthTimeoutSec
  if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
    $body = ($resp.Content -replace "\s+", " ").Trim()
    if ($body.Length -gt 120) { $body = $body.Substring(0, 117) + "..." }
    Write-Check PASS "chart-server /health" ("HTTP {0} {1}" -f $resp.StatusCode, $body)
  } else {
    Write-Check SKIP "chart-server /health" ("HTTP {0} (optional)" -f $resp.StatusCode)
  }
} catch {
  Write-Check SKIP "chart-server /health" "server not up (optional) - $HealthUrl"
}

# --- 4) package.json workspaces + desktop scripts ---
$pkgPath = Join-Path $RepoRoot "package.json"
if (-not (Test-Path -LiteralPath $pkgPath)) {
  Write-Check FAIL "root package.json" "missing"
} else {
  try {
    $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Check FAIL "root package.json" "invalid JSON: $($_.Exception.Message)"
    $pkg = $null
  }

  if ($null -ne $pkg) {
    $ws = @($pkg.workspaces)
    $needWs = @("apps/*", "packages/*", "tools/*")
    $missingWs = @($needWs | Where-Object { $ws -notcontains $_ })
    if ($missingWs.Count -gt 0) {
      Write-Check FAIL "workspaces" ("missing: {0}" -f ($missingWs -join ", "))
    } else {
      Write-Check PASS "workspaces" ($ws -join ", ")
    }

    $scripts = $pkg.scripts
    $needScripts = @("dev", "build")
    $missingScripts = @($needScripts | Where-Object {
        -not ($scripts -and ($scripts.PSObject.Properties.Name -contains $_))
      })
    if ($missingScripts.Count -gt 0) {
      Write-Check FAIL "root desktop scripts" ("missing: {0}" -f ($missingScripts -join ", "))
    } else {
      Write-Check PASS "root desktop scripts" ("dev={0}; build={1}" -f $scripts.dev, $scripts.build)
    }
  }
}

$desktopPkg = Join-Path $RepoRoot "apps\desktop\package.json"
if (-not (Test-Path -LiteralPath $desktopPkg)) {
  Write-Check FAIL "@irbis/desktop package.json" "missing: apps\desktop\package.json"
} else {
  try {
    $dp = Get-Content -LiteralPath $desktopPkg -Raw -Encoding UTF8 | ConvertFrom-Json
    $nameOk = $dp.name -eq "@irbis/desktop"
    $hasDev = $dp.scripts -and ($dp.scripts.PSObject.Properties.Name -contains "dev")
    $hasBuild = $dp.scripts -and ($dp.scripts.PSObject.Properties.Name -contains "build")
    if ($nameOk -and $hasDev -and $hasBuild) {
      Write-Check PASS "@irbis/desktop scripts" "name=$($dp.name); has dev+build"
    } else {
      Write-Check FAIL "@irbis/desktop scripts" "name=$($dp.name); dev=$hasDev; build=$hasBuild"
    }
  } catch {
    Write-Check FAIL "@irbis/desktop package.json" $_.Exception.Message
  }
}

# --- Summary ---
Write-Host ("=" * 60)
Write-Host ("Summary: PASS={0} FAIL={1} SKIP={2}" -f $pass, $fail, $skip)
if ($fail -gt 0) {
  Write-Host "Result: FAIL" -ForegroundColor Red
  exit 1
}
Write-Host "Result: PASS" -ForegroundColor Green
exit 0
