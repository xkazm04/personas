# Moonshot Execution Batches — Personas (2026-07-30)

21 accepted moonshots → 5 batches. Each batch: 5 features developable in PARALLEL (disjoint code
zones), one design doc (`BATCH-N-DESIGN.md`) defining shared UX contracts so the package lands as
ONE comprehensible experience, one Fable builder per item, orchestrator reviews + runs gates.

| Batch | Package story | Items | Primary zones |
|---|---|---|---|
| **1. Command Surfaces** | "You open the app and the fleet is legible and drivable in minutes" | Generative Cockpit · Morning Director · Generative Tours · Fleet Command Anywhere · Autonomous NOC | shared UI catalog · home dashboard · tours engine · mobile bridge/fleet · overview/healing |
| **2. Safe Autonomy** | "The fleet may act alone because every act is governed, audited, reversible" | Overnight Portfolio Engine · Night Shift (Athena) · Reversible Agent · Zero-Plaintext Broker · Crew Foundry | autopilot · companion · db ledger/cdc · credential vault/proxy · factory/team-synthesis |
| **3. Self-Improvement** | "Everything that runs, learns" | Darwin Mode · Director's Lab · Self-Tuning Fabric · Self-Evolving Team · Self-Wiring Fabric | evolution/genome · director+lab · engine routing/telemetry · teams retro · event bus mining |
| **4. Federation** | "Personas becomes the backend other things call" | Agent Mesh · Teams as Addressable Workforce · Federated Data Plane · Design Genome · Twin Goes Live | a2a · mcp/team dispatch · db explorer fabric · design-system export · twin outbox |
| **5. Capstone** | "The Studio ships operating businesses" | Athena Ships Agent-Native Apps | studio/intent-compiler (integrates batches 1-4 outputs) |

Ordering rationale: Batch 1 is highest-feasibility (3× T1/high) and pure user-facing value —
establishes the visual language the rest inherit. Batch 2 needs the trust substrate before
autonomy widens. Batch 3 builds on telemetry surfaces landed in 1-2. Batch 4 exposes matured
capabilities outward. Batch 5 composes everything.

Cross-batch design constraints (batch-1 design doc owns these):
- One shared visual grammar for "agent-produced surfaces" (cockpit widgets, briefing cards, NOC
  incident cards, tour overlays) — same tokens, motion presets, empty/loading states.
- Approve/act affordances identical everywhere (one-click action buttons carry the same
  confirm/undo semantics batch 2's Reversible Agent will deepen).
- NEVER concurrent cargo builds; Rust gate is `cargo check --features desktop,ml`, run by the
  orchestrator only.
