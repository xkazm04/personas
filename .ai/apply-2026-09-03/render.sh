#!/bin/bash
# Reproduces kokoro.rs synthesize()'s exact sidecar invocation (personas
# src-tauri/src/companion/tts/kokoro.rs:220-247). Product code untouched.
K=/c/Users/mkdol/.personas/companion-tts/kokoro
BIN=/c/Users/mkdol/.personas/companion-tts/bin/sherpa-onnx-offline-tts.exe
SID=3   # af_heart, kokoro_catalog.rs
render() {
  local name="$1"; shift
  local text="$1"
  "$BIN" --kokoro-model="$K/model.onnx" --kokoro-voices="$K/voices.bin" \
    --kokoro-tokens="$K/tokens.txt" --kokoro-data-dir="$K/espeak-ng-data" \
    --kokoro-lexicon="$K/lexicon-us-en.txt" --num-threads=2 --sid=$SID \
    --output-filename="renders/$name.wav" "$text" >/dev/null 2>&1
  echo "$name $(stat -c%s renders/$name.wav 2>/dev/null || echo FAIL)"
}
