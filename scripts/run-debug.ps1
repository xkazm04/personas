$env:RUST_BACKTRACE = "full"
$env:RUST_LOG = "debug,personas_desktop=trace"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logFile = Join-Path $repoRoot "crash-stderr.log"

Write-Host "[debug] Starting app with full backtrace, logging stderr to $logFile"
Write-Host "[debug] Repo root: $repoRoot"

# Start Vite dev server first
$viteProc = Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory $repoRoot -PassThru -NoNewWindow
Start-Sleep -Seconds 5

# Run the Rust binary directly
$exePath = Join-Path $repoRoot "src-tauri\target\debug\personas-desktop.exe"
Write-Host "[debug] Running: $exePath"
& $exePath 2>&1 | Tee-Object -FilePath $logFile
$exitCode = $LASTEXITCODE
Write-Host "[debug] App exited with code: $exitCode (hex: 0x$($exitCode.ToString('X')))"

# Cleanup vite
if ($viteProc -and !$viteProc.HasExited) {
    Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
}
