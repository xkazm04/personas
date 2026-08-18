---
layer: application
subject: sync-replication
technique: conflict-detection-and-policy
stack: rust
---

# Conflict detection and policy — two lanes, two scopes, one algorithm

How this repo implements the
[conflict-detection-and-policy](../techniques/conflict-detection-and-policy.md)
technique, twice, with the policy half differing exactly along the
technique's scope rule:

- `src-tauri/src/commands/obsidian_brain/conflict.rs` — app ↔ external
  note vault. The vault is edited by tools outside the app's control, so
  divergence goes to a **human-merge lane** with a diff UI.
- `src-tauri/engine/src/workspace_sync/merge.rs` — device ↔ device for
  one user. Both writers are the same mind, so divergence auto-resolves
  by **deterministic last-writer-wins**.

## Detection: three-way compare on content hashes

`three_way_compare` (`conflict.rs:36-81`) is the technique's detection
half almost line for line. The base is a stored content hash (not a
timestamp, not the row's own `updated_at`); the comparison is two
independent booleans — `app_hash != base_hash`, `vault_hash != base_hash`
— matched as a 2×2, so the both-changed cell cannot be forgotten
(`ThreeWayResult` is a closed enum; the caller's `match` is exhaustive).

**Converged-conflict is a distinct outcome, with the rationale written
down.** The both-changed-but-identical cell returns
`ThreeWayResult::ConvergedConflict { app_hash, vault_hash, base_hash }`
rather than collapsing into `NoChange`, and the doc comment
(`conflict.rs:16-30`) makes the technique's audit argument: the user
did edit both sides, a real conflict was avoided by chance, and the
trail must say so. A unit test (`conflict.rs:116-134`) pins the
distinction so it cannot regress into the quiet lie.

## Policy lane 1: park, preserve, present

The divergent cell constructs a `SyncConflict` carrying **both full
bodies and all three hashes** (`conflict.rs:67-78`) — preservation and
presentability in one struct: nothing is discarded before the human
rules, and the frontend renders a line-level diff
(`src/features/plugins/obsidian-brain/sub_sync/ConflictDiffView.tsx`)
rather than a name and two buttons. The resolution command re-hashes the
destination before writing and refuses if it moved while the dialog was
open (`obsidian_brain/mod.rs`, the TOCTOU guard) — the ruling applies to
the snapshot the human actually saw.

## Policy lane 2: LWW as a total function, scoped to one user

`merge_entity` (`merge.rs:107-134`) runs the same four-outcome detection
generically over any `SyncSnapshot` (personas, memories, triggers), with
`base_hash: Option<&str>` making first contact a legal input. Its
divergent arm is the technique's "LWW is only a policy when it is a
deterministic total function": `last_writer_wins` (`merge.rs:140-157`)
orders by `modified_at`, breaks ties by lexicographic `device_id`, and
is total even over unparseable timestamps — so **both devices compute
the same winner from the same inputs without coordination**. The module
header (`merge.rs:1-9`) states the scope justification exactly as the
technique demands: both ends are the *same user's* devices, which is why
auto-resolution is legitimate here and queued-for-human is used in lane 1.

Supporting details that track the technique:

- the content hash excludes the LWW timestamp
  (`snapshot.rs:canonical_content_hash` removes `updatedAt` before
  digesting) — re-touching a row without changing content is not a
  content change, so recency and content answer different questions;
- deletes conflict too: `WorkspaceEntity::Tombstone` carries its own
  `deleted_at` ordering key, so a delete concurrent with an edit goes
  through the same LWW rather than being resolved by arrival order —
  `merge.rs:307-319`'s test pins "local edit newer than remote delete
  wins" (resurrection-by-policy, chosen deliberately, not by race).

## The counter-example: the third lane has no policy at all

The cloud sync writer (`src-tauri/src/cloud/sync/`) pushes 11 tables via
upsert with `Prefer: resolution=merge-duplicates` and never reads the
remote copy back. No base, no comparison, no declared winner: the remote
row is whatever device pushed last, the loser cannot learn it lost, and
the rule exists only by omission — the technique's "last-arrival-wins is
a race, not a policy" in shipped form. The repo thus contains the
correct detection machinery (twice) and a live lane that uses neither;
the full audit is the legacy corpus document
`docs/concepts/golden-paths/sync-reconciliation-and-conflicts.md`.
