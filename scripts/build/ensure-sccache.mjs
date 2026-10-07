#!/usr/bin/env node
/**
 * Provision a size-capped sccache so parallel worktrees stop recompiling the
 * same 683 third-party crates from scratch, and hand `RUSTC_WRAPPER` to whoever
 * launches cargo.
 *
 * WHY THIS EXISTS (2026-10-07). Every worktree gets its own `CARGO_TARGET_DIR`,
 * and nothing is shared between them: a fresh worktree's first `cargo build
 * --lib` measured **490 s and 7.0 GB** (docs/development/build-measurement.md:123),
 * almost all of it dependency compiles that an adjacent worktree had already
 * done minutes earlier. A target dir cannot fix that — it is per-checkout by
 * construction, and it is also the thing that never garbage-collects: the main
 * `src-tauri/target` measured **48.8 GB** today and has reached **324 GB** in the
 * past (docs/development/build-cache.md). sccache is the opposite shape on both
 * counts: one content-addressed store shared by every checkout on the machine,
 * and it **self-prunes to a byte budget**.
 *
 * A shared cargo `build.build-dir` across worktrees was tried in 2026-09 and
 * REJECTED as unsafe — cargo's unit hash for a workspace member does not include
 * the checkout path, so one worktree gets reported `Fresh` against another
 * worktree's code (reproduced; build-measurement.md, "Rejected: a shared
 * build.build-dir across worktrees"). sccache has no such hole: it keys on the
 * preprocessed input, the compiler binary and the full flag set, so a hit is a
 * hit on identical inputs or it is not a hit.
 *
 * WHAT IT DOES AND DOES NOT BUY — read this before quoting a number.
 *   - It caches **non-incremental** compilation units. That is the ~683
 *     third-party dependency crates, which is where the 490 s mostly goes.
 *   - It does **NOT** cache this repo's own crates (`app_lib`/`personas-desktop`,
 *     `personas-db`, `personas-engine`, `personas-core`). Cargo passes
 *     `-C incremental=...` for workspace members in the dev profile, and rustc
 *     invocations with incremental compilation enabled are not cacheable —
 *     sccache counts them as "non-cacheable" and forwards them untouched.
 *   - So a fresh worktree still pays for compiling the repo's own crates. The
 *     win is real and it is bounded: dependencies, not everything. Do not let
 *     this file or the docs imply otherwise.
 *   - `CARGO_INCREMENTAL=0` would make the workspace crates cacheable too, at
 *     the cost of every warm rebuild. This script does not set it; that is a
 *     separate, deliberate trade (build-cache.md, "Tuning Cargo itself").
 *
 * ONE-TIME COST. Cargo folds the rustc wrapper into its fingerprints, so the
 * first build after sccache is switched on — or off — recompiles the world once.
 * Turn it on and leave it on. Toggling it per session is strictly worse than not
 * having it. (Reasoned from cargo's fingerprint inputs, not measured here: this
 * script is forbidden from running a build.)
 *
 * FAIL OPEN, LOUDLY. If the binary is absent and cannot be fetched, this prints
 * one line, sets nothing, and exits 0 so the build proceeds unwrapped. That is
 * the `guard-concurrent-cargo.mjs` precedent (its header argues it at length:
 * the cost of a false block is a developer who cannot compile at all) and it is
 * also what CI learned the hard way — `RUSTC_WRAPPER` was job-level and
 * un-overridable there, so the 2026-07-27 GitHub cache outage took the entire
 * Rust gate down with it for weeks. `.github/workflows/ci.yml:722-738` now
 * writes the wrapper only after sccache proves it can serve. Same rule here:
 * **nothing is exported until the server answers `--show-stats`.**
 *
 * IDEMPOTENT, AND IT SAYS SO FROM A MEASUREMENT. A second run re-resolves the
 * binary, probes the server with a TCP connect (the one way to ask "is it up?"
 * that does not start one as a side effect), re-reads the cap the server is
 * actually holding, and reports a no-op. It never restarts a live server: the
 * cap is immutable for a server's lifetime, so re-capping is an explicit
 * `--restart`, never something this script does behind a build's back.
 *
 * USAGE
 *   node scripts/build/ensure-sccache.mjs            # provision + report
 *   node scripts/build/ensure-sccache.mjs --json     # machine-readable result
 *   node scripts/build/ensure-sccache.mjs --env      # KEY=VALUE lines only
 *   node scripts/build/ensure-sccache.mjs --no-download   # use what is installed or nothing
 *   node scripts/build/ensure-sccache.mjs --restart  # re-cap a server started without the budget
 *
 *   PERSONAS_SCCACHE=off        never wrap (the CARGO_GUARD=off shape)
 *   PERSONAS_SCCACHE_BIN=<p>    use exactly this binary, provision nothing
 *   SCCACHE_SERVER_PORT=<n>     sccache's own; the liveness probe follows it
 *
 *   import { ensureSccache } from "./ensure-sccache.mjs";
 *   const r = await ensureSccache();   // → { ok, bin, env, action, reason, stats }
 *
 * HOW THE ENVIRONMENT ACTUALLY REACHES CARGO — and the one thing this script
 * cannot do. A child process cannot write its parent's environment. So the CLI
 * form CANNOT wrap a cargo that some other process launches: an npm `pre*`
 * script runs in its own process and its env dies with it. The three real paths,
 * in order of preference:
 *   1. **Import it.** `scripts/build/cargo-run.mjs` spawns cargo with
 *      `{ ...process.env }` and is contractually forbidden from clobbering
 *      `RUSTC_WRAPPER`, so one `await ensureSccache()` at its top makes every
 *      cargo this repo launches wrapped. That is one line in that file and it is
 *      the intended wiring.
 *   2. **Eval the export lines.** `--env` prints `KEY=VALUE` per line for a
 *      shell to consume.
 *   3. **Read the handoff file.** The resolved values are also written to
 *      `.claude/.sccache-env.json` (gitignored scratch, same place
 *      `cache-budget.mjs` keeps its snapshot) so a later process can pick them
 *      up without re-probing.
 * This script does 1 (for its own process), 2 and 3. It deliberately does not
 * write `~/.cargo/config.toml` or call `setx`: both would wrap every cargo
 * invocation on the machine, for every project, and would break every build on
 * the day the binary is removed — the exact single-point-of-failure CI already
 * paid for.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { get as httpsGet } from "node:https";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Pinned. Bumping this means re-reading the release's `.sha256` sidecars and
 * replacing both digests below — a build tool that gets statically trusted by
 * every compile on this machine is not something to fetch unverified.
 */
export const SCCACHE_VERSION = "0.18.0";

/**
 * The operator's byte budget. A cache without one is a directory that grows
 * until the disk intervenes, which is precisely the failure mode `target/`
 * already demonstrates at 48.8 GB. sccache enforces this itself by evicting
 * least-recently-used objects — there is no reaper to write for it.
 *
 * sccache reads it when the SERVER starts and then holds it for the server's
 * lifetime, so changing it requires a `sccache --stop-server`.
 */
export const SCCACHE_CACHE_SIZE = "20G";

/**
 * SHA-256 of the release zip per host triple, as published in the
 * `<asset>.sha256` sidecar at mozilla/sccache v0.18.0 (read 2026-10-07).
 * The sidecar is fetched at download time as well and both must agree — the
 * pin catches a re-cut release, the sidecar catches a stale pin.
 */
export const ZIP_SHA256 = {
  "aarch64-pc-windows-msvc": "205d613fa74a9a0525e41a5ace77b1c71907d5bd4a5e668bad79111776829290",
  "x86_64-pc-windows-msvc": "8965c74d5e8a225244f741e18ad2f3f504f48228dc1bac948fc22761a348363d",
};

const DOWNLOAD_TIMEOUT_MS = 120_000;

const assetName = (triple) => `sccache-v${SCCACHE_VERSION}-${triple}.zip`;
const assetUrl = (triple) =>
  `https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/${assetName(triple)}`;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/**
 * Where a provisioned binary lands: beside the other cargo-adjacent tools the
 * operator already has there (`cargo-sweep.exe`, `cargo-deny.exe`), which is on
 * PATH, so `sccache` resolves by name afterwards and `cargo install sccache`
 * would simply overwrite it.
 */
const CARGO_BIN = join(homedir(), ".cargo", "bin");
const EXE = process.platform === "win32" ? "sccache.exe" : "sccache";

/** Gitignored scratch — the same directory `cache-budget.mjs` keeps its snapshot in. */
const ENV_HANDOFF = join(ROOT, ".claude", ".sccache-env.json");

// ─── Helpers ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

/** Everything human-readable goes to stderr so `--env` / `--json` stay pipeable. */
function log(msg) {
  process.stderr.write(`[ensure-sccache] ${msg}\n`);
}

function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return out.match(/^host:\s*(\S+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * First existing candidate, or null. PATH is consulted via `where`/`which`.
 *
 * `PERSONAS_SCCACHE_BIN` names an exact binary instead — for an operator with
 * sccache somewhere unusual, and for the test that proves the fail-open branch
 * works (point it at a path that does not exist and nothing is provisioned, so
 * the unwrapped path can be exercised without touching the real install).
 *
 * Exported so a read-only reporter (`build-disk.mjs`) can locate the binary
 * without provisioning or starting anything.
 */
export function findInstalled() {
  const pinned = process.env.PERSONAS_SCCACHE_BIN;
  if (pinned) return existsSync(pinned) ? pinned : null;

  const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["sccache"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (onPath.status === 0) {
    const first = (onPath.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  }
  const inCargoBin = join(CARGO_BIN, EXE);
  if (existsSync(inCargoBin)) return inCargoBin;
  return null;
}

/** `sccache --version` → "0.18.0", or null if the binary will not run. */
function versionOf(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 20_000 });
  if (r.status !== 0) return null;
  return (r.stdout || "").trim().match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

function downloadToFile(url, destPath, maxRedirects = 6) {
  return new Promise((resolveP, rejectP) => {
    const attempt = (currentUrl, redirectsLeft) => {
      const req = httpsGet(
        currentUrl,
        { headers: { "User-Agent": "personas-ensure-sccache" } },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            if (redirectsLeft <= 0) {
              res.resume();
              rejectP(new Error(`too many redirects fetching ${url}`));
              return;
            }
            const next = new URL(res.headers.location, currentUrl).toString();
            res.resume();
            attempt(next, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            rejectP(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
            return;
          }
          const total = Number(res.headers["content-length"]) || 0;
          let received = 0;
          let lastPct = -1;
          const out = createWriteStream(destPath);
          res.on("data", (chunk) => {
            received += chunk.length;
            if (total > 0) {
              const pct = Math.floor((received / total) * 100);
              if (pct !== lastPct && pct % 25 === 0) {
                log(`downloading ${pct}%`);
                lastPct = pct;
              }
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            out.close();
            resolveP(received);
          });
          out.on("error", rejectP);
        },
      );
      req.on("error", rejectP);
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy(new Error(`download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`));
      });
    };
    attempt(url, maxRedirects);
  });
}

/** The published sidecar, or null when it cannot be read (not fatal on its own). */
function fetchSidecarSha(triple) {
  const url = `${assetUrl(triple)}.sha256`;
  const tmp = join(tmpdir(), `sccache-sidecar-${process.pid}.txt`);
  try {
    // curl is present on Windows 10+ and every POSIX host; a 64-byte fetch is
    // not worth a second promise-based download path.
    const r = spawnSync("curl", ["-sSL", "--max-time", "30", "-o", tmp, url], {
      encoding: "utf8",
      timeout: 40_000,
    });
    if (r.status !== 0) return null;
    const text = readFileSync(tmp, "utf8").trim();
    return text.match(/\b([0-9a-f]{64})\b/i)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
  }
}

function extractZipWithSystemTar(zipPath, destDir) {
  // Windows ships BSD tar in System32 since 1803; it extracts .zip natively.
  // Same approach as scripts/ensure-ort-cache.mjs.
  const tarExe =
    process.platform === "win32"
      ? join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe")
      : "tar";
  if (process.platform === "win32" && !existsSync(tarExe)) {
    throw new Error(`tar.exe not found at ${tarExe}; cannot extract zip`);
  }
  mkdirSync(destDir, { recursive: true });
  const r = spawnSync(tarExe, ["-xf", zipPath, "-C", destDir], { stdio: "ignore" });
  if (r.status !== 0) throw new Error(`tar -xf failed with exit code ${r.status}`);
}

/** The extracted tree is `sccache-v<ver>-<triple>/sccache.exe`; find it anyway. */
function findExeUnder(dir, depth = 0) {
  if (depth > 3) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === EXE.toLowerCase()) return p;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findExeUnder(join(dir, e.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Download, verify against BOTH the pin and the published sidecar, extract, and
 * place the binary. Throws on any failure; the caller fails open.
 */
async function provision(triple) {
  const expected = ZIP_SHA256[triple];
  if (!expected) throw new Error(`no pinned sha256 for host triple ${triple}`);

  const staging = join(tmpdir(), `personas-sccache-${process.pid}`);
  mkdirSync(staging, { recursive: true });
  const zipPath = join(staging, assetName(triple));
  try {
    const url = assetUrl(triple);
    log(`downloading ${url}`);
    await downloadToFile(url, zipPath);

    const actual = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
    if (actual !== expected) {
      throw new Error(
        `SHA256 mismatch for ${assetName(triple)}\n  pinned   ${expected}\n  got      ${actual}\n` +
          `Refusing to install — this binary would wrap every rustc invocation on this machine.`,
      );
    }
    const sidecar = fetchSidecarSha(triple);
    if (sidecar === null) {
      log(`WARNING: could not read the published .sha256 sidecar; the pinned digest matched and is being trusted alone`);
    } else if (sidecar !== actual) {
      throw new Error(
        `published sidecar disagrees with the bytes downloaded\n  sidecar  ${sidecar}\n  got      ${actual}\n` +
          `Refusing to install.`,
      );
    } else {
      log(`sha256 verified against the pin and the published sidecar (${actual.slice(0, 12)}…)`);
    }

    const unpacked = join(staging, "unpacked");
    extractZipWithSystemTar(zipPath, unpacked);
    const exe = findExeUnder(unpacked);
    if (!exe) throw new Error(`no ${EXE} found in the extracted archive`);

    mkdirSync(CARGO_BIN, { recursive: true });
    const dest = join(CARGO_BIN, EXE);
    copyFileSync(exe, dest);
    return dest;
  } finally {
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * `20G` / `20 GiB` / `512M` → bytes, or null. sccache prints `G` as `GiB`, so
 * the binary prefixes are the right reading of both forms (verified 2026-10-07:
 * a server started with `SCCACHE_CACHE_SIZE=20G` reports `Max cache size 20 GiB`).
 */
export function parseByteSize(text) {
  const m = /^\s*([\d.]+)\s*([KMGT]?)(?:i?B)?\s*$/i.exec(String(text ?? ""));
  if (!m) return null;
  const mult = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2].toUpperCase()];
  return Math.round(Number(m[1]) * mult);
}

/**
 * Parse `sccache --show-stats` (text form; `--stats-format=json` exists but its
 * field names have moved between releases and the text form has not).
 * Returns null when the output cannot be read at all.
 *
 * There is NO "current cache size" field in 0.18.0 — the first version of this
 * file invented one and printed `size ?`. The bytes on disk are measured by
 * `scripts/build/build-disk.mjs` instead, from the `cacheLocation` below.
 */
export function parseStats(text) {
  if (!text) return null;
  const num = (label) => {
    const m = new RegExp(`^${label}\\s+(\\d+)\\s*$`, "mi").exec(text);
    return m ? Number(m[1]) : null;
  };
  const str = (label) => {
    const m = new RegExp(`^${label}\\s+(.+)$`, "mi").exec(text);
    return m ? m[1].trim() : null;
  };
  const hits = num("Cache hits");
  const misses = num("Cache misses");
  const denom = (hits ?? 0) + (misses ?? 0);
  const maxCacheSize = str("Max cache size");
  return {
    compileRequests: num("Compile requests"),
    compileRequestsExecuted: num("Compile requests executed"),
    cacheHits: hits,
    cacheMisses: misses,
    nonCacheableCompilations: num("Non-cacheable compilations"),
    // null, not 0: "no requests yet" and "0% of 4,000 requests" are different
    // facts, and a hit rate printed as 0 for the first conflates them. sccache
    // agrees — its own "Cache hits rate" field prints `-` in that state.
    hitRatePct: denom > 0 ? Math.round((hits / denom) * 1000) / 10 : null,
    cacheLocation: str("Cache location"),
    maxCacheSize,
    maxCacheSizeBytes: parseByteSize(maxCacheSize),
    raw: text.trim(),
  };
}

/**
 * Ask the RUNNING SERVER for its stats, with `SCCACHE_CACHE_SIZE` deliberately
 * removed from the probe's environment.
 *
 * THAT DELETION IS THE WHOLE POINT, and the first version of this file got it
 * wrong. Measured 2026-10-07 on sccache 0.18.0:
 *   - `Max cache size` comes from the SERVER, fixed when the server started.
 *   - A client asking with `SCCACHE_CACHE_SIZE=5G` against a 20 GiB server is
 *     told **20 GiB** — the client's value is ignored.
 *   - So a probe that passes the cap it *wants* reads back its own wish and can
 *     never detect a server running with the 10 GiB default. Removing it makes
 *     the number a measurement instead of an echo.
 */
export function serverStats(bin) {
  const env = { ...process.env };
  delete env.SCCACHE_CACHE_SIZE;
  const r = spawnSync(bin, ["--show-stats"], { encoding: "utf8", timeout: 60_000, env });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n")[0] };
  }
  return { ok: true, stats: parseStats(r.stdout) };
}

/**
 * Is a server already listening? A TCP connect, because every sccache CLI route
 * to the answer has a side effect: `--show-stats` AUTO-STARTS a server (with
 * whatever cap the asking client's env happens to carry — which is how the
 * 10 GiB default gets installed by accident) and `--stop-server` kills it. This
 * probe mutates nothing, which is what lets the idempotency claim below be a
 * measurement rather than an assumption.
 *
 * 4226 is sccache's default; `SCCACHE_SERVER_PORT` overrides it, same as sccache.
 */
export function serverListening(port = Number(process.env.SCCACHE_SERVER_PORT) || 4226) {
  return new Promise((resolveP) => {
    const sock = connect({ host: "127.0.0.1", port });
    const done = (answer) => {
      sock.destroy();
      resolveP(answer);
    };
    sock.setTimeout(750, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/**
 * Start the server with the cap applied, DETACHED, and wait for it to answer.
 *
 * Detached and unref'd deliberately: a server started as a tracked child of this
 * node process does not reliably outlive it on Windows. Observed 2026-10-07 —
 * the first run here started a 20 GiB server through `spawnSync`, node exited,
 * and the next client found no server, auto-started its own *without* the cap,
 * and quietly got the **10 GiB default**. An unenforced byte budget that reports
 * itself as enforced is the failure this script exists to prevent.
 *
 * "Address in use" is the success case when a server is already up, so the exit
 * code is not consulted; whether a server answers is.
 */
async function startServer(bin, cacheSize) {
  try {
    const child = spawn(bin, ["--start-server"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, SCCACHE_CACHE_SIZE: cacheSize },
      windowsHide: true,
    });
    child.unref();
  } catch {
    return { ok: false, error: "could not spawn --start-server" };
  }
  let last = { ok: false, error: "server did not answer" };
  for (let i = 0; i < 20; i++) {
    last = serverStats(bin);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

// ─── The one entry point ────────────────────────────────────────────────────

/**
 * @param {{ download?: boolean, cacheSize?: string, restart?: boolean }} [opts]
 * @returns {Promise<{ok:boolean, bin:string|null, version:string|null, env:Record<string,string>,
 *                     action:"found"|"provisioned"|"absent", reason:string|null,
 *                     stats:ReturnType<typeof parseStats>|null, cacheSize:string,
 *                     capEnforced:boolean|null, capWarning:string|null}>}
 */
export async function ensureSccache({ download = true, cacheSize = SCCACHE_CACHE_SIZE, restart = false } = {}) {
  const fail = (reason) => ({
    ok: false,
    bin: null,
    version: null,
    env: {},
    action: "absent",
    reason,
    stats: null,
    cacheSize,
    capEnforced: null,
    capWarning: null,
    server: null,
  });

  // The off switch, same shape as CARGO_GUARD=off and CACHE_AUTO_PRUNE=0. There
  // is one real use beyond testing: cargo folds the wrapper into its
  // fingerprints, so comparing a wrapped against an unwrapped build needs a way
  // to ask for the unwrapped one without uninstalling anything.
  if (process.env.PERSONAS_SCCACHE === "off") return fail("PERSONAS_SCCACHE=off");

  const triple = hostTriple();
  // A missing rustc is not an error here — a frontend-only contributor has no
  // cargo to wrap. Same early-out as ensure-ort-cache.mjs.
  if (!triple) return fail("rustc not on PATH — nothing to wrap");

  let bin = findInstalled();
  let action = bin ? "found" : "absent";

  if (!bin) {
    if (!download) return fail("not installed, and downloading was not permitted");
    if (!ZIP_SHA256[triple]) return fail(`no pinned release for host triple ${triple}`);
    try {
      bin = await provision(triple);
      action = "provisioned";
    } catch (e) {
      return fail(`could not provision: ${e.message}`);
    }
  }

  const version = versionOf(bin);
  if (!version) return fail(`${bin} will not run (--version failed)`);

  const env = {
    RUSTC_WRAPPER: bin,
    SCCACHE_CACHE_SIZE: cacheSize,
  };

  // An explicit, operator-invoked restart is the only way to re-cap a server
  // that is already up: the cap is immutable for a server's lifetime. It is
  // never automatic — the server may be serving another session's build, and
  // a smaller-than-intended cache is a working cache.
  if (restart) {
    spawnSync(bin, ["--stop-server"], { encoding: "utf8", timeout: 60_000, stdio: "ignore" });
  }

  // NOTHING is exported before the server answers. This is the CI lesson
  // (ci.yml:722-738): a wrapper that cannot serve turns every compile into a
  // hard failure, which is strictly worse than no cache.
  const wasListening = !restart && (await serverListening());
  const probe = wasListening ? serverStats(bin) : await startServer(bin, cacheSize);
  if (!probe.ok) {
    return fail(`sccache is installed but will not serve (${probe.error}) — leaving cargo unwrapped`);
  }

  // Did the budget actually take? See serverStats() for why this is a
  // measurement and not an echo.
  const wantBytes = parseByteSize(cacheSize);
  const gotBytes = probe.stats?.maxCacheSizeBytes ?? null;
  const capEnforced = wantBytes !== null && gotBytes !== null ? gotBytes === wantBytes : null;
  let capWarning = null;
  if (capEnforced === false) {
    capWarning =
      `the running sccache server caps the cache at ${probe.stats.maxCacheSize}, NOT the ${cacheSize} budget. ` +
      `A server's cap is fixed when it starts, so this one was started without SCCACHE_CACHE_SIZE ` +
      `(sccache's own default is 10 GiB). Fix it when no build is live: ` +
      `\`sccache --stop-server\` then re-run this script, or run it with --restart.`;
  } else if (capEnforced === null) {
    capWarning = `could not read the server's cache cap — it is NOT confirmed at ${cacheSize}`;
  }

  // Apply to THIS process so an importer (cargo-run.mjs) inherits it for free.
  Object.assign(process.env, env);

  try {
    mkdirSync(dirname(ENV_HANDOFF), { recursive: true });
    writeFileSync(
      ENV_HANDOFF,
      JSON.stringify({ writtenAt: new Date().toISOString(), version, env }, null, 2),
    );
  } catch (e) {
    log(`WARNING: could not write the env handoff file (${e.message}); in-process env is still set`);
  }

  return {
    ok: true,
    bin,
    version,
    env,
    action,
    reason: null,
    stats: probe.stats,
    cacheSize,
    capEnforced,
    capWarning,
    server: wasListening ? "already-running" : "started",
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

// Windows paths are case-insensitive; compare folded. Same guard shape as
// cache-budget.mjs so this file is safe to import.
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const SELF = fileURLToPath(import.meta.url);

if (process.argv[1] && samePath(resolve(process.argv[1]), SELF)) {
  const result = await ensureSccache({ download: !flag("no-download"), restart: flag("restart") });

  if (flag("json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (flag("env")) {
    for (const [k, v] of Object.entries(result.env)) process.stdout.write(`${k}=${v}\n`);
  }

  if (!result.ok) {
    // One line, set nothing, exit 0. The build proceeds unwrapped.
    log(`not enabled: ${result.reason}`);
    log(`builds will run unwrapped — slower, not broken`);
    process.exit(0);
  }

  const s = result.stats;
  const nothingChanged = result.action === "found" && result.server === "already-running";
  if (result.action === "provisioned") {
    log(`provisioned sccache ${result.version} → ${result.bin}`);
  } else {
    log(`sccache ${result.version} already at ${result.bin}`);
  }
  log(
    result.server === "started"
      ? `server started with SCCACHE_CACHE_SIZE=${result.cacheSize}`
      : `server already listening — not restarted`,
  );
  log(`cache at ${s?.cacheLocation ?? "(location not reported)"}, server cap ${s?.maxCacheSize ?? "unknown"}`);
  if (result.capWarning) log(`WARNING: ${result.capWarning}`);
  if (s && s.hitRatePct === null) {
    log(`hit rate: no compile requests recorded yet (a true starting measurement, not a failure)`);
  } else if (s) {
    log(`hit rate: ${s.hitRatePct}% (${s.cacheHits} hit / ${s.cacheMisses} miss), ${s.nonCacheableCompilations ?? "?"} non-cacheable`);
  }
  log(`RUSTC_WRAPPER=${result.bin}`);
  if (nothingChanged) log(`no-op: nothing to install, nothing to start`);
  log(`a child cannot set its parent's env: import ensureSccache() from the process that spawns cargo, or eval \`--env\``);
  process.exit(0);
}

/**
 * mtime of the env handoff file in ms, or null when it has never been written.
 * For a caller that prefers reading `.claude/.sccache-env.json` over re-probing
 * and needs to know how old that answer is.
 */
export function handoffWrittenAtMs() {
  try {
    return statSync(ENV_HANDOFF).mtimeMs;
  } catch {
    return null;
  }
}
