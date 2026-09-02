#!/usr/bin/env node
/**
 * Checks parity between Rust event_registry.rs and TypeScript eventRegistry.ts.
 * Payload shape parity remains a TypeScript/Rust binding concern; this script
 * focuses on event-name drift, which has caused silent listener misses.
 *
 * Three passes, in order:
 *
 *  1. NAME PARITY   — the two registries declare the same vocabulary.
 *  2. CALL SITES    — every literal `listen()`/`emit()` name under src/ is in
 *                     the registry (catches names whose authority is a private
 *                     const beside their emitter).
 *  3. PAIRING       — every event Rust names outside the registry is REFERENCED
 *                     at least once by non-test TypeScript. Passes 1 and 2 both
 *                     run green on an event that Rust emits into the void: the
 *                     name is declared on both sides, and the missing half is a
 *                     listener that was never written, which a name diff cannot
 *                     see. `let _ = app.emit(...)` is fire-and-forget, so
 *                     neither side reports the gap at runtime either.
 *
 * Pass 3 is baselined by `scripts/event-listener-allowlist.txt` (same doctrine
 * as `scripts/binding-orphan-allowlist.txt`): it fails on a NEW void emit AND
 * on an allowlisted name that gains a listener, because a silent drop is what a
 * broken matcher looks like.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
export const ALLOWLIST_REL = "scripts/event-listener-allowlist.txt";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** `EXECUTION_OUTPUT => "execution-output"` → Map<constName, wireName>. */
export function parseRustEvents(src) {
  const out = new Map();
  for (const m of src.matchAll(/([A-Z][A-Z0-9_]*)\s*=>\s*"([^"]+)"/g)) out.set(m[1], m[2]);
  return out;
}

/** The `EventName` object literal → Map<constName, wireName>. */
export function parseTsEvents(src) {
  const obj = src.match(/export const EventName = \{([\s\S]*?)\} as const;/);
  if (!obj) return null;
  const out = new Map();
  for (const m of obj[1].matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/g)) out.set(m[1], m[2]);
  return out;
}

/** One bare event CONST name per line; `#` starts a comment. */
export function parseAllowlist(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const hash = line.indexOf("#");
    const name = (hash === -1 ? line : line.slice(0, hash)).trim();
    const reason = hash === -1 ? "" : line.slice(hash + 1).trim();
    if (name) out.set(name, reason);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tree walks
// ---------------------------------------------------------------------------

const PRUNE = new Set(["target", "node_modules", "gen", "dist", "build", ".git"]);

/** Recursive walk that PRUNES build output — `src-tauri/target` alone is >50GB. */
export function walkFiles(dir, extRe, rel = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (PRUNE.has(e.name)) continue;
      out.push(...walkFiles(resolve(dir, e.name), extRe, rel ? `${rel}/${e.name}` : e.name));
    } else if (extRe.test(e.name)) {
      out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  }
  return out;
}

/** A Rust file that only a test compiles. */
const isRustTestFile = (rel) =>
  /(^|\/)tests\//.test(rel) || /(^|\/)tests?\.rs$/.test(rel) || /_tests?\.rs$/.test(rel);

/** A TypeScript file that only a test compiles. */
const isTsTestFile = (rel) =>
  rel.includes("__tests__") ||
  rel.includes(".test.") ||
  rel.includes(".e2e.") ||
  rel.startsWith("test/") ||
  rel.startsWith("src/test/");

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
/** Doc comments carry `event_name::X` examples that emit nothing. */
const isCommentLine = (text) => /^\s*(\/\/|\*|#)/.test(text ?? "");

/**
 * Every place Rust NAMES a registry event outside the registry itself.
 *
 * `event_name::CONST` is the only form scanned, deliberately. Rust reaches an
 * emitter through several shapes — `app.emit(event_name::X, …)`,
 * `emit_event(&app, event_name::X, …)`, `emit_to(&*emitter, event_name::X, …)`,
 * `BackgroundJobManager::new(lock, event_name::X_STATUS, event_name::X_OUTPUT)`,
 * `event_name: event_name::X` struct fields — and enumerating the call shapes
 * would miss the next one somebody invents. Naming the constant at all is the
 * invariant they share: the constant exists to be emitted.
 *
 * Bare string literals are NOT counted. `engine/src/event_vocabulary.rs` lists
 * bus event TYPES ("incident_resolved", "review_decision.resolved") that travel
 * inside an EVENT_BUS payload and are not Tauri channels; counting them would
 * report a void for an event nothing emits.
 */
export function scanRustEmits(tauriDir, { skipRel = "core/src/events.rs" } = {}) {
  const hits = new Map();
  const files = walkFiles(tauriDir, /\.rs$/).filter(
    (f) => f !== skipRel && !isRustTestFile(f),
  );
  for (const rel of files) {
    let src;
    try {
      src = readFileSync(resolve(tauriDir, rel), "utf8");
    } catch {
      continue;
    }
    if (!src.includes("event_name::")) continue;
    const lines = src.split("\n");
    for (const m of src.matchAll(/event_name::([A-Z][A-Z0-9_]*)/g)) {
      const line = lineOf(src, m.index);
      if (isCommentLine(lines[line - 1])) continue;
      if (!hits.has(m[1])) hits.set(m[1], []);
      hits.get(m[1]).push(`src-tauri/${rel}:${line}`);
    }
  }
  return { hits, filesVisited: files.length };
}

/**
 * Every place non-test TypeScript references a registry event, by constant
 * (`EventName.X`) or by wire literal (`'execution-output'`). The registry file
 * itself is excluded: declaring a name is not consuming it.
 */
export function scanTsRefs(srcDir, names, { skipRel = "lib/eventRegistry.ts" } = {}) {
  const hits = new Map();
  const testHits = new Map();
  const files = walkFiles(srcDir, /\.(ts|tsx)$/).filter((f) => f !== skipRel);
  for (const rel of files) {
    let src;
    try {
      src = readFileSync(resolve(srcDir, rel), "utf8");
    } catch {
      continue;
    }
    const sink = isTsTestFile(rel) ? testHits : hits;
    for (const [constName, wire] of names) {
      let idx = src.indexOf(`EventName.${constName}`);
      if (idx < 0) {
        for (const q of ["'", '"', "`"]) {
          const k = src.indexOf(q + wire + q);
          if (k >= 0) {
            idx = k;
            break;
          }
        }
      }
      if (idx < 0) continue;
      if (!sink.has(constName)) sink.set(constName, []);
      sink.get(constName).push(`src/${rel}:${lineOf(src, idx)}`);
    }
  }
  return { hits, testHits, filesVisited: files.length };
}

// ---------------------------------------------------------------------------
// Pairing verdict
// ---------------------------------------------------------------------------

export function checkPairing({ names, rustEmits, tsRefs, allowlist }) {
  const voids = [];
  const allowed = [];
  const tsOnly = [];
  for (const [constName] of names) {
    const emitted = (rustEmits.get(constName) ?? []).length > 0;
    const heard = (tsRefs.get(constName) ?? []).length > 0;
    if (emitted && !heard) {
      (allowlist.has(constName) ? allowed : voids).push(constName);
    } else if (!emitted && heard) {
      tsOnly.push(constName);
    }
  }
  // A baselined name that grew a listener, or that left the registry entirely.
  const stale = [...allowlist.keys()].filter((n) => {
    if (!names.has(n)) return true;
    const emitted = (rustEmits.get(n) ?? []).length > 0;
    const heard = (tsRefs.get(n) ?? []).length > 0;
    return heard || !emitted;
  });
  return { voids, allowed, tsOnly, stale };
}

export const isPairingFailure = (r) => r.voids.length > 0 || r.stale.length > 0;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rustSrc = readFileSync(resolve(ROOT, "src-tauri/core/src/events.rs"), "utf8");
  const tsSrc = readFileSync(resolve(ROOT, "src/lib/eventRegistry.ts"), "utf8");

  const rustByConst = parseRustEvents(rustSrc);
  const tsByConst = parseTsEvents(tsSrc);
  if (!tsByConst) {
    console.error("Could not find EventName object in src/lib/eventRegistry.ts");
    process.exit(1);
  }

  // -- Pass 1: name parity (keyed by wire name, which is the contract) -------
  const rustEvents = new Map([...rustByConst].map(([c, s]) => [s, c]));
  const tsEvents = new Map([...tsByConst].map(([c, s]) => [s, c]));

  const missingInTs = [...rustEvents.keys()].filter((n) => !tsEvents.has(n)).sort();
  const missingInRust = [...tsEvents.keys()]
    .filter((n) => !rustEvents.has(n))
    // Frontend-only event used by systemTrace module.
    .filter((n) => n !== "system-trace-updated")
    .sort();

  if (missingInTs.length || missingInRust.length) {
    if (missingInTs.length) {
      console.error("Events defined in Rust but missing in TypeScript:");
      for (const n of missingInTs) console.error(`  - ${rustEvents.get(n)} => ${n}`);
    }
    if (missingInRust.length) {
      console.error("Events defined in TypeScript but missing in Rust:");
      for (const n of missingInRust) console.error(`  - ${tsEvents.get(n)} => ${n}`);
    }
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Pass 2: call-site scan.
  //
  // The two name lists above can agree perfectly while the app subscribes to
  // events that are in NEITHER of them: an event whose authority is a private
  // Rust const rather than events.rs never appears in either list, so the diff
  // reports OK for a vocabulary it never measured. Zero findings from a check
  // that looked at zero call sites is not a pass, so this half asserts it found
  // the call sites before it reports them clean.
  // -----------------------------------------------------------------------

  const SRC = resolve(ROOT, "src");
  // Bare `listen(` / `emit(` in a file that imports the Tauri event API. A
  // `bus.emit(...)` is the in-process store bus — a different vocabulary with a
  // different owner, and not this registry's claim.
  const CALL_SITE = /(?<![.\w])(?:listen|emit)\s*(?:<[^(]*>)?\s*\(\s*['"]([^'"]+)['"]/g;
  const TAURI_IMPORT = /["']@tauri-apps\/api\/event["']/;
  const skipFile = (f) =>
    f.includes("__tests__") ||
    f.includes(".test.") ||
    f.startsWith("test/") ||
    f.endsWith("eventRegistry.ts");

  const files = walkFiles(SRC, /\.(ts|tsx)$/).filter((f) => !skipFile(f));

  const known = new Set([...tsEvents.keys(), ...rustEvents.keys()]);
  const offRegistry = [];
  let callSites = 0;

  for (const rel of files) {
    const src = readFileSync(resolve(SRC, rel), "utf8");
    if (!TAURI_IMPORT.test(src)) continue;
    for (const m of src.matchAll(CALL_SITE)) {
      callSites += 1;
      if (!known.has(m[1])) {
        offRegistry.push(`src/${rel}:${lineOf(src, m.index)}  ${m[1]}`);
      }
    }
  }

  if (callSites === 0) {
    console.error("Call-site scan matched no listen()/emit() calls under src/.");
    console.error("The scanner is broken, not the code — a clean report here would be a lie.");
    process.exit(1);
  }

  if (offRegistry.length) {
    console.error(
      `Event names used at a call site but absent from the registry (${offRegistry.length} of ${callSites} literal call sites):`,
    );
    for (const hit of offRegistry.sort()) console.error(`  - ${hit}`);
    console.error("Each of these has an authority somewhere — usually a private Rust const.");
    console.error(
      "Move the name into events.rs + EventName so one artifact answers 'what events exist?'.",
    );
    process.exit(1);
  }

  // -- Pass 3: emitter ↔ listener pairing -----------------------------------

  const TAURI = resolve(ROOT, "src-tauri");
  const rust = scanRustEmits(TAURI);
  const ts = scanTsRefs(SRC, rustByConst);
  const allowlist = parseAllowlist(readFileSync(resolve(ROOT, ALLOWLIST_REL), "utf8"));

  // Fail-loud floors. "Found nothing" and "looked at nothing" are different
  // outcomes and only one of them is a pass.
  if (rust.filesVisited < 500) {
    console.error(
      `Rust walk visited only ${rust.filesVisited} .rs files under src-tauri/ — the walk is broken, not the tree.`,
    );
    process.exit(1);
  }
  if (ts.filesVisited < 2000) {
    console.error(
      `TypeScript walk visited only ${ts.filesVisited} files under src/ — the walk is broken, not the tree.`,
    );
    process.exit(1);
  }
  if (rust.hits.size === 0 || ts.hits.size === 0) {
    console.error(
      `Pairing scan matched ${rust.hits.size} Rust emit site(s) and ${ts.hits.size} TS reference(s).`,
    );
    console.error("A matcher that finds nothing is assumed broken.");
    process.exit(1);
  }
  // Known positive, asserted on every real run: AUTH_ERROR is emitted by
  // src-tauri/src/boot/deep_link.rs and heard by src/lib/eventBridge.ts.
  // If the canary stops pairing, the scanner changed — not the code.
  const canaryEmit = (rust.hits.get("AUTH_ERROR") ?? []).length;
  const canaryRef = (ts.hits.get("AUTH_ERROR") ?? []).length;
  if (canaryEmit === 0 || canaryRef === 0) {
    console.error(
      `Canary AUTH_ERROR did not pair (${canaryEmit} Rust emit site(s), ${canaryRef} TS reference(s)).`,
    );
    console.error("The pairing scanner is broken; its clean verdict would be a lie.");
    process.exit(1);
  }

  const pairing = checkPairing({
    names: rustByConst,
    rustEmits: rust.hits,
    tsRefs: ts.hits,
    allowlist,
  });

  if (pairing.voids.length) {
    console.error(
      `\n${pairing.voids.length} event(s) emitted by Rust with NO non-test TypeScript reference:`,
    );
    for (const n of pairing.voids.sort()) {
      console.error(`  - ${n} => "${rustByConst.get(n)}"`);
      for (const site of rust.hits.get(n).slice(0, 3)) console.error(`      ${site}`);
      const t = ts.testHits.get(n);
      if (t) console.error(`      (test-only TS reference: ${t[0]})`);
    }
    console.error(
      `\nEither wire a listener, retire the event on both sides, or baseline it in\n${ALLOWLIST_REL} with a one-line reason.`,
    );
  }

  if (pairing.stale.length) {
    console.error(`\n${pairing.stale.length} stale entr(ies) in ${ALLOWLIST_REL}:`);
    for (const n of pairing.stale.sort()) {
      if (!rustByConst.has(n)) console.error(`  - ${n} — no longer in the registry`);
      else if ((ts.hits.get(n) ?? []).length) {
        console.error(`  - ${n} — now has a listener (${ts.hits.get(n)[0]})`);
      } else console.error(`  - ${n} — Rust no longer emits it`);
    }
    console.error("\nDelete the line. A drop below baseline is never silently accepted.");
  }

  // Report-only in this direction: a TS listener for an event Rust never names
  // may be emitted from JS, from a plugin, or be genuinely dead. Reported so it
  // is visible, not gated — that is a separate decision.
  if (pairing.tsOnly.length) {
    console.log(
      `Note: ${pairing.tsOnly.length} event(s) referenced in TypeScript that Rust never names outside the registry: ${pairing.tsOnly.sort().join(", ")}`,
    );
  }

  if (isPairingFailure(pairing)) process.exit(1);

  console.log(
    `Event registry OK (${rustEvents.size} Rust events, ${tsEvents.size} TypeScript events, ` +
      `${callSites} literal call sites all in registry; pairing: ${rust.filesVisited} .rs + ` +
      `${ts.filesVisited} .ts/.tsx visited, ${rust.hits.size} events emitted by Rust, ` +
      `${pairing.allowed.length} allowlisted void emit(s)).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
