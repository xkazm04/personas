---
layer: application
subject: versioning-snapshots
technique: snapshot-scope
stack: rust
---

# Snapshot scope — the persona version snapshots

Two coexisting version stores in this repo apply the technique from opposite
ends, and a third mechanism embodies the field-log alternative. Together they
are a complete worked example — including the failure modes.

## The full-graph copy: `persona_versions`

`src-tauri/db/src/repos/lab/versions.rs::create_version` is the canonical
set-based full-graph capture. One connection, two `INSERT … SELECT`
statements:

1. The head row copies the persona's behavioral surface directly from the
   live table — `name, description, system_prompt, structured_prompt,
   model_profile, max_budget_usd, max_turns, timeout_ms, design_context` —
   and mints `tag = 'experimental'` at creation (`versions.rs:21-26`).
2. The owned children follow: `persona_version_tools` is populated by
   selecting through the `persona_tools` assignment table and **embedding**
   each tool's definition as a JSON object (`json_object('name', …,
   'category', …, 'description', …)`, `versions.rs:29-36`) — an explicit
   embed-vs-reference decision. The version means *those* tools as they were,
   not whatever the tool ids resolve to later; a prompt restored without its
   tools would be the chimera the technique names.

Scope notes against the technique's checklist: fresh child ids
(`hex(randomblob(16))`), copies keyed to the new version id, execution
history and ratings excluded (they belong to the entity). Two gaps:

- The two inserts run on one connection but are **not wrapped in an explicit
  transaction**, so the head-then-tools copy is a two-statement capture; a
  failure between them leaves a tool-less version row.
- `SELECT COALESCE(MAX(version_number), 0) + 1` runs as a separate statement
  with `.unwrap_or(1)` on error (`versions.rs:10-16`), and the DDL
  (`incremental.rs:1963`) declares **no UNIQUE(persona_id, version_number)**
  — the version-identity technique's constraint backstop is absent.
- Largest of all: the 2026-08-17 census
  (`docs/concepts/golden-paths/definition-version-history.md` §0) measured
  this whole store at **zero callers and zero rows ever written** — the
  best-scoped snapshot in the repo is the dead one, while the narrower
  `persona_prompt_versions` (prompt + design fields, no tools) is what every
  writer writes.

## The conditional door that diffs one field

`src-tauri/db/src/repos/execution/metrics.rs::create_prompt_version_if_changed`
(:152) is the dedupe gate on the working store's capture door — and a
measured instance of the technique's warning about conditional capture: it
compares **only `structured_prompt`**, and its sole caller guards the entire
call behind `if let Some(ref new_sp) = input.structured_prompt`. A
system-prompt-only edit never reaches the version writer; the census counted
16 of 25 historical rows with `system_prompt IS NULL`. The scope declared by
the snapshot columns and the scope enforced by the change gate are two
different scopes, and nothing cross-checks them.

## The field-log shape, done right

`src-tauri/db/src/repos/resources/persona_change_log.rs` is the repo's
exemplar of the golden path's *other* history shape: `write_diff` (:213)
takes the **caller's connection** so the history row commits atomically with
the edit it records; `compute_changes` (:65) diffs 19 fields explicitly from
the already-loaded row (no re-read race); secrets are redacted at capture;
retention is enforced at write time (200 rows per persona). Choosing between
this and the snapshot stores is exactly the "what moves together" decision
the golden path describes — the persona's independently-edited fields suit
the field log; a whole-prompt rollback suits the snapshot.
