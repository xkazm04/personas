# Athena dev mode v2 — self-improvement through the fleet, grounded in the context map

**Date:** 2026-07-03. Sibling to [`autonomous-mode-direction.md`](./autonomous-mode-direction.md)
(execution review) and [`fleet-orchestration-direction.md`](./fleet-orchestration-direction.md)
(fleet supervision). This one revisits the parked **self-improve loop**: Athena, in a dev build,
changing the Personas app — including her own code — from natural conversation.

## The goal (user's words, paraphrased)

A dev toggle the user flips on; then, over days of *natural conversation* that mixes normal Athena
requests, talk about Personas features, and "fix/improve this" asks, Athena:
1. knows **which part of the code is responsible** for a discussed feature,
2. **dispatches coding subagents** to improve/fix it during the conversation,
3. reports outcomes back, only involving the user for decisions she's not confident about.

## What the historical feature was — and why it stalled

`src-tauri/src/companion/dev_session.rs` ("Phase 4: self-improve loop") + `commands/companion/feedback.rs`
+ the 🔧 wrench-send button in `Composer.tsx` (all still compiled and wired, gated by
`companion_beta_flags` → `cfg!(debug_assertions)`):

- The wrench pipes the composer text into **one detached, headless `claude -p`** at the repo root
  (`--dangerously-skip-permissions`, subscription auth, 10-min timeout).
- Outcome parsed from stream-json → `[Athena self-improve]` episode with files-modified +
  critical-file flags (`CRITICAL_FILE_NEEDLES`).
- Detached + marker files + `recover_orphan_improvements` because editing `src-tauri/` restarts the
  Tauri dev server and kills the parent — a real constraint they solved with process detachment.

Why it never grew: **(1) zero code context** (generic system prompt; no feature→code map);
**(2) user pre-classification** (you had to decide "this is a dev request" and hit the wrench);
**(3) invisible** (headless, detached, unsteerable, one blind shot); **(4) Athena wasn't in the
loop** — the feature bypassed her reasoning entirely.

## The key insight — the platform has since built everything the old feature lacked

| Need | What exists now |
|---|---|
| Dispatch coding agents | `fleet_dispatch` (`commands/companion/approvals.rs:3543`) — up to **8 role'd CLI sessions** at any registered dev project, `operation_intent` tracked as a `dispatched_by_athena` op in operative memory. Containment: `validate_fleet_cwd` (cwd must be inside a registered Dev Tools project). |
| Watch & steer | The Fleet grid — visible tiles, PTY, state machine, intervention affordances. |
| Keep them moving unattended | The fleet orchestration loop (see fleet-orchestration-direction.md): `orchestrate_on_awaiting` reads the session's **real vt100 screen** and answers at high confidence; `reassess_stale_awaiting` re-checks parked sessions on the proactive tick. Her coding subagents' permission prompts / AskUserQuestions get handled by *her*. |
| Feature→code resolution | `context-map.json` — 49 contexts × 8 groups, each with `filePaths` + a one-line `index`; plus `scripts/docs/feature-doc-map.json` (source globs ↔ feature docs). |
| Product self-knowledge | Doctrine (`companion/brain/doctrine.rs`) — 22 `docs/**` files embedded in her brain incl. `athena-usecases.md`. She can already *talk* about her features. |
| Outcome memory | `companion_turn` ledger, episodes, `fleet_session_metadata` (files touched via transcript rollup), and the `dev_ideas` inbox → Idea Triage → build loop for oversized requests. |

**So: don't rebuild the self-improve feature — give Athena a self-model and let her dispatch her
existing fleet machinery at her own repo.** Mostly prompt + policy + one dispatcher action.

## Design — five phases

### Phase 0 — Enablement: the dev-mode toggle
- Runtime setting `companion_dev_mode` (settings_keys allowlist) + toggle in Companion toolbar/Setup,
  replacing the compile-time-only beta flag. **Double gate:** effective only when
  `cfg!(debug_assertions)` (never release), mirroring `feedback.rs:42`.
- Toggle-on verifies the personas repo is a registered Dev Tools project (required by
  `validate_fleet_cwd`) and auto-registers from `resolve_repo_root()` if missing.

### Phase 1 — Self-knowledge: the dev-mode prompt addendum
When dev mode is on, `prompt.rs` injects (same pattern as the AUTONOMOUS MODE block, `prompt.rs:1111`):
- **Self-model:** "You run from your own source checkout at `<repo_root>`; the Personas app —
  including you — is built from this repo. The user may mix product requests with code-change asks."
- **The context-map index** — 49 one-liners (name · group · description). Cheap tokens; feature →
  code-area resolution without holding code in her head.
- **Judgment rules:** product request → normal ops; app-change request → propose `dev_improve`;
  ambiguous ("make the orb bigger" — setting vs code?) → one clarifying line first.
- Constitution bump (`CONSTITUTION_VERSION`) teaching the op + boundaries.

### Phase 2 — The action: `OP: dev_improve`
- New dispatcher action, **approval-gated** (the user is in the conversation — one click), executor
  gated on dev mode + debug build. Params:
  `{ request, context_slug?, files_hint?, confidence, rationale }`.
- Executor = thin wrapper over `fleet_dispatch`: one role at the repo root; task prompt assembled
  **Rust-side** — user request + Athena's framing + the resolved context's `filePaths` (deterministic
  lookup from `context-map.json` by slug, never model-hallucinated paths) + the old
  `IMPROVE_SYSTEM_PROMPT` discipline + "commit atomically, clear message; never push; never stash."
- Session named "Athena: <short label>" (`ATHENA_SESSION_NAME_SENTINEL`) → visible in Grid +
  LiveOpsStrip. Parallel requests = parallel sessions (fleet_dispatch caps at 8).
- **Division of labor:** Athena triages + phrases + names the context; the coding CLI greps the exact
  lines. She manages; it codes.

### Phase 3 — Loop closure: outcome + verification
Mostly free via fleet hooks + her orchestration loop. Add:
- On dev-op session exit, the reconciler assembles the outcome — files touched
  (`fleet_session_metadata`), commit SHA (`git log -1` in the cwd), critical-file flags (reuse
  `CRITICAL_FILE_NEEDLES`) — surfaced as an episode + orb card.
- **Hot-reload split stated on the card:** `src/**`-only edits → "live via HMR, try it now";
  `src-tauri/**` edits → "needs the dev-server rebuild — expect a restart."

### Phase 4 — The src-tauri paradox (restart resilience)
Her most valuable improvements are Rust (her own brain), and editing Rust **restarts the app and
kills her PTY sessions** — the fleet registry is in-memory, no DB persistence. Two-layer answer:
- **Recommended default: worktree isolation.** Dev sessions touching `src-tauri/**` work in
  `.claude/worktrees/athena-dev-<id>` (repo convention for multi-file work anyway). The running dev
  server never sees the edits → no mid-run restart. The outcome card offers **merge** as the explicit
  "apply & rebuild now" moment. Frontend-only quick fixes run in the main checkout for instant HMR.
- **Backstop: durable dispatch markers.** Persist `(fleet_session_id, claude_session_id, op_intent)`
  to the brain dir (like the old `ImprovementMarker`); on `companion_init`, dead-but-transcribed
  sessions respawn into Fleet with `--resume <id>` + `RESUME_CONTINUATION_PROMPT` (works since the
  nesting-env fix, cd13ecc75).

### Phase 5 — The experiment harness
- Durable `dev_improvement` ledger: request → session → outcome → commit → **user verdict**
  (👍/👎 chip on the outcome card).
- Oversized requests degrade gracefully: she files a `dev_ideas` entry (existing triage→build loop)
  and says so in one line.
- Metrics: % dispatches landing a commit; % needing rescue; time-to-outcome; verdict ratio.
  A periodic self-review of this ledger (the `execution_review` pattern) closes the meta-loop.

## Decisions (user, 2026-07-04)
1. **Wrench button** — retired as a composer send-mode; the wrench is now the **dev-mode toggle**
   in the panel header next to the autonomous Infinity icon, rendered only in debug builds.
2. **Autonomy** — `dev_improve` **never auto-fires** (not on `AUTOAPPROVE_ALLOWLIST`, in any mode).
   Every dev-mode operation gets a **reflection** turn, and every improvement change is
   **approved by the user first** — the dispatch is a click, and a backend run's apply-step
   (`dev_merge`) is a second click.
3. **Checkout policy** — main checkout by default when no Rust change is needed (HMR gratification);
   **worktree whenever Athena identifies backend adjustments**, so she orchestrates the change in
   isolation and the **merge handshake** synchronizes update expectations on both sides.

## Build log
- **2026-07-03** — historical-feature autopsy + this design. (`ec562877f`)
- **2026-07-04 — Phases 0–3 shipped.**
  - **Phase 0** (`d73ef4ee2`): `companion_dev_mode` setting (+`companion_set_dev_mode`,
    `dev_mode_enabled` hard-gated on `cfg!(debug_assertions)`), `companion_beta_flags` →
    `dev_mode_available`, wrench toggle in the CompanionPanel header (`companion-toggle-dev-mode`),
    composer wrench-send retired (+state/API cleanup), setup-panel card repurposed, i18n −8/+7 keys
    ×14 locales.
  - **Phases 1–3** (this commit): `companion/dev_mode.rs` — repo root, context-map index/resolution,
    dev-op registry, worktree+merge git helpers, task-prompt builder (workspace policy encoded);
    DEV MODE prompt addendum (self-model + context index + dev_improve/dev_merge teaching) riding
    the mode-addenda slot in both `build_system_prompt` variants; `dev_improve` + `dev_merge` in
    dispatcher `ALLOWED_ACTIONS` + executors in `approvals.rs` (containment via `validate_fleet_cwd`,
    session named `athena-*-dev`, operative-memory op `dev_improve: <request>`); reflection hook in
    `reconcile_if_dispatched` → `spawn_dev_reflection` (`dev_improve_review` proactive turn with git
    evidence; replaces the generic wrap-up card for dev ops). 5 unit tests in `dev_mode.rs`.
  - **Deliberately deferred:** durable dispatch markers + resume-on-restart (Phase 4 hardening);
    the `dev_improvement` ledger + verdict chips (Phase 5); auto-registering the repo as a Dev
    Tools project on toggle-on (executor errors clearly if unregistered).
