---
layer: application
subject: versioning-snapshots
technique: promotion-lifecycle
stack: rust
---

# Promotion lifecycle — prompt-version tags, proposals, and auto-rollback

The prompt-version store (`persona_prompt_versions`) carries a complete
promotion lifecycle: a declared tag vocabulary, an atomic activation swap, a
human-gated proposal path, and an automated demotion hook. Each maps to a
clause of the technique.

## Declared states, validated at the door

`src-tauri/src/commands/execution/lab.rs::lab_tag_version` (:814) enumerates
the vocabulary in one place — `["production", "experimental", "archived"]` —
and rejects anything else with a validation error. Versions are minted
`'experimental'` (`lab.rs:626`, `versions.rs:23`): creation is not promotion.

## The atomic swap — and where "one pointer" is really N flags

`activate_version_atomic` (`lab.rs:960`) is the promotion act: apply the
version's prompt to the live persona, demote the current `'production'` row
to `'experimental'`, tag the target `'production'` — all in **one
transaction**, deliberately replacing a former two-IPC flow whose partial
failure left the prompt and the model mismatched (`lab.rs:1046-1052`
documents the incident). Two honest caveats against the technique:

- "Active" is a **tag scattered across version rows**, not a single pointer
  column; the atomic transaction is what prevents two `'production'` rows,
  and the readers hedge with `ORDER BY version_number DESC LIMIT 1`
  (`lab.rs:902,1018`) — which silently picks one if the invariant ever
  breaks rather than failing loudly.
- Demotion re-tags the old production row `'experimental'`, erasing the fact
  that it was ever promoted. The technique's "promoted-ever" retention
  exemption is unenforceable over this vocabulary — `'archived'` exists but
  the demotion path never uses it.

## Human-gated proposals

Darwin-mode evolution cycles **always complete `promoted = false`**;
`mark_cycle_promoted` (`src-tauri/db/src/repos/lab/evolution.rs:356`) is
documented as callable *only* from the human-approval path of a promotion
proposal (`src-tauri/db/src/repos/lab/evolution_proposals.rs` — the
`evolution_promotion_proposals` table). The machine nominates with fitness
evidence (`winner_fitness` vs `incumbent_fitness` on the cycle row); only
ratification changes state. This is the technique's proposal shape verbatim.

## Automated demotion, with its evidence attached

`src-tauri/src/engine/auto_rollback.rs` is the pre-wired rollback hook (the
self-healing subject's ground, consumed here as a lifecycle event): it
selects the current version **by the `production` tag, explicitly not by
highest number** — the comment at `auto_rollback.rs:123-126` explains that
after a rollback the demoted version still has the higher number, so
number-ordering would re-demote in an infinite loop, a live confirmation of
"active ≠ latest". It compares execution-weighted error rates between
current and previous versions, triggers at a 2× regression, serializes with
the AI-healing writer via the shared `healing_personas` slot (two writers,
one door), and emits an `AutoRollbackEvent` carrying `from_version`,
`to_version`, and both error rates — the demotion recorded with the evidence
that triggered it.
