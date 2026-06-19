# Athena Web-Dev Companion — v0 Build Plan

**Status:** designed 2026-06-19 (brainstorm + 4 verification Explore passes). Not yet built.
**Execution model:** one phase per session/PR, each self-contained and shippable, mirroring
the discipline of [`athena-value-expansion.md`](./athena-value-expansion.md). Anchors below were
verified against `master` on 2026-06-19; re-confirm line numbers at execution time (they drift).

Companion feature; engine principle is fixed: **the user's own Claude subscription + the local
Claude Code CLI + Personas**. No API/cloud-credit metering. Doctrine that the build engine reads:
[`docs/concepts/web-build-best-practices.md`](../concepts/web-build-best-practices.md). UX design
+ locked decisions live in the project memory `project_athena_webdev_companion`.

---

## What v0 proves (the tracer bullet)

A non-technical user, inside Personas, watches Athena **scaffold and build the `mk` portfolio**
(blank Next.js/TS/Tailwind test bed at `C:\Users\kazda\kiro\mk`) **live in an embedded preview**,
**led by the orb dock**, in gated mode with a manual auto toggle — entirely on the local
subscription engine. If that thread works end-to-end, the thesis is real; everything else is widening.

### Explicitly OUT of v0 (deferred → v1+)
- Bun auto-install/bundling + the `claude login` onboarding wall (v0 assumes both present).
- Preview-bridge **element-glow / orb pointing excursion** (v0 orb narrates over the preview; no
  per-element glow inside the iframe).
- **Earn-autonomy auto-offer** (v0 = manual gated/auto toggle).
- Full doctrine **embedding pipeline** in `brain/doctrine.rs` (v0 injects the doctrine inline into
  the build session's system context).
- Scaffold-template *menu* (v0 = the one validated Next/TS/Tailwind stack).
- Deploy phase; the **Personas dev-tools integration** (backlog/teams/orchestration) — the big later phase.
- Build-session persistence across app restart (v0 best-effort; `--resume` survives, in-memory UI state may not).

---

## Architecture decisions (the synthesis from the verification passes)

- **AD1 — Build engine = extended companion `run_cli`, not fleet PTY.** Spawn `claude` with
  `--output-format stream-json` at the **project `cwd`**, seeded with the web-build doctrine, with a
  **build-session-specific `--session-id`/`--resume`** distinct from Athena's main chat session. This
  reuses the existing stream-json parse (`session.rs:1318-1357`), the op dispatcher (so `build_plan` +
  TodoWrite parsing work for free), `STREAM_EVENT` streaming (`session.rs:298-317`), and the
  `continue_autonomously` chain (for auto mode). Fleet PTY (`commands/fleet/pty.rs:68-304`) is the
  wrong base here — its output is raw terminal bytes with no server-side op/TodoWrite parsing.
  **Verify at execution:** confirm where `run_cli`'s spawn sets `current_dir` and that it can be
  parameterized per build session (Athena's runs at the repo root today); confirm a *second*,
  independently-resumable companion session can coexist with the main chat session.
- **AD2 — Embedded preview = a plain iframe pointed at the Bun dev-server port.** No `local_http`
  endpoint needed in v0 (the iframe hits e.g. `http://localhost:3000` directly; verified the Next dev
  server sends no `X-Frame-Options`/CSP, so it embeds). The `local_http` `register_router` machinery
  (`local_http/mod.rs:36-49`, mounts at `lib.rs:866-893`) is the home for the v1 preview-bridge, not v0.
- **AD3 — BuildDock is companionStore state, not a new `CompanionState`.** The enum
  (`types.ts:15`) is a stable 4-state machine; don't extend it. Add `buildDockOpen: boolean` +
  `buildPlanSteps` to `companionStore`; the dock is a flyout the orb owns while `state==='minimized'`.
- **AD4 — `build_plan` is an auto-fire dispatcher op** (same class as `compose_cockpit`): ALLOWED list
  + match arm (`dispatcher.rs:150-259`, auto-fire arms `437-490`), a `Dispatched.build_plans` field, a
  `session.rs` emit loop + event const (pattern at `session.rs:837-863`, consts `200-212`), persisted
  per build session (like dashboards/cockpits). Constitution bump from v41 (`templates/mod.rs:319`).
- **AD5 — Bun runtime = new `webbuild` Rust module**; dev-server children tracked in `AppState` and
  **killed on window-close**; project rows reuse the `dev_projects` registry.

### Dependency graph / recommended order
```
P0 (Bun runtime) ─► P1 (embedded pane) ─► P2 (build session engine) ─► P3 (build_plan + checklist) ─► P4 (BuildDock UX)
        └────────────────────────────────► (P1 needs P0 status; P2 needs P0 project dir)
```
Linear. P1 carries the last feasibility check (HMR inside a WebView2 iframe) — do it first inside P1.

---

## Phase P0 — Bun project runtime (Rust)

**Goal:** Personas can scaffold, install, run-dev, build, and report status/port/health for a managed
web project as supervised child processes, and never orphans one.

**Build** — new `src-tauri/src/webbuild/` (`bun.rs`, `devserver.rs`, `project.rs`):
- Resolve Bun (env override → PATH), mirroring the binary-lookup discipline in `companion/stt/whisper.rs:46-55`.
- Project dir under `~/.personas/projects/<slug>/` using the path helper convention in
  `companion/disk.rs:28-54` (`PERSONAS_HOME` override → `dirs::home_dir().join(".personas")`).
- Scaffold via the validated flags (`bunx create-next-app@latest <dir> --ts --tailwind --eslint --app
  --no-src-dir --import-alias "@/*" --use-bun --turbopack`); pin `turbopack.root` in `next.config.ts`
  (the stray-lockfile gotcha we already hit).
- Long-lived dev server: `tokio::process::Command` with piped stdout/stderr (contrast the one-shot
  `whisper.rs` pattern), parse the `Ready`/port line, health-poll the port, graceful shutdown.
  Windows: `DETACHED_PROCESS` / hidden console as `whisper.rs` does.
- Track handles in `AppState` (new field `Arc<tokio::sync::Mutex<HashMap<String, BunServerHandle>>>`,
  following the `Arc<Mutex<Option<Arc<T>>>>` convention at `lib.rs:358-430`); register child PIDs in
  `ActiveProcessRegistry` (`lib.rs:61-338`).
- **App-exit hook** (`on_window_event` / `CloseRequested` in `lib.rs`) kills all live dev servers.
  Orphan-on-startup sweep mirrors the background-job orphan recovery.
- Commands (register in `lib.rs` invoke_handler, regen command-names): `webbuild_scaffold`,
  `webbuild_dev_start`, `webbuild_dev_stop`, `webbuild_status`. Project rows via the `dev_projects`
  repo (`db/repos/dev_tools.rs:238` `create_project`).

**Verify:** scaffold a fresh app → dev_start allocates a port → status returns the URL → preview
reachable via curl → dev_stop kills cleanly → app-exit leaves zero orphan processes (check by port).

**Demo:** dev server comes up and goes down under Personas' control, no orphans.

---

## Phase P1 — Embedded preview pane (FE)

**Goal:** see the running app live inside Personas; **close the last feasibility gap** (HMR inside a
WebView2 iframe).

**Build** — a new **"Studio"** surface:
- Add `"studio"` to `SidebarSection` (`src/lib/types/types.ts:395`) + the sections array
  (`src/features/shared/chrome/sidebar/sidebarData.ts:35-45`, mark `devOnly` for now); lazy-import +
  conditional render in `PersonasPage.tsx:70-200` (with `lazyRetry`, add to the idle-prefetch list).
- `src/features/studio/StudioPage.tsx`: `<iframe src={devUrl}>` + start/stop/reload controls wired to
  the P0 `webbuild_status`, with loading/error states (reuse `feedback/LoadingSpinner`, `EmptyState`).

**Verify:** `mk` renders live in the pane; a manual file edit hot-reloads **inside the iframe** (this
is the deferred last-5% check — WebView2 is Chromium so expected to pass, but confirm here first).

**Demo:** "my app runs inside Personas."

---

## Phase P2 — Build-session engine (Rust)

**Goal:** Athena edits the project from a natural-language instruction; the change shows live. The
thesis loop.

**Build:**
- A **build session** = an extended companion `run_cli` (`session.rs:1137-1472`) spawned with
  `current_dir = <project path>`, `--output-format stream-json`, a dedicated `--session-id`
  (resumed across turns), and the web-build doctrine + brief injected as system context (inline, or a
  generated project `CLAUDE.md`). Distinct from Athena's main chat session.
- A command to send an instruction to the build session and stream results; reuse the existing
  `STREAM_EVENT` channel + the dispatcher so ops/TodoWrite are parsed exactly as in chat.
- Wire the stream to the Studio FE (the existing `companion://stream` listener pattern).

**Verify:** "make the hero text purple" → build session edits `mk/app/page.tsx` → preview HMR shows
purple. **This single test proves the whole thesis loop.** Watch subscription usage across the turn.

**Demo:** the money shot — Athena changes the app, you watch it change live.

---

## Phase P3 — Build plan + checklist (Rust + FE)

**Goal:** the structured plan (Spine + generated tail) exists, follows the doctrine's quality
contract, and tracks progress.

**Build:**
- `build_plan` auto-fire op (AD4): `dispatcher.rs` ALLOWED + match arm validating the phase schema
  from the doctrine (`{id,title,intent,deliverable,golden_output,done_test,status,sub_steps,source,
  confidence}`); `Dispatched.build_plans` field; `session.rs` emit loop + `COMPOSE_BUILD_PLAN_EVENT`
  const; persist per build session (decide: in-memory vs a `build_plan` row like dashboards/cockpits —
  **the riskiest sub-decision; pick DB-persisted to survive panel reloads**). Constitution bump.
- Map the build session's **TodoWrite** stream (`operationalSteps.ts:39-67` `extractTodoWrite`,
  `TodoStep` `17-28`) to live phase status, in addition to the emitted plan.
- FE: `companionStore` gains `buildPlanSteps`; a listener hydrates from `COMPOSE_BUILD_PLAN_EVENT`.

**Verify:** starting a portfolio build yields the Spine + a portfolio tail with real golden outputs;
phases flip pending→in_progress→done as work lands; each generated phase has a done-test.

---

## Phase P4 — BuildDock orb UX (FE)

**Goal:** the orb leads via the flyout dock with gated/auto modes — the differentiator.

**Build** in `src/features/plugins/companion/orb/`:
- `BuildDock` flyout anchored to the orb home (`companionOrbPos`), opening on the side with viewport
  room (reuse the `ComposerPickerShell` portal pattern); driven by `buildDockOpen` (AD3). Header
  (project + phase), **mode toggle**, checklist (reuse `OperationalThread.tsx:29-81` rendering — extract
  a shared `TodoStepsList` if the wrapper differs), narration "now" zone.
- **Gated mode:** per-phase propose→do→review. Surface each gate via the decision machinery
  (`useDecisionQueue.ts:400-456` + `ApprovalCard.tsx:84-210`) as `[Go][Tweak][Skip]` → work →
  `[Accept][Revise][Undo]`. Keep the BuildDock gate stream independent from the orb's general decision
  queue (the verified interdependency caveat).
- **Auto mode:** drive the plan via `continue_autonomously`.
- **Undo:** per-change git checkpoint via Rust `git2` (auto-commit each accepted phase; Undo = revert).
- Defer (v1): orb pointing excursion + element glow; earn-autonomy auto-offer.

**Verify:** a full **gated** mk-portfolio build driven entirely from the dock; flip to **auto**, it
finishes the remaining phases; Undo reverts a step; gates don't collide with the orb decision queue.

**Demo:** the full thesis — orb-led, two modes, zero→portfolio, on the subscription engine.

---

## Risks & front-loaded unknowns

| Risk | Mitigation |
|---|---|
| `run_cli` cwd not parameterizable / can't run a 2nd resumable session | Verify FIRST in P2; if blocked, fall back to fleet PTY + app-layer stream-json extraction (heavier) |
| HMR websocket inside WebView2 iframe | Resolved first thing in P1; Chromium parity makes it low-risk |
| Subscription usage limits become the throughput ceiling | Surface "approaching your Claude limit" in the dock; human-paced gated mode throttles naturally |
| Orphaned dev servers (the node-glut hazard) | P0 app-exit hook + startup orphan sweep, non-negotiable |
| build_plan persistence model | Persist to a DB row per session (like dashboards/cockpits), not in-memory |
| BuildDock gates colliding with the orb decision queue | Two independent decision streams over the same approval machinery; BuildDock gates render in the flyout, no `;` keyboard path |
| Constitution version collision with parallel work | Claim the next free `CONSTITUTION_VERSION` at execution time |

## Phase index

| # | Phase | Size | Depends on | Headline deliverable |
|---|---|---|---|---|
| 1 | P0 | L (Rust) | — | `webbuild` Bun runtime + supervised dev server + exit cleanup |
| 2 | P1 | M (FE) | P0 | Studio surface + embedded iframe preview (HMR check) |
| 3 | P2 | L (Rust) | P0 | Build-session engine (run_cli @ project cwd, structured stream) |
| 4 | P3 | M (Rust+FE) | P2 | `build_plan` op + checklist (Spine + generated tail) |
| 5 | P4 | L (FE) | P3 | BuildDock flyout + gated/auto modes + git-checkpoint Undo |

Every phase is independently shippable; the plan tolerates stopping after any row. Start P0/P1
(least ambiguous; P1 closes the last feasibility gap), then re-confirm P2's anchors before building it.
