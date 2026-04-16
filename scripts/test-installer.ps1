# scripts/test-installer.ps1
# Installer acceptance test for Personas Desktop (Windows NSIS).
#
# Runs the NSIS installer in silent mode, verifies file placement,
# launches the binary with --health-check, then uninstalls.
#
# Usage:
#   .\scripts\test-installer.ps1 [-Installer <path>]
#
# Exit codes:
#   0  — all checks passed
#   1  — one or more checks failed

param(
    [string]$Installer
)

$ErrorActionPreference = "Stop"
$script:failures = 0

function Test-Step {
    param([string]$Name, [scriptblock]$Block)
    Write-Host "  [$Name] " -NoNewline
    try {
        & $Block
        Write-Host "PASS" -ForegroundColor Green
    }
    catch {
        Write-Host "FAIL: $_" -ForegroundColor Red
        $script:failures++
    }
}

Write-Host "`n=== Personas Installer Acceptance Test ===" -ForegroundColor Cyan

# ── Resolve installer path ──────────────────────────────────────────
if (-not $Installer) {
    $Installer = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\Personas_*_x64-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $Installer -or -not (Test-Path $Installer)) {
    Write-Host "ERROR: No installer found. Build first with 'npx tauri build' or pass -Installer <path>" -ForegroundColor Red
    exit 1
}

Write-Host "Installer: $Installer"

# ── Determine expected install directory ────────────────────────────
# NSIS currentUser mode installs to %LOCALAPPDATA%\Personas
$installDir = Join-Path $env:LOCALAPPDATA "Personas"
$binary = Join-Path $installDir "personas-desktop.exe"
$uninstaller = Join-Path $installDir "uninstall.exe"

# ── 1. Silent install ───────────────────────────────────────────────
Write-Host "`n--- Phase 1: Install ---" -ForegroundColor Yellow

Test-Step "silent-install" {
    $proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) { throw "installer exited with code $($proc.ExitCode)" }
    # Give filesystem a moment to flush
    Start-Sleep -Seconds 2
}

# ── 2. Verify file placement ───────────────────────────────────────
Write-Host "`n--- Phase 2: File Verification ---" -ForegroundColor Yellow

Test-Step "binary-exists" {
    if (-not (Test-Path $binary)) { throw "binary not found at $binary" }
}

Test-Step "uninstaller-exists" {
    if (-not (Test-Path $uninstaller)) { throw "uninstaller not found at $uninstaller" }
}

Test-Step "binary-size" {
    $size = (Get-Item $binary).Length
    # Binary should be at least 20 MB (catches truncated/corrupt installs)
    if ($size -lt 20MB) { throw "binary is only $([math]::Round($size / 1MB, 1)) MB — expected >20 MB" }
    Write-Host "($([math]::Round($size / 1MB, 1)) MB) " -NoNewline
}

# ── 3. Registry verification ───────────────────────────────────────
Write-Host "`n--- Phase 3: Registry ---" -ForegroundColor Yellow

Test-Step "uninstall-registry" {
    $regPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Personas"
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Personas"
    )
    $found = $false
    foreach ($path in $regPaths) {
        if (Test-Path $path) { $found = $true; break }
    }
    if (-not $found) { throw "uninstall registry key not found" }
}

Test-Step "deep-link-protocol" {
    $protoPath = "Registry::HKEY_CLASSES_ROOT\personas"
    if (Test-Path $protoPath) {
        Write-Host "(personas://) " -NoNewline
    } else {
        # Non-fatal — protocol may be registered per-user
        Write-Host "(protocol not in HKCR — may be per-user) " -NoNewline
    }
}

# ── 4. Health check ────────────────────────────────────────────────
Write-Host "`n--- Phase 4: Health Check ---" -ForegroundColor Yellow

Test-Step "health-check" {
    $result = & $binary --health-check 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "health check failed (exit $exitCode): $($result -join '; ')"
    }
    $passed = $result | Where-Object { $_ -match "health-check: passed" }
    if (-not $passed) {
        throw "health check did not report 'passed': $($result -join '; ')"
    }
}

# ── 5. Silent uninstall ────────────────────────────────────────────
Write-Host "`n--- Phase 5: Uninstall ---" -ForegroundColor Yellow

Test-Step "silent-uninstall" {
    if (Test-Path $uninstaller) {
        $proc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
        Start-Sleep -Seconds 3
        if (Test-Path $binary) { throw "binary still exists after uninstall" }
    } else {
        throw "uninstaller not found — skipping"
    }
}

# ── Summary ─────────────────────────────────────────────────────────
Write-Host "`n=== Results ===" -ForegroundColor Cyan
if ($script:failures -eq 0) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
    exit 1
}
