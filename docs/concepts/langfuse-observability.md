# Langfuse Observability — Solution Design

> 📦 **Path A is shipped.** The implemented-product reference for the Langfuse plugin lives at **[`docs/features/langfuse.md`](../features/langfuse.md)** (managed Docker stack + manual mode + auto-login flow + backend command surface). This document remains the **design archive** — it's where the Path A → A+ → B reasoning lives, plus the supersedence history of Cloud → Self-host. Read it when you want the *why*; read `features/langfuse.md` when you want the *what is*.

**Status:** **Path A closed 2026-05-07.** Managed self-host plugin shipped, traces flow into Langfuse, zero-click sign-in works, browser deep-links go straight to traces. Path A+ exploration is the next step. Path B vs "master Langfuse" decision deferred until A+ findings land.
**Known backlog:** Lab `score_result` → Langfuse Scores API — see [`langfuse-lab-score-push.md`](./langfuse-lab-score-push.md). Pick up before Path B work, or earlier if A+ surfaces it as a need.
**Owners:** TBD
**Last updated:** 2026-05-07

---

## 2026-05-07 — Self-host pivot (supersedes the cloud framing below)

Cloud Langfuse (EU/US/JP/HIPAA) is **out of scope**. The plugin targets self-hosted only, with a managed lifecycle owned by the desktop app. A non-technical user clicks **Start Langfuse** and the app runs Docker for them — generates a `docker-compose.yml` + `.env`, brings up Postgres + ClickHouse + Redis + MinIO + Langfuse v3, health-probes until ready, auto-seeds an admin user and project keys via `LANGFUSE_INIT_*`, and writes the keys into our keyring. The user never opens a terminal.

What this changed in the plan below:

- "Path A" is no longer "paste cloud keys" — it's the managed self-host build described in **Phase 1a delivery** below.
- The **non-goal** "Self-hosting Langfuse for the user" is reversed: managed self-host *is* the entire target.
- The **goal** that read "region picker + key paste" is replaced by "click Start; we run the stack."
- Path A+ still applies — it remains the investigative phase on a live local instance.
- Paths B and C are unchanged.

Why we pivoted: a desktop user shouldn't have to sign up for an external service to get observability on a local app. We can ship a fully managed stack with no marginal user ask, the cloud paths offered nothing the local stack doesn't, and removing them removes a regional/compliance variable from the support surface.

### Phase 1a delivery (this branch)

- New plugin `src/features/plugins/langfuse/` (sibling of `obsidian-brain`, `gitlab`, etc.) with a primary **ManagedStackPanel** and a collapsed **"I have my own Langfuse"** advanced section for users who run their own instance.
- New Rust module `src-tauri/src/langfuse/`:
  - `templates.rs` — embeds a slim Langfuse v3 compose template (`compose.yml.tmpl`); generates strong random secrets (`NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY` (64-hex), `REDIS_AUTH`, per-service passwords) plus auto-init values (`LANGFUSE_INIT_PROJECT_*`, admin email/password). Compose project name is `personas-langfuse` for volume isolation.
  - `docker.rs` — detects Docker (CLI present, daemon up, `docker compose` vs `docker-compose`), runs `up -d`/`down`/`ps`, parses presence, polls `/api/public/health`.
  - `config.rs` — extends keyring storage with `managed`, `admin-email`, `admin-password` entries.
  - `types.rs` — adds `LangfuseStackInfo`, `LangfuseStackState`, `LangfuseAdminCredentials` (all ts-rs exported).
- Five new Tauri commands: `langfuse_stack_get_info`, `langfuse_stack_start` (long-running, 10-min timeout), `langfuse_stack_stop`, `langfuse_stack_get_admin_credentials`, `langfuse_stack_open_ui` (opens browser via `open::that`).
- Aux services (Postgres, ClickHouse, Redis, MinIO) intentionally do not publish ports to the host — only `langfuse-web` is reachable on `127.0.0.1:3000`. Reduces the port-conflict blast radius.
- `compose down` preserves named volumes — user data (traces, prompts, scores) survives stop/start.
- The advanced **manual** flow still works for users who run a Langfuse somewhere else; it shares the same probe (`GET /api/public/projects`) and keyring storage.

What is NOT in this branch (Phase 1b targets):

- The OTLP exporter from `engine::trace::TraceCollector` to Langfuse — no traces flow yet.
- Lab `score_result` → Langfuse Scores API.
- "Open in Langfuse ↗" link from Execution Detail.
- The `redact_content` toggle is stored but not yet honored (gates prompt/completion text in the exporter once 1b lands).
- Auto-port-pick on conflict (currently pinned to 3000).
- Reset-data button (delete volumes); image update/refresh button.

### Phase 1b delivery (this branch, on top of 1a)

- New module `src-tauri/src/langfuse/exporter.rs` — OTLP/HTTP-JSON exporter with bounded MPSC queue and a tokio worker; POSTs to `<host>/api/public/otel/v1/traces` with HTTP Basic auth (`base64(pk:sk)`).
- TraceSpan → OTLP mapping: 32-char hex `traceId` + 16-char hex `spanId` derived from existing UUIDs; `CliSpawn` spans get `langfuse.observation.type=generation`; `ToolCall` spans get `langfuse.observation.type=tool`; token counts surface as `gen_ai.usage.input_tokens` / `output_tokens`; `chain_trace_id` becomes `langfuse.session.id` so multi-persona chains group as a Langfuse Session.
- Hooked into all four `TraceCollector::finalize` call sites in `engine/runner/mod.rs` via `langfuse::exporter::export_trace(&final_trace)` — fire-and-forget, never blocks execution.
- `redact_content` is honored at POST time (read from keyring per-export, not captured at install) so the toggle takes effect on the next trace without restart. When on, span `metadata` is omitted entirely; structure + token counts + cost still ship.
- Lifecycle: `init_from_config()` runs on app startup as a checkpoint; `langfuse_save_config`, `langfuse_stack_start`, and `langfuse_clear_config` all install/uninstall the exporter as a side effect of their existing flows.
- Frontend: new `OpenInLangfuseButton` next to the Execution Detail tab switcher. Visible only when (a) a managed config is connected, (b) `enabled=true`, and (c) the execution has a persisted trace. Builds the deep link as `<host>/project/personas-default/traces/<trace_id>`.
- Resilience: failed POSTs log a `tracing::warn!` and drop the trace — no retry, no dead-letter queue, never propagates to the execution path. A full export queue drops the *current* trace with a warn instead of blocking.

### Phase 1c delivery (this branch, on top of 1b)

- Background lifecycle. `langfuse_stack_start`, `langfuse_stack_stop`, and the new `langfuse_docker_download_installer` all return a `LangfuseJobHandle` immediately and run as detached `tauri::async_runtime::spawn` tasks in `langfuse/lifecycle.rs`. The user is no longer locked in the plugin page during a multi-minute first-run setup.
- Granular phases + progress events. `StartPhase` enum (`Preparing` 2 s · `PullingImages` 180 s · `StartingContainers` 30 s · `Healthchecking` 60 s) with fixed estimates that drive aggregate fraction and ETA. Background workers fire `langfuse://stack/progress` every 2 s using a per-phase ticker; the final `langfuse://stack/done` event ends the job.
- Per-byte progress for the installer download — real bytes-streamed against `Content-Length`, not interpolation, throttled to ~5 emits/s.
- Single-job concurrency guards. `START_IN_FLIGHT` and `STOP_IN_FLIGHT` atomics make double-start a 4xx instead of a race.
- OS notifications via `tauri-plugin-notification`. Fire on every terminal `done` event the user kicked off explicitly (start success/failure, installer download success/failure). Quiet on a clean stop.
- Port preference. New `langfuse_save_preferred_port` command; preferred port lives in keyring (`langfuse-preferred-port`, default 3000). On every start, `templates::pick_free_port(preferred)` scans up to 10 ports beginning at the user's choice and uses the first free one. Auxiliary services still bind to internal-only ports. If the stack is already running, its existing port is kept (no churn).
- Docker installer download + run. Detects OS, streams the official Docker Desktop installer to the user's Downloads folder (Win .exe / macOS .dmg). On macOS arm64 vs x64 picks the right artifact. After download, `langfuse_docker_run_installer(path)` opens the file via `open::that` — UAC on Windows, .dmg mount on macOS. Linux gets a docs link instead.
- Frontend: dedicated `langfuseStackStore` (zustand) for live progress, mounted globally via `useLangfuseStackEvents` inside `BackgroundServices.tsx` so navigation away from the plugin page doesn't drop the in-flight progress. New `StackProgress` component renders fraction + ETA + a "you can close this page" hint. New `OutcomeBanner` shows the result after the user comes back. Port-preference input lives next to the action buttons. Docker install assistance shows a "Download installer" → "Run installer" flow with progress.

### Phase 1d: zero-click sign-in via in-app HTTP proxy

After fixing the keyring/email bugs, the only manual step left was Langfuse's NextAuth sign-in form. Built a generic in-app HTTP service so the user lands inside Langfuse without typing anything.

**`src-tauri/src/local_http/`** — shared infrastructure:
- `mod.rs` — axum server bound to `127.0.0.1:<free port from 17400>`, started in `lib.rs` setup. Exposes `register_router(prefix, axum::Router)` so future integrations (GitLab webhooks, magic links, anything that needs to be reachable by the user's default browser) plug in without touching this file. Also a single-use 60-second nonce store (`mint_nonce` / `consume_nonce`).
- `langfuse_routes.rs` — first consumer. `GET /langfuse/auto-login?nonce=…&return_to=…`:
  1. Validate + consume nonce.
  2. Read host + admin email/password from keyring.
  3. Server-side `GET <host>/api/auth/csrf` → capture both the body's `csrfToken` and the full `next-auth.csrf-token` cookie value.
  4. Render HTML response with `Set-Cookie: next-auth.csrf-token=...; Domain=localhost; Path=/; SameSite=Lax` and a hidden auto-submitting `<form>` posting `csrfToken`/`email`/`password`/`callbackUrl` to `<host>/api/auth/callback/credentials`.
  5. Browser stores cookie (scoped to `localhost` across ports), submits form to Langfuse — same-site so SameSite=Lax permits it. NextAuth validates body token == cookie value, sets `next-auth.session-token`, redirects to `callbackUrl`.

**Critical detail.** The auto-login URL must be served from `http://localhost:<port>` (not `127.0.0.1:<port>`). Setting `Domain=localhost` on a response from `127.0.0.1` is rejected by spec-compliant clients (the cookie's domain must match or be a parent of the request host), which silently breaks the cross-port cookie share. Found this live by walking the flow with curl.

**Tauri command.** `langfuse_open_authenticated_ui(return_to: Option<String>)` mints a nonce, builds the URL, and `open::that()`s it. Falls back to plain `langfuse_stack_open_ui` (no auto-login) for manual connections — those don't have admin credentials in keyring. A test-only `langfuse_make_authenticated_url` (compiled under `#[cfg(feature = "test-automation")]`) returns the URL without spawning a browser, so the flow can be exercised end-to-end via curl in the regression suite.

**Frontend wiring.** `useLangfuseStack.openUi()` calls the new command. `OpenInLangfuseButton` (per-execution) passes `return_to=/project/<projectId>/traces/<traceId>`, so a click deep-links straight into the trace inside Langfuse. Both keep the plain open path as a final-fallback after the authenticated path errors.

**Reusability.** Adding a new integration that needs a browser-reachable endpoint is `register_router("integration_name", router())` from anywhere before `local_http::start()`. Future candidates: GitLab webhook receivers, OAuth redirect targets that need to bridge into the desktop app, magic links to share trace URLs with non-Personas users.

### Phase 1c live-debug fixes (live session via test-automation)

After Phase 1c shipped, a live debugging session via `npx tauri dev --features test-automation` exposed two real bugs the static checks couldn't catch:

- **`LANGFUSE_INIT_USER_EMAIL: personas@localhost` → "Invalid environment variables".** Langfuse runs Zod's `.email()` against the init user email; bare `@localhost` is rejected because there's no TLD. The 8-minute health probe waited forever because the langfuse-web container kept crash-looping on its instrumentation hook. Fixed by switching to `personas@local.host` in `langfuse/templates.rs::StackSecrets::generate` (still purely local; `.host` is a valid TLD).
- **Every keyring write silently no-op'd.** `Cargo.toml` had `keyring = { version = "3", optional = true }` with no backend feature. keyring 3.x made platform backends opt-in — without any of `apple-native`, `windows-native`, `sync-secret-service`, the crate ships the **mock backend** that accepts writes and reads back nothing. Symptoms: `langfuse_save_preferred_port(3742)` returns `Ok` but `langfuse_get_config()` reads back the default; admin credentials never appear in the UI; the entire Langfuse + GitLab + every other keyring user is broken. Fixed by enabling all three native backends so a single Cargo.toml works on every desktop target. **This is a project-wide fix** — GitLab keyring storage was equally broken before.

### Phase 1c bug fixes + 1d delivery (this branch, on top of 1c)

Bugs found in Phase 1c testing:
- `Currently using` label didn't update after saving a new preferred port. Fixed: `langfuse_save_preferred_port` now also rewrites the .env when the stack is initialized and not currently bound to the new port (running stacks are left alone — port realignment requires a stop+start).
- Health probe stuck in `Healthchecking` and Langfuse returned 500 on first run. Root cause: the compose template had drifted from Langfuse's official v3 self-host. Realigned: removed the ClickHouse `:24` tag (use upstream default), restored `cgr.dev/chainguard/minio` via `docker.io/minio/minio` with the correct `mc ready local` healthcheck, simplified the redis healthcheck to match upstream.
- "Open in Langfuse" button appeared in `Unhealthy` state and during in-flight start jobs. Tightened: only shown when state is *exactly* `running` and no job is in flight.

Phase 1d additions:
- Maintenance section: **Pull latest images** (`compose pull` only) and **Reset stack data** (`compose down -v`, behind a "type RESET to confirm" gate). Both run via new `langfuse_stack_refresh_images` / `langfuse_stack_reset` commands.
- Auto-poll Docker detection. While the stack state is `DockerMissing` / `DockerNotRunning` / `ComposeMissing`, the frontend polls `langfuse_stack_get_info` every 5 s so the UI advances automatically once the user finishes installing or starting Docker — no manual Refresh needed.
- Open-in-Langfuse for *manual* connections. Added optional `projectId` to `LangfuseSaveRequest` and `LangfuseConfig`; the connection form has a "Project ID (optional)" field. The deep-link button now appears whenever `projectId` is set (always for the managed stack — `personas-default` baked in via `config::MANAGED_PROJECT_ID`).
- Port-mismatch hint. When the user changes preferred port while the stack is running, the UI shows a small "Stop and start the stack to apply the new port." note next to the port input.

### Path A — closed (2026-05-07)

Original "Pipe & Link" goals (export sink, plugin chassis, "Open in Langfuse" link) are all met. Plus everything that grew out of the live-debug session (managed self-host, background lifecycle, OS notifications, port preference, Docker installer, auto-login, in-app HTTP service infrastructure, keyring-backend fix project-wide).

Closed with **one known backlog item** and two polish items deferred until they bite:

1. **Lab score push** — see [`langfuse-lab-score-push.md`](./langfuse-lab-score-push.md). The most visible coverage gap (Lab runs don't appear in Langfuse). Recommended approach is Path 2 (synthesize per-scenario traces); ~4–8 hours.
2. **Per-image pull progress** — current linear interpolation is fine on cache-hit restarts; first-run cold pulls are when this would matter. ~4 hours when someone notices.
3. **Live span streaming** — push-on-finalize is enough for post-hoc analysis (which is Langfuse's core value-add). Real-time streaming is the kind of feature Path B might justify; deferring until then. ~6–10 hours.

### Path A+ — next

The whole point of the staged plan: ship Path A, use it for real, judge Langfuse's UI fit on real data. Now that the plumbing works end-to-end:

- Run a few real personas with the exporter on. Click around Langfuse's trace explorer. Does it render `personas.span_type`, `chain_trace_id` sessions, our metadata cleanly? Are there things we need that aren't there?
- Open the Langfuse prompt CMS. Does it duplicate or complement our Lab? Could it replace `PersonaPromptVersion`, or do they need to coexist?
- Look at per-model cost bucketing in Langfuse. Does it satisfy gap #2 from the original three-paths analysis ("cost is global aggregate; no per-model bucketing")?
- Try sharing a public trace link. Useful for non-Personas teammates? Worth keeping?

Output: `docs/concepts/langfuse-path-a-plus-findings.md` with verdicts on each gap from the original analysis. That doc decides whether to:
- **Stay at A** (Langfuse-as-external is sufficient; close the design).
- **Path B** (embed Langfuse views back into Personas; Lab score push becomes a higher priority).
- **"Master Langfuse"** (fork or deeply theme self-hosted Langfuse; commit to it as the canonical observability surface).

### Resources & limits

- Stack idle: ~2 GB RAM, ~1.5 GB disk after image pulls.
- First start downloads images (~1.5 GB). 8-minute health-probe timeout covers this; subsequent starts are seconds.
- Container exposure is loopback-only (`127.0.0.1:3000`), so the local Langfuse is not reachable from the LAN.

---

## Context

Personas already collects rich execution telemetry — `engine::trace::TraceCollector` produces a span tree (`Execution → PromptAssembly → CredentialResolution → CliSpawn → ToolCall → ProtocolDispatch → ChainEvaluation → …`) and persists it to the `execution_traces` table. The existing reporting surface in `src/features/overview` (15 subsections, Mission Control aesthetic) renders aggregate cost, run health, alerts, anomalies, and an in-memory system trace viewer.

Two real gaps exist:

1. **The persisted execution-span tree is never surfaced in the UI.** The data is in the DB; no view explores it.
2. **Cost and tokens are aggregated globally**, never bucketed per model or per LLM call.

Langfuse is the most mature open-source LLM observability product on the market and has a polished trace explorer, prompt management, scoring API, and session/chain views. Three quiet alignments make the integration unusually low-friction:

- Our `TraceSpan` enum is structurally OTEL-shaped — exporting is a translation, not a redesign.
- Lab's three rubric scores (`tool_accuracy`, `output_quality`, `protocol_compliance`) map directly to Langfuse's Score API; prompt-version lineage maps to Sessions.
- Langfuse fills the two reporting gaps without competing with the existing cost/health dashboards.

A Rust crate (`opentelemetry-langfuse` 0.3.x on crates.io) wraps OTLP export, so we don't have to write a Langfuse client ourselves.

## Goals

- A non-technical user can connect Langfuse from inside the desktop app (region picker + key paste, no manual env-var fiddling, no external setup wizard).
- Persona executions, Lab runs, and prompt-version events flow into Langfuse as traces/observations/scores with no behavioral change in production paths.
- Each execution detail view links out to its corresponding Langfuse trace.
- The integration is opt-in, off by default, and degrades silently if Langfuse is unreachable.
- The integration is shaped as a **plugin** (sibling of `obsidian-brain`, `research-lab`, `gitlab`, `twin`, `companion`) so it can be enabled/disabled per workspace and discovered via the existing Plugin Browse page.

## Non-goals

- Replacing any existing Overview chart, alert rule, or trace viewer.
- Self-hosting Langfuse for the user (self-host stays a "I'll provide my own host URL" option, not a managed surface).
- Building any of Langfuse's own features (prompt CMS, dataset management, evaluation runners) inside Personas — those are exactly what we're delegating to Langfuse.

---

## Existing surfaces this touches

| Area | File / location | Why it matters |
| --- | --- | --- |
| Execution pipeline | `src-tauri/src/engine/runner/mod.rs` (`run_execution`) | Owns the 4-stage pipeline; W3C `traceparent` already injected on CLI spawn |
| Trace collection | `src-tauri/src/engine/trace.rs` (`TraceCollector`, `TraceSpan`) | Source of truth for spans; export point |
| Chain correlation | `chain_trace_id` propagated through engine | Maps to Langfuse Session for multi-persona chains |
| Cost & tokens | `src-tauri/src/engine/cost.rs` (pricing table); `persona_executions.cost_usd` | Per-call attribution exists in execution events |
| Lab scoring | `src-tauri/src/engine/eval.rs` (`eval_with_llm`); `src-tauri/src/commands/execution/lab.rs` (`test_runner.rs::score_result`) | Three rubric scores → Langfuse Scores |
| Prompt versioning | `src-tauri/src/db/repos/lab/versions.rs`; `PersonaPromptVersion` | Optional: surface version IDs as Langfuse trace tags |
| Secret storage | `src-tauri/src/engine/crypto.rs` (`EncryptedToken::seal`); OS keyring | Where Langfuse keys live |
| HTTP client | `src-tauri/src/cloud/client.rs` (`reqwest::Client`); tokio runtime | Reusable transport |
| Plugin chassis | `src/features/plugins/PluginBrowsePage.tsx`; `src/features/plugins/pluginTheme.ts`; `useSystemStore.enabledPlugins` | Where the new plugin slots in |

---

## Three paths

### Path A — "Pipe & Link" (export sink + setup plugin)

Smallest surface that produces real value.

**What ships:**

- A new plugin `src/features/plugins/langfuse/` (sibling of `obsidian-brain`).
- One settings/connection screen inside the plugin: region picker (Cloud EU / Cloud US / Cloud JP / HIPAA / Self-hosted custom URL), paste fields for `pk-lf-…` and `sk-lf-…`, **Test connection** button, **Enable export** toggle.
- Keys sealed with `EncryptedToken::seal()` (same pattern as OAuth tokens), stored in the existing settings repo.
- A Rust exporter task: subscribes to `TraceCollector::end_span` and emits OTEL spans via `opentelemetry-langfuse` to `<host>/api/public/otel/v1/traces`. Bounded MPSC queue + tokio task with batch+flush (e.g. 100 spans or 5 s).
- Lab `score_result` POSTs scores to Langfuse Score API tagged with the trace ID it just produced.
- A small "Open in Langfuse ↗" link on the Execution Detail header (built from `host + traceId`).
- No new dashboards inside Personas. The user sees the rich view in Langfuse's own UI.

**Effort:** ~1 sprint.

**Pros:**

- Off-the-shelf Rust crate handles OTLP transport.
- Uses the existing keyring/encryption/reqwest/tokio plumbing — no new infrastructure.
- Doesn't touch any existing dashboard, so zero regression risk on Overview.
- Power users get persistent traces, sharing, prompt diffs, and per-model cost bucketing immediately.

**Cons:**

- The user has to leave the app to actually *see* anything beyond a link.
- Non-technical users may never click through unless there is a strong in-app affordance.
- No multi-persona chain visualization inside Personas.

### Path A+ — "Customization probe" (between A and B/fork)

Not a separate ship; it's the **investigative phase** that runs on top of Path A once data is flowing.

**What we test:**

- Can Langfuse's UI be customized (custom dashboards, metadata-driven views, custom score visualizations) to fit Persona-specific concepts (use cases, healing categories, chain trace, prompt-version lineage, design context)?
- Does Langfuse's prompt-management surface duplicate, complement, or conflict with our Lab + `PersonaPromptVersion` versioning?
- How well does Langfuse render the span types we emit? Are there trace shapes (e.g. nested chain trace IDs, retry failover chains) that look broken?
- What does iframing Langfuse Cloud inside the desktop app feel like (auth, theming, depth)? Could a self-hosted Langfuse be deeply themed to match Personas without a fork?

**Output:** a short follow-up doc that picks one of:

- **Path B** if Langfuse covers ~80% of what we want and the remaining 20% is best built natively in Personas, leaning on Langfuse for storage + heavy lifting.
- **Fork / "master Langfuse"** if we hit hard customization walls and the right answer is to embed a self-hosted, deeply themed Langfuse (or fork its UI) as the canonical observability surface.
- **Stay at A** if Langfuse-as-external is sufficient and adding a second UI surface in our app is not worth the maintenance.

### Path B — "Embedded Insights"

Everything in Path A, plus a new **Overview → Insights** subsection (sibling of Observability) that pulls traces back via Langfuse's read API and renders them in our visual language.

**Adds:**

- Repurpose `SystemTraceViewer.tsx` to render *persisted* Langfuse traces with prompt/completion text inline.
- Per-model cost-and-token bucketing chart (closes gap #2).
- Multi-persona chain waterfall using `chain_trace_id` as Langfuse session id.
- "Compare two runs" prompt diff inside the app.
- "Share this run" button that mints a Langfuse public link.

**Effort:** Path A (1 sprint) + ~3 weeks.

**Pros:**

- The user never leaves the app; Langfuse is invisible infrastructure.
- Closes both reporting gaps with our design language preserved.
- Round-trip via Langfuse's read API means no second source of truth.

**Cons:**

- We own a second UI surface that has to stay roughly in sync with what Langfuse offers.
- Trace round-trip latency means the live tail still has to come from local events.
- Invisible dependency: a Langfuse outage degrades a UI surface that looks native.

### Path C — "Lab Cloud"

Narrow scope: only the Lab.

**Adds:**

- Each Arena/Matrix/A-B/Eval run becomes a Langfuse Experiment.
- Each `PersonaPromptVersion` mirrors as a Langfuse Prompt Management entry.
- Rubric scores push as Langfuse Scores; lineage is a Session.
- Optional: prompts can be edited in Langfuse's web UI and pulled back into Personas (canonical store debate).

**Pros:**

- Concrete user job (iterate prompts), maps to existing investments.
- Lowest risk to production execution paths.

**Cons:**

- Narrow. Doesn't help users who want observability for live executions.
- The Lab already has rich versioning, scoring, and lineage locally — Langfuse's prompt CMS would compete with it more than complement it.
- Forces a "which side is canonical?" decision for prompt versions before we know if anyone wants the cloud side.

---

## Recommendation

**Ship Path A first. Use Path A+ to decide between Path B and "master Langfuse" (fork/deep-embed). Hold Path C.**

Rationale:

1. Path A is almost free given the existing `TraceSpan`/keyring/`reqwest`/tokio plumbing and the off-the-shelf `opentelemetry-langfuse` crate.
2. Path A immediately delivers persistent traces, sharing, and per-model cost — and validates whether anyone actually turns the integration on. If adoption is zero, B and C are both moot.
3. Path A+ is exactly the experiment the user asked for: live data flowing into a real Langfuse, with us probing how customizable its UI is. That is the only honest way to choose between B (mirror-and-improve) and a fork (master-and-embed).
4. Path C is appealing but premature. The Lab already has opinionated local versioning + LLM-evaluated scoring; bolting a parallel cloud experiment store on it without first proving that prompt-sharing is a desired job risks making the Lab confusing.
5. Because everything rides on OTLP, a future user who wants a different backend (Phoenix, Helicone, custom OTEL collector) can swap endpoints without us rewriting anything.

---

## Path A — implementation scaffold

### Plugin shape

The integration ships as a plugin so it can be enabled/disabled per workspace and discovered from the Plugin Browse page. It mirrors the `obsidian-brain` shape (small, settings-heavy, no sub-tabs initially).

```
src/features/plugins/langfuse/
  LangfusePage.tsx              # plugin landing — connection card + status
  ConnectionForm.tsx            # region picker + key fields + Test connection
  StatusPanel.tsx               # last export, queue depth, error tail
  hooks/
    useLangfuseSettings.ts      # read/write settings via Tauri commands
    useLangfuseHealth.ts        # poll exporter status
  api/
    langfuseClient.ts           # invokeWithTimeout wrappers
```

Registration touchpoints (mirror existing plugins):

- Add `'langfuse'` to `PluginTab` in `src/lib/types/types`.
- Add an entry to `PLUGINS` in `src/features/plugins/PluginBrowsePage.tsx` (icon: `Activity` or `LineChart` from lucide; suggested accent `text-orange-400` so it doesn't collide with existing plugin colors).
- Add an accent to `pluginTheme.ts`.
- Add i18n keys `plugins.langfuse_label` / `plugins.langfuse_desc` to `src/i18n/locales/en.json` (per CLAUDE.md i18n rule).
- Add the plugin route to wherever sibling plugins resolve their pages.

### Connection UX

One screen, three steps, no jargon:

1. **Where is your Langfuse?** Radio group: Cloud EU · Cloud US · Cloud JP · HIPAA · "I have my own URL" (text field).
2. **Paste your two keys.** Two fields, format-validated against `pk-lf-` / `sk-lf-` prefixes. A "Where do I find these?" link to Langfuse's project settings docs.
3. **Test & enable.** Test connection button calls a Rust command that sends a single empty trace and reports HTTP status + auth result. On success, the Enable export toggle becomes interactive.

Status panel shows: export on/off, last successful export timestamp, queue depth, last 5 errors (truncated). No raw OTLP payloads displayed.

### Backend

New Rust module `src-tauri/src/integrations/langfuse/`:

```
mod.rs            # public API (init, shutdown, send_score)
config.rs         # LangfuseConfig {host, region, encrypted_pk, encrypted_sk}
exporter.rs       # OTLP exporter wired to TraceCollector
queue.rs          # bounded MPSC + batcher (100 spans or 5s, whichever first)
scores.rs         # POST to /api/public/scores for Lab eval results
```

New Tauri commands in `src-tauri/src/commands/integrations/langfuse.rs`:

- `langfuse_test_connection(config) -> Result<TestResult, AppError>` — sends a probe, returns auth/HTTP status.
- `langfuse_save_config(config) -> Result<(), AppError>` — seals keys via `EncryptedToken::seal`, persists config to settings repo, hot-swaps exporter.
- `langfuse_get_status() -> Result<ExporterStatus, AppError>` — last export time, queue depth, recent errors.
- `langfuse_clear_config() -> Result<(), AppError>` — disable and zeroize keys.
- `langfuse_get_trace_url(execution_id) -> Result<String, AppError>` — used by the Execution Detail "Open in Langfuse" link.

Generate ts-rs bindings via `cargo test export_bindings` after adding `#[derive(TS)] #[ts(export)]` to the new structs (per CLAUDE.md ts-rs rule).

### Wiring into the engine

- `TraceCollector::end_span` gains a side-channel hook (no behavior change if exporter is off): `if let Some(tx) = self.langfuse_tx { let _ = tx.try_send(span); }`. Try-send with `try_send`, never `.await` — exporter back-pressure must not stall execution.
- `chain_trace_id` becomes the OTEL session attribute (`langfuse.session.id`).
- `persona_id`, `persona_name`, `version_id`, model, cost_usd, input_tokens, output_tokens, engine_kind, use_case_id become span attributes — these are what makes the Langfuse trace queryable later.
- LLM-call spans (CliSpawn child) emit as OTEL `generation` (the Langfuse type for LLM observations) with `model`, `input` (prompt text), `output` (completion text), `usage.input/output`, `cost.total`.
- On `score_result` completion in `test_runner.rs`, POST scores via `scores::send` keyed to the parent trace id.

### Frontend wire-up

- New `src/api/langfuse.ts` with `invokeWithTimeout` wrappers (per CLAUDE.md no-raw-invoke rule).
- Execution Detail header: a small `LangfuseLink` component that calls `langfuse_get_trace_url(executionId)` and shows the link only if the exporter is enabled and a trace was successfully exported for this execution.
- No changes to existing Overview charts, alerts, or trace viewers.

### Acceptance criteria

- A first-run user can go from "Plugin disabled" to "first trace visible in Langfuse" in ≤ 90 seconds without touching env vars, files, or terminal.
- Disabling the plugin stops all outbound HTTP within 1s and zeroizes secret material from memory.
- An execution with the exporter off behaves byte-for-byte identically (no trace, no log, no latency delta) compared to with the plugin uninstalled.
- A Langfuse outage does not slow down or fail any execution; the queue drops oldest spans on overflow and surfaces the drop count in the status panel.
- Lab scores appear in Langfuse within 10s of `score_result` completing.

### Open questions for Path A

- Should we tag every span with the user's workspace id so a single Langfuse project can serve multi-workspace deployments cleanly?
- Do we expose a "redact prompt content" toggle for users who want trace structure but not message text?
- How do we handle BYOM model identifiers that don't exist in Langfuse's pricing table (use our `cost.rs` pricing as the cost authority and override Langfuse's)?

---

## Decision criteria for after Path A+

After 2–4 weeks of Path A in real use, decide:

| Signal | → Implication |
| --- | --- |
| Users do enable the plugin and click "Open in Langfuse" regularly | Path B is worth the investment — bring the views home |
| Users enable but never click through | Either Path B (bring views into the app) or remove the link — A alone is not enough |
| Users don't enable at all | Don't ship B. Reconsider whether observability is the right concept; maybe Path C (Lab-only) is the actual job |
| Langfuse UI customizes cleanly to our schemas (custom dashboards, metadata, themes) | Path B — embed and theme |
| Langfuse UI hits hard walls; we keep wanting features it can't render | "Master Langfuse" — self-host, deeply theme, treat its data layer as canonical and own the UI ourselves |

---

## Risks

- **Two sources of truth for cost.** Langfuse has its own pricing table; our `cost.rs` has another. Our cost authoritative until we reconcile.
- **PII in prompts.** Persona prompts may include user data, credentials, or internal context. Add a redaction toggle before encouraging adoption.
- **Outage shadow.** If Path B ships and Langfuse is down, an in-app dashboard surface goes stale. Plan for a degraded-mode banner.
- **i18n drift.** Plugin label/desc must land in `src/i18n/locales/en.json`; non-English locales fall back automatically (per CLAUDE.md), but new error strings need the registry bridge.
- **Plugin discoverability.** Users have to find and toggle the plugin. Consider featuring it on the Plugin Browse page hero strip on first launch when execution count > N.

## References

- Langfuse: <https://langfuse.com/docs/get-started>
- Langfuse OTEL: <https://langfuse.com/integrations/native/opentelemetry>
- Self-host config: <https://langfuse.com/self-hosting/configuration/observability>
- Rust crate: <https://crates.io/crates/opentelemetry-langfuse>, <https://docs.rs/opentelemetry-langfuse>
- Internal: `src-tauri/src/engine/runner/mod.rs`, `src-tauri/src/engine/trace.rs`, `src-tauri/src/engine/eval.rs`, `src-tauri/src/commands/execution/lab.rs`, `src/features/plugins/PluginBrowsePage.tsx`, `src/features/overview/sub_observability/components/SystemTraceViewer.tsx`
