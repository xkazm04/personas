# Dev Tools CX Redesign — four channels, one decision layer

> **Status:** direction chosen (user, 2026-07-14) + design approach (this doc).
> Next step: **mock-data prototypes** — iterate the experience before any real
> wiring. Terrain reference:
> [`docs/features/plugins/dev tools/cx-map.md`](../features/plugins/dev%20tools/cx-map.md).
> Studio scope deferred throughout.

## 1. The chosen direction (verbatim intent)

**A. Four core dev channels**, distinguished by *who drives and who it serves*:

| # | Channel | Driver → audience | Home |
| --- | --- | --- | --- |
| 1 | **Personas-driven development & orchestration** | persona teams, autonomously → the power user steering them | Teams (docs: `docs/features/teams/`) |
| 2 | **Delegated development for non-developers** | **Athena orchestrates** → non-technical user | Studio *(deferred)* |
| 3 | **Delegated development for developers** | **Athena orchestrates** → developer | Fleet |
| 4 | **Dev Runner** | manual clicks + automations | interface for LLM task processing across the whole app |

**B. Monitoring → action** is where concepts are split today with no ultimate
solution. The chosen hierarchy:

- **(a) Passport Wall** — first-sight assessment across all projects; where the
  user *establishes* a project (auth, database, monitoring… wiring connectors)
  and dispatches straightforward LLM tasks.
- **(b) KPI as the project detail view** — a project broken into **dimensions**
  with measurable states: the **business dimension** consuming the context map
  (features as children), the **technical dimension** consuming LLM/Monitoring.
  Strategy-driven development: control through measurable data + user
  ratings/feedback; the source of *calculated* LLM dispatches (likely → Fleet).
  **Absence of data/connectors must encourage wiring.**

## 2. Reevaluation — the architecture this implies

### 2.1 B is not a fifth channel. It is the decision layer.

The unifying read of A + B: **A is the set of engines; B is the cockpit.**
Monitoring→action is the shared bridge from *observation* to *delegation* — it
ends, always, in a dispatch that picks a channel:

```
            FLEET ROOM (Passport Wall)          ← assess, compare, ESTABLISH
                      │ drill in
            PROJECT COCKPIT (KPI detail)        ← dimensions · measurable states
             business ← context map/features      · findings + VERDICTS in place
             technical ← LLM cost / monitoring    · gaps render as wiring CTAs
                      │ decide
                DISPATCH (evidence-carrying)
       ┌──────────┬──────────────┬───────────────┬─────────────┐
   straightforward  calculated     orchestrated    conversational
   → Dev Runner     → Fleet(+Athena) → Team (ch 1)  → Studio (ch 2, deferred)
```

This single move resolves the map's worst tensions *by placement*: the loop gets
its cockpit (T4) because findings and their verdicts render inside the dimension
whose number they moved; the wiring becomes discoverable (T5) because gaps *are*
the CTAs; the three health reads (T6) merge into the cockpit's dimensions.

### 2.2 Positions taken on the four channels

- **Channel 4 is substrate, not a peer.** Channels 1–3 are *experiences*;
  the Runner is the engine room all of them dispatch into (the user's own
  phrasing: "various scans and tasks across the app"). CX consequence: the
  Runner should not compete in navigation as a "way to develop" — its future is
  an **operations/jobs console** (watch, debug, audit any LLM job app-wide),
  and its per-project presence inside the cockpit is just "work in flight".
- **Channels 2 & 3 are one Athena brain with two skins.** They differ in
  conversation altitude (need/design-proposals vs implementation) and control
  surface (proposals vs live sessions/terminals) — not in orchestration logic.
  Her tool surface over findings/scans/dispatch should be built once. The E
  pre-commitment holds (read tools first; write-back is now safe to design
  because dispatch exists).
- **Channel 1 is the thesis differentiator** — and the fix for T8 ("personas
  barely in the room"). Concretely: dispatch grows a third adapter (finding →
  **bound team** assignment) after the prototypes; the findings loop already
  publishes `signal.raised` with everything a team-dispatch op needs.
- **Naming needs one decision, later:** the channel-1 home is currently the
  *Projects* section whose code says `teams`. "Dev tools.Teams" vs "Projects"
  should be settled when the IA moves, not before prototyping.

### 2.3 Design principles for the hierarchy (what the prototypes must embody)

1. **Measurement before opinion.** Every tile is a real number or a wiring CTA —
   never a fake number, never an empty chart. A bare project sees an
   establishment checklist, not a broken dashboard. (This is the user's
   "absence encourages wiring", made a hard rule.)
2. **The Wall stays assessment-first.** It already won its prototype as a
   comparison instrument. *Establish* is a **guided flow launched from a gap
   stamp** (auth/db/monitoring/LLM/repo/team as stamps to earn) — not inline
   config sprawl that would re-bloat the wall. Straightforward dispatches stay
   as the existing improve-cell one-clicks.
3. **The cockpit is where the loop is visible.** Findings, dispatches in
   flight, and verification verdicts (`cleared / moved / unchanged /
   regressed`) render **in the dimension they belong to**, plus one compact
   "what the loop did this week" strip. No separate loop dashboard.
4. **Dispatch always carries evidence and names its channel.** (The
   `dispatchPrompt` contract already exists: evidence attached, bar stated —
   "the fix has to move them, not merely look plausible.")
5. **One grammar per level.** Fleet room keeps the certificate grammar; the
   project level unifies under ONE dimensional grammar. T2 is resolved
   per-level, not by forcing a single grammar everywhere.

### 2.4 The Project Cockpit — concrete enough to prototype

- **Header:** identity + the two readiness seals (from the passport) + wiring
  completeness.
- **Dimensions** (start with two; leave room for Delivery/Quality later):
  - **Business** — features (context-map use cases) as rows: KPI state, user
    rating/feedback slot, LLM cost flowing through, linked goals; gaps →
    propose/scan CTAs.
  - **Technical** — monitoring KPIs (unresolved errors, events), LLM spend by
    use case, passport dimensions below target.
- **Every row/tile:** state → trend → last verdict → dispatch affordance.
- **Loop strip:** raised *n* · dispatched *m* · verified: *k* moved, *j*
  unchanged, *i* regressed (regressions never wear success colours).
- **Three wiring tiers drive the whole render** — bare (checklist), half-wired
  (numbers where possible, CTAs elsewhere), fully wired (full cockpit). The mock
  data must model all three from round 1.

### 2.5 IA consequences — *to validate, not commitments*

If the prototypes prove out: Overview + Observability's table + the KPIs tab
fold **into** the cockpit; Observability's assignment matrix folds into the
establishment flow; the Factory wall becomes the fleet room / primary entry;
Task Runner is recast as the ops console; the vestigial `skills` tab id dies.
None of this moves until the experience is proven on mocks.

## 3. Prototype plan — mock data first (/prototype discipline)

**Shared mock module** first: ~3 projects at the three wiring tiers, with
features, KPIs (incl. a user-rating kind), findings with verdicts, costs.

| Round | Target | The A/B |
| --- | --- | --- |
| **R1** | **Project Cockpit** (highest novelty, highest risk) | (a) **Dimension board** — sectioned board, KPI tiles with drill-in children · (b) **Strategy ledger** — goal→KPI→feature→finding as one indented, scannable hierarchy (leans on the ledger grammar users already know) |
| R2 | Wall → establishment | gap stamps as CTAs, drill-in to cockpit, guided establish flow (stubbed) |
| R3 | Dispatch flow | evidence card + channel picker (runner/fleet live; team/studio greyed "coming") |

Then consolidate per `/prototype` rules; only after a winner exists do we
discuss real-data wiring and the IA moves in §2.5.

**Open questions the rounds must answer:** do goals live *inside* dimensions or
above them? · is user rating a KPI kind or a separate signal (mock as KPI kind
first)? · how does the half-done use-case→**Features** rename land in the
business dimension? · how much of the improve engine migrates into
establishment vs stays on wall cells? · does the cockpit *replace* the KPIs tab
or open as drill-in from the wall (R2 tests both entries)?

## 4. Docs & consolidation state

- Channel-1 docs home: **`docs/features/teams/`** (README updated with the
  channels note; `deliberations.md` consolidated in with a tombstone at the old
  path; doc map re-aimed, sync tests green).
- Terrain: `docs/features/plugins/dev tools/cx-map.md` · loop:
  `findings-loop.md` (same folder).
- Studio (channel 2) remains deferred to its own design session.
