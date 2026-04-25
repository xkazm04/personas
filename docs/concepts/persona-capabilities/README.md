# Persona Capabilities — implementation reference

> Architectural reframe: **persona = behavior core + composable capabilities (use cases)**.
> Each use case is a first-class runnable entity with its own triggers, executions,
> messages, reviews, and memories. Persona keeps identity, goal, voice, tools, and shared memory.

**Status (as of 2026-04-25):** C1–C5b shipped. Schema v3.2 ratified and live. All 107 templates on v3.1 shape. Build pipeline state-machine gate enforces clarifying questions per dimension. Drive plugin + drive tools wired to runner via MCP sidecar.

Active workstreams now live in `.planning/phases/` and the top-level `docs/HANDOFF-*.md` files. This directory holds the **stable architecture reference** for the persona-as-capabilities model and the v3.x template authoring contract.

---

## Doc layout

```
docs/concepts/persona-capabilities/
├── README.md                        ← you are here
│
│   Base reference (canonical — read in order the first time)
├── 00-vision.md                     why we're doing this, the mental model
├── 01-behavior-core.md              behavior core definition + fields
├── 02-use-case-as-capability.md     use case as first-class entity
├── 03-runtime.md                    prompt assembly, session cache, data flow
├── 04-data-model.md                 schema, FKs, coupling points
├── 05-pillars.md                    triggers/events/executions/messages/memories/reviews
├── 06-building-pipeline.md          CLI build + template adoption
├── 07-lab-versioning.md             lab refinement + versioning (RFC)
├── 08-frontend-impact.md            UI surfaces and changes
├── 09-implementation-plan.md        ordered phases with tasks
├── 10-deferred-backlog.md           intentionally deferred items
│
│   Template authoring contract (consolidated — v3 / v3.1 / v3.2 in one doc)
├── C3-template-schema-v3.md         current schema reference
├── C3-v3.1-authoring-lessons.md     authoring guidance — read before authoring a template
├── C3-4-template-proposal.md        vision-alignment proposal (4 templates)
├── C3-AUTHORING-PROGRESS.md         migration summary (mass v3.1 pass)
│
└── _archive/                        historical handoffs and superseded docs
```

## TL;DR architecture

```
Persona
  ├── Goal                   (one-sentence unifying purpose — rendered as subtitle)
  ├── Behavior core          (identity, voice, principles, constraints, decision_principles)
  ├── Core memories          (facts, user preferences — cross-capability)
  ├── Tools                  (shared tool pool available to all capabilities)
  ├── Connectors             (persona-wide, required | optional w/ fallback_note)
  ├── Governance             (trust_level, budget, turn limits, gateway)
  ├── Composition
  │     ├── trigger_composition    (shared | per_use_case)
  │     └── message_composition    (combined | per_use_case)
  ├── Notification channels  (v3.2 — per-channel use_case_ids + event_filter)
  └── Capabilities (use cases)
        ├── Purpose / capability_summary    (what this capability does)
        ├── Triggers                        (schedule | polling | webhook | manual | event_listener)
        ├── Event subscriptions             (emit | listen — <domain>.<subdomain>.<action>;
        │                                    notify_titlebar gates bell surfacing)
        ├── Connectors used                 (names referencing persona.connectors)
        ├── Sample output                   (v3.2 — {title?, body?, format?} for Test Run)
        ├── Review policy                   (never | on_low_confidence | always + context)
        ├── Memory policy                   (enabled + context)
        ├── Input schema / sample_input     (with {{param.X}} adoption-time substitution)
        ├── Output assertions               (per-UC + persona-wide; baseline NotContains)
        ├── Model override                  (per-UC failover-chain primary)
        ├── Error handling                  (per-UC subsection in active-capability prompt)
        ├── Flow diagram                    (documentation only — prompt is authoritative)
        └── enabled_by_default              (runtime toggle, no rebuild)
```

## What's shipped

| Phase | Subject | State |
|---|---|---|
| C1 | Runtime foundation — prompt assembly, session cache, enabled flag | shipped |
| C2 | Building pipeline — AgentIr, CLI prompts, template schema v2 | shipped |
| C3 | UI activation — toggle, simulate, per-UC Execute in tab | shipped |
| C3 template migration | v3.1 hand-authored shape for 107 templates | shipped (mass migration 2026-04-20) |
| C3.1 schema | 8 normative principles (P1–P8) | shipped |
| C3.2 schema | `sample_output`, `notify_titlebar`, `notification_channels` v2 | shipped |
| C4 | Triggers/automations first-class (trigger builder rewired) | shipped |
| C4 build gate | State-machine gate forces clarifying questions per dimension | shipped (commit `44b681fa`) |
| C4 drive tools | `drive_write_text` / `drive_read_text` / `drive_list` exposed via MCP sidecar | shipped |
| C5 | Per-use-case messages/reviews/memories | shipped |
| C5b | Per-capability generation policy + event aliasing | shipped |
| Trigger Composition UI | Variant prototypes (chip grid + master/override) | landed as WIP |
| Execution Verification | Notification center bridge, output assertions, per-UC error_handling, policy events backend, per-UC model_override | shipped (Phases 5, 6a, 7, 8 backend, 9, 10) |

## What's deferred

- C6 — Lab per-use-case + versioning (not started)
- Phase 6b — pre-execution healthcheck gate (assertion layer already catches the symptom; gate is belt-and-suspenders)
- Phase 8 — frontend "Policy Events" tab (backend persists; reader UI not built)
- `TriggerCompositionStep.tsx` / `MessageCompositionStep.tsx` UI productionization (prototypes only)
- `ConnectorGateStep.tsx` empty-state UI

## Where to find current work

Active workstreams have moved out of this directory:

- `docs/HANDOFF-resource-scoping.md` — current credential resource-scoping handoff (live)
- `.planning/phases/17-schema-v3-2/` — v3.2 schema execution
- `.planning/phases/18-personas-messages-connector/` — messaging connector
- `.planning/phases/19-backend-delivery-glue/` — delivery glue
- `.planning/handoffs/` — dated session handoffs

For historical context on how we got here, see `_archive/`.

## Key design decisions (stable)

| # | Decision | Rationale |
|---|---|---|
| 1 | One persona prompt, not per-capability fragments | Keeps identity coherent |
| 2 | Capabilities injected at runtime into prompt via "Active Capabilities" section | Dynamic awareness without rebuild |
| 3 | Session cache hash includes active-capability fingerprint | Toggles invalidate warm sessions correctly |
| 4 | No Execute button on persona header | Executions are per-capability |
| 5 | Chat remains persona-scoped | LLM routes internally to the right capability |
| 6 | Lab can version whole persona or refine capabilities | Matches user's mental model |
| 7 | No backward compatibility for templates | Pre-production; rewrite cleanly |
| 8 | Use cases do not appear in sidebar | Navigation via Use Case tab |
| 9 (v3.1) | Disabled UCs contribute zero prompt / matrix / questions / events | P1 from schema-v3.1-delta |
| 10 (v3.1) | Questions link to N use cases via `use_case_ids[]`, hidden when all referenced UCs disabled | P5 |
| 11 (v3.1) | Connectors declare `required: bool` + `fallback_note` for optional | P8 |
| 12 (v3.1) | Events use `<domain>.<subdomain>.<action>` convention | P7 |
| 13 (v3.2) | Schema version stays `3` — v3.2 is additive, fully back-compat | D-02 from Phase 17 |
| 14 (v3.2) | Build pipeline enforces per-dimension clarifying gates on the Rust side, not via prompt rules alone | LLM treats prompt rules as suggestions |

## Who reads what

- **New coordinator** → start with `00-vision.md`, then this README's status table, then `docs/HANDOFF-resource-scoping.md` for the active workstream.
- **Template author** → `C3-template-schema-v3.md` (single canonical schema doc) + `C3-v3.1-authoring-lessons.md` (do/don't patterns).
- **Human reviewer (architecture)** → `00-vision.md` + `09-implementation-plan.md`.
- **Implementer mid-phase** → the phase-relevant base doc (03, 04, 05) + the relevant `.planning/phases/<n>/` directory.
- **Historical lookup** → `_archive/` for superseded handoffs, the original v3.1 + v3.2 schema deltas (now folded into `C3-template-schema-v3.md`), the C3 messaging design proposal, the v3.1 impact analysis, and the EXEC-VERIF execution plan.
