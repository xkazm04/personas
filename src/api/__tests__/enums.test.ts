// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TWIN_CHANNEL_KINDS,
  TWIN_INTERACTION_DIRECTIONS,
  OBSIDIAN_CONFLICT_RESOLUTIONS,
  TWIN_PENDING_MEMORY_STATUSES,
} from "@/api/enums";

/**
 * Enum-drift guards. Each TS `*_KINDS` union below must equal the set the Rust
 * trust-boundary validator accepts — otherwise a value valid at compile time is
 * rejected at runtime (or a Rust-accepted value is unreachable from the typed
 * frontend). The first three sets are READ FROM THE RUST SOURCE (comments
 * stripped), so a change on either side fails this test until both move
 * together. twin.rs names this file as its lock-step guard, so a hand copy of
 * the Rust side here would leave each side believing the other pins it.
 *
 * History: `TWIN_CHANNEL_KINDS` once declared 11 channels while the Rust
 * `VALID_CHANNELS` accepted only 6, so training/telegram/teams/whatsapp
 * interactions (all genuinely produced by the Training Studio + Reply Outbox)
 * were runtime-rejected. The two sides were aligned to a 10-value set; the
 * Browser webview's `browser` lane (`twin_draft_for_page`) made it 11.
 */
function rustSource(rel: string): string {
  return readFileSync(resolve(__dirname, "../../..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** The string literals of `const NAME: &[&str] = &[ ... ];`. */
function rustStrArray(src: string, name: string): string[] {
  const m = new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`).exec(src);
  if (!m) throw new Error(`${name} not found in the Rust source; update this pin`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((s) => s[1]!);
}

/** The literal arms of the first `match resolution.as_str() {` in `fn name(`. */
function rustMatchArms(src: string, fnName: string, scrutinee: string): string[] {
  const fnStart = src.indexOf(`pub fn ${fnName}(`);
  if (fnStart < 0) throw new Error(`fn ${fnName} not found; update this pin`);
  const matchStart = src.indexOf(`match ${scrutinee} {`, fnStart);
  if (matchStart < 0) throw new Error(`match ${scrutinee} not found in ${fnName}; update this pin`);
  const fnEnd = src.indexOf("\n}\n", matchStart);
  if (fnEnd < 0) throw new Error(`end of ${fnName} not found; update this pin`);
  // Top-level arms of this match sit at two indents deeper than the fn body.
  return [...src.slice(matchStart, fnEnd).matchAll(/^ {8}"([a-z_]+)" =>/gm)].map((m) => m[1]!);
}

const TWIN_RS = rustSource("src-tauri/src/commands/infrastructure/twin.rs");
const OBSIDIAN_RS = rustSource("src-tauri/src/commands/obsidian_brain/mod.rs");

describe("api/enums Rust-sync", () => {
  it("TWIN_CHANNEL_KINDS matches twin_record_interaction VALID_CHANNELS", () => {
    const rust = rustStrArray(TWIN_RS, "VALID_CHANNELS");
    expect(rust.length, "parsed no channels (vacuous pin)").toBeGreaterThan(5);
    expect([...TWIN_CHANNEL_KINDS].sort()).toEqual([...rust].sort());
  });

  it("TWIN_INTERACTION_DIRECTIONS matches twin_record_interaction VALID_DIRECTIONS", () => {
    const rust = rustStrArray(TWIN_RS, "VALID_DIRECTIONS");
    expect(rust.length, "parsed no directions (vacuous pin)").toBeGreaterThan(1);
    expect([...TWIN_INTERACTION_DIRECTIONS].sort()).toEqual([...rust].sort());
  });

  it("OBSIDIAN_CONFLICT_RESOLUTIONS matches obsidian_brain_resolve_conflict's accepted `resolution` values", () => {
    const rust = rustMatchArms(OBSIDIAN_RS, "obsidian_brain_resolve_conflict", "resolution.as_str()");
    expect(rust.length, "parsed no match arms (vacuous pin)").toBeGreaterThan(1);
    expect([...OBSIDIAN_CONFLICT_RESOLUTIONS].sort()).toEqual([...rust].sort());
  });

  it("TWIN_PENDING_MEMORY_STATUSES matches twin_list_pending_memories / twin_review_memory's status values", () => {
    // HAND COPY - the one set here not read from Rust, because Rust keeps no
    // single list of it: the values are literals in
    // src-tauri/db/src/repos/twin.rs (review_pending_memory writes
    // "approved" | "rejected" over a row inserted as 'pending').
    const RUST_PENDING_MEMORY_STATUSES = ["pending", "approved", "rejected"];
    expect([...TWIN_PENDING_MEMORY_STATUSES].sort()).toEqual(
      [...RUST_PENDING_MEMORY_STATUSES].sort(),
    );
  });
});
