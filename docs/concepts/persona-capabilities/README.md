# Persona Capabilities — implementation plan

> Architectural reframe: **persona = behavior core + composable capabilities (use cases)**.
> Each use case is a first-class runnable entity with its own triggers, executions,
> messages, reviews, and memories. Persona keeps identity, goal, voice, tools, and shared memory.

**Status:** C1 – C5b shipped to master. C3 template migration in progress (v3.1 schema ratified 2026-04-20). UI variant prototype (Trigger Composition) landed as WIP 2026-04-20. No production personas yet — greenfield, no backward-compat required.

**👉 New coordinator picking this up? Start at [C3-session-handoff-2026-04-20.md](C3-session-handoff-2026-04-20.md)** — latest session state, open decisions, precise Phase A-F execution queue for the next work block.

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
│   Template authoring — v3 / v3.1
├── C3-template-schema-v3.md         v3 schema reference
├── C3-schema-v3.1-delta.md          v3.1 refinement (8 normative principles)
├── C3-v3.1-impact-analysis.md       file-level impact map for v3.1
├── C3-4-template-proposal.md        vision-alignment proposal (4 templates)
├── C3-AUTHORING-PROGRESS.md         active status tracker (per template)
├── C3-session-handoff-2026-04-20.md latest handoff — start here
│
└── _archive/                        historical/superseded docs
    ├── C2-*.md                      C2 phase working docs
    ├── C3-template-authoring-handoff.md  pre-v3.1 handoff (superseded)
    ├── C4-build-from-scratch-v3-handoff.md
    └── HANDOFF-2026-04-19.md        prior session handoff
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
  └── Capabilities (use cases)
        ├── Purpose / capability_summary    (what this capability does)
        ├── Triggers                        (schedule | polling | webhook | manual | event_listener)
        ├── Event subscriptions             (emit | listen — <domain>.<subdomain>.<action>)
        ├── Connectors used                 (names referencing persona.connectors)
        ├── Notification channels           (per-UC delivery targets)
        ├── Review policy                   (never | on_low_confidence | always + context)
        ├── Memory policy                   (enabled + context)
        ├── Input schema / sample_input     (with {{param.X}} adoption-time substitution)
        ├── Flow diagram                    (documentation only — prompt is authoritative)
        └── enabled_by_default              (runtime toggle, no rebuild)
```

## Status per phase

| Phase | Subject | State |
|---|---|---|
| C1 | Runtime foundation — prompt assembly, session cache, enabled flag | **shipped** |
| C2 | Building pipeline — AgentIr, CLI prompts, template schema v2 | **shipped** |
| C3 | UI activation — toggle, simulate, per-UC Execute in tab | **shipped** |
| C3 template migration (v3) | Hand-authored v3 shape for 107 templates | **6/107 done** — see `C3-AUTHORING-PROGRESS.md` |
| C3.1 schema refinement | 8 normative principles (goal, use_case_ids[], composition, required connectors, ui_component hints, event namespace, flow=doc, N-ary question links) | **ratified 2026-04-20**; normalizer shipped with 4 new tests |
| C3.1 template pass | Financial + Idea Harvester + Web Marketing + Game Animator + Briefer + Dev Clone rewritten | **shipped 2026-04-20** (a109fcf7 → a0b5de23) |
| C3.1 runtime test | User-driven adoption walkthrough of 4 new templates | **in progress** — Daily Briefer + Dev Clone still untested |
| C4 | Triggers/automations first-class (trigger builder rewired) | **shipped** |
| C5 | Per-use-case messages/reviews/memories | **shipped** |
| C5b | Per-capability generation policy + event aliasing | **shipped** |
| Trigger Composition UI | Variant A (chip grid) + Variant B (master + override) prototypes | **landed as WIP 2026-04-20** (5daa03d2) |
| C6 | Lab per-use-case + versioning | not started |

## Quick resume for a new session

1. Read [`C3-session-handoff-2026-04-20.md`](C3-session-handoff-2026-04-20.md) first. It lists the exact Phase A-F execution queue + 5 open decisions to confirm with the user.
2. `git log --oneline -10` — recent commits (most recent: trigger UI prototypes, 4-template v3.1 rewrite, v3.1 schema delta).
3. `npx tsc --noEmit` clean, `cargo test --lib engine::template_v3::` 15/15, `npx vitest run src/lib/personas/templates` 17/17.
4. `.planning/` — none this repo uses; planning lives in these docs.
5. Template catalog: 107 templates, 6 on v3.1, balance on v3 pre-v3.1 (see progress doc).

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

## Who reads what

- **Next-session coordinator** → `C3-session-handoff-2026-04-20.md` (everything needed to continue)
- **Template author** → `C3-template-schema-v3.md` + `C3-schema-v3.1-delta.md` + `C3-AUTHORING-PROGRESS.md`
- **Human reviewer (architecture)** → `00-vision.md` + `09-implementation-plan.md`
- **Implementer mid-phase** → the phase-relevant base doc (03, 04, 05) + latest handoff
- **Historical lookup** → `_archive/` for superseded handoffs and C2-era working docs
