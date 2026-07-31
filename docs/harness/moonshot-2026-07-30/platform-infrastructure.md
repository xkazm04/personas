# Moonshots — Platform Infrastructure

## 1. The Overnight Portfolio Engine — Autopilot `full` becomes a real self-driving improvement loop across every managed repo

- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: The owner's dozen managed repos improve themselves every night — scan → triage → fix-dispatch → verdict → checkpoint — inside spend/concurrency governance, turning weeks of hand-driven campaign work into a morning review of a digest.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: Personas already contains *every organ* of an autonomous software-improvement organism, but the nervous system connecting them is a human clicking buttons. The owner's actual workflow today (multi-week Vibeman campaigns: scan, triage, waves, PRs, per-repo) is the single most expensive thing they do, and it is exactly the loop this area can close. Shipping this changes what the product *is*: from "a cockpit where I run agents" to "a portfolio that runs itself and reports to me." No competitor ships a desktop-local, spend-governed, verdict-gated autonomous dev fleet.
- **What exists today** (this is explicitly a "finish and amplify" — every limb exists, unwired):
  - Autopilot mode ladder `off|measure|suggest|full` with a `Capability` enum documented as "extend as more subscriptions are added" — `src-tauri/engine/src/autopilot.rs`, IPC in `src-tauri/src/commands/infrastructure/autopilot.rs`.
  - Idea→task→execution dispatch with self-verifying prompts (`dispatch_prompt` embeds evidence as "the bar the fix has to clear") and a `fleet` target that is deliberately still frontend-composed (v1 decision, documented in-code) — `src-tauri/src/commands/infrastructure/dev_tools.rs` (`dev_tools_dispatch_ideas`, `dev_tools_run_triage_rules`, `dev_tools_evaluate_due_kpis`).
  - A fleet scheduler with live-slot caps, auto-hibernation, frozen/stale detection, and memory-outbox ingest on session exit that already triggers delta context rescans — `src/stores/slices/system/fleetSlice.ts`.
  - Director meta-persona that scores outputs into `persona_manual_reviews` with batch mode and portfolio rollups — `src-tauri/src/commands/infrastructure/director.rs`.
  - Incremental context scanning + standards/doc-rot/divergence governance + git checkpointing — `src-tauri/src/commands/infrastructure/{incremental_scan.rs, standards_scan.rs, doc_rot.rs, git_checkpoint.rs}`.
  - Hard budget rails: monthly USD ceiling + max parallel executions in `src/features/settings/sub_limits/LimitsSettings.tsx`, spend tracking in `llm_spend.rs`/`tier_usage.rs`, notification webhooks for the digest (`notification_subscriptions`).
- **Path to implementation**:
  1. Move fleet-dispatch composition from the frontend into Rust (kill the documented v1 limitation in `dev_tools_dispatch_ideas`) so a headless tick can spawn fix sessions with no UI present. Doable now — the prompt builder and task machinery are already backend-side.
  2. Add `Capability::ScanAndTriage` and `Capability::DispatchFixes` to `autopilot.rs`; a nightly subscription tick per `full`-mode project runs incremental scan → `dev_tools_run_triage_rules` → dispatches auto-accepted ideas to the fleet, capped by `fleetMaxLiveSessions`.
  3. Wire a budget governor: the tick refuses to dispatch when projected cost crosses the monthly ceiling (spend data already in `llm_spend_log`); degrade `full` → `suggest` instead of failing silently.
  4. Gate side effects with the Director: on session exit, run a Director verdict over the diff; only verdict-passing sessions get `create_git_checkpoint` / branch push, failures re-queue as `suggest`-mode ideas.
  5. Close the measurement loop: memory-outbox ingest (already wired in `fleetSlice.ts`) feeds `dev_tools_record_kpi_measurement`, so KPIs judge whether the autonomous waves are actually moving numbers.
  6. Morning digest: one webhook/notification per project per night — dispatched, passed, blocked, spend, KPI delta.
- **Dependencies**: fleet-core session spawner, dev-tools repos, Director engine (`src-tauri/src/engine/director.rs`), settings/spend tables, notification-subscriptions API. No new external services.
- **Risks**: (1) Unattended agents committing bad code — mitigated by Director gate + checkpoint-not-merge, but the gate's judgment quality is the real product risk. (2) Cost blowouts from retry loops — the budget governor must be a hard pre-dispatch check, not post-hoc accounting. (3) Nightly fleet load on one desktop machine; hibernation/live-slots help but long CLI sessions can starve the tick.
- **What changes if we ship it**: Personas stops being a tool the owner operates and becomes staff the owner manages. Every managed repo compounds quality nightly; the owner's leverage multiplies by roughly the number of repos under governance.

## 2. The Signed Persona Exchange — from LAN share-links to a provenance-verified public registry of agent personas

- **Tier**: 1 (10x category-defining)
- **Category**: ecosystem
- **Impact**: Anyone can publish, discover, and one-click-install cryptographically signed persona bundles with verifiable authorship and fork lineage — the npm of agent personas, with Personas as its native client.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The entire trust and packaging substrate for a persona ecosystem is already built — deterministic signed `.persona` archives, Ed25519 signatures, provenance records, enclave tamper verification, TOCTOU-safe import preview, deep-link resolution — but it is imprisoned on the LAN: share links live in an in-memory map on `localhost:9420` with a 24h TTL and 64-link cap. Lifting this to the internet converts a solo desktop tool into a network with compounding data-moat effects (the registry's trust graph and provenance chains become the asset). It is the difference between owning a text editor and owning a package ecosystem.
- **What exists today**:
  - Signed deterministic bundle format with manifest/signature/metadata, exposure filtering, and a preview cache — `src-tauri/src/engine/bundle.rs` (incl. `CreateProvenanceInput`, `BundleSignature` Ed25519).
  - Share-link server + `personas://share` deep link and frontend `ShareLinkHandler` — `src-tauri/src/engine/share_link.rs`, `src/features/settings/sub_network/`.
  - Import UX with conflict preview, provenance badges, enclave tamper detection — `BundleImportDialog.tsx`, `BundlePreviewContent.tsx`, `EnclaveVerificationView.tsx` (network-bundle-sharing context).
  - Peer identity + trust levels + exposure access scopes — `src-tauri/src/commands/network/{identity.rs, exposure.rs, enclave.rs}`, `src/api/network/*`.
  - A cloud channel already integrated: Supabase-backed sync in `src-tauri/src/commands/infrastructure/cloud_sync.rs` / `src/api/cloudSync.ts`, plus an authenticated management API pattern (`src-tauri/src/engine/management_api.rs`) to model registry auth on.
- **Path to implementation**:
  1. Add a `publish_bundle` command that pushes existing bundle bytes + manifest JSON to Supabase storage/tables, reusing the exact `bundle.rs` hash/signature pipeline — no format change. Doable now against the already-configured Supabase project.
  2. Registry index: searchable table of manifests (name, tags, signer public key, content hash, download count) with the provenance chain modeled as parent-hash links, so forks carry verifiable lineage.
  3. Public per-bundle web page whose install button is the existing `personas://share` deep link (resolver already parses host/token/hash) — install-from-a-browser with zero new client code paths.
  4. Trust graph: extend `peer_identities` semantics to registry identities; import keeps today's signature + enclave verification, adding "known signer / new signer / changed key" TOFU warnings.
  5. Feedback loop: opt-in install/run telemetry (pattern already exists in `skill_usage_log`) powering rankings; later curation, org namespaces, and paid personas.
- **Dependencies**: Supabase (storage + Postgres + auth), existing identity/signing modules, deep-link handler; a small public web frontend (can be static).
- **Risks**: (1) Distributing executable agent behavior is a supply-chain attack surface — signatures prove authorship, not safety; needs an import-time capability diff ("this persona wants shell + these connectors") before first run. (2) Cold-start: a registry with ten bundles is a liability, not a moat — seed it with the owner's own persona library and recipe seeds. (3) Moderation/abuse burden of any public index for a solo maintainer; mitigate with signed-identity gating and no anonymous publishing.
- **What changes if we ship it**: Personas gains a network: every user becomes a potential author, every install strengthens the trust graph, and the registry — not the app binary — becomes the defensible asset.
