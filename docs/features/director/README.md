# Director

The **Director** is a built-in, system-owned meta-persona that coaches every
other persona toward being genuinely useful. It stands *outside* each persona,
reads its shape + recent behaviour + value/efficiency + open issues + past
user decisions, and emits an overall **0-5 verdict score** plus optional
prose **coaching verdicts**.

It is the longitudinal, portfolio-level counterpart to Athena's per-execution
reactive review.

## The command center (Overview › Director)

The Director's surface is **one Overview sub-tab** —
`src/features/overview/sub_director/` (default export `DirectorCoachingTab`),
lazy-loaded by `OverviewPage` for `overviewTab === 'director'`, TEAM-tier. (It
was briefly a dedicated top-level sidebar section; it was descoped so the code
layout mirrors the UI layout — the Director lives under Overview where its
analytics belong.) Everything is fed by the shared `useDirector` hook
(`sub_director/useDirector.ts`, the single source of truth for the surface and
the Agents-page teaser).

The single tab stacks, top to bottom:

- **Thin subheader** — scope summary + the **Brain long-term-memory toggle**
  (gated on a configured vault; otherwise a deep-link to the Obsidian Brain
  plugin), an **Add to scope** button, and **Review all in scope**.
- **Scorecard** (the portfolio analytics): KPI cards for fleet value-delivered
  rate, average verdict score, cost-per-value, and in-scope count; a 0–5
  **score distribution** bar; and a **model efficiency** table. All from the
  `get_director_portfolio` command, which finally surfaces the `ValueRollup`
  that until now only ever reached the LLM payload.
- **Coaching table** — one table consolidating what were three tabs (Roster +
  Attention + Reviews). Each in-scope agent is a row showing score · trend
  sparkline · value rate · **attention tags** · last review. Attention tags are
  the client-derived triage lenses (`sub_director/attention.ts`): awaiting first
  review / low score ≤2 / declining trend / stale review >14d; an "only needs
  attention" filter focuses triage. **Clicking a row opens a detail modal**
  (`PersonaDetailModal`) with that agent's score trend, value signal, active
  attention flags, and full **verdict history** (the Reviews surface, scoped to
  the agent, expandable to rationale + suggested actions) plus Review-now.

**Add to scope** and **per-agent detail** are modals (`AddToScopeModal` /
`PersonaDetailModal`) so the tab stays compact.

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

- **Command center** (`src/features/overview/sub_director/`): the primary
  surface — the **Overview › Director** sub-tab. See the section above.
- **Agents-page teaser** (`src/features/agents/components/allPersonas/DirectorPanel.tsx`):
  a slim status strip at the top of the personas page (scope + avg score + last
  review) with an **Open Director** deep-link that navigates to
  Overview › Director. It does not duplicate the dashboard — the full management
  lives in the sub-tab.
- **Personas table** (`src/features/agents/components/allPersonas/PersonaOverviewColumns.tsx`):
  a **Verdict** column shows each persona's score-trend sparkline — the
  most recent N (default 10) `director_score` values for that persona,
  oldest→newest, colored by the latest score (red/amber/green). At a
  glance you can see whether coaching is moving the needle for a row.
  Personas with no scored executions render "—". Powered by
  `list_director_score_trends`.
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
| `list_director_score_trends(persona_ids, limit?)` | Batched recent score history per persona (oldest→newest); powers the personas-table sparkline. |
| `get_director_portfolio(days?)` | Portfolio analytics for the command center: fleet value rollup + in-scope roster + 0–5 score distribution + headline counts. Composes existing aggregates (no new SQL). |
| `set_persona_starred(id, starred)` | Add/remove a persona from the Director's scope. |
| `get_director_brain_enabled()` / `set_director_brain_enabled(enabled)` | Read/toggle the Brain long-term-memory wiring. |

## Source map

- Engine: `src-tauri/src/engine/director.rs` (rubric, evaluator, scoring,
  routing).
- Brain bridge: `src-tauri/src/engine/director_brain.rs` (vault read/write
  helpers, split out of `director.rs` so the gating + filesystem code stays
  separate from the evaluator pipeline).
- Commands: `src-tauri/src/commands/infrastructure/director.rs`.
- Portfolio analytics: `director_portfolio()` in `engine/director.rs` (structs
  `DirectorPortfolio` / `DirectorRosterEntry` / `DirectorScoreBand`), reusing
  `metrics::get_value_rollup`.
- Scope/score storage: `personas.starred`, `persona_executions.director_score`
  / `director_review_md` (migrations in `src-tauri/src/db/migrations/`).
- Command center: `src/features/overview/sub_director/` —
  `DirectorCoachingTab.tsx` (the Overview sub-tab: subheader + scorecard +
  table), `useDirector.ts` (shared data/actions hook), `attention.ts` (triage
  lenses), `directorScore.ts` + `ScoreSparkline.tsx` (shared 0–5 score visual
  language), `DirectorSection.tsx` (panel surface), `components/{PersonaCoachingTable,PersonaDetailModal,AddToScopeModal}.tsx`.
- Shared primitive: `src/features/shared/components/display/StatCard.tsx` (KPI
  card, added with this feature).
- Other UI: `src/features/agents/components/allPersonas/DirectorPanel.tsx`
  (slim teaser) + `VerdictTrendCell.tsx` (table sparkline),
  `src/features/agents/sub_activity/*` (Verdict column),
  `src/features/agents/sub_executions/detail/*` (Director tab). All UI strings
  live under the consolidated `t.director.*` i18n namespace
  (`src/i18n/locales/en.json`).

## Testing

`tools/test-mcp/e2e_director.py` drives the live app (:17320): it stars 1-2
healthy personas, runs the Director on each, and asserts a `director_score`
lands on each target's latest execution.
