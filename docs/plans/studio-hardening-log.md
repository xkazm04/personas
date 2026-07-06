# Studio hardening log (Track 2 of the ChainSonar dual-dev)

> **Purpose.** While Track 1 drives Athena in **Studio** to build ChainSonar (see
> [`chain-signal-studio-app.md`](./chain-signal-studio-app.md)), this log watches
> the **Studio feature itself** — it's dev-only/experimental and "needs care." The
> method is **empirical**: each build turn is an observation; a gap becomes a fix
> only once a real turn demonstrates it. We do *not* pre-emptively rewrite the
> doctrine on hypotheses.
>
> Feature surfaces: `src/features/studio/**` (frontend runtime), `src/api/webbuild.ts`,
> `src-tauri/src/webbuild/**`, and the build brain in `src-tauri/src/companion/session.rs`
> (`WEB_BUILD_DOCTRINE` = `docs/concepts/web-build-best-practices.md` via `include_str!`,
> `BUILD_PLAN_INSTRUCTION`, `AUTO_MAX_TURNS` in `studioStore.ts`).

## How I observe (harness)

- App runs with `npm run tauri:dev:test` → test server on `:17320`.
- `scripts/studio-chain.mjs` drives turn-by-turn; `bridge.studioState()` (added
  to `src/test/automation/bridge.ts`, called via `/bridge-exec`) returns the
  active runtime: untruncated reply, pending question + options + orb selector,
  plan checklist, phase, stream tail, and page-level errors.
- Ground truth of what got built is read from disk under the scaffolded project
  dir (`app/**/page.tsx`, newest mtime).

## Gap hypotheses — WATCH-ITEMS (confirm on a real turn before fixing)

| # | Hypothesis (why it may bite a data/analytics app) | Watch for | Candidate fix (deferred) | Layer |
| --- | --- | --- | --- | --- |
| H1 | **Doctrine is design-site-weighted** — Spine is Vision→Brand→Design→Foundation; only worked tail is a portfolio. Athena may over-invest in hero/brand, under-build the data pipeline. | Plan phases skew to hero/brand/sections; data model + RPC pipeline arrive late or thin. | Add an "analytics / data-tool" tail playbook to `web-build-best-practices.md`. | backend (rebuild) |
| H2 | **Dependency timidity** — build Rules say "never install *unrelated* dependencies"; Athena may refuse `bun add viem` / a chart lib. | Athena declines to install viem/charts, or hand-rolls RPC instead. | Soften the rule to "install deps your plan needs; avoid unrelated bloat." | backend (rebuild) |
| H3 | **No secrets/RPC/CORS story** — doctrine says nothing about env vars, keys, or server route handlers as proxies. | Browser-side RPC calls; CORS/rate-limit failures in the preview; key hardcoded. | Add an env + server-route-proxy pattern to the doctrine / instruction. | backend (rebuild) |
| H4 | **Autonomous caps at 12 turns** (`AUTO_MAX_TURNS`) — a full data app is bigger than a landing page. | Autonomous stops mid-build with phases still pending. | Raise/soften cap for app-type builds, or re-arm cleanly. | frontend (HMR) |
| H5 | **Preview is a black-box iframe** — `StudioPage` shows the rendered page but not the iframe's console errors / failed network calls, where chain bugs live. | Silent RPC failures; blank preview with no surfaced error. | Surface iframe console/network errors into the Studio panel. | frontend (HMR) |
| H6 | **Decision orb-pointer is DOM-element-centric** — great for "which hero variant," low-value for "which chain / thresholds." | `selector`/`area` decisions that don't map to a visual element. | Allow non-visual decisions to skip the orb gracefully (already degrades). | frontend (HMR) |
| H7 | **Reply summary truncation** (`query` caps innerText at 300) — mitigated by `studioState()` reading the store directly. | — (resolved by observer) | n/a | — |

## Track-2 backlog (fixes land only after a confirming observation)

- [x] **Observability: `studioState()` bridge method** — clean per-turn read of the
  Studio runtime over `/bridge-exec` (frontend, HMR, no rebuild). *(landed with setup)*
- [x] **Build-turn CLI error observability (Rust)** — `run_cli` now `tracing::warn!`s the
  RAW (un-redacted) CLI stderr + cwd + is_build on any non-zero exit
  (`session.rs`, target `webbuild_cli`). Before this, `sanitize_error_message`
  redacted the failing path to `<path>` in the only surfaced copy, making
  build-turn spawn failures undebuggable. *(landed; needs `cargo clippy` before commit.)*
- [~] **Build-turn spawn failure — first-run transient, NOT reproduced.** The seed
  turn on the pre-rebuild instance died with a redacted cmd.exe `'"<path>"' is not
  recognized` (empty stdout → claude died at startup). ~10 raw-claude repros
  (every flag/env/tool/shell combo) all PASSED; after the app restarted (Rust
  rebuild) + `node_modules` fully populated, trivial AND tool-heavy build turns
  (viem install + RPC route + tsc + BUILD_PLAN) succeed. Leading theory: a
  fresh-scaffold race / first-run-under-high-load condition (resource governor
  was PAUSED at 91% CPU during scaffold). **Watch for recurrence** — the raw
  logging above will now capture the real path if it returns.
- [ ] **H8 — Bun preflight (CONFIRMED, 2026-07-05).** Studio hard-depends on Bun for
  scaffold + dev server, but there's no in-app preflight; the only failure signal is a
  toast ("Bun runtime not found. Install Bun or set PERSONAS_BUN_BIN"). Worse, in the
  **lite/test build** `path_lookup()` is gated behind the `desktop` feature (`bun.rs`),
  so even a PATH-installed Bun isn't found without `desktop` or `PERSONAS_BUN_BIN`.
  *Fix candidates:* a preflight Bun check on the Studio entry with a clear install CTA;
  document the `PERSONAS_BUN_BIN`/feature interaction. *(unblocked live by installing Bun
  1.3.14 via winget + pinning `PERSONAS_BUN_BIN`.)*
- [ ] **H9 — scaffold error invisible to the harness (CONFIRMED, 2026-07-05).**
  `createWithVision`'s scaffold rejection is swallowed: the driver kicks it via a
  fire-and-forget `/eval`, and `studioStore.createWithVision` `toastCatch`es the error
  without storing it anywhere `studioState()` can read — so the observer just saw
  `active: null` with no error. Could not distinguish "scaffolding slowly" from "scaffold
  failed." *Fix candidate:* track `lastError`/`createError` on the runtime (or a Studio
  store field) so `studioState()` surfaces it. Low-risk, frontend/HMR.
- [ ] **H10 — frontend tab lost during a long turn (CONFIRMED, 2026-07-05).** During the
  ~15-min full-vision turn the studio store's active project vanished (webview
  reload — freeze-recovery or a full Vite reload mid-turn). Because `studioStore.patch()`
  early-returns when the runtime is gone, the completed turn's reply/plan/messages were
  **silently dropped** — the store showed the *previous* turn's reply and the checklist
  never advanced, even though the work (page.tsx: full themed ChainSonar UI) landed on
  disk. *Fixes:* (a) persist the active-project id (not just history) so a reload
  re-hydrates the open tab; (b) reconcile a runtime's phase/plan/reply from disk +
  version history on re-open so a turn that completed while the tab was gone isn't lost;
  (c) make the runner resilient to store loss (write turn results to `studioHistory`
  even if the live runtime is gone). Workaround in the loop: monitor build progress from
  disk (files/mtime) + re-open the tab as needed — the build work itself is never lost.
- [ ] **H11 — frontend/backend turn-timeout mismatch (CONFIRMED, 2026-07-06).** The
  `webbuild_session_send` IPC times out at 900s and the UI reports the turn as failed —
  but the **backend CLI is NOT cancelled** and kept editing files for 20+ min afterward
  (`webbuild_session_stop` returned `true` = still running; a file was edited 12s before
  the stop). So a long turn "fails" in the UI while silently running to completion,
  wasting tokens and leaving the frontend unable to know when it's done. *Fixes:* set the
  backend `TURN_TIMEOUT` ≤ the IPC budget and kill the CLI on timeout; OR raise the IPC
  budget + let the frontend reconnect to an in-flight turn (the stream keys already exist);
  OR at minimum surface "still running in the background" instead of a hard error. Relates
  to H10 (both are about turn/state lifecycle across the IPC boundary).
- [ ] H1–H7: promoted from watch-item → backlog item when a real turn confirms it.

## Fixes landed — Studio hardening pass (2026-07-06)

User picked "harden Studio broadly." All three shipped + verified live via the harness.

- **H10 — tab survives a WebView reload (FIXED + VERIFIED).** `studioHistory` now persists
  `openTabIds` + `activeTabId`; `studioStore.rehydrate()` (run from `initStream` on mount)
  re-opens them and `attachOrStart()` **re-attaches to a still-running dev server** (via
  `webbuild_status`, no restart) or cold-starts it if the whole app restarted. Verified
  both ways: (a) `location.reload()` → tab back on the SAME port `:50945`; (b) full Rust
  rebuild-restart → tab cold-started `:62344`. Files: `studioHistory.ts`, `studioStore.ts`
  (persistTabs/attachOrStart/rehydrate), `StudioPage.tsx`.
- **H9 — scaffold failure is no longer silent (FIXED).** `studioStore.lastCreateError`
  is set on a scaffold reject (readable via `studioState()`), and `StudioVisionStart`
  renders it in a destructive banner. Files: `studioStore.ts`, `StudioPage.tsx`,
  `StudioVisionStart.tsx`, `bridge.ts` (observer).
- **H8 — Bun preflight (FIXED + VERIFIED).** New Rust command `webbuild_bun_status`
  (`Option<String>` = resolved bun path or null); `StudioVisionStart` checks it on mount
  and shows an install-guidance warning + disables the build button when Bun is missing.
  Verified: command returns the winget bun.exe path. Files: `commands/infrastructure/webbuild.rs`,
  `lib.rs`, `api/webbuild.ts`, `StudioVisionStart.tsx`, `commandNames.generated.ts`.

- **H11 — turn lifecycle: no zombie, no race (FIXED + VERIFIED).** Three parts:
  (a) per-session `try_lock` mutex in `run_build_turn` — a second turn for the same
  project is **rejected** ("already running") instead of racing (verified live: turn B
  rejected while A ran; after Stop, turn C accepted). (b) `kill_on_drop(true)` on the
  build CLI in `run_cli` — a timed-out/cancelled turn now **kills** claude instead of
  detaching it (the zombie that raced the retry). (c) frontend build IPC timeout raised
  `900s → 1_560_000ms (26 min)` to exceed the backend `TURN_TIMEOUT` (25 min), so the UI
  never reports "failed" while the backend is still building. Files:
  `companion/session.rs`, `api/webbuild.ts`, `scripts/studio-chain.mjs` (wait budget).

**Pre-commit gates remaining:** `cargo clippy`/`cargo test` on the Rust changes (deferred —
can't run cleanly while `tauri dev` holds the target lock); Studio strings are hardcoded
English, consistent with the rest of this dev-only surface (not i18n'd).

## Per-turn observation table

Filled as the loop runs. `Studio issue?` names the surface + hypothesis id.

| Turn | Instruction / decision answered | Athena reply (gist) | Phases | Files touched | Studio issue? |
| --- | --- | --- | --- | --- | --- |
| _(setup)_ | scaffold ChainSonar | **FAILED 1st try** — "Bun runtime not found"; installed Bun 1.3.14 (winget, aarch64) + pinned `PERSONAS_BUN_BIN`; relaunched | — | — | **CONFIRMED H8 (no Bun preflight) + H9 (scaffold error invisible to `studioState`)** |
| seed (1st) | full vision (auto-sent) | **FAILED** — redacted cmd.exe `'…' is not recognized`; empty stdout (claude died at startup) | mock | — | build-turn spawn failure → added raw-stderr logging (Rust); NOT reproduced after restart |
| t1 | "reply OK" (post-rebuild) | `OK` | — | — | build turn works after restart |
| t2 | install viem + `app/api/rpc/route.ts` + BUILD_PLAN | viem installed, RPC route (server-side, `ETH_RPC_URL` + public default, 502 error path), tsc clean; plan → Vision·Brand·Design·**Foundation**·Ship | Foundation ▶ | `app/api/rpc/route.ts`, `package.json` | plan is generic doctrine spine — **no analytics tail yet (H1)** |
| _(op)_ | pin RPC via `.env.local` | live route returns `{chainId:1, blockNumber:25468970}` — **RPC pipeline works E2E**. Default `eth.llamarpc.com` was down (CF 521) → pinned `ethereum-rpc.publicnode.com` | — | `.env.local` | reliable public RPC decision (playbook) |
| vision | full ChainSonar vision seed | built full themed **boot UI** (terminal chrome, sonar logo, tagline) + dark token theme; **paused for scope confirmation**; renders clean | (not recorded — see H10) | `app/page.tsx` (+theme) | **CONFIRMED H10 (tab lost mid-turn → result dropped from store; work on disk intact)**; turn ran ~15min |
| t3 | scope confirmed + build token lookup (bounded) | token route + `token-lookup.tsx` + `lib/eth.ts`; USDC metadata correct + honest `unknown` map | Token lookup ✓ | `api/token/**`, `lib/eth.ts` | tab dropped mid-turn (H10, pre-fix) — verified from disk |
| t4 | safety report card | `lib/safety.ts` + route + `safety-card.tsx`; Athena self-verified across USDC/renounced/WETH/EOA/invalid; honest `unknown` (holders, mint/tax); "low risk ≠ safe" | Safety card ✓; plan gained a real **analytics tail** (H1 resolved) | `api/safety/**`, `lib/safety.ts`, `safety-card.tsx` | clean; my QA confirmed fail-path (score 0) + wiring |
| t5 | signal score | `lib/signal.ts` + route + `signal-card.tsx`; Athena found publicnode's **100-block getLogs cap** + rate-limit; hit the **900s IPC timeout** mid-verify | Signal score ▶ | `api/signal/**`, `lib/signal.ts`, `signal-card.tsx` | **CONFIRMED H11 (CLI ran 20+ min past the UI timeout)**; QA found the signal **over-claims** (81/100 from ~99 blocks / 7 swaps — 72/72 chunks skipped) |
| t6 | signal confidence-hardening fix | USDC now **54/100 · low confidence** (was 81 "strong"); window reduced 7200→300 blocks, honest coverage note, capped band, "add Alchemy key" nudge; tsc clean | Signal score ✓ | `lib/signal.ts`, `signal-card.tsx` | **H11 bit hard**: the first attempt's "failed" turn kept running (H11) and **collided** with the retry — two CLIs editing the same files. No corruption (tsc-clean) but a real hazard. |
