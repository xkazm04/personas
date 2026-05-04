# 07 — Lab & Versioning

> **Status:** RFC — to be finalized before Phase C6 starts.
> This doc captures the **shape of the answer** we've agreed on; the open
> questions are enumerated at the end.

## Principle

Lab is Option-A compatible. Versions snapshot whatever the user wants to
version — could be the whole persona (identity + all capabilities), or a
specific capability's fragment. The version table gains an optional
`use_case_id` to represent the latter.

## What the Lab does today (baseline)

- **Arena**: multi-model comparison of the whole persona against fixed scenarios.
- **A/B**: compares two versions of the persona (each is a full
  `structured_prompt` + `system_prompt` snapshot).
- **Matrix**: given user instruction like "improve error handling," generates a
  draft prompt and tests it against scenarios. On accept, writes the draft
  into the persona's `structured_prompt` globally.
- **Eval**: scenario-based evaluation with rubrics.
- **Versions**: snapshots in `persona_prompt_versions` table. One row = one
  whole-persona snapshot.

All four operate at the persona level. `use_case_filter` exists as a param
but only scopes test scenario selection, not prompt refinement.

## What the Lab needs to do post-C6

The user should be able to:

1. **Refine the whole persona** — e.g., "make the persona more cautious overall."
   This still exists, unchanged. Versions with `use_case_id IS NULL` represent
   this.
2. **Refine a specific capability** — e.g., "for the gem finder, be more
   selective on market cap." Lab generates a draft that modifies only
   `design_context.useCases[uc_gem]` fields (capability_summary, tool_hints,
   notification_channels, model_override, or even a capability-local
   prompt fragment). On accept, only those fields update, not the
   persona-wide structured_prompt.
3. **Refine multiple capabilities at once** — e.g., "tighten notification
   formatting across gem finder and gov tracker." This can be modeled as
   two separate capability-scoped versions, or as a single whole-persona
   version that happens to only touch capability fields. Choice: the user
   declares scope before Matrix starts (single-capability | multiple-capability | whole-persona).

## Schema additions (C6)

```sql
ALTER TABLE persona_prompt_versions ADD COLUMN use_case_id TEXT;
ALTER TABLE persona_prompt_versions ADD COLUMN scope TEXT NOT NULL DEFAULT 'persona';
-- scope: 'persona' | 'capability' | 'multi_capability'
ALTER TABLE persona_prompt_versions ADD COLUMN scoped_capability_ids TEXT;
-- JSON array of use_case_ids touched when scope='multi_capability'
ALTER TABLE persona_prompt_versions ADD COLUMN design_context_snapshot TEXT;
-- NEW: because capability versions need to snapshot design_context changes
```

The existing `structured_prompt` + `system_prompt` columns remain for
persona-scope versions. Capability and multi-capability versions use
`design_context_snapshot` to record the design_context diff (or full
design_context; storage is cheap, simpler).

## Lab command updates

### `lab_start_matrix`

Gains two optional params:

```rust
pub async fn lab_start_matrix(
  persona_id: String,
  user_instruction: String,
  models: Vec<serde_json::Value>,
  scope: LabScope,                              // NEW: Persona | Capability | MultiCapability
  target_use_case_ids: Option<Vec<String>>,     // NEW: required when scope != Persona
  test_scenarios: Option<Vec<String>>,          // replaces use_case_filter semantically
)
```

`test_runner::run_matrix_test` receives the scope and targets; when scope is
`Capability`, the draft prompt it generates is a capability-fragment, not a
whole `structured_prompt`.

### `lab_accept_matrix_draft`

Gains scope awareness:

```rust
if run.scope == LabScope::Persona {
  // existing path: UPDATE personas SET structured_prompt = draft
  update_persona_structured_prompt(...)
} else {
  // new path: patch design_context.useCases[...] from draft
  patch_design_context_capabilities(persona_id, target_use_case_ids, draft_capability_fragments)
}

// Write a version row regardless, with scope + (use_case_id OR scoped_capability_ids)
insert_version_row(...)
```

### Rollback

```rust
pub async fn lab_rollback_version(version_id: String)
```

- If the version is `scope='persona'`: restore `structured_prompt` +
  `system_prompt` + `design_context_snapshot` from the version row.
- If the version is `scope='capability'` or `'multi_capability'`: restore
  only the targeted capability entries in `design_context.useCases[]`.
- Cascade: session pool invalidation in all cases.

## Lab UI (C6)

- Scope picker on Matrix start: **"Refine: [Whole persona] [Capability: gem finder] [Multi: gem finder + gov tracker]"**
- Version list shows scope badges: `🏛 persona`, `⚙ capability: gem finder`, `⚙ capabilities: gem finder + 2`
- Diff viewer handles both full-persona diffs and capability-fragment diffs
- A/B comparison can compare any two versions regardless of scope — the diff
  just shows what fields each touches

## Open questions (to resolve before C6 implementation)

1. **Multi-capability as one version vs N versions?** Proposed: one row with
   `scope='multi_capability'` and `scoped_capability_ids` array. Simpler
   version history, atomic rollback. Counter-argument: harder to reason about
   in the UI, preferable to show as N related versions. **Defer to UX review
   during C6.**

2. **Capability-local prompt fragments — do we need them?** Option A says no
   (capability_summary + tool_hints + model_override suffices). But some Lab
   refinements might want "for gem finder specifically, use this
   errorHandling strategy." If yes, add `per_capability_prompt_overrides` to
   `DesignUseCase`. **Defer — only add if C1–C5 usage shows a clear need.**

3. **Test scenarios per capability.** Currently scenarios are persona-wide.
   Post-C6 they should be capability-tagged (a scenario for gem finder, one
   for gov tracker). Add `use_case_id` to scenario rows. **Straightforward,
   implement with C6.**

4. **Version tagging (`production`, `archived`, `experimental`) — per-scope semantics.**
   Can a capability version be "production" independently of the persona
   version being "production"? Proposed: yes. A persona can have its
   persona-scope production version + capability-scope production overrides.
   Runtime merges them: effective structured_prompt = persona production +
   capability overrides active.

5. **Migration for existing versions.** Pre-C6 versions are all
   `scope='persona'`, `use_case_id=NULL`. Populate the new columns with
   those defaults in a data migration.

## Why this is RFC-gated

The merging logic (persona version + capability overrides) is where bugs
live. Until C5 lands and we see real usage patterns, we shouldn't commit to
a merge algorithm. The RFC in C6 will:

- Propose the merge algorithm explicitly
- Enumerate conflict cases (persona version and capability override touch
  the same field)
- Define precedence rules
- Specify rollback semantics
- Specify A/B comparison semantics

Then implement.
