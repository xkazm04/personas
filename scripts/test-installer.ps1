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
#   0  -- all checks passed
#   1  -- one or more checks failed
#
# Compatibility: ASCII-only on purpose. Windows PowerShell 5.1's default
# console codepage (cp1252 on most en-US installs) mis-decodes UTF-8 box-
# drawing characters and refuses to parse the file. Use ASCII -- / == in
# section headers and error messages so the script runs on both
# `powershell.exe` (5.1) and `pwsh` (7+).

param(
    [string]$Installer,
    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64'
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

# -- Resolve installer path -------------------------------------------
if (-not $Installer) {
    $Installer = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\Personas_*_$Arch-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $Installer -or -not (Test-Path $Installer)) {
    Write-Host "ERROR: No installer found. Build first with 'npx tauri build' or pass -Installer <path>" -ForegroundColor Red
    exit 1
}

Write-Host "Installer: $Installer"

# -- Determine expected install directory -----------------------------
# NSIS currentUser mode installs to %LOCALAPPDATA%\Personas
$installDir = Join-Path $env:LOCALAPPDATA "Personas"
$binary = Join-Path $installDir "personas-desktop.exe"
$uninstaller = Join-Path $installDir "uninstall.exe"

# -- 1. Silent install ------------------------------------------------
Write-Host "`n--- Phase 1: Install ---" -ForegroundColor Yellow

Test-Step "silent-install" {
    $proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) { throw "installer exited with code $($proc.ExitCode)" }
    # Give filesystem a moment to flush
    Start-Sleep -Seconds 2
}

# -- 2. Verify file placement -----------------------------------------
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
    if ($size -lt 20MB) { throw "binary is only $([math]::Round($size / 1MB, 1)) MB -- expected >20 MB" }
    Write-Host "($([math]::Round($size / 1MB, 1)) MB) " -NoNewline
}

Test-Step "onnxruntime-runtime" {
    # Linking-aware ONNX Runtime check on the INSTALLED tree. ORT can be linked
    # two ways here: STATIC (pyke-passthrough) bakes it into the exe (no dll
    # needed), or DYNAMIC (Microsoft-ORT swap / load-dynamic) where the exe
    # imports onnxruntime.dll and boot-crashes without it next to the exe.
    # Delegate to the shared PE-import-aware checker so the installed tree is
    # judged by the exact rule as the CI release gate -- it exits non-zero iff
    # the exe imports onnxruntime.dll but the dll is missing beside it (a static
    # build no longer false-fails for a dll it never needed).
    # Capture via temp files (the health-check pattern below) so PowerShell 5.1
    # native-stderr wrapping can't trip $ErrorActionPreference = Stop.
    $tmpOut = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath "node" `
            -ArgumentList @("scripts\verify-onnxruntime-bundling.mjs", "--dir", $installDir) `
            -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
        $code = $p.ExitCode
        $out = @(Get-Content $tmpOut -ErrorAction SilentlyContinue) + @(Get-Content $tmpErr -ErrorAction SilentlyContinue)
    } finally {
        Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) { throw (($out | Where-Object { $_ }) -join '; ') }
    $summary = $out | Where-Object { $_ -match "ONNX Runtime" } | Select-Object -Last 1
    if ($summary) { Write-Host "($($summary.Trim())) " -NoNewline }
}

# -- 3. Registry verification -----------------------------------------
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
        # Non-fatal -- protocol may be registered per-user
        Write-Host "(protocol not in HKCR -- may be per-user) " -NoNewline
    }
}

# -- 4. Health check --------------------------------------------------
Write-Host "`n--- Phase 4: Health Check ---" -ForegroundColor Yellow

Test-Step "health-check" {
    # personas-desktop.exe is built with the Windows GUI subsystem, so
    # invoking it via PowerShell's `&` detaches it from the parent
    # console and PowerShell can't capture stdout / $LASTEXITCODE
    # (returns empty exit + empty output). Use Start-Process with
    # explicit pipe redirection to a temp file -- that's the only
    # PowerShell pattern that reliably captures both for a GUI exe.
    $tmpOut = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $binary -ArgumentList "--health-check" `
            -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
        $exitCode = $p.ExitCode
        $stdout = Get-Content $tmpOut -ErrorAction SilentlyContinue
        $stderr = Get-Content $tmpErr -ErrorAction SilentlyContinue
        $result = @($stdout) + @($stderr) | Where-Object { $_ }
    } finally {
        Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
    }
    if ($exitCode -ne 0) {
        throw "health check failed (exit $exitCode): $($result -join '; ')"
    }
    $passed = $result | Where-Object { $_ -match "health-check: passed" }
    if (-not $passed) {
        throw "health check did not report 'passed': $($result -join '; ')"
    }
}

# -- 5. Silent uninstall ----------------------------------------------
Write-Host "`n--- Phase 5: Uninstall ---" -ForegroundColor Yellow

Test-Step "silent-uninstall" {
    if (Test-Path $uninstaller) {
        $proc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
        Start-Sleep -Seconds 3
        if (Test-Path $binary) { throw "binary still exists after uninstall" }
    } else {
        throw "uninstaller not found -- skipping"
    }
}

# -- Summary ----------------------------------------------------------
Write-Host "`n=== Results ===" -ForegroundColor Cyan
if ($script:failures -eq 0) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
    exit 1
}
