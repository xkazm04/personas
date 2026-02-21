@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" arm64
cd /d "C:\Users\mkdol\dolla\personas"
npm run tauri dev
