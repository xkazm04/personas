#!/usr/bin/env node
/**
 * Checks parity between Rust event_registry.rs and TypeScript eventRegistry.ts.
 * Payload shape parity remains a TypeScript/Rust binding concern; this script
 * focuses on event-name drift, which has caused silent listener misses.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUST = resolve(ROOT, "src-tauri/core/src/events.rs");
const TS = resolve(ROOT, "src/lib/eventRegistry.ts");

const rustSrc = readFileSync(RUST, "utf8");
const tsSrc = readFileSync(TS, "utf8");

const rustEvents = new Map();
for (const match of rustSrc.matchAll(/([A-Z][A-Z0-9_]*)\s*=>\s*"([^"]+)"/g)) {
  rustEvents.set(match[2], match[1]);
}

const eventObject = tsSrc.match(/export const EventName = \{([\s\S]*?)\} as const;/);
if (!eventObject) {
  console.error("Could not find EventName object in src/lib/eventRegistry.ts");
  process.exit(1);
}

const tsEvents = new Map();
for (const match of eventObject[1].matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/g)) {
  tsEvents.set(match[2], match[1]);
}

const missingInTs = [...rustEvents.keys()].filter((name) => !tsEvents.has(name)).sort();
const missingInRust = [...tsEvents.keys()]
  .filter((name) => !rustEvents.has(name))
  // Frontend-only event used by systemTrace module.
  .filter((name) => name !== "system-trace-updated")
  .sort();

if (missingInTs.length || missingInRust.length) {
  if (missingInTs.length) {
    console.error("Events defined in Rust but missing in TypeScript:");
    for (const name of missingInTs) console.error(`  - ${rustEvents.get(name)} => ${name}`);
  }
  if (missingInRust.length) {
    console.error("Events defined in TypeScript but missing in Rust:");
    for (const name of missingInRust) console.error(`  - ${tsEvents.get(name)} => ${name}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Call-site scan.
//
// The two name lists above can agree perfectly while the app subscribes to
// events that are in NEITHER of them: an event whose authority is a private
// Rust const rather than events.rs never appears in either list, so the diff
// reports OK for a vocabulary it never measured. Zero findings from a check
// that looked at zero call sites is not a pass, so this half asserts it found
// the call sites before it reports them clean.
// ---------------------------------------------------------------------------

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

const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .map((f) => f.split("\\").join("/"))
  .filter((f) => /\.(ts|tsx)$/.test(f) && !skipFile(f));

const known = new Set([...tsEvents.keys(), ...rustEvents.keys()]);
const offRegistry = [];
let callSites = 0;

for (const rel of files) {
  const src = readFileSync(resolve(SRC, rel), "utf8");
  if (!TAURI_IMPORT.test(src)) continue;
  for (const m of src.matchAll(CALL_SITE)) {
    callSites += 1;
    if (!known.has(m[1])) {
      const line = src.slice(0, m.index).split("\n").length;
      offRegistry.push(`src/${rel}:${line}  ${m[1]}`);
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
  console.error("Move the name into events.rs + EventName so one artifact answers 'what events exist?'.");
  process.exit(1);
}

console.log(
  `Event registry OK (${rustEvents.size} Rust events, ${tsEvents.size} TypeScript events, ${callSites} literal call sites all in registry).`,
);
