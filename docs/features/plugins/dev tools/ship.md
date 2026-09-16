# Ship — retired 2026-09-15

The Factory's **Ship** tab no longer exists. `FactoryShipTab.tsx` and
`ShipPlannerTab.tsx` were deleted and the `ship` member of `FactoryL2Tab` with
them; the Factory's L2 is now Overview · KPI matrix · Observability.

A milestone is read through **the note that is its brief**. The full surface and
its doctrine are in **[`docs/features/notepad.md` § Plan](../../notepad.md#plan)**.

## Where everything went

| Was | Is |
|---|---|
| `teams/sub_factory/l2/ship/ShipPlannerTab.tsx` (the surface) | `features/notepad/plan/NotePlanPane.tsx` + `NotePlanLedger.tsx` + `NotePlanRuns.tsx`, rendered by `NoteBody` for a linked note |
| `l2/ship/useShipData.ts` | `features/notepad/plan/useProjectPlan.ts` — one entry point now; it owns its own L2 read |
| the roadmap spine (pick between milestones) | gone; a note is the brief of exactly one milestone, so there was nothing to pick |
| `l2/ship/Ship*.tsx` (control bar, criteria, composer, goal rail, dispatch, certify) | `features/notepad/plan/` unchanged apart from import paths |
| the pure derivations | `src/lib/milestone/` — `shipDerive.ts`, `shipCriteria.ts`, `shipDuality.ts`, `shipVelocity.ts`, `shipModel.ts` |
| "open the ship plan" (island menu, milestone status bar, passport cover roadmap strip) | raises the Notepad with the desk filtered to that project (`notepadOpenForProject`) |
| §3 Data model, §13 Athena's Ship toolset | `docs/features/notepad.md` § Plan |

## What did NOT move

**All of it, on the Rust side.** Nothing was retired in the backend:
`dev_milestones` + `dev_milestone_items`, the `dev_tools_*_milestone*` commands,
Athena's three ops (`describe_ship_milestone`, `set_ship_scope`,
`ship_milestone_lifecycle`), the management API's Ship routes, the
`dev_tools_ship_milestone_ingest` door the `/ship-milestone` skill reports
through, and `dev_tools_project_wall_summary` (which still feeds the passport
wall's cover roadmap) are all unchanged. `dev_notes.milestone_id` (e30) is the
link between the two halves; migration e31 minted a brief for every open
milestone that had none, so nothing on an existing database became unreachable.

The note lifecycle carries the milestone's states: `scoped` (linked, uncut) →
`cut` (scope frozen) → `shipped`. The sections this file lost with its surface —
the `/ship-milestone` skill contract, the management API's Ship routes and the
live-refresh design — are in `.claude/skills/ship-milestone/skill.md` and in this
file's own history (`git log --follow -- "docs/features/plugins/dev tools/ship.md"`).
