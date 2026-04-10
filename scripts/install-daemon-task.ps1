# install-daemon-task.ps1 — Register personas-daemon as a Windows Task Scheduler entry.
#
# Usage:
#   .\install-daemon-task.ps1              # Register (current user, run at logon)
#   .\install-daemon-task.ps1 -Uninstall   # Remove the scheduled task
#
# The task runs as the current user at logon and restarts on failure.
# It does NOT require elevation unless you want "run whether user is logged on or not"
# (which requires the user's password). For Phase 0, logon-only is fine.
#
# Prerequisites:
#   - personas-daemon.exe built and accessible on PATH or in the same directory
#   - PERSONAS_DAEMON_MODE=1 set in the user's environment

param(
    [switch]$Uninstall,
    [string]$DaemonPath = "",
    [string]$DbPath = ""
)

$TaskName = "PersonasDaemon"
$Description = "Personas always-on daemon — fires scheduled triggers for headless personas"

if ($Uninstall) {
    Write-Host "Removing scheduled task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if ($?) {
        Write-Host "Task '$TaskName' removed successfully."
    } else {
        Write-Host "Task '$TaskName' was not found or could not be removed."
    }
    exit 0
}

# Find the daemon binary
if (-not $DaemonPath) {
    # Look in common locations
    $candidates = @(
        "$PSScriptRoot\..\src-tauri\target\release\personas-daemon.exe",
        "$PSScriptRoot\..\src-tauri\target\debug\personas-daemon.exe",
        (Get-Command personas-daemon -ErrorAction SilentlyContinue).Source
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -eq 0) {
        Write-Error @"
Could not find personas-daemon.exe.
Build it first:
  cd src-tauri && cargo build --bin personas-daemon --features daemon --release

Or specify the path:
  .\install-daemon-task.ps1 -DaemonPath "C:\path\to\personas-daemon.exe"
"@
        exit 1
    }
    $DaemonPath = (Resolve-Path $candidates[0]).Path
}

if (-not (Test-Path $DaemonPath)) {
    Write-Error "Daemon binary not found at: $DaemonPath"
    exit 1
}

Write-Host "Using daemon binary: $DaemonPath"

# Build the argument list
$Arguments = ""
if ($DbPath) {
    $Arguments = "--db-path `"$DbPath`""
}

# Check that PERSONAS_DAEMON_MODE is set
$envVal = [System.Environment]::GetEnvironmentVariable("PERSONAS_DAEMON_MODE", "User")
if ($envVal -ne "1") {
    Write-Host ""
    Write-Host "Setting PERSONAS_DAEMON_MODE=1 in user environment..."
    [System.Environment]::SetEnvironmentVariable("PERSONAS_DAEMON_MODE", "1", "User")
    Write-Host "  Done. The daemon will pick this up on next logon."
}

# Create the scheduled task
$Action = New-ScheduledTaskAction -Execute $DaemonPath -Argument $Arguments
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Settings: restart on failure (up to 3 times), don't stop on idle,
# don't limit execution time, allow start on battery
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

# Register (current user, logon-only — no password prompt)
Register-ScheduledTask `
    -TaskName $TaskName `
    -Description $Description `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -RunLevel Limited `
    -Force

if ($?) {
    Write-Host ""
    Write-Host "Task '$TaskName' registered successfully."
    Write-Host "The daemon will start automatically at next logon."
    Write-Host ""
    Write-Host "To start it now:  Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "To check status:  Get-ScheduledTask -TaskName '$TaskName' | Select-Object State"
    Write-Host "To remove:        .\install-daemon-task.ps1 -Uninstall"
} else {
    Write-Error "Failed to register the scheduled task."
    exit 1
}
