# Dev Tools — documentation index

Everything Dev-Tools-related was gathered here (2026-07-14) as the substrate for
the upcoming **CX/UX rethink** of the domain. Start with the map.

| Doc | Read it when you want… |
| --- | --- |
| [`cx-map.md`](./cx-map.md) | **the terrain** — every surface across both homes, the loops that cross them, the data spine, and the named tensions the redesign must resolve. Start here. |
| [`dev-tools.md`](./dev-tools.md) | the per-tab reference: what each surface does today, user flows, backend commands, the 21 scan agents. ⚠ its "Five development directions" section predates the findings loop — treat as history, not plan. |
| [`findings-loop.md`](./findings-loop.md) | the shipped **detect → triage → dispatch → ship → verify → learn** loop end-to-end: sensors, spine, verification honesty rules, `health_ingest`, signals, the Runner/Fleet dispatch A/B. |
| [`fleet.md`](./fleet.md) | the Fleet tab (Claude Code session aggregator). Canonical copy — `docs/features/fleet.md` is now a tombstone pointer. |
| [`context-design.md`](./context-design.md) | the Context Map's data model, scan protocol, integrity invariants, KPI pairing. |

Related, deliberately **not** in this folder:

- [`../../events/README.md`](../../events/README.md) — system ops, triggers,
  Chain Studio, `signal.*` events, `unattended_mode` (the loop's wiring layer).
- [`../../teams/goals.md`](../../teams/goals.md) ·
  [`../../teams/kpis.md`](../../teams/kpis.md) — the Projects-section surfaces
  that feed/consume the loops.
- [`../../../plans/dev-findings-loop.md`](../../../plans/dev-findings-loop.md) —
  design history + phase plan for the findings loop (the feature doc above is
  the implemented-state view).
- **Deferred:** Studio/Athena involvement ("E") — its own future design session.
