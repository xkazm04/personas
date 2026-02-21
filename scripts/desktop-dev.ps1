param(
  [switch]$Restart,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[desktop-dev] $Message" -ForegroundColor Cyan
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

Write-Step "Repo root: $repoRoot"

$clangPath = 'C:\Program Files\LLVM\bin\clang.exe'
$clangOnPath = $null -ne (Get-Command clang -ErrorAction SilentlyContinue)

if (-not $clangOnPath -and (Test-Path $clangPath)) {
  Write-Step "Clang found at $clangPath but not on PATH. Adding for this session."
  $env:Path = "C:\Program Files\LLVM\bin;$env:Path"
  $clangOnPath = $null -ne (Get-Command clang -ErrorAction SilentlyContinue)
}

if (-not $clangOnPath) {
  Write-Error "clang is required but not available on PATH. Install LLVM or add C:\Program Files\LLVM\bin to PATH, then retry."
}

Write-Step "Using clang: $((Get-Command clang).Source)"

if ($Restart) {
  Write-Step "Restart mode: stopping stale personas-desktop instances if any."
  Get-Process personas-desktop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  Write-Step "Stopping stale Vite dev servers for this repo if any."
  $nodeProcs = Get-CimInstance Win32_Process -Filter "name = 'node.exe'"
  foreach ($proc in $nodeProcs) {
    if ($proc.CommandLine -and $proc.CommandLine -match 'vite' -and $proc.CommandLine -match [Regex]::Escape($repoRoot)) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Step "Stopped node process $($proc.ProcessId)"
    }
  }
}

if ($CheckOnly) {
  Write-Step "Check-only mode complete."
  exit 0
}

Write-Step "Starting desktop app via: npm run tauri dev"
npm run tauri dev
