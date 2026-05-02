#!/usr/bin/env node
/**
 * Checks parity between Rust event_registry.rs and TypeScript eventRegistry.ts.
 * Payload shape parity remains a TypeScript/Rust binding concern; this script
 * focuses on event-name drift, which has caused silent listener misses.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUST = resolve(ROOT, "src-tauri/src/engine/event_registry.rs");
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

console.log(`Event registry OK (${rustEvents.size} Rust events, ${tsEvents.size} TypeScript events).`);
