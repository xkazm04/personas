# Desktop App Start/Restart Runbook

## What was failing

`npm run tauri dev` failed in Rust build (`ring`) with:
- `failed to find tool "clang"`

On this machine, LLVM is installed (`C:\Program Files\LLVM\bin\clang.exe`) but that folder is not on terminal `PATH`, so builds fail intermittently depending on shell environment.

## One-time fix (recommended)

Add LLVM to user PATH permanently and restart terminals:

```powershell
setx PATH "$env:PATH;C:\Program Files\LLVM\bin"
```

Then close/reopen VS Code terminals.

## Reliable daily command

Use the helper script from the repo root:

```powershell
Set-Location .\personas
.\scripts\desktop-dev.ps1 -Restart
```

What it does:
1. Ensures `clang` is available (adds LLVM path for current session if needed).
2. Stops stale `personas-desktop` and repo-local stale Vite node processes (when `-Restart` is used).
3. Runs `npm run tauri dev`.

## Health checks

Check prerequisites quickly:

```powershell
Set-Location .\personas
.\scripts\desktop-dev.ps1 -CheckOnly
```

## If startup still fails

1. Confirm clang is visible:
```powershell
clang --version
```

2. Confirm Rust host target:
```powershell
rustc -vV
```

3. Retry clean restart:
```powershell
Set-Location .\personas
.\scripts\desktop-dev.ps1 -Restart
```

## Notes

- Current Rust host/toolchain is `aarch64-pc-windows-msvc`, so native-tool availability in this shell is mandatory.
- Running old binaries directly from `src-tauri\target\debug` is not a reliable dev flow; prefer `tauri dev` via the script.
