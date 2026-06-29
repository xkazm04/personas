#!/usr/bin/env node
// Verify the app can find ONNX Runtime at runtime.
//
// ORT is linked one of two ways in this repo (see src-tauri/Cargo.toml and
// scripts/ensure-ort-cache.mjs):
//
//   * STATIC  (pyke-passthrough): pyke's `onnxruntime.lib` is a static lib
//     linked INTO personas-desktop.exe. No `onnxruntime.dll` exists or is
//     needed at runtime (this is what makes the exe ~148 MB).
//   * DYNAMIC (Microsoft-ORT swap, or ort's `load-dynamic` feature): the exe
//     imports `onnxruntime.dll` and MUST find it next to itself, or it
//     boot-crashes with "ONNX Runtime binary not found".
//
// The correct invariant is therefore LINKING-AWARE, not "a dll must always
// exist next to the exe": iff the exe imports onnxruntime.dll, that dll must
// be bundled beside it. We read the exe's PE import table — the ground truth
// of what was actually linked — instead of assuming a fixed linking mode.
// (The old version hard-required the dll, which false-failed every static
// pyke-passthrough build, e.g. installer acceptance + this gate.)
//
// Usage:
//   node scripts/verify-onnxruntime-bundling.mjs --target <triple>   # build dir: src-tauri/target/<triple>/release
//   node scripts/verify-onnxruntime-bundling.mjs --dir <path>        # explicit dir (e.g. an install tree)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXE = "personas-desktop.exe";
const DLL = "onnxruntime.dll";

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const target = argOf("--target");
const explicitDir = argOf("--dir");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let releaseDir;
if (explicitDir) {
  releaseDir = resolve(explicitDir);
} else if (target) {
  releaseDir = join(repoRoot, "src-tauri", "target", target, "release");
} else {
  console.error("usage: verify-onnxruntime-bundling.mjs (--target <triple> | --dir <path>)");
  process.exit(2);
}

if (!existsSync(releaseDir)) {
  console.error(`dir not found: ${releaseDir}`);
  process.exit(1);
}

const exePath = join(releaseDir, EXE);
const dllPath = join(releaseDir, DLL);

if (!existsSync(exePath)) {
  console.error(`missing exe: ${exePath}`);
  process.exit(1);
}

// ── PE import-table reader ──────────────────────────────────────────────────
// Returns a Set of imported DLL names (lowercased), or null if the file can't
// be parsed as a PE (caller falls back to a conservative presence check).
function importedDlls(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  try {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null; // 'MZ'
    const peOff = buf.readUInt32LE(0x3c);
    if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null; // 'PE\0\0'
    const coff = peOff + 4;
    const numSections = buf.readUInt16LE(coff + 2);
    const optSize = buf.readUInt16LE(coff + 16);
    const optOff = coff + 20;
    const magic = buf.readUInt16LE(optOff); // 0x10b PE32, 0x20b PE32+
    const ddOff = optOff + (magic === 0x20b ? 0x70 : 0x60); // data-directory array
    const importRva = buf.readUInt32LE(ddOff + 1 * 8); // directory[1] = import table
    if (!importRva) return new Set(); // statically self-contained — no imports

    const secOff = optOff + optSize;
    const sections = [];
    for (let i = 0; i < numSections; i++) {
      const s = secOff + i * 40;
      if (s + 40 > buf.length) return null;
      sections.push({
        vaddr: buf.readUInt32LE(s + 12),
        vsize: buf.readUInt32LE(s + 8),
        raw: buf.readUInt32LE(s + 20),
        rawsz: buf.readUInt32LE(s + 16),
      });
    }
    const rvaToOff = (rva) => {
      for (const s of sections) {
        const span = Math.max(s.vsize, s.rawsz);
        if (rva >= s.vaddr && rva < s.vaddr + span) return s.raw + (rva - s.vaddr);
      }
      return -1;
    };
    const readCStr = (off) => {
      if (off < 0 || off >= buf.length) return null;
      let end = off;
      while (end < buf.length && buf[end] !== 0) end++;
      return buf.toString("latin1", off, end);
    };

    const names = new Set();
    const descOff = rvaToOff(importRva);
    if (descOff < 0) return null;
    // IMAGE_IMPORT_DESCRIPTOR: 20 bytes; Name RVA at +12; all-zero terminator.
    for (let i = 0; ; i++) {
      const d = descOff + i * 20;
      if (d + 20 > buf.length) break;
      const origThunk = buf.readUInt32LE(d + 0);
      const nameRva = buf.readUInt32LE(d + 12);
      const firstThunk = buf.readUInt32LE(d + 16);
      if (origThunk === 0 && nameRva === 0 && firstThunk === 0) break;
      if (nameRva === 0) continue;
      const nm = readCStr(rvaToOff(nameRva));
      if (nm) names.add(nm.toLowerCase());
    }
    return names;
  } catch {
    return null;
  }
}

// ── decide ──────────────────────────────────────────────────────────────────
const onDiskDlls = readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith(".dll"))
  .map((f) => ({ name: f, size: statSync(join(releaseDir, f)).size }));

const imports = importedDlls(exePath);
const dllPresent = existsSync(dllPath);

function reportDlls() {
  if (onDiskDlls.length) {
    console.log(`DLLs alongside the exe in ${releaseDir}:`);
    for (const d of onDiskDlls) console.log(`  ${d.name} (${(d.size / 1024 / 1024).toFixed(2)} MiB)`);
  } else {
    console.log(`No DLLs alongside the exe in ${releaseDir} (self-contained build).`);
  }
}

if (imports === null) {
  // Couldn't parse the PE — don't guess. Fall back to the old conservative
  // presence check so a real dynamic build can't slip through unverified.
  console.warn(`WARN: could not parse PE import table of ${exePath}; falling back to presence check.`);
  reportDlls();
  if (!dllPresent) {
    console.error(`\nONNX Runtime check failed (fallback): ${DLL} not found next to ${EXE}.`);
    process.exit(1);
  }
  console.log(`\n${DLL} present (fallback presence check passed).`);
  process.exit(0);
}

const needsDll = imports.has(DLL);
reportDlls();

if (needsDll) {
  // Dynamic link: the exe imports onnxruntime.dll and will boot-crash without it.
  if (!dllPresent) {
    console.error(
      `\nONNX Runtime bundling check FAILED: ${EXE} dynamically imports ${DLL}, ` +
        `but ${DLL} is not next to it in ${releaseDir}.\n` +
        `fastembed/ort's bundled binary did not land (or load-dynamic was enabled ` +
        `without bundling the dll). The app will crash at boot with ` +
        `"ONNX Runtime binary not found". Bundle ${DLL} as a Tauri resource so it ` +
        `ships beside the exe.`,
    );
    process.exit(1);
  }
  console.log(`\nONNX Runtime bundled correctly: ${EXE} dynamically links ${DLL} and it is present.`);
  process.exit(0);
}

// Static link: ORT is compiled into the exe; no runtime dll needed.
console.log(
  `\nONNX Runtime OK: ${EXE} does NOT import ${DLL} -- ORT is statically linked into the exe ` +
    `(pyke-passthrough), so no runtime dll is required.` +
    (dllPresent ? ` (A stray ${DLL} is present; harmless.)` : ""),
);
process.exit(0);
