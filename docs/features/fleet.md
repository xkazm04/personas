# Fleet — Claude Code session aggregator

> **Status:** Experimental. DEV builds only. Not yet shipped in any tier.

## What it is

Fleet is a Personas plugin that observes and controls multiple Claude Code (CC) CLI sessions from one Tauri window. It:

- Spawns `claude` in a PTY so we own stdin/stdout (xterm.js renders the live terminal).
- Receives Claude Code's lifecycle **hooks** (`SessionStart`, `Notification`, `Stop`, `PreToolUse`, `SessionEnd`, `UserPromptSubmit`) via an in-app HTTP receiver, turning them into a state machine: *Spawning → Running → AwaitingInput → Idle → Stale → Exited*.
- Watches `~/.claude/projects/*.jsonl` so transcripts produced by *external* `claude` runs (not spawned from Fleet) also flow through the state machine.
- Groups every tracked session by project (cwd-derived label) in a single grid UI, with status badges that update in real time.
- Lets the user **broadcast** a prompt to any subset of sessions at once — selecting "every session currently awaiting input" is the canonical workflow.

The plugin only shows up in `import.meta.env.DEV` builds. The Rust module always compiles so ts-rs bindings and command-name codegen stay stable across build profiles.

## Where it lives

| Layer | Path |
|---|---|
| Plugin UI | `src/features/plugins/fleet/` (3 sub-tabs: `sub_grid`, `sub_decisions`, `sub_settings`) |
| Terminal manager | `src/features/plugins/fleet/fleetTerminalManager.ts` (long-lived xterm-per-session + addons; see [Terminal](#terminal-experience)) |
| Terminal settings bridge | `src/features/plugins/fleet/useFleetTerminalConfig.ts` (pushes font/copy/theme into the manager) |
| Frontend state | `src/stores/slices/system/fleetSlice.ts` |
| Frontend API | `src/api/fleet/fleet.ts` |
| Tauri commands | `src-tauri/src/commands/fleet/commands.rs` (`fleet_spawn_session`, `fleet_write_input`, `fleet_resize_session`, `fleet_kill_session`, `fleet_list_sessions`, `fleet_remove_session`, `fleet_install_hooks`, `fleet_uninstall_hooks`, `fleet_check_hooks`) |
| PTY backend | `src-tauri/src/commands/fleet/pty.rs` (uses `portable-pty`) |
| Registry | `src-tauri/src/commands/fleet/registry.rs` (global `OnceLock<FleetRegistry>`) |
| Hook receiver | `src-tauri/src/commands/fleet/hooks.rs` (mounted under `/fleet/hooks/*` via `local_http::register_router`) |
| Hook installer | `src-tauri/src/commands/fleet/hook_install.rs` (patches `~/.claude/settings.json`, `_fleet: true` marker preserves user hooks) |
| Staleness ticker | `src-tauri/src/commands/fleet/stale.rs` (30s interval; 5min cutoff) |
| JSONL watcher | `src-tauri/src/commands/fleet/transcript.rs` (`notify` recursive watcher, desktop-only) |
| Events | `FLEET_SESSION_OUTPUT`, `FLEET_SESSION_STATE`, `FLEET_SESSION_EXITED`, `FLEET_REGISTRY_CHANGED` (in `event_registry.rs`) |

## Usage

1. **Open in DEV:** `npm run tauri:dev:lite`. Plugins → Fleet appears in the sidebar with a DEV badge.
2. **Install hooks:** Fleet → Settings → "Install hooks". Patches `~/.claude/settings.json` to POST every lifecycle event to `http://127.0.0.1:<port>/fleet/hooks/*`. Re-install whenever the local_http port changes (Personas detects mismatch on startup and prompts).
3. **Spawn a session:** Fleet → Sessions → "Spawn session" → enter a project directory → click Spawn. `claude` boots inside the Fleet-owned PTY.
4. **Run external sessions:** Run `claude` from any terminal once hooks are installed — it'll register in the grid via hooks alone (no PTY ownership on those rows, but state badges still work).
5. **Broadcast a prompt:** Fleet → Sessions → "Broadcast" → write your prompt → click "Waiting (N)" / "All" to pick targets → Send. Each session receives the bytes via its PTY's stdin (or via the hook stdin path for external sessions in a future enhancement).
6. **Apply a skill to a session:** Fleet → "Show skills" → select a skill → "Apply to session". This opens the same target picker as Broadcast, pre-seeded with the skill's slash command (`/skill-name `). Pick one or more live sessions and Send — Fleet writes the command to each session's terminal exactly as if you'd typed it. Add arguments inline before sending. The skill must exist in the target session's project (install it there first — step 7).
7. **Browse the global library + install into a repo:** In "Show skills", flip the source toggle to **Global library** to browse `~/.claude/skills` (user-level skills available everywhere) instead of the active project's. Select a skill → **Install to repo** → pick a target project → Install. Fleet copies the skill's `SKILL.md` + reference files into that project's `.claude/skills/<name>/`. Enable **Overwrite** to replace an existing copy (otherwise an existing skill is left untouched and you're told it already exists). This is what makes cross-repo "apply" (step 6) actually work — install once, then apply.

## State machine

| State | How we enter it | Visual |
|---|---|---|
| `Spawning` | PTY just opened, no SessionStart hook yet | spinner |
| `Running` | SessionStart / PreToolUse / UserPromptSubmit hook fired | blue spinner |
| `AwaitingInput` | Notification hook fired (CC is blocked, waiting for the user) | pulsing amber |
| `Idle` | Stop hook fired (turn ended cleanly) | emerald check |
| `Stale` | No activity for 5 minutes (ticker) | orange clock |
| `Exited` | PTY child reaped OR SessionEnd hook | grey ban |

Priority of signals: **process exit > hooks > JSONL mtime > inactivity ticker**. An Exited session never gets re-animated; a Stale session bounces back to Idle on any transcript append.

## Session overview surfaces

Above the session grid, the Sessions tab carries a set of glanceable read affordances — the desktop groundwork for a future paired mobile companion that surfaces fleet status remotely:

- **Summary pills** (`FleetSummaryPills`) — one colored count pill per active lifecycle state, reusing the per-session dot palette. Each pill is a filter toggle that narrows the grid to that state; clicking the active pill clears the filter.
- **"Needs you" banner** (`FleetNeedsYouBanner`) — a pulsing violet strip that appears whenever one or more sessions are `awaiting_input`, listing each as a click-to-focus chip. The at-a-glance "something needs a human" signal.
- **Status legend** (`FleetStatusLegend`) — a hover/focus disclosure in the header decoding the two-axis dots (process: spawning/alive/exited · activity: working/awaiting/idle/stale). Reuses the exact `CONSOLE_DOT` / `BUSINESS_DOT` maps exported from `FleetStatusDots` so palette and labels can't drift.
- **Mobile companion preview** (`FleetMobilePreview`, in Settings) — a read-only render of the glance view (state count chips + the awaiting list) inside a phone frame, fed by live session data. Non-interactive by design: it mirrors what a phone would show, letting the remote surface be validated locally before any mobile client ships.

The "Needs you" banner does more than list — it's the desktop stand-in for the companion's remote-approve surface:

- **Inline quick-reply** — each awaiting chip carries a reply affordance that opens an inline input writing straight to that session's PTY (`writeInput`, trailing `\r`), so you can unblock a session without opening its terminal. The chip name still jumps to the terminal.
- **Relative "Xs ago"** — chips (and the mobile preview rows) show how long a session has been blocked, from `lastActivityMs`, refreshed every 30s via a shared `useNowTick` hook (`relativeAgo.ts`).
- **Desktop alert on awaiting_input** (`notifyFleetAwaiting`) — entering `awaiting_input` raises an OS notification once per entry; a bell toggle in the Sessions header (persisted as `fleetNotifyAwaiting`) mutes it. This is the desktop form of the companion's "push when something needs a human".
- **Companion approvals** — pending companion (Athena) approvals are folded into the same banner with inline Approve/Reject (wired to `companion_approve_action` / `companion_reject_action`), unifying "a session needs input" and "an action needs sign-off".
- **Jump-to-next cycler + "All clear"** — when more than one session is awaiting, a skip-forward control cycles terminal focus through them; when sessions exist but nothing's pending, a small emerald "All clear" chip shows instead of the surface vanishing.
- **Per-session sparkline** (`FleetStateSparkline`) — each session card carries a tiny inline timeline of recent lifecycle transitions (colored ticks, oldest→newest), backed by the in-memory `fleetTransitions` ring-buffer in `fleetSlice` (cap 24/session). Spot a flapping or long-stuck session at a glance.
- **Plugin-rail badges** — the "needs you" counts also surface on the L2 plugin list: a pulsing violet badge on the Dev Tools row (awaiting sessions) and an amber badge on the Companion row (pending approvals), so you see them without opening either plugin (`PluginsSidebarNav`).
- **Session filter** — once more than one session is tracked, a search field above the list narrows the grouped grid by project label or custom name (composes with the state-pill filter); the focused session is persisted across reloads (`fleetActiveSessionId`). The sparkline ticks carry "&lt;state&gt; · &lt;Xs ago&gt;" tooltips on hover.

### Pair a device (stage 1)

Fleet Settings also carries `FleetPairDevice` — a **stage-1 scaffold** for pairing a phone. It mints an ephemeral local pairing code, shows the endpoint a phone would dial, and renders a QR placeholder with explainer copy (credentials never leave the desktop). It's UI only: no new dependency, no backend call. The secure handshake (relay/P2P), live QR encoding, and the mobile client are architect-scale and tracked for a later stage.

All of the above are fully internationalized under `plugins.fleet` (state labels, dot tooltips, banner/pill/legend/preview/reply/alert/pairing strings).

## Terminal experience

The session terminals are rendered with **xterm.js**, but the xterm instances are no longer owned by the React pane. They live in a singleton **terminal manager** (`fleetTerminalManager.ts`, parked on `globalThis` so HMR doesn't reset them), keyed by session id. `FleetTerminalPane` is a thin **mount point** that *attaches* a session's terminal into its container on mount and *detaches* (never disposes) on unmount.

Consequences:

- **Lossless, instant session switching.** A terminal keeps its `fleet-session-output` subscription and full scrollback while parked off-screen, so switching the active session — or leaving and returning to the Fleet page — replays nothing and loses nothing. (This retires the old "re-attaching should replay scrollback" roadmap item; output never goes away in the first place.)
- **Fullscreen grid overlay.** A **Grid** button in the action row (left of Spawn, disabled when no live sessions) maximizes a fullscreen, app-wide terminal grid (`FleetTerminalOverlay`, portaled to `document.body` so it sits above the framer-motion transform ancestors). It starts at `top-12` (below the 48px titlebar) rather than `inset-0` so the always-on-top titlebar — its window controls **and the global Back button** — stay visible and usable above it. The grid is **density-adaptive** — columns = `min(4, ceil(√N))`, i.e. 1×1 → 2×2 → 3×3 → 4×4 as sessions spawn (rows auto-fill and scroll past 16). While the overlay is open the single pane is unmounted so the two don't contend for the same managed terminal's holder; every tile attaches a durable terminal, so maximizing/minimizing is lossless. Terminals for removed sessions are reaped via `gcTerminals` keyed on the live session list.
- **Three ways back.** The overlay's own header Back button, **Escape**, and the **titlebar Back button** all minimize to the single pane (showing the last-selected session). The titlebar wiring uses a generic `backInterceptor` on `uiSlice.navigateBack`: a fullscreen surface registers a Back handler on mount (and the titlebar surfaces its Back button while one is set), so Back dismisses the overlay instead of navigating the underlying page out from under it. If every session exits while the grid is open it auto-minimizes.
- **Density-scaled font.** While the grid is open the terminal font is scaled to the grid density via a transient override (`setFleetFontOverride`): 1×1→15px, 2×2→14px, 3×3→13px, 4×4→12px (floored at 12px for legibility). The override never touches the persisted single-view `fleetTerminalFontSize`; it's cleared on minimize.
- **Renderer + addons.** WebGL rendering (`@xterm/addon-webgl`) is loaded **per attach** and disposed on detach, so N background terminals don't each pin a GL context (it falls back to the DOM renderer if WebGL is unavailable). `@xterm/addon-unicode11` fixes emoji/CJK/box-drawing widths; `@xterm/addon-web-links` makes URLs clickable, opened via `openExternalUrl` after `sanitizeExternalUrl`. The panes are otherwise chrome-free — paste is right-click / Ctrl+Shift+V / Cmd+V; font size, copy-on-select and theme live in Fleet Settings (no per-pane buttons).

### Terminal settings

Fleet Settings → **Terminal** (`FleetTerminalSettings`) exposes, all persisted in `fleetSlice` and applied live to every open terminal (no remount):

- **Font size** — zoom 9–22px (also from the hover `+`/`−` buttons on each pane; `fleetTerminalFontSize`).
- **Copy on select** — mirror a terminal selection to the clipboard on mouse-up (`fleetTerminalCopyOnSelect`, default on). Right-click still pastes; Ctrl+Shift+V / Cmd+V paste too.
- **Color theme** — `Auto` (follows the app's `data-theme` light/dark), `Dark`, or `Light` (`fleetTerminalTheme`).

> Pre-bundling note: `@xterm/*` is listed in `vite.config.ts` → `optimizeDeps.include` so Vite optimizes it at server boot. Without that, the first navigation to Fleet (a lazy chunk) triggers an on-the-fly dep re-optimize that 504s the in-flight import.

## Hook installer details

Each entry is tagged `_fleet: true` so uninstall is surgical:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "_fleet": true,
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -m 2 --connect-timeout 1 -X POST --data-binary @- -H \"Content-Type: application/json\" http://127.0.0.1:17400/fleet/hooks/stop",
            "_fleet": true
          }
        ]
      }
    ]
  }
}
```

`curl` is the universal HTTP client (Windows 10+ ships it). Payload is streamed via stdin (`--data-binary @-`) so we never have to JSON-escape on the command line.

## Sharp edges to know about

- **One PTY session per cwd.** The spawn enforces this to keep hook routing unambiguous (we match hooks by claude_session_id once SessionStart fires, but the bootstrap window uses cwd).
- **Soft kill only (for now).** `fleet_kill_session` drops the writer + master, which makes CC see stdin EOF. Phase 6's cancellation token will land a hard kill path that does `Child::kill()`.
- **Port mismatch detection.** If local_http binds to a different port after a restart (rare — only if 17400-17415 had a new occupant), the installer detects the mismatch and the settings page prompts to re-install.
- **No translation of hook payloads.** We only look at the URL path for the event type and `session_id` / `cwd` for routing — Claude Code's payload shape varies across versions, so we don't depend on field shapes that may change.

## Roadmap (not built yet)

- Hard kill (drop the running task's child handle).
- Send-to-external-session (hook-callback path that lets us queue prompts for sessions whose PTY we don't own).
- ~~Per-session output ring-buffer (re-attaching to a session that's been off-screen should replay scrollback).~~ **Done** — the terminal manager keeps a live xterm (and its scrollback) per session; see [Terminal experience](#terminal-experience).
- Persisted session memory across Personas restarts (currently registry is in-memory only).

### "Beyond the terminal" program (in progress)

A five-capability arc that exploits Fleet's unique leverage over a bare terminal (PTY ownership, the hook state machine, transcript access, the per-session MCP channel):

- **Skill library (F1).** *P1.1 — apply a skill to live sessions: **done** (Usage step 6). P1.2 — global library + cross-repo install: **done** (Usage step 7).* The "Show skills" browser now has a source toggle (This project / Global library = `~/.claude/skills`) and an "Install to repo" action that copies a skill's files into any registered project's `.claude/skills/`, so a skill applied cross-repo actually exists there. Backend: `skill_files_list_global`, `skill_files_install`.
- **Transcript intelligence (F2).** Parse `~/.claude/projects/**/*.jsonl` (today only its mtime is read) into a per-session cost / tokens / tools / files-touched timeline + a cross-session searchable activity feed.
- **Session hibernation (F3).** Auto-checkpoint Idle/Stale sessions, drop the PTY to reclaim the process, and resurrect on demand via `claude --resume <id>` with scrollback rehydrated from the transcript.
- **Remote attention (F4).** Permission-prompt detection + reply/approve from the "Needs you" surface and (later) a paired mobile client — finishing the inert `FleetPairDevice` handshake.
- **Fleet recipes (F5).** User-authored multi-session workflows: fan a task out across N repos, or sequence sessions where one's `Stop` hook seeds the next.
