# Persona Capabilities — Implementation Plan

> Architectural reframe: **persona = behavior core + composable capabilities (use cases)**.
> Each use case becomes a first-class runnable entity with its own triggers, executions,
> messages, reviews, and memories. Persona keeps identity, style, tools, and shared memory.

**Status:** Design locked. Implementation in progress across multiple sessions. No production personas exist — greenfield, no backward compatibility required.

**👉 New coordinator picking this up? Start at [HANDOFF-2026-04-19.md](HANDOFF-2026-04-19.md) — it has the current state snapshot, the locked decisions, C2 coordination rules, and the full C5 task breakdown.**

## Reading order

1. [00-vision.md](00-vision.md) — Why we're doing this. The mental model.
2. [01-behavior-core.md](01-behavior-core.md) — What the persona's behavior core is (definition + fields).
3. [02-use-case-as-capability.md](02-use-case-as-capability.md) — Use case as first-class entity.
4. [03-runtime.md](03-runtime.md) — Prompt assembly (Option A), session cache, data flow.
5. [04-data-model.md](04-data-model.md) — Schema, FKs, coupling points.
6. [05-pillars.md](05-pillars.md) — How triggers/events/executions/messages/memories/reviews rewire.
7. [06-building-pipeline.md](06-building-pipeline.md) — CLI build + template adoption + template schema v2.
8. [07-lab-versioning.md](07-lab-versioning.md) — Lab refinement + versioning (RFC, implemented last).
9. [08-frontend-impact.md](08-frontend-impact.md) — UI surfaces and changes.
10. [09-implementation-plan.md](09-implementation-plan.md) — Ordered phases with tasks.
11. [10-deferred-backlog.md](10-deferred-backlog.md) — Items intentionally deferred, with trigger conditions.

## TL;DR architecture

```
Persona (identity + shared state)
  ├── Behavior core        → identity, voice, principles, cognitive style
  ├── Core memories        → facts, constraints, user preferences (cross-capability)
  ├── Tools                → shared tool pool (available to all capabilities)
  ├── Governance           → trust_level, budget, turn limits, gateway
  └── Capabilities (use cases)
        ├── Purpose                    (what the capability does)
        ├── Triggers                   (schedule, polling, webhook, manual)
        ├── Event subscriptions        (which events activate this capability)
        ├── Input schema / sample      (expected payload shape)
        ├── Notification channels      (where outputs go for this capability)
        ├── Model override (optional)  (per-capability compute profile)
        ├── Learned memories           (scoped to this capability)
        ├── Test fixtures              (canned simulations)
        └── enabled: bool              (runtime toggle, no rebuild)
```

## Key design decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | One persona prompt, not per-capability fragments (Option A) | Keeps identity coherent; avoids prompt version fragmentation |
| 2 | Capabilities injected at runtime into prompt via "## Active Capabilities" section | Dynamic awareness without rebuild |
| 3 | Session cache hash includes active-capability fingerprint | Toggles invalidate warm sessions correctly |
| 4 | No Execute button on persona header | Executions are per-capability, surfaced in Use Case tab |
| 5 | Chat remains persona-scoped | LLM routes internally to the right capability |
| 6 | Lab can version whole persona or refine capabilities | Matches user's "refine one or many" mental model |
| 7 | No backward compatibility for templates | Pre-production; rewrite cleanly in one pass |
| 8 | Use cases do not appear in sidebar | Navigation via Use Case tab |

## Status per phase

| Phase | Subject | State |
|---|---|---|
| C1 | Runtime foundation (prompt assembly reads capabilities, session cache, enabled flag, semantic trigger linkage via positional fallback) | **shipped** (uncommitted — 2026-04-19) |
| C2 | Building pipeline rewrite (AgentIr v2, CLI prompts, template schema v2, 107-template rewrite, adoption v2) | **in progress** (separate CLI session) |
| C3 | UI activation (toggle, simulate, remove persona Execute → per-capability in Use Case tab) | **shipped** (uncommitted — 2026-04-19); §L + §K polish/tests shipped 2026-04-19 |
| C4 | Triggers/automations first-class (trigger builder rewired, automation use-case binding) | **shipped** (uncommitted — 2026-04-19) |
| C5 | Per-use-case messages/reviews/memories | **shipped** (uncommitted — 2026-04-19) |
| C6 | Lab per-use-case + versioning RFC-driven | not started |

### Quick resume for a new session

1. `git status` — C1 + C3 changes are on `master` working tree, uncommitted. C2 work (agent_ir.rs + C2-template-audit.md) is also uncommitted, from a separate CLI session.
2. `cargo check --features desktop` — clean.
3. `npx tsc --noEmit && npx vite build` — clean.
4. The only green tests I can confirm running are `engine::prompt::tests::c1_*` (9 passing). Other Rust test-scope compilation is broken on master (unrelated); partial hygiene fix applied in `credentials.rs` to unblock `c1_*`.
5. **C4 is the next phase** — unless C2 blocks on a schema decision, start C4 from a cold read of [09-implementation-plan.md](09-implementation-plan.md) §C4.

When a phase completes, update this table and the status header of the individual doc.

## Who reads this

- **Another Claude Code session** picking up where this one left off — read this README + the phase doc they're landing.
- **Human reviewer** — [00-vision.md](00-vision.md) + [09-implementation-plan.md](09-implementation-plan.md).
- **Implementer** mid-phase — the phase doc + the pillar docs (03, 04, 05) it touches.
