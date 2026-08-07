---
slug: dispatch-panel-one-truth
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: feature
status: shipped
size: M
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: 33ef7e71b
---
## What & why

A right-docked panel that answers one question the app currently cannot: *what have I
approved, did it actually get sent, and is it going stale?* — with one click to dispatch it
to the Dev runner **or** to Fleet.

The Fleet half already exists and has never been reachable.

## Evidence

- `dev_tools_dispatch_ideas(ideaIds, target: "runner" | "fleet", depth?, maxParallel?)` —
  `commands/infrastructure/dev_tools.rs:1036-1063`. Auto-accepts anything still pending
  ("dispatching IS the decision", `:1131-1144`), composes a prompt from the idea's title,
  description, reasoning and evidence (`:998-1017`), creates the task, and for `fleet`
  spawns a headless `claude -p` against the project's `root_path` (`:1187-1243`), writing
  `session_id` back onto the task.
- **The `'fleet'` arm has zero frontend callers.** Its only production consumer is the
  headless Overnight Portfolio Engine (`commands/infrastructure/overnight.rs:16`).
- The only UI is one button hard-coded to `'runner'` — `BacklogPanel.tsx:194`.
- Fleet targets a **filesystem directory**, not a persona or team: `fleet_spawn_headless_session(app, cwd, task, args)`
  (`commands/fleet/commands.rs:59-71`). A project with no `root_path` is skipped with a
  reason (`dev_tools.rs:1193-1201`).
- The app's idempotency convention for "don't dispatch this twice" is a deterministic
  session rename — `PracticeRolloutModal.tsx:70-80`, `ExtractionMenu.tsx:269`.

## The container question — why this is a panel and not a fifth list

There are already four surfaces over these rows: Backlog (cross-project ideas + the dispatch
button), Run Desk (project-scoped tasks), the triage deck, and the attention queue. This repo
has consolidated twice, explicitly, to end exactly that duplication:

> "Approvals fetched 100 pending ideas … while Dev Tools' Idea Triage fetched the whole idea
> table for ONE project through a different slice — **same rows, two data paths, two
> truths.**" — `BacklogPanel.tsx:1-10`

So the panel is a **thin dispatcher, not a new data path**: it reuses `useBacklogQueue` and
`FacetedDecisionTable` and reads the new backend signal from
[[staleness-sees-ideas-and-tasks]]. It adds a surface, never a second truth.

## Acceptance criteria

- [ ] Right-docked, **overlaying** rather than reflowing — the `NotificationCenter` shape
      (`fixed top-[var(--titlebar-height,40px)] right-0 bottom-0 w-[380px]`,
      `NotificationCenter.tsx:361-368`). An in-flow column would fight `ContentBox`'s
      responsive `min-width` floor (`ContentLayout.tsx:74`) and make the page scroll
      horizontally at 2xl instead of shrinking.
- [ ] Opens from the title-bar tray via the existing single-slot `HeaderOverlay`
      (`uiSlice.ts:79`) — mutually exclusive with the other overlays by construction.
- [ ] Data comes from `useBacklogQueue` + the new backend signal. **No new fetch path for
      `dev_ideas`.**
- [ ] Rows group by project; `FacetedDecisionTable` already supports it — `getGroupPath`
      returns the project name instead of `category/origin` (`backlogModel.ts:86-88`).
- [ ] "Approved but never dispatched" is visually distinct, and its age is shown via the
      existing `RelativeTime` (already used for idea age at `BacklogTable.tsx:176-182`).
- [ ] Both targets reachable: `dispatchIdeas(ids, 'runner')` and `dispatchIdeas(ids, 'fleet')`.
- [ ] A project with no `root_path` cannot be fleet-dispatched — say why, in the UI, before
      the click rather than as a skip reason after it.
- [ ] The panel reports what the dispatch actually returned: `DispatchIdeasResult` carries
      `dispatched[]` **and** `skipped[]` with per-item reasons (`dev_tools.rs:977-989`).
      Skips must be visible, not swallowed.

## Risks / non-goals

Not a replacement for the Backlog or the Run Desk. Does not re-decide anything — accepting
is the deck's job; this panel only dispatches what was already approved.

`HeaderOverlay` is single-slot: adding a variant means the panel closes the monitor/deck and
vice versa. That is the established contract (`uiSlice.ts:74-78`), not a regression.

Depends on [[staleness-sees-ideas-and-tasks]] — forks after it merges.

## Build record

Shipped `33ef7e71b` — 44 files (6 new under
`src/features/overview/sub_manual-review/components/dispatch/`).

Every acceptance criterion met, with one **deliberate departure** and one
**hazard found and fixed**:

- **Departure — width.** The panel is `w-[720px]`, not 380px. The shared
  `FacetedDecisionTable`'s group rail is a fixed `w-60` (240px); at 380px the
  grid gets ~120px and the table is unreadable. The load-bearing half of the
  criterion — *overlay, never in flow* — is honoured exactly (scrim +
  `fixed top-[var(--titlebar-height,40px)] right-0 bottom-0 border-l`, the
  NotificationCenter shape).
- **Hazard — the shared list.** `triageItems` is ONE array and
  `useBacklogQueue` filters it locally by status, so mounting a second instance
  on `accepted` left the Backlog (on `pending`) rendering an empty table after
  the panel closed. Fixed structurally: `devToolsTriageSlice` now records
  `lastTriageQuery`, and the panel captures it on first render and re-issues it
  on unmount. Restoring the QUERY (not a row snapshot) means the other surface
  comes back fresh. Pinned by a test.
- **Two stale premises in the evidence**, reported not fixed:
  `src/lib/bindings/DispatchedIdea.ts` lacks the `session_id` the Rust struct
  now carries, and `devApi.dispatchIdeas`' JSDoc still claims the fleet arm is
  frontend-composed — the backend has spawned the sessions itself since
  `dev_tools.rs:1186`. Regenerating bindings would sweep ~12 files of another
  context's in-flight drift, so it was left alone.
- **Also worth knowing:** when NOTHING can be dispatched, `dispatch_ideas_core`
  returns `Err("Nothing could be dispatched — see the per-item reasons.")` and
  **discards `skipped[]`** — the per-item reasons it points at are lost on the
  wire. The panel surfaces the message honestly, but that arm is the one place
  the backend cannot keep its own promise.

Gates: `tsc --noEmit` 0 · vitest `chrome/ overview/ stores/` 46 files / 429
passed (37 new) · eslint 0 errors, 0 new warnings · `check:i18n:strict` and
`check:i18n:untranslated` clean across 14 locales · `check:contracts` OK.
