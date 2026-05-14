#!/usr/bin/env node
// Workaround for pyke's mislabeled ort-sys 2.0.0-rc.9 aarch64-pc-windows-msvc
// tarball. Self-healing: detects when pyke's cached `onnxruntime.lib` reports
// a machine type that doesn't match the host arch, and replaces the cache
// contents with Microsoft's official ONNX Runtime release for the host arch.
// On a clean cache it populates from Microsoft up front. Idempotent: skips
// when a sentinel records a verified-correct cache for the current target.
//
// Background — why this script exists:
//   `fastembed 4.9.1` pins `ort = "=2.0.0-rc.9"` and `ort-sys = "=2.0.0-rc.9"`.
//   Pyke's `dist.txt` line 8 for that version maps aarch64-pc-windows-msvc to
//   `parcel.pyke.io/.../ortrs_static-v1.20.0-aarch64-pc-windows-msvc.tgz` with
//   SHA256 `C09BFF…27DE`. The tarball hashes correctly (download verification
//   passes), but `dumpbin /HEADERS` on the extracted `onnxruntime.lib` reports
//   `machine (x64)` — i.e., the upstream tarball is mislabeled. This is a
//   hard upstream defect; `clean:ort` doesn't help because re-download fetches
//   the same broken bytes. Hash-based identity in `dist.txt` makes it
//   impossible to fix from the consumer side without either patching the
//   crate or pre-populating the cache directory the build script reads.
//
// What we do:
//   Pre-populate `%LOCALAPPDATA%/ort.pyke.io/dfbin/<target>/<hash>/onnxruntime/`
//   with Microsoft's official ORT 1.20.0 release for the host arch. The
//   `ort-sys` build script checks `if !lib_dir.exists()` and skips the broken
//   download when our directory is already there.
//
// Linkage change:
//   Pyke's tarball ships a 290 MB STATIC `onnxruntime.lib`. Microsoft's
//   release ships a small import library + `onnxruntime.dll` (DYNAMIC). The
//   `ort` crate's `copy-dylibs` feature (on by default) copies the DLL to
//   target/<profile>/, so dev and release builds both work; tauri-bundler
//   picks the DLL up from target/release/ for installers.

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { get as httpsGet } from "node:https";
import { URL } from "node:url";

// ─── Constants ──────────────────────────────────────────────────────────────

// Pinned to ort-sys 2.0.0-rc.9. The SHA256 below IS the cache directory name
// the build script computes from `dist.txt`. Bumping ort-sys requires
// reading the new dist.txt and updating these constants.
const ORT_SYS_VERSION = "2.0.0-rc.9";
const ORT_ONNXRUNTIME_VERSION = "1.20.0";

const PYKE_DIST_HASHES = {
  "aarch64-pc-windows-msvc": "C09BFF5582BCA2EC583E49A32E7B1B406AC930CB18791C3165E82B53516C27DE", // BROKEN — tarball is x64
  "x86_64-pc-windows-msvc":  "BB02D856F2747E4863C344BE38AF2A645E660E9055C871EE9984907497BE590A", // presumed OK
};

const HOST_TO_MS_ARCH = {
  "aarch64-pc-windows-msvc": "arm64",
  "x86_64-pc-windows-msvc":  "x64",
};

const HOST_TO_EXPECTED_MACHINE = {
  "aarch64-pc-windows-msvc": "arm64",
  "x86_64-pc-windows-msvc":  "x64",
};

const msReleaseUrl = (arch) =>
  `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_ONNXRUNTIME_VERSION}/onnxruntime-win-${arch}-${ORT_ONNXRUNTIME_VERSION}.zip`;

const SENTINEL_NAME = ".personas-ort-fix-applied";
const SENTINEL_VERSION = 1;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoTargetDir = join(repoRoot, "src-tauri", "target");

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[ensure-ort-cache] ${msg}\n`);
}

function fatal(msg) {
  process.stderr.write(`[ensure-ort-cache] ERROR: ${msg}\n`);
  process.exit(1);
}

function currentHostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function cacheRootForTarget(target) {
  return join(
    homedir(),
    "AppData",
    "Local",
    "ort.pyke.io",
    "dfbin",
    target,
    PYKE_DIST_HASHES[target],
  );
}

function ortBinaryDir(target) { return join(cacheRootForTarget(target), "onnxruntime"); }
function libDir(target)        { return join(ortBinaryDir(target), "lib"); }
function libFile(target)       { return join(libDir(target), "onnxruntime.lib"); }
function sentinelFile(target)  { return join(ortBinaryDir(target), SENTINEL_NAME); }

// Read the first object member of a COFF archive (.lib) and return its
// declared machine type. Defeats the "label says arm64, contents are x64"
// mismatch that motivated this script.
//
// Archive layout:
//   bytes 0..7   : "!<arch>\n"
//   then repeated: 60-byte member header + member data (2-byte aligned).
//   Member name is bytes 0..15 of the header (whitespace-padded ASCII).
//   Linker metadata members are named "/" or "//"; skip them.
//   First object member's first 2 bytes are the COFF machine field (LE).
function sniffLibArchitecture(libPath) {
  if (!existsSync(libPath)) return null;
  const buf = readFileSync(libPath);
  if (buf.length < 16) return "too-short";
  if (buf.slice(0, 8).toString("ascii") !== "!<arch>\n") return "not-coff-archive";

  let offset = 8;
  for (let i = 0; i < 20 && offset + 60 < buf.length; i++) {
    const name = buf.slice(offset, offset + 16).toString("ascii").trim();
    const sizeStr = buf.slice(offset + 48, offset + 58).toString("ascii").trim();
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(size)) return "bad-size";
    const dataStart = offset + 60;

    // Linker metadata: skip
    if (name === "/" || name === "//" || name === "/<HASH>" || name.startsWith("/ ")) {
      offset = dataStart + size + (size % 2);
      continue;
    }
    // First non-metadata member: read its COFF FILE HEADER's machine field.
    if (dataStart + 2 > buf.length) return "truncated";
    const machine = buf.readUInt16LE(dataStart);
    if (machine === 0x8664) return "x64";
    if (machine === 0xAA64) return "arm64";
    if (machine === 0x014C) return "x86";
    return `unknown-0x${machine.toString(16).padStart(4, "0")}`;
  }
  return "no-object-member-found";
}

function downloadToFile(url, destPath, maxRedirects = 6) {
  return new Promise((resolveP, rejectP) => {
    const attempt = (currentUrl, redirectsLeft) => {
      const req = httpsGet(
        currentUrl,
        { headers: { "User-Agent": "personas-ensure-ort-cache" } },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            if (redirectsLeft <= 0) {
              rejectP(new Error(`too many redirects fetching ${url}`));
              res.resume();
              return;
            }
            const next = new URL(res.headers.location, currentUrl).toString();
            res.resume();
            attempt(next, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            rejectP(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
            res.resume();
            return;
          }
          const total = Number(res.headers["content-length"]) || 0;
          let received = 0;
          let lastPctReported = -1;
          const out = createWriteStream(destPath);
          res.on("data", (chunk) => {
            received += chunk.length;
            if (total > 0) {
              const pct = Math.floor((received / total) * 100);
              if (pct !== lastPctReported && pct % 10 === 0) {
                process.stdout.write(`\r[ensure-ort-cache] downloading ${pct}%`);
                lastPctReported = pct;
              }
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            out.close();
            if (total > 0) process.stdout.write("\n");
            resolveP(received);
          });
          out.on("error", rejectP);
        },
      );
      req.on("error", rejectP);
      req.setTimeout(120_000, () => {
        req.destroy(new Error("download timed out after 120s"));
      });
    };
    attempt(url, maxRedirects);
  });
}

function extractZipWithSystemTar(zipPath, destDir) {
  // Windows ships BSD tar in System32 since 1803; it extracts .zip natively.
  const tarExe = join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe");
  if (!existsSync(tarExe)) {
    fatal(`tar.exe not found at ${tarExe}; cannot extract zip`);
  }
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync(tarExe, ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) {
    fatal(`tar -xf failed with exit code ${result.status}`);
  }
}

function copyTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, name.name);
    const destPath = join(destDir, name.name);
    if (name.isDirectory()) {
      copyTree(srcPath, destPath);
    } else if (name.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Invalidate cargo's ort/ort-sys build outputs in the target directory.
// Cargo doesn't track the upstream-downloaded ONNX Runtime binary as a
// rerun-if-changed input — when we swap the lib under cargo's feet, the
// existing rlib still has the previous arch's .obj members archived inside.
// Without this evict, the next `cargo build` happily reuses the stale rlib
// and the link error returns. Mirrors clean-ort.mjs's logic.
function evictCargoOrtArtifacts() {
  let removed = 0;
  for (const profile of ["debug", "release"]) {
    const buildDir = join(cargoTargetDir, profile, "build");
    if (existsSync(buildDir)) {
      for (const name of readdirSync(buildDir)) {
        if (/^ort(-sys)?-[0-9a-f]+$/i.test(name)) {
          rmSync(join(buildDir, name), { recursive: true, force: true });
          removed++;
        }
      }
    }
    const depsDir = join(cargoTargetDir, profile, "deps");
    if (existsSync(depsDir)) {
      for (const name of readdirSync(depsDir)) {
        if (/^(lib)?ort(_sys)?-[0-9a-f]+\.(rlib|rmeta|d)$/i.test(name)) {
          rmSync(join(depsDir, name), { force: true });
          removed++;
        }
      }
    }
  }
  if (removed > 0) {
    log(`evicted ${removed} stale ort artifact(s) from src-tauri/target/`);
  }
}

function writeSentinel(target, source, machine) {
  writeFileSync(
    sentinelFile(target),
    JSON.stringify({
      version: SENTINEL_VERSION,
      target,
      source,
      ort_sys_version: ORT_SYS_VERSION,
      ort_runtime_version: ORT_ONNXRUNTIME_VERSION,
      verified_machine: machine,
      verified_at: new Date().toISOString(),
    }, null, 2),
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

const t0 = performance.now();

const host = currentHostTriple();
if (!host) {
  log("rustc not on PATH — skipping (frontend-only contributor?)");
  process.exit(0);
}

if (!Object.prototype.hasOwnProperty.call(PYKE_DIST_HASHES, host)) {
  log(`host ${host} is not a known Windows MSVC target — skipping`);
  process.exit(0);
}

const target = host;
const expectedMachine = HOST_TO_EXPECTED_MACHINE[target];
const msArch = HOST_TO_MS_ARCH[target];
const libPath = libFile(target);
const sentinelPath = sentinelFile(target);

// Fast-path A: valid sentinel + lib still has correct machine type.
// Also guards against a stale rlib in cargo's target dir — if there's an
// existing ort-sys rlib that was built before the sentinel was last updated,
// it was linked against the previous-arch onnxruntime.lib and must be
// evicted, otherwise cargo's incremental compile reuses it and the link
// error returns.
if (existsSync(sentinelPath)) {
  try {
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
    if (sentinel.version === SENTINEL_VERSION && sentinel.target === target) {
      const machine = sniffLibArchitecture(libPath);
      if (machine === expectedMachine) {
        const sentinelMtimeMs = statSync(sentinelPath).mtimeMs;
        let staleRlib = false;
        for (const profile of ["debug", "release"]) {
          const depsDir = join(cargoTargetDir, profile, "deps");
          if (!existsSync(depsDir)) continue;
          for (const name of readdirSync(depsDir)) {
            if (/^libort_sys-[0-9a-f]+\.rlib$/i.test(name)) {
              const rlibMtimeMs = statSync(join(depsDir, name)).mtimeMs;
              if (rlibMtimeMs < sentinelMtimeMs) {
                staleRlib = true;
                break;
              }
            }
          }
          if (staleRlib) break;
        }
        if (staleRlib) {
          log(`sentinel current but cargo's ort-sys rlib predates it; evicting so cargo rebuilds against the fixed cache`);
          evictCargoOrtArtifacts();
        }
        log(`cache OK for ${target} (machine=${machine}, source=${sentinel.source})`);
        process.exit(0);
      }
      log(`sentinel exists but lib reports machine=${machine}, expected=${expectedMachine}; refixing`);
    }
  } catch {
    // Corrupt sentinel — fall through.
  }
}

// Fast-path B: no sentinel, but an existing lib happens to have the correct
// arch (i.e., pyke's tarball was OK for this target — e.g., x64 host). Mark
// it with a sentinel so future runs are O(1).
if (existsSync(libPath)) {
  const machine = sniffLibArchitecture(libPath);
  if (machine === expectedMachine) {
    writeSentinel(target, "pyke-passthrough", machine);
    log(`cache OK for ${target} (machine=${machine}, source=pyke-passthrough); sentinel written`);
    process.exit(0);
  }
  log(`existing lib has wrong machine type (got ${machine}, expected ${expectedMachine}); replacing with Microsoft ORT ${ORT_ONNXRUNTIME_VERSION}`);
}

// Fix path: wipe and repopulate from Microsoft's official release.
// Also evict cargo's ort/ort-sys build outputs — without this, the existing
// rlib (which has the wrong arch's .obj members archived inside it from the
// previous build) gets reused by cargo's incremental compile and the link
// error returns.
const targetCacheRoot = cacheRootForTarget(target);
if (existsSync(targetCacheRoot)) {
  rmSync(targetCacheRoot, { recursive: true, force: true });
}
mkdirSync(targetCacheRoot, { recursive: true });
evictCargoOrtArtifacts();

const zipUrl = msReleaseUrl(msArch);
const zipPath = join(tmpdir(), `onnxruntime-win-${msArch}-${ORT_ONNXRUNTIME_VERSION}.zip`);
log(`downloading ${zipUrl}`);
await downloadToFile(zipUrl, zipPath);
const zipSize = readFileSync(zipPath).length;
log(`downloaded ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

const stagingDir = join(targetCacheRoot, "_staging");
extractZipWithSystemTar(zipPath, stagingDir);

const innerDirName = `onnxruntime-win-${msArch}-${ORT_ONNXRUNTIME_VERSION}`;
const innerRoot = join(stagingDir, innerDirName);
const innerLibDir = join(innerRoot, "lib");
const innerIncludeDir = join(innerRoot, "include");
if (!existsSync(innerLibDir)) {
  fatal(`expected ${innerLibDir} after extraction; got entries: ${readdirSync(stagingDir).join(", ")}`);
}

const targetOnnxDir = ortBinaryDir(target);
mkdirSync(targetOnnxDir, { recursive: true });
copyTree(innerLibDir, libDir(target));
if (existsSync(innerIncludeDir)) {
  copyTree(innerIncludeDir, join(targetOnnxDir, "include"));
}

rmSync(stagingDir, { recursive: true, force: true });
try { rmSync(zipPath); } catch { /* zip cleanup is best-effort */ }

const finalMachine = sniffLibArchitecture(libPath);
if (finalMachine !== expectedMachine) {
  fatal(`after fix, lib reports machine=${finalMachine}, expected ${expectedMachine}`);
}

writeSentinel(target, `microsoft/onnxruntime-v${ORT_ONNXRUNTIME_VERSION}`, finalMachine);

const elapsedMs = Math.round(performance.now() - t0);
log(`cache populated for ${target} in ${elapsedMs}ms (machine=${finalMachine})`);
