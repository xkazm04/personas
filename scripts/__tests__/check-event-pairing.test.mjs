// Self-test for pass 3 (emitter <-> listener pairing) of
// scripts/check-event-registry.mjs.
//
// The gate this proves is the one that had to be written because the two
// halves it replaces BOTH ran green on 35 events that Rust serialises and
// pushes into nothing. So the failure mode to defend against here is not "the
// verdict is wrong" -- it is "the scanner looked at nothing and said fine".
// Every case below is either a shape that actually exists in this tree, or the
// synthetic void the fail-loud contract requires the scanner to be able to
// find.
//
// Run:  node scripts/__tests__/check-event-pairing.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRustEvents,
  parseTsEvents,
  parseAllowlist,
  scanRustEmits,
  scanTsRefs,
  checkPairing,
  isPairingFailure,
  ALLOWLIST_REL,
} from "../check-event-registry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0,
  failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const roots = [];
/** Build a throwaway tree of `{ relPath: contents }` and return its root. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "evtpair-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf-8");
  }
  roots.push(root);
  return root;
}

const NAMES = new Map([
  ["HEARD", "heard-event"],
  ["VOID", "void-event"],
]);

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 1: THE SYNTHETIC VOID — a scan that reports none is broken");
{
  const rust = fixture({
    "src/emit.rs": `fn go(app: &App) {
    let _ = app.emit(event_name::HEARD, &p);
    let _ = app.emit(event_name::VOID, &p);
}`,
  });
  const ts = fixture({
    "lib/listen.ts": `import { EventName } from '@/lib/eventRegistry';
typedListen(EventName.HEARD, () => {});`,
  });
  const r = scanRustEmits(rust);
  const t = scanTsRefs(ts, NAMES);
  const v = checkPairing({
    names: NAMES,
    rustEmits: r.hits,
    tsRefs: t.hits,
    allowlist: new Map(),
  });
  expect("both events seen as emitted", r.hits.size === 2, `got ${r.hits.size}`);
  expect("VOID reported", v.voids.includes("VOID"), JSON.stringify(v.voids));
  expect("HEARD not reported", !v.voids.includes("HEARD"));
  expect("verdict is a failure", isPairingFailure(v));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 2: THE WIRE-LITERAL LISTENER (src/lib/eventBridge.ts shape)");
{
  // Plenty of listeners never touch `EventName.X` — they pass the raw string.
  // A constant-only matcher calls all of those void, which would be 100+ false
  // positives on the real tree and would make the gate unusable on day one.
  const ts = fixture({ "a.ts": `listen('void-event', () => {});` });
  const t = scanTsRefs(ts, NAMES);
  expect("wire literal counts as a reference", (t.hits.get("VOID") ?? []).length === 1);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 3: A TEST IS NOT A LISTENER");
{
  // src/test/e2e/cli-scenario-streams.e2e.test.ts names template-adopt-status.
  // Counting it would certify a stream nothing in the app consumes.
  const ts = fixture({
    "test/e2e/x.e2e.test.ts": `listen('void-event', () => {});`,
    "features/__tests__/y.test.tsx": `EventName.HEARD;`,
  });
  const t = scanTsRefs(ts, NAMES);
  expect("test refs do not pair", t.hits.size === 0, [...t.hits.keys()].join(","));
  expect("test refs are still reported separately", t.testHits.size === 2);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 4: A DOC COMMENT IS NOT AN EMIT (engine/src/events.rs:113)");
{
  // `/// emit_to(&*emitter, event_name::EXECUTION_STATUS, &e);` is a usage
  // example. Counting it makes a retired event look live forever.
  const rust = fixture({
    "src/doc.rs": `/// emit_to(&*emitter, event_name::VOID, &e);
//  event_name::HEARD
fn nothing() {}`,
  });
  const r = scanRustEmits(rust);
  expect("comment-only file emits nothing", r.hits.size === 0, [...r.hits.keys()].join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 5: A BARE STRING IS NOT A TAURI EMIT (event_vocabulary.rs:72)");
{
  // `("review_decision.resolved", "review")` is a BUS event type carried inside
  // an EVENT_BUS payload — not a channel anything can listen on. Counting the
  // literal reports a void for an event that has no emitter at all.
  const rust = fixture({ "src/vocab.rs": `const V: &[(&str, &str)] = &[("void-event", "x")];` });
  const r = scanRustEmits(rust);
  expect("bare literal is not an emit", r.hits.size === 0, [...r.hits.keys()].join(","));
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 6: THE PRUNE — build output must be invisible, and cheap");
{
  // src-tauri/target/ holds tens of gigabytes of generated .rs. Walking it is
  // slow enough to time the gate out, and a build artifact naming an event
  // would certify a void as paired.
  const rust = fixture({
    "target/debug/build/gen.rs": `let _ = app.emit(event_name::VOID, &p);`,
    "src/real.rs": `let _ = app.emit(event_name::HEARD, &p);`,
  });
  const r = scanRustEmits(rust);
  expect("target/ pruned", !r.hits.has("VOID"), [...r.hits.keys()].join(","));
  expect("sibling source still walked", r.hits.has("HEARD"));
  expect("filesVisited excludes pruned", r.filesVisited === 1, `${r.filesVisited}`);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 7: THE RATCHET FAILS DOWNWARD TOO");
{
  const rustPaired = fixture({ "src/a.rs": `app.emit(event_name::HEARD, &p);` });
  const tsPaired = fixture({ "a.ts": `EventName.HEARD;` });
  const r = scanRustEmits(rustPaired);
  const t = scanTsRefs(tsPaired, NAMES);

  const stale = checkPairing({
    names: NAMES,
    rustEmits: r.hits,
    tsRefs: t.hits,
    allowlist: new Map([["HEARD", "baselined"]]),
  });
  expect("allowlisted name that gained a listener is stale", stale.stale.includes("HEARD"));
  expect("...and that is a failure", isPairingFailure(stale));

  const gone = checkPairing({
    names: NAMES,
    rustEmits: r.hits,
    tsRefs: t.hits,
    allowlist: new Map([["RETIRED_LONG_AGO", "baselined"]]),
  });
  expect("allowlisted name off the registry is stale", gone.stale.includes("RETIRED_LONG_AGO"));

  const noEmitter = checkPairing({
    names: NAMES,
    rustEmits: r.hits,
    tsRefs: t.hits,
    allowlist: new Map([["VOID", "baselined"]]),
  });
  expect(
    "allowlisted name Rust stopped emitting is stale",
    noEmitter.stale.includes("VOID"),
    JSON.stringify(noEmitter.stale),
  );
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 8: AN EMPTY WALK YIELDS ZERO — the floor's premise");
{
  // The script refuses to pass when the walk is this small. This asserts the
  // condition the floor keys on actually arises, so the floor is not dead code.
  const empty = fixture({ "README.md": "nothing here" });
  const r = scanRustEmits(empty);
  const t = scanTsRefs(empty, NAMES);
  expect("no .rs visited", r.filesVisited === 0);
  expect("no hits either side", r.hits.size === 0 && t.hits.size === 0);
}

// ──────────────────────────────────────────────────────────────────────────
console.log("Case 9: THE REAL TREE — the known positive, and the baseline");
{
  const names = parseRustEvents(
    readFileSync(resolve(ROOT, "src-tauri/core/src/events.rs"), "utf8"),
  );
  const tsNames = parseTsEvents(readFileSync(resolve(ROOT, "src/lib/eventRegistry.ts"), "utf8"));
  expect("both registries parse", names.size > 100 && tsNames.size > 100);

  const r = scanRustEmits(resolve(ROOT, "src-tauri"));
  const t = scanTsRefs(resolve(ROOT, "src"), names);
  expect("Rust walk is real", r.filesVisited > 500, `${r.filesVisited}`);
  expect("TS walk is real", t.filesVisited > 2000, `${t.filesVisited}`);

  // AUTH_ERROR: emitted by src-tauri/src/boot/deep_link.rs, heard by
  // src/lib/eventBridge.ts. If this stops pairing, the scanner broke.
  expect("canary AUTH_ERROR is emitted", (r.hits.get("AUTH_ERROR") ?? []).length > 0);
  expect("canary AUTH_ERROR is heard", (t.hits.get("AUTH_ERROR") ?? []).length > 0);

  const allowlist = parseAllowlist(readFileSync(resolve(ROOT, ALLOWLIST_REL), "utf8"));
  const v = checkPairing({ names, rustEmits: r.hits, tsRefs: t.hits, allowlist });
  expect("real tree is at baseline", !isPairingFailure(v), JSON.stringify(v));
  expect(
    "every allowlist entry is doing work",
    allowlist.size === v.allowed.length,
    `${allowlist.size} listed vs ${v.allowed.length} matched`,
  );
  console.log(
    `  (measured: ${names.size} events, ${r.hits.size} named by Rust, ` +
      `${v.allowed.length} allowlisted void, ${v.tsOnly.length} TS-only)`,
  );
}

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
