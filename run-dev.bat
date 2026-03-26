@echo off
setlocal

rem Navigate to repo root (where this script lives)
cd /d "%~dp0"

rem Try to set up MSVC environment if vcvarsall.bat is found
set "VCVARSALL="
for %%A in (
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat"
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
) do (
  if exist %%A set "VCVARSALL=%%~A"
)

if defined VCVARSALL (
  echo [run-dev] Using vcvarsall: %VCVARSALL%
  call "%VCVARSALL%" %PROCESSOR_ARCHITECTURE%
) else (
  echo [run-dev] WARNING: vcvarsall.bat not found. Build may fail if MSVC is not already on PATH.
)

echo [run-dev] Repo root: %cd%
echo [run-dev] Starting desktop app via: npm run tauri dev
npm run tauri dev
