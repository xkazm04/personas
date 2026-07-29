#!/usr/bin/env node
// Dump a Windows PE binary's import table and report whether it carries an
// embedded side-by-side manifest.
//
// Why this exists: "why won't this binary load?" is otherwise an hour of
// archaeology, and guessing produces confidently wrong answers. A single
// STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) blocker in this repo survived
// months and two contradictory written root causes -- one claiming ONNX
// Runtime / DirectML, the other comctl32. The import table settled it in one
// run: the binary imported TaskDialogIndirect from comctl32.dll and imported
// no ORT at all. This repo also links ORT statically, so "which DLL does this
// actually need" is a recurring question that file-presence checks cannot
// answer.
//
// Usage:
//   node scripts/build/inspect-pe-imports.mjs <path-to-exe-or-dll>
//   node scripts/build/inspect-pe-imports.mjs <path> --symbols
//   node scripts/build/inspect-pe-imports.mjs <path> --symbols comctl32
//   node scripts/build/inspect-pe-imports.mjs <path> --json
//
// Zero dependencies. Reads the file; never executes it.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Parsed view of the bits of a PE we care about. */
export function inspectPe(filePath) {
  const buf = readFileSync(filePath);

  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${filePath}: not a PE image (missing MZ signature)`);
  }
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) {
    throw new Error(`${filePath}: not a PE image (missing PE\\0\\0 signature)`);
  }

  const numSections = buf.readUInt16LE(peOff + 6);
  const optHeaderSize = buf.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const magic = buf.readUInt16LE(optOff);
  const isPe32Plus = magic === 0x20b; // 0x10b = PE32, 0x20b = PE32+
  const machineCode = buf.readUInt16LE(peOff + 4);

  // Section table follows the optional header; needed to map RVA -> file offset.
  const sections = [];
  const secTableOff = optOff + optHeaderSize;
  for (let i = 0; i < numSections; i++) {
    const o = secTableOff + i * 40;
    if (o + 40 > buf.length) break;
    sections.push({
      virtualSize: buf.readUInt32LE(o + 8),
      virtualAddress: buf.readUInt32LE(o + 12),
      rawSize: buf.readUInt32LE(o + 16),
      rawPointer: buf.readUInt32LE(o + 20),
    });
  }

  const rvaToOffset = (rva) => {
    for (const s of sections) {
      // Use the larger of virtual/raw size: a section can be padded either way.
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
        const off = rva - s.virtualAddress + s.rawPointer;
        return off < buf.length ? off : -1;
      }
    }
    return -1;
  };

  const readCString = (off) => {
    if (off < 0 || off >= buf.length) return '';
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('latin1', off, end);
  };

  // Data directory entry 1 = import table.
  const dataDirOff = optOff + (isPe32Plus ? 112 : 96);
  const importRva = buf.readUInt32LE(dataDirOff + 8);

  const imports = [];
  if (importRva) {
    let desc = rvaToOffset(importRva);
    // Each IMAGE_IMPORT_DESCRIPTOR is 20 bytes; a zeroed one terminates.
    while (desc > 0 && desc + 20 <= buf.length) {
      const originalFirstThunk = buf.readUInt32LE(desc);
      const nameRva = buf.readUInt32LE(desc + 12);
      const firstThunk = buf.readUInt32LE(desc + 16);
      if (!nameRva) break;

      const dll = readCString(rvaToOffset(nameRva));
      const symbols = [];
      // Prefer the original (unbound) thunk array; fall back to firstThunk,
      // which is what a bound import leaves usable.
      let thunk = rvaToOffset(originalFirstThunk || firstThunk);
      const entrySize = isPe32Plus ? 8 : 4;
      const ordinalFlag = isPe32Plus ? 1n << 63n : 0x80000000;

      while (thunk > 0 && thunk + entrySize <= buf.length) {
        if (isPe32Plus) {
          const entry = buf.readBigUInt64LE(thunk);
          if (entry === 0n) break;
          if (entry & ordinalFlag) symbols.push(`#${entry & 0xffffn}`);
          else symbols.push(readCString(rvaToOffset(Number(entry & 0x7fffffffn)) + 2));
        } else {
          const entry = buf.readUInt32LE(thunk);
          if (entry === 0) break;
          if (entry & ordinalFlag) symbols.push(`#${entry & 0xffff}`);
          else symbols.push(readCString(rvaToOffset(entry & 0x7fffffff) + 2));
        }
        thunk += entrySize;
      }

      imports.push({ dll, symbols });
      desc += 20;
    }
  }

  // Manifest detection: an embedded RT_MANIFEST is literal XML in .rsrc, so a
  // byte scan is both sufficient and far simpler than walking the resource
  // tree. This is the signal that matters most in practice -- a missing
  // manifest is invisible in every other tool.
  const assemblyIdx = buf.indexOf(Buffer.from('<assembly', 'latin1'));
  let manifest = null;
  if (assemblyIdx >= 0) {
    const end = buf.indexOf(Buffer.from('</assembly>', 'latin1'), assemblyIdx);
    manifest = buf.toString('latin1', assemblyIdx, end > 0 ? end + 11 : assemblyIdx + 2048);
  }

  const MACHINES = { 0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'arm64', 0x1c4: 'arm' };

  return {
    file: filePath,
    machine: MACHINES[machineCode] ?? `0x${machineCode.toString(16)}`,
    format: isPe32Plus ? 'PE32+' : 'PE32',
    imports,
    manifest,
    hasManifest: manifest !== null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node scripts/build/inspect-pe-imports.mjs <exe|dll> [--symbols [dll]] [--json]');
    process.exit(2);
  }

  let pe;
  try {
    pe = inspectPe(target);
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(pe, null, 2));
    return;
  }

  const symbolsFlag = args.indexOf('--symbols');
  const symbolFilter = symbolsFlag >= 0 ? args[symbolsFlag + 1] : undefined;
  const wantSymbols = symbolsFlag >= 0;

  console.log(`${pe.file}`);
  console.log(`  format:   ${pe.format} (${pe.machine})`);
  console.log(`  manifest: ${pe.hasManifest ? 'embedded' : 'NONE'}`);
  if (!pe.hasManifest) {
    console.log('            ^ a binary importing a side-by-side-only entry point');
    console.log('              (e.g. comctl32 TaskDialogIndirect) will die at LOAD');
    console.log('              with STATUS_ENTRYPOINT_NOT_FOUND / 0xc0000139.');
  }
  console.log(`  imports:  ${pe.imports.length} DLL(s)`);
  for (const { dll, symbols } of pe.imports) {
    const show = wantSymbols
      && (!symbolFilter || symbolFilter.startsWith('--') || dll.toLowerCase().includes(symbolFilter.toLowerCase()));
    console.log(`    ${dll}${show ? '' : `  (${symbols.length} symbols)`}`);
    if (show) for (const s of symbols) console.log(`      ${s}`);
  }
}

// Only run the CLI when invoked directly, so run-rust-tests.mjs can import
// inspectPe() without triggering argument parsing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}
