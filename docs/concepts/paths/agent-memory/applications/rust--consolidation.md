---
layer: application
subject: agent-memory
technique: consolidation
stack: rust
---

# Consolidation in the companion brain (Rust)

The repo runs the technique twice over one belief store: a **manual,
review-gated pass** (`src-tauri/src/companion/brain/consolidation.rs`) and a
**pressure-triggered sleep cycle** (`src-tauri/src/companion/brain/sleep_cycle/`).
Both distill episodes from `src-tauri/src/companion/brain/episodic.rs` into
facts via the same writers in `src-tauri/src/companion/brain/semantic.rs` —
the one-door property realized as shared functions, not shared discipline.

## The batch pass and its window

`run_consolidation` (`consolidation.rs:146-259`) reads an 80-episode window
(`EPISODE_WINDOW`, `:42`) plus up to 200 existing facts, and asks an ephemeral
reasoning session for a JSON envelope of proposals. Every structural rule the
standard states appears literally in the prompt (`:890-907`):

- provenance is mandatory — "Every proposal must cite at least one source
  episode_id … If you can't cite, you can't propose" (rule 1), enforced again
  in code: `raw.sources.is_empty()` skips the proposal (`:214-217`), and
  `semantic::FactInput` documents `sources` non-empty as a hard contract
  (`semantic.rs:81-93`);
- supersede-don't-overwrite — rule 3 requires `supersedes_id` on updates;
- transcript-altitude refusal — rule 5: "'User asked X today' is an episode,
  not a fact."

The window deliberately reads **conversation only**
(`list_recent_conversation`, `:174`): fleet correlator rows were 57% of
episodic memory, and feeding them in produced "30 'facts' that are 70-day-old
fleet statistics" (`:170-173`) — the transcript-is-not-memory failure measured
on a live brain.

## The distiller's output is untrusted

`validate_supersedes` (`:278-303`) is the standard's untrusted-output rule in
one function: a model-proposed `supersedes_id` must resolve to a live fact
(`kind='fact'`, `importance>0`) in the same scope before `apply_item` may
demote anything — "a hallucinated or unrelated id would silently zero out an
arbitrary fact's importance, defeating the human-review step" (`:273-277`).
The sleep cycle applies the same posture wholesale: episode bodies ride inside
nonce-tagged untrusted fences, and every id the model hands back is checked
against the database before any write (`sleep_cycle.rs:77-88`).

## Dedup as reinforcement

`apply_item`'s ml arm (`:341-387`) runs `semantic::find_near_duplicate` before
writing; a close match folds the new evidence into the existing fact via
`reinforce_fact` (importance +1 capped, `last_seen_at` bumped, sources
appended — `semantic.rs:286-292`) instead of minting a duplicate row. Skipped
when the user marked supersedes (deliberate replacement ≠ duplicate), and
best-effort — a dedup failure falls through to a normal write rather than
breaking the pass (`:344-350`).

## Pressure, not the clock

The sleep cycle's header (`sleep_cycle.rs:23-55`) is the cadence section of
the standard with measurements attached: trigger on accumulated conversation
volume (`PRESSURE_THRESHOLD_CHARS`), clock only as floor (`MIN_INTERVAL_HOURS`)
and staleness release (`STALENESS_HOURS`); "one boundary, one predicate, one
read" — admission measurement and compress window are literally the same
`Vec<Episode>`; and drain-forward — compress consumes oldest-first and records
`consumed_through`, so a truncated heavy day becomes the next cycle's oldest
material instead of orphaned residue (the predecessor took newest-N and had
exactly that bug, `:50-55`).

## The review lanes

Manual proposals land as `companion_consolidation_item` rows in `pending`;
nothing touches the belief store until `apply_item` (with operator edits,
`:264-271`) or `reject_item` resolves them, and `discard_run` (`:479-512`)
rejects a whole pass idempotently. The sleep cycle auto-applies its capped
compress output (≤12 facts/cycle) through the same writers — the auto-commit
lane — but keeps forgetting **report-only** and taxonomy expansion
**propose-only** (`sleep_cycle.rs:58-69`), matching the governance tiering:
observations flow, vocabulary and forgetting wait for a human.
