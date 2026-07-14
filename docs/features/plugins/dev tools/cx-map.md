# Dev Tools CX Map — the terrain before the rethink

> **Purpose:** the substrate for a CX/UX redesign of the Dev Tools domain. It
> inventories every surface, traces the loops that cross them, and **names the
> fragmentation honestly** — with receipts. It deliberately proposes nothing:
> the direction is an open product decision.
>
> **Direction chosen (2026-07-14):** four core dev channels + a two-level
> monitoring→action hierarchy — see
> [`docs/plans/dev-tools-cx-redesign.md`](../../../plans/dev-tools-cx-redesign.md).
> This map remains the terrain reference underneath it.
>
> **Scope note:** Studio/Athena involvement (findings-loop "E") is explicitly
> deferred to its own design session and appears here only as a touchpoint.
>
> Compiled 2026-07-14, against `master` (post findings-loop C/D). Companion docs:
> [`dev-tools.md`](./dev-tools.md) (per-tab reference),
> [`findings-loop.md`](./findings-loop.md) (the loop), [`fleet.md`](./fleet.md),
> [`context-design.md`](./context-design.md).

---

## 1. Surface inventory — three homes, plus touchpoints

The domain renders in **two sections of the app** plus **two cross-cutting
surfaces that live elsewhere**. That alone is the first thing a redesign has to
take a position on.

### Home 1 — Plugins → Dev Tools (the automation surfaces)

`DevToolsTab` union has **8 ids; the sidebar shows 7** (see Orphans, §5.7).

| Tab (label) | id | Question it answers | Central UI metaphor | Scope |
| --- | --- | --- | --- | --- |
| Overview | `overview` | "is my project OK right now?" | mission-control pulse: vital-sign tiles + connections rail + today-feed | per-project |
| Observability | `llm-overview` | "what does it do/cost/break at runtime?" | assignment matrix (fleet coverage board) + pinpoints table; LLM / Monitoring sub-tabs | matrix = fleet; table = per-project |
| Context Map | `context-map` | "what is this codebase made of, business-wise?" | spreadsheet cross-tab (contexts × features), coverage + runtime chips per row | per-project |
| Idea Scanner | `idea-scanner` | "what could be improved?" | 21-agent scan console + Agent Scoreboard | per-project |
| Idea Triage | `idea-triage` | "which of it is worth doing?" | Tinder swipe deck + rules panel + Sensor Scoreboard + findings sweep | per-project |
| Task Runner | `task-runner` | "is the work getting done?" | batch execution console + PR Bridge | per-project |
| Fleet | `fleet` | "what are my live Claude Code sessions doing?" | terminal aggregator (xterm previews) | per-project cwd; **dev builds only** |
| *(skills)* | `skills` | — | **vestigial**: in the type union, absent from nav, renders `FleetPage` (`DevToolsPage.tsx:37`) | — |

### Home 2 — Projects section (the project-management surfaces)

The 2026-07 IA consolidation moved these *out* of Dev Tools. `TeamsTab` union
(code still says "teams"): `workspace · goals · kpis · factory · projects ·
lifecycle · competition`.

| Tab | Question it answers | Central UI metaphor | Scope |
| --- | --- | --- | --- |
| Workspace | "what is the team doing/saying?" | Flight Deck / Red Room / collab chat | per-team |
| Goals | "what are we trying to achieve?" | goal constellation / progress board (+ advancement loop, default-OFF tick) | per-project |
| KPIs | "are the numbers on target?" | KPI console, per-use-case scoping, needs-attention rows | per-project |
| Factory | "can agents develop this? can I ship it?" | **passport wall** — readiness certificates as comparison columns, improve-cell ladders, golden gauge, standards scan, improve plan | **fleet** (cross-project) |
| Manage (`projects`) | project CRUD, bindings, archive | table + modals | fleet |
| Lifecycle | Dev Clone setup | setup flow | per-project |
| Competition | competitions on projects | boards | per-project |

### Cross-cutting touchpoints (live elsewhere, animate this domain)

| Surface | Where | Role in this domain |
| --- | --- | --- |
| **Chain Studio** | Events section | the *only* place the loop's automation is wired: `health_ingest` weekly schedule, `signal.raised → dispatch` routes, `unattended_mode` gates. Zero discoverability from Dev Tools. |
| **Live Stream** | Events section | where `signal.raised` / `signal.verified` / scan lifecycle events are visible |
| **Vault → Connectors** | Connections section | where the sensors get their credentials (LightTrack/Langfuse/LangSmith/Helicone, Sentry, GitHub) — Observability's empty states point here |
| Studio / Athena | Studio section | **deferred** — future "moment" layer where Athena consumes scans and speaks in design proposals |

## 2. The data spine (what actually unifies the domain)

The UI is fragmented; the data model is not. Everything hangs off `dev_projects`,
and the join keys genuinely work (proven live during the findings-loop build):

```
dev_projects ──┬── contexts (groups; filePaths)  ←──── Sentry culprit match
               ├── dev_use_cases (slug ← telemetry name; context_ids N:M)
               ├── dev_kpis (use_case_id-scoped)
               ├── goals (→ tasks)
               ├── dev_ideas  = scanner ideas ∪ FINDINGS (origin/evidence/dedup_key/verify_state)
               ├── dev_tasks  (source_idea_id ← the link verification keys off)
               ├── dev_standards (golden-standard scan rows)
               ├── passport   (derived per scan: automation + production axes)
               └── bindings: team_id · llm_tracking_credential_id · monitoring_credential_id · pr cred
```

The findings loop made this concrete: telemetry → use-case slug → contexts;
Sentry culprit → context filePaths; KPI → use case; finding → task → verdict.
**Any redesign can lean on the spine — the joins are real, only the presentation
is scattered.**

## 3. The loops that cross surfaces

This is where the fragmentation becomes visible: every real workflow crosses
homes.

**L1 — the daily improvement loop** (the original):
Scanner *(DT)* → Triage *(DT)* → Task Runner *(DT)* → PR → Agent Scoreboard *(DT, Scanner tab)*.
Self-contained in the plugin. The only loop that is.

**L2 — the findings loop** (new; see `findings-loop.md`):
sensors: Factory passport *(Projects)* + Observability *(DT)* + Context Ledger *(DT)* + KPIs *(Projects)*
→ findings in Triage *(DT)* → dispatch via Chain Studio route *(Events)* → Task Runner *(DT)* **or** Fleet *(DT, dev-only)*
→ verification on sweep *(DT Triage / scheduled via Studio)* → Sensor Scoreboard *(DT Triage)*.
**Crosses three sections.** Its cockpit is nowhere.

**L3 — the readiness loop:**
Factory passport gap *(Projects)* → ImproveCell / improve plan *(Projects)* → queued task → Task Runner *(DT)* → rescan → passport moves *(Projects)*.

**L4 — the goal loop:**
Goal *(Projects)* → advancement tick → tasks *(DT Runner)* → progress *(Projects)*; goal-coverage chips on ledger rows *(DT)* deep-link back.

**L5 — the structure loop:**
Context scan *(DT)* → features/use-cases proposed *(DT ledger)* ← telemetry proposes more *(DT Observability)* → KPIs scoped to them *(Projects)* → KPI findings feed L2.

## 4. Deep-link web (the seams users actually cross)

Ledger goal-chip → Goals board (Pulse spotlight) · ledger idea-chip → Triage ·
ledger error-chip → Overview · Observability unmapped pinpoint → "+ propose" →
ledger proposal strip · Factory warning badge → KPI console · Factory improve
cell → task queue / deploy → Runner · Overview tiles → GitHub/Sentry/setup ·
Triage evidence popover → (conceptually) each sensor's surface · everything's
empty states → Vault. These seams exist and mostly work — but each was added
point-to-point; there is no consistent "you are in a loop, here's the next
station" pattern.

## 5. The tensions — named honestly

### 5.1 Two homes, one workflow
The 2026-07 split (project management → Projects; automation → Dev Tools) is
clean *taxonomically* but every loop above crosses it. Factory is a **sensor**
for a loop whose triage/dispatch/verify surfaces live in the plugin; KPIs feed
findings the same way. The user doing the daily loop bounces between sidebar
sections.

### 5.2 Three sensors, three visual grammars
Passport wall = stamped certificates in comparison columns. Context Ledger =
spreadsheet cross-tab. Observability = coverage board + assignment sockets.
Each is a good `/prototype` winner *in isolation*; there is no shared visual
language for "a sensor surface" (scan button placement, freshness display,
scan overlays, drill-down patterns all differ).

### 5.3 Three work queues, one executor
`dev_tasks` is the confluence, but the queues feeding it have different UX:
scanner ideas + findings (swipe triage), improve-plan items (Factory's batch
queue), goal decompositions (goal board). Priorities never merge; there is no
single "what should this project do next?" list — which is exactly the question
the impact-per-effort machinery could answer.

### 5.4 The loop has no cockpit
L2 now runs end-to-end — but its evidence is smeared across toasts, triage
badges, two scoreboards, Live Stream rows, and task statuses. Nothing answers:
*"what did the system detect, do, and prove for this project this week?"*
Verification's whole value (`unchanged`/`regressed` as loudly as `cleared`) is
throttled by not having one place to see it.

### 5.5 The wiring lives in another section
The automation that animates the domain — weekly `health_ingest`, dispatch
routes, approval gates — is configured in **Events → Chain Studio**. Powerful,
composable… and invisible from Dev Tools. A user who has never opened Chain
Studio will never discover the loop can run itself.

### 5.6 Three overlapping "health" reads
Overview (repo + Sentry pulse, per-project) vs Observability (LLM cost + Sentry
issues; matrix is fleet, table is project) vs Factory (readiness, fleet).
Related questions, three aesthetics, three refresh models — and Sentry appears
in all three.

### 5.7 Orphans, tier debris, naming drift
- `skills` tab: in the union, not in nav, **renders FleetPage** — dead weight.
- Fleet: dev-builds-only but always visible in nav (comment in `sidebarData.ts`
  admits the map doesn't tier-filter).
- Naming: sidebar says **Observability**, the id says `llm-overview`; code says
  **teams**, UI says **Projects**; "use cases" were rebranded **Features** in the
  ledger UI (2026-07-14) while the data model and KPI console still say use
  case; "ideas" vs "findings" coexist in Triage.
- `dev-tools.md`'s "Five development directions" section predates the findings
  loop — #5 (per-persona dispatch) is half-superseded by the Runner/Fleet A/B;
  the section reads as a plan but is history.

### 5.8 Personas are barely in the room
For an app whose thesis is persona-driven work, the Dev domain is mostly
persona-*less*: `team_id` binding exists, dispatch targets are runner/Fleet (not
bound teams yet), and the Workspace tab's collab surfaces don't see findings at
all. (Deferred E — Athena — will press on exactly this.)

## 6. Questions a unification has to answer

*(Framing only — the direction is yours to pick.)*

1. **Who is each surface for?** The human, or the loop itself? Several tabs are
   arguably *sensor configuration + evidence display* — do they deserve
   permanent top-level nav, or do they collapse into a setup flow + a cockpit?
2. **What is the organizing noun?** The *project* (→ one per-project cockpit
   with lenses) or the *work item* (→ one unified queue across ideas, findings,
   improve items, goal tasks)? Today it's both, inconsistently.
3. **Does the plugin/Projects split survive** once the loops are the product?
   Or is "Dev" one domain with a fleet lens (Factory-style) and a project lens?
4. **Should the loop be visible *as a loop*?** A timeline per project — detect →
   decide → do → verify — would give verification its stage and make the
   automation legible. Nothing renders that today.
5. **Where does wiring belong?** Keep Chain Studio as the power surface, but
   does Dev Tools need an embedded "automation" panel (view + one-click arm of
   the standard routes) for discoverability?
6. **Which tabs earn daily attention** vs setup-once vs diagnostic-rarely — and
   should nav weight follow that frequency instead of module history?
7. **When Athena arrives (E)**, which of these surfaces does she *replace* for
   the non-technical user — and which must remain as the expert's instrument
   panel?

## 7. Known debris worth sweeping regardless of direction

Cheap, direction-independent cleanups a redesign shouldn't have to inherit:
remove the `skills` tab id (or give it a real page); tier-filter Fleet's nav
entry; reconcile `llm-overview` id ↔ "Observability" label; finish the
use-case→Features rename or revert it; retire/annotate the stale "Five
development directions" section in `dev-tools.md`.
