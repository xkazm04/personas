# Director

The **Director** is a built-in, system-owned meta-persona that coaches every
other persona toward being genuinely useful. It stands *outside* each persona,
reads its shape + recent behaviour + value/efficiency + open issues + past
user decisions, and emits an overall **0-5 verdict score** plus optional
prose **coaching verdicts**.

It is the longitudinal, portfolio-level counterpart to Athena's per-execution
reactive review.

## Scope — the star

The Director only coaches **starred** personas. Starring is done from the
personas table (the favorite ⭐ on each row) and is persisted on
`personas.starred`; the star toggle and the "Director's coaching scope" are the
same thing. The batch cycle (`run_director_batch`) iterates starred personas;
running the Director on a single persona (`run_director_on_persona`) is always
explicit and ignores scope.

The Director persona itself is **system-owned** (`trust_origin = 'system'`):
it cannot be deleted (backend `Forbidden` guard + UI guard + excluded from
batch delete).

## How a review works

The Director **is a persona** whose `system_prompt` is the locked
`DIRECTOR_RUBRIC` (`src-tauri/src/engine/director.rs`). To evaluate a target,
the engine runs the Director persona through the normal execution runner with a
synthetic payload describing the target (identity + value/efficiency rollup +
open healing + memory sample + the Director's own prior verdicts and how the
user resolved them), polls it to completion, and parses its output:

- One mandatory `DIRECTOR_SCORE: {"score":0-5,"summary":"…"}` line → the
  overall verdict. The score + a rendered markdown of the full assessment are
  written onto the **reviewed execution** (`persona_executions.director_score`
  / `director_review_md`).
- Zero-to-three `DIRECTOR_WIN: {"category":"…","note":"…"}` lines → things the
  persona is **doing well** in that category. Rendered as a "What's working"
  section at the top of the review markdown so coaching isn't purely
  corrective. Wins are not routed to the review queue.
- Zero-to-four `DIRECTOR_VERDICT: {…}` lines → coaching notes, routed into
  `persona_manual_reviews` (the existing Human Review queue). Approving /
  rejecting them feeds the human-feedback learning loop, which the next cycle
  reads back.

Because the score lives on the execution (not a review row), healthy personas
get a high score with **no** review-queue spam.

## Long-term memory (Obsidian Brain)

When the **Brain** plugin is enabled (a vault is configured) and the
`director.brain_enabled` setting is on, each review:

- **reads** the persona's prior Director notes from `<vault>/Director/<persona>/`
  and folds them into the payload ("Prior coaching from your long-term memory"),
  so advice compounds instead of repeating;
- **writes** the new assessment back as a dated markdown note in that folder.

Both are best-effort (a vault failure never breaks a review) and use plain file
I/O via the mirror API (`mirror_vault_root` / `mirror_write_note`) — no
embeddings, so it works in the lite build. Toggle via
`get_director_brain_enabled` / `set_director_brain_enabled`.

## Where verdicts surface

- **Director panel** (`src/features/agents/components/allPersonas/DirectorPanel.tsx`):
  the unified management card at the top of the personas page. Shows the
  scope summary (how many personas are starred + when the last review ran),
  a **Run review now** button (batch-runs the Director over starred personas),
  the Brain long-term-memory toggle (when a vault is configured), and a
  **Recent verdicts** list of the most recent coaching notes.
- **Activity list** (`src/features/agents/sub_activity`): a **Verdict** column
  (0-5 stars, 2nd column) reads `director_score` per execution. Unreviewed
  runs show "—".
- **Execution detail modal**: a **Director** tab renders `director_review_md`
  (the full assessment) as styled markdown. The modal is widened so all tabs
  have room.
- **Review queue**: coaching verdicts appear as `persona_manual_reviews` rows
  with `context_data.source = "director"` (see `list_director_verdicts`).

## Invoking the Director

| Command | Effect |
| --- | --- |
| `run_director_on_persona(persona_id)` | Review one persona now (async, minutes; a real LLM run). |
| `run_director_batch(max_personas?)` | Review all starred personas sequentially. |
| `list_director_verdicts(persona_id?)` | Read Director-sourced coaching reviews. |
| `set_persona_starred(id, starred)` | Add/remove a persona from the Director's scope. |
| `get_director_brain_enabled()` / `set_director_brain_enabled(enabled)` | Read/toggle the Brain long-term-memory wiring. |

## Source map

- Engine: `src-tauri/src/engine/director.rs` (rubric, evaluator, scoring,
  routing).
- Brain bridge: `src-tauri/src/engine/director_brain.rs` (vault read/write
  helpers, split out of `director.rs` so the gating + filesystem code stays
  separate from the evaluator pipeline).
- Commands: `src-tauri/src/commands/infrastructure/director.rs`.
- Scope/score storage: `personas.starred`, `persona_executions.director_score`
  / `director_review_md` (migrations in `src-tauri/src/db/migrations/`).
- UI: `src/features/agents/components/allPersonas/DirectorPanel.tsx` (management
  card), `src/features/agents/sub_activity/*` (Verdict column),
  `src/features/agents/sub_executions/detail/*` (Director tab). All UI strings
  live under the consolidated `t.director.*` i18n namespace
  (`src/i18n/locales/en.json`).

## Testing

`tools/test-mcp/e2e_director.py` drives the live app (:17320): it stars 1-2
healthy personas, runs the Director on each, and asserts a `director_score`
lands on each target's latest execution.
