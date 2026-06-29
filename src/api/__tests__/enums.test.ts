import { describe, it, expect } from "vitest";
import { TWIN_CHANNEL_KINDS, TWIN_INTERACTION_DIRECTIONS } from "@/api/enums";

/**
 * Enum-drift guards. Each TS `*_KINDS` union below must equal the set the Rust
 * trust-boundary validator accepts — otherwise a value valid at compile time is
 * rejected at runtime (or a Rust-accepted value is unreachable from the typed
 * frontend). The Rust sets are hardcoded here with a pointer to their source so
 * a change on EITHER side fails this test until both move together.
 *
 * History: `TWIN_CHANNEL_KINDS` once declared 11 channels while the Rust
 * `VALID_CHANNELS` accepted only 6, so training/telegram/teams/whatsapp
 * interactions (all genuinely produced by the Training Studio + Reply Outbox)
 * were runtime-rejected. The two sides are now aligned to the 10-value set.
 */
describe("api/enums Rust-sync", () => {
  it("TWIN_CHANNEL_KINDS matches twin_record_interaction VALID_CHANNELS", () => {
    // Source of truth: src-tauri/src/commands/infrastructure/twin.rs
    //   const VALID_CHANNELS: &[&str] = &[
    //     "discord","slack","email","sms","telegram","teams","whatsapp",
    //     "voice","generic","training",
    //   ];
    const RUST_VALID_CHANNELS = [
      "discord",
      "slack",
      "email",
      "sms",
      "telegram",
      "teams",
      "whatsapp",
      "voice",
      "generic",
      "training",
    ];
    expect([...TWIN_CHANNEL_KINDS].sort()).toEqual([...RUST_VALID_CHANNELS].sort());
  });

  it("TWIN_INTERACTION_DIRECTIONS matches twin_record_interaction VALID_DIRECTIONS", () => {
    // Source of truth: src-tauri/src/commands/infrastructure/twin.rs
    //   const VALID_DIRECTIONS: &[&str] = &["in", "out"];
    const RUST_VALID_DIRECTIONS = ["in", "out"];
    expect([...TWIN_INTERACTION_DIRECTIONS].sort()).toEqual([...RUST_VALID_DIRECTIONS].sort());
  });
});
