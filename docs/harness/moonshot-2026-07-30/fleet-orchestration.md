# Moonshots — Fleet & Orchestration

## 1. Campaign Conductor — the fleet closes its own loop

- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: A multi-week, multi-repo improvement campaign (scan → wave plan → fan-out → harvest → verdict → next wave) becomes one durable object the fleet drives to completion itself, with the operator reduced to approving wave boundaries — turning days of hands-on orchestration per campaign into minutes of review.
- **Feasibility**: medium
- **Time-horizon**: months

- **Why it's a moonshot**: Today Fleet is a superb *monitor* with an emergent *run* concept — but the loop is open. The operator (a human, or a hand-driven orchestrating Claude session) plans waves, spawns sessions, reads the harvest, decides what's next, and spawns again. Every piece of the closed loop already exists as a disconnected organ: durable runs, per-session `FLEET:DONE` outcomes, transcript rollups, an Athena decision ledger, headless spawn. The moonshot is fusing them into a *campaign state machine* where the harvest of run N is machine-parsed into the plan for run N+1. That changes what the product **is**: not a terminal aggregator but an autonomous engineering-campaign engine — the exact workflow the owner runs by hand across a dozen repos today, productized.
- **What exists today**:
  - Durable run grouping + registry: `src-tauri/src/commands/fleet/run.rs` (dispatch-window + explicit `begin_run`/`end_run`), `src-tauri/db/src/repos/fleet_sessions.rs` (rehydratable rows, `run_id`/`run_label`, `list_runs`, `list_by_run`).
  - Machine-readable outcomes: `registry::mark_finished` "Task complete:" summaries + `transcript_read` token/file rollups, folded by `src/features/plugins/fleet/sub_harvest/FleetHarvestPanel.tsx` and `fleetRunMarkdown.ts` — currently exported for a *human* to read.
  - An orchestration brain with a memory: `src-tauri/db/src/repos/fleet_decisions.rs` (Athena's per-screen auto_fired/deferred ledger, cross-restart dedupe) and the attention model in `src/features/plugins/fleet/fleetAttention.ts` (`craftStalePrompt`, per-tile approvals).
  - Dispatch levers: `fleet_spawn_session`/`fleet_headless_session` (`src-tauri/src/commands/fleet/headless.rs`, `pty.rs`), pre-seeded prompts via `src/features/plugins/fleet/FleetSpawnTaskModal.tsx`, broadcast via `FleetBroadcastModal.tsx`, and the skill library (`sub_skills/`) as a catalog of dispatchable playbooks.
- **Path to implementation**:
  1. Structure the harvest: extend the `FLEET:DONE` contract so sessions declare a small JSON block (outcome, follow-ups, blockers, files) parsed in `transcript_read`/`run.rs` — the harvest becomes machine-readable, not just Markdown. Doable now.
  2. Add a `fleet_campaigns` table + repo (sibling of `fleet_sessions.rs`): goal, repo set, wave cursor, policy (max parallel sessions, gates), linking runs as waves.
  3. Build the Conductor tick: after a run's sessions all reach terminal state, feed the structured harvest + campaign goal to Athena (same bridge that powers `fleet_decisions`) to draft the next wave — a list of `(cwd, prompt, skill)` spawn specs — logged to the ledger.
  4. Gate it: surface the drafted wave in the Fleet Sessions tab as an approve/edit/reject card (reuse the Needs-You banner + tile-approval pattern from `fleetAttention.ts`); approval fires `begin_run` + headless fan-out.
  5. Add campaign-level policies: budget caps from token rollups, auto-halt on failure ratio, "autonomous mode" that skips the gate for low-risk waves (confidence field already exists on decisions).
  6. Campaign timeline UI in the Monitor shell (waves as chapters over the existing run picker).
- **Dependencies**: Athena companion bridge (`fleet_bridge`), fleet registry + persist writer thread, transcript rollup parser, skill library APIs; no new external services (LLM calls ride the existing companion path).
- **Risks**: (1) Autonomous wave-drafting quality — a bad plan fans out to N sessions and burns real tokens; the gate must default ON and budgets must be hard. (2) The `FLEET:DONE` JSON contract depends on session compliance — needs a validating parser with graceful fallback to prose summaries. (3) Cross-repo git safety (branch/merge policy) is outside Fleet's current scope; first version should stop at "sessions deliver on branches, human merges."
- **What changes if we ship it**: The owner stops being the scheduler of their own agent workforce. Personas becomes the only desktop product where "run a three-wave refactor campaign across five repos this week" is a single object you create, gate twice, and harvest — leverage compounds with every repo added.

## 2. Fleet Command Anywhere — finish the mobile companion into a real remote bridge

- **Tier**: 2 (3-5x)
- **Category**: interface
- **Impact**: Every `awaiting_input` and review gate becomes answerable from a phone within seconds instead of stalling until the operator returns to the desk — collapsing hours of dead fleet time per day into near-continuous throughput.
- **Feasibility**: medium
- **Time-horizon**: quarters

- **Why it's a moonshot**: This is explicitly "finish and amplify": `FleetPairDevice.tsx` self-describes as a UI scaffold — a fake pairing token, a QR placeholder, no backend call. Yet the fleet's real bottleneck is human latency: `needsLiveAttention` shows the whole design already funnels down to rare, high-value human moments (`awaiting_input`, Athena proposals, review gates). Those moments are tiny payloads — a question, a diff summary, an approve/reject — perfect for a phone. A desktop app whose agent workforce keeps moving while the owner is at lunch, in transit, or in bed is a categorically different product: unattended-capable, not attended-only. The hard rule the scaffold already promises (credentials never leave the device) is the differentiator versus cloud agent dashboards.
- **What exists today**:
  - The pairing scaffold + phone-frame preview: `src/features/plugins/fleet/FleetPairDevice.tsx`, `FleetMobilePreview.tsx` (Fleet Settings).
  - A local axum HTTP server already running on `fleetHookPort` (`src-tauri/src/commands/fleet/hooks.rs`, `keys.rs`) — the natural mount point for an authenticated `/companion` API.
  - Everything the remote surface needs is already a pure projection: attention classification + per-session Athena approvals (`src/features/plugins/fleet/fleetAttention.ts` — `sessionAttention`, `approvalsForSession`), state palette (`fleetStateMeta.ts`), live-overlay message shape (`src/features/fleet/monitor/live/liveModel.tsx`), urgent-event cards (`LiveCommsStack.tsx`), harvest summaries (`sub_harvest/`), and write levers (`fleet_write_input`, `fleet_kill_session`, `fleet_wake_session`, review verdicts via `useMonitorData.ts`).
  - The decision ledger (`fleet_decisions.rs`) gives the phone a trustworthy "why is Athena asking" rationale for every card.
- **Path to implementation**:
  1. Real pairing, locally: replace `genToken` theatre with a backend `fleet_pair_device` command — mint a device keypair, store it, render a genuine QR (endpoint + token), and add token-authenticated `/companion/state` + `/companion/act` routes on the existing hooks axum server. LAN-only at first. Doable now.
  2. Define the remote projection: a compact JSON feed of sessions × attention × pending approvals × live messages, reusing `sessionAttention`/`approvalsForSession`/`liveModel` verbatim (they are already pure).
  3. Ship the client as an installable PWA served by the axum server itself (no app-store dependency, no new repo): attention inbox, approve/reject Athena proposals, reply-to-`awaiting_input`, kill/wake, harvest digest.
  4. Escape the LAN: outbound-only encrypted relay or self-hosted tunnel for the *control feed only* — PTY bytes, transcripts, and credentials never leave the machine; the phone sees projections and sends verdicts.
  5. Push, not poll: notification on attention transitions (the footer badge logic in `FleetFooterIcon.tsx` already computes exactly when to buzz).
  6. Close the loop with Moonshot 1: campaign wave-gates become phone-approvable cards.
- **Dependencies**: hooks axum server + `fleetHookPort`, companion approvals API (`@/api/companion`), fleet write commands; external: a relay/tunnel provider (or user-supplied Tailscale-style network) for step 4; web-push service for step 5.
- **Risks**: (1) Security is the whole product here — a bug in the remote `act` route is remote code execution into live terminals; needs device-scoped tokens, per-action allowlists (start with approve/reject + canned replies only), and an audit trail (the decisions ledger extends naturally). (2) Relay step drags in infrastructure a local-first solo product has avoided; LAN+Tailscale may have to be the honest v1. (3) Answering agents from a phone without terminal context risks bad verdicts — the projection must carry enough rationale (Athena's `rationale` field, transcript tail) to decide safely.
- **What changes if we ship it**: The fleet stops keeping desk hours. Blocked sessions get unblocked from a pocket in seconds, Athena's proposals stop expiring unanswered, and Personas becomes the first local-first agent platform you can *govern* from anywhere while everything sensitive stays on your machine.
