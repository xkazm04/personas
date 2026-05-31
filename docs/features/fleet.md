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
| Plugin UI | `src/features/plugins/fleet/` (internal tabs: `sub_grid` = Sessions, `sub_activity` = Activity feed, `sub_settings`) |
| Skill library drawer | `src/features/plugins/fleet/SkillLibraryDrawer.tsx` (left slide-in; browse shared library + click-to-apply to the focused terminal + per-skill install; reuses `sub_skills/useSkillData` + `SkillInstallModal`) |
| Session insights | `src/features/plugins/fleet/sub_grid/FleetSessionInsights.tsx` (transcript rollup; shown via the right-column Terminal/Insights toggle and per-tile in the grid overlay) |
| Context-size pill | `src/features/plugins/fleet/sub_grid/FleetContextPill.tsx` (CLI-header efficiency indicator — `last_context_tokens` from the transcript, colored green→amber→red as the conversation grows) |
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
| Transcript reader (P0) | `src-tauri/src/commands/fleet/transcript_read.rs` (`fleet_read_transcript` — parses `<sessionId>.jsonl` content into `FleetTranscriptSummary`: tokens, tools, files touched, message counts, timestamps) |
| Events | `FLEET_SESSION_OUTPUT`, `FLEET_SESSION_STATE`, `FLEET_SESSION_EXITED`, `FLEET_REGISTRY_CHANGED` (in `event_registry.rs`) |

## Usage

1. **Open in DEV:** `npm run tauri:dev:lite`. Plugins → Fleet appears in the sidebar with a DEV badge.
2. **Install hooks:** Fleet → Settings → "Install hooks". Patches `~/.claude/settings.json` to POST every lifecycle event to `http://127.0.0.1:<port>/fleet/hooks/*`. Re-install whenever the local_http port changes (Personas detects mismatch on startup and prompts).
3. **Spawn a session:** Fleet → Sessions → "Spawn session" → enter a project directory → click Spawn. `claude` boots inside the Fleet-owned PTY.
4. **Run external sessions:** Run `claude` from any terminal once hooks are installed — it'll register in the grid via hooks alone (no PTY ownership on those rows, but state badges still work).
5. **Broadcast a prompt:** Fleet → Sessions → "Broadcast" → write your prompt → click "Waiting (N)" / "All" to pick targets → Send. Each session receives the bytes via its PTY's stdin (or via the hook stdin path for external sessions in a future enhancement).
6. **Apply a skill to the focused session (skill drawer):** Click **Skills** — above the terminal in the single-pane view, or in the fullscreen grid header. A library drawer slides in from the left over the sidebar region. It lists the **shared library** (`~/.claude/skills`, with a This-project / Global-library toggle), searchable. Click any skill to write its slash command (`/skill-name⏎`) into the **focused** session's terminal, exactly as if you'd typed it. The drawer header shows which session it'll apply to; pick a session first (click its row/tile) if none is focused. The skill must exist in that session's project — install it there first (next).
7. **Install a skill into a repo:** In the skill drawer, hover a skill and click its **Install to repo** (download) icon → pick a target project → Install. Fleet copies the skill's `SKILL.md` + reference files into that project's `.claude/skills/<name>/`. Enable **Overwrite** to replace an existing copy. This is what makes cross-repo apply (step 6) actually work — install once, then apply.
8. **Inspect a session's transcript:** In the single-pane view, flip the right-column toggle to **Insights**; in the fullscreen grid, each tile has its own **Terminal/Insights** toggle in its header. Fleet reads that session's `~/.claude/projects/**/<id>.jsonl` and shows a glanceable rollup — token totals (input/output/cache), turns + prompts, tools used (with counts), and files touched. Works for exited sessions too, so it doubles as a "what did this run do" review. Refresh to re-read a live session. The right-column header also carries a **context-size pill** (`ctx`) — the size of the context the focused session re-sends each turn (`last_context_tokens`), colored green→amber→red as it grows — a glanceable efficiency signal.
9. **Search across sessions (Activity tab):** The **Activity** tab lists the most recently-active Claude Code sessions across *all* projects (transcripts modified in the last 7 days, newest first), each with its token/turn/tool/files rollup. Type in the search box to filter across project name, files touched, tool names, and models — e.g. "which sessions touched `auth.rs`?" surfaces every matching run with the matching files shown.
10. **Hibernate & wake a session (F3):** Select a session → **Hibernate** (moon, in the CLI header). The `claude` process is killed to free it; the row stays as `Hibernated` (indigo) so it stays resumable. To bring it back, select the hibernated row and click **Wake** — Fleet runs `claude --resume <id>` in the original cwd and the resumed process restores the conversation. Hibernate needs a bound `claude_session_id` (it's how we resume), so a session must have started before it can sleep.
11. **Auto-hibernate idle sessions (F3/P3.2):** Fleet → Settings → **Auto-hibernate idle sessions** → enable + set the idle threshold (minutes). The always-on staleness ticker then hibernates any Idle/Stale session inactive past the threshold — freeing the process even when Fleet isn't focused (it stays resumable via Wake). `AwaitingInput` sessions are never auto-slept (you may be mid-response).
12. **Find & kill orphaned processes:** Fleet → Settings → **Running Claude processes**. Fleet's session registry is in-memory, so an app restart loses the session list while the underlying `claude` processes can keep running — orphans otherwise reachable only via Task Manager. The panel scans the OS process table (`fleet_detect_processes`), lists every Claude CLI process with its PID / memory / cwd, marks which are still Fleet-tracked vs. orphaned (orphans sort first), and **Kill** ends one by PID (`fleet_kill_pid`, confirm-gated — targeted, never a blanket kill). It scans on open and on **Scan**.

## State machine

| State | How we enter it | Visual |
|---|---|---|
| `Spawning` | PTY just opened, no SessionStart hook yet | spinner |
| `Running` | SessionStart / PreToolUse / UserPromptSubmit hook fired | blue spinner |
| `AwaitingInput` | Notification hook fired (CC is blocked, waiting for the user) | pulsing amber |
| `Idle` | Stop hook fired (turn ended cleanly) | emerald check |
| `Stale` | No activity for 5 minutes (ticker) | orange clock |
| `Hibernated` | Operator clicked **Hibernate** (`fleet_hibernate_session`) — the `claude` process was killed to free it, but `claude_session_id` + `cwd` are kept so it can be resumed. NOT terminal. | indigo moon |
| `Exited` | PTY child reaped OR SessionEnd hook | grey ban |

Priority of signals: **process exit > hooks > JSONL mtime > inactivity ticker**. An Exited session never gets re-animated; a Stale session bounces back to Idle on any transcript append.

**Growth-hardened staleness (`stale.rs`).** Hooks fire at discrete points, so a session's state could drift — a hung session stuck `Running` ("in progress" when it's not), or a working session marked `Stale` mid-long-operation. The ticker now polls each session's transcript **size** every tick and uses *real log growth* (not hook timing or mtime touches) as the authoritative activity signal: a session whose log **grew** is bounced `Stale`/`Idle` → `Running` (and its activity refreshed); a `Running`/`Idle`/`Spawning` session whose log has been **flat past the cutoff** is marked `Stale`. `AwaitingInput` is never staled by flat logs (it's correctly waiting on the user). The decision is a pure `staleness_transition()` fn with unit tests. `Hibernated` is operator-driven (not a signal-derived state): the reaper records the hibernation-triggered child exit as `Hibernated`, not `Exited`, and the staleness ticker leaves it alone. **Wake** (`fleet_wake_session`) spawns a fresh PTY running `claude --resume <claude_session_id>` in the original cwd and drops the placeholder — the resumed process restores the conversation itself.

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
- **What it needs (F4/P4.1)** — the Claude `Notification` hook carries a message ("Claude needs your permission to use Bash"). Fleet captures it into `state_reason` (`hooks.rs`), shows it on the awaiting chip (so you see *what* each session wants without opening the terminal), and includes it in the desktop alert body.
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
- **Fullscreen grid overlay.** A **Grid** button in the action row (left of Spawn, disabled when no live sessions) maximizes a fullscreen, app-wide terminal grid (`FleetTerminalOverlay`, portaled to `document.body` so it sits above the framer-motion transform ancestors). It starts at `top-12` (below the 48px titlebar) rather than `inset-0` so the always-on-top titlebar — its window controls **and the global Back button** — stay visible and usable above it. The grid is **density-adaptive** — columns = `min(4, ceil(√N))`, i.e. 1×1 → 2×2 → 3×3 → 4×4 as sessions spawn (rows auto-fill and scroll past 16). While the overlay is open the single pane is unmounted so the two don't contend for the same managed terminal's holder; every tile attaches a durable terminal, so maximizing/minimizing is lossless. Terminals for removed sessions are reaped via `gcTerminals` keyed on the live session list. The overlay is self-sufficient: its header carries **Spawn** (new session in the active project) + **Skills** (drawer), and each tile (`FleetOverlayTile`) has a Terminal/Insights toggle and a **Kill** control — so you can grow and prune the fleet without leaving the grid.
- **Three ways back.** The overlay's own header Back button, **Escape**, and the **titlebar Back button** all minimize to the single pane (showing the last-selected session). The titlebar wiring uses a generic `backInterceptor` on `uiSlice.navigateBack`: a fullscreen surface registers a Back handler on mount (and the titlebar surfaces its Back button while one is set), so Back dismisses the overlay instead of navigating the underlying page out from under it. If every session exits while the grid is open it auto-minimizes.
- **Density-scaled font.** While the grid is open the terminal font is scaled to the grid density via a transient override (`setFleetFontOverride`): 1×1→15px, 2×2→14px, 3×3→13px, 4×4→12px (floored at 12px for legibility). The override never touches the persisted single-view `fleetTerminalFontSize`; it's cleared on minimize.
- **Renderer + addons.** WebGL rendering (`@xterm/addon-webgl`) is loaded **per attach** and disposed on detach, so N background terminals don't each pin a GL context (it falls back to the DOM renderer if WebGL is unavailable). `@xterm/addon-unicode11` fixes emoji/CJK/box-drawing widths; `@xterm/addon-web-links` makes URLs clickable, opened via `openExternalUrl` after `sanitizeExternalUrl`. The panes are otherwise chrome-free — paste is right-click / Ctrl+Shift+V / Cmd+V; font size, copy-on-select and theme live in Fleet Settings (no per-pane buttons).

### Terminal settings

Fleet Settings → **Terminal** (`FleetTerminalSettings`) exposes, all persisted in `fleetSlice` and applied live to every open terminal (no remount):

- **Font size** — zoom 9–22px (`fleetTerminalFontSize`).
- **Copy on select** — mirror a terminal selection to the clipboard on mouse-up (`fleetTerminalCopyOnSelect`, default on). Right-click still pastes; Ctrl+Shift+V / Cmd+V paste too.
- **Color theme** — `Auto` (follows the app's `data-theme` light/dark), `Dark`, or `Light` (`fleetTerminalTheme`).

> Pre-bundling note: `@xterm/*` is listed in `vite.config.ts` → `optimizeDeps.include` so Vite optimizes it at server boot. Without that, the first navigation to Fleet (a lazy chunk) triggers an on-the-fly dep re-optimize that 504s the in-flight import.

### Athena copilot on the grid (experimental)

A UI-fusion layer (`fleetAttention.ts`, `FleetTileAthenaBar.tsx`) that surfaces Athena's existing fleet reasoning *on the terminal tiles*, rather than only in the Needs-You banner. Pure frontend over existing backend (`companion_send_message`, the approval pipeline, `fleet_send_input` / `fleet_intervene`).

- **Attention borders.** Tiles (and the single pane) get a pulsing border by state — violet for `awaiting_input`, amber for `stale`, red for a non-zero `exited` — via the `fleet-attn-*` classes in `globals.css`, chosen by `sessionAttention()` / `attentionClass()`. Healthy tiles stay plain.
- **On-tile suggestions.** When a pending companion approval is a `fleet_send_input` / `fleet_intervene` targeting a tile's session (matched by parsing `paramsJson.session_id`), the tile shows Athena's proposed text with **Approve** (→ `companion_approve_action` → writes it into the PTY) / **Dismiss**. The existing approval pipeline is the write gate — nothing auto-types.
- **Ask Athena.** A stale tile with nothing pending shows an "Ask Athena" button that fires a session-scoped turn (`companionSendMessage(craftStalePrompt(session))`) asking her to decide the next step and, if there's a clear winner, propose writing it — which returns as an on-tile suggestion. The tile shows a "thinking" affordance until the turn resolves.

- **Athena visible in the grid.** The fullscreen overlay is `z-[200]`, above the orb's normal `z-50` — so while it's open the orb would be hidden. The overlay sets `fleetGridOpen` (fleet slice) on mount and `AthenaOrbLayer` raises itself to `z-[210]` while that's true, so Athena's orb (her thinking/speaking state + decision bubbles) floats above the grid and you can see + react to her there. Ask-Athena → propose → approve-on-tile → `write_input` is wired end-to-end (verified at `approvals.rs::execute_fleet_send_input`).

**Auto-apply under autonomous mode.** By default Athena's `fleet_send_input` stays approval-gated (a tile click). When **autonomous mode** is on, `fleet_send_input` is on the `auto_resolve_if_allowed` allowlist (`approvals.rs`), so the autonomous chain (`session.rs`) auto-approves + executes it — Ask Athena → she types into the session, no click. This is a deliberate higher-blast-radius exception (gated on the toggle); it matters that Fleet spawns run with `--dangerously-skip-permissions`, so an auto-applied write executes its tools unprompted. The on-tile suggestion strip shows on the grid tiles; the single pane relies on the Needs-You banner.

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
- Persisted session memory across Personas restarts (currently registry is in-memory only). *Partial mitigation shipped:* the **Running Claude processes** panel (Usage step 12) detects + kills orphaned `claude` processes a restart leaves behind. Re-adopting a still-running orphan (re-attaching a PTY) is not possible; the next step is resuming its conversation via `claude --resume` from the detected cwd. Full registry persistence (sessions survive restart) remains open.

### "Beyond the terminal" program (in progress)

A five-capability arc that exploits Fleet's unique leverage over a bare terminal (PTY ownership, the hook state machine, transcript access, the per-session MCP channel):

- **Skill library (F1). *DONE.*** Apply a skill to live sessions (P1.1) + global library & cross-repo install (P1.2), surfaced as a **left skill-library drawer** (`SkillLibraryDrawer`) opened from a **Skills** button above the CLI and in the grid header — replacing the old "Show skills" tab. Click a skill → loads `/skill ` into an editable composer (add args) → applies to the focused terminal; per-skill **Install to repo**. Backend: `skill_files_list_global`, `skill_files_install` (its description extractor is frontmatter-aware so skills show their `description:` not `---`). The Idea Scanner's 21 scan lenses are also promotable to global `scan-<lens>` skills via `scripts/skills/scan-agents-to-skills.mjs` (writes interactive SKILL.md files to `~/.claude/skills/`; the scanner itself is unchanged).
- **Transcript intelligence (F2). *DONE.*** P0 ingestion core (`transcript_read.rs` + `fleet_read_transcript`) parses the JSONL — previously only its mtime was read — into `FleetTranscriptSummary` (tokens, per-tool counts, files touched, message counts, timestamps). P2.1: the Sessions grid's right column has a **Terminal / Insights** toggle (`FleetSessionInsights`) rendering that rollup for the selected session, exited ones included (Usage step 8). P2.2: an **Activity** tab (`fleet_recent_transcripts` + `FleetActivityPage`) — a cross-session feed of recently-active sessions, searchable across project / files / tools / models ("which sessions touched auth.rs?", Usage step 9).
- **Session hibernation (F3). *DONE.*** P3.1 — manual sleep/wake: `Hibernated` state + `fleet_hibernate_session` / `fleet_wake_session`; Hibernate frees the process, Wake respawns `claude --resume` (Usage step 10, State machine). P3.2 — auto-hibernate policy: the always-on staleness ticker (`stale.rs`) hibernates Idle/Stale sessions past a threshold (`fleet_set_auto_hibernate` config from a Fleet → Settings toggle), so resources are reclaimed even when Fleet isn't focused. (Literal ANSI scrollback rehydration was dropped — `claude --resume` restores the conversation itself. Caveat: the persisted setting is pushed to the Rust ticker on Fleet refresh; a pure-startup push is a tracked follow-up.)
- **Remote attention (F4).** *P4.1 (desktop): **done*** — the `Notification` message (what Claude needs) is captured into `state_reason`, surfaced on the awaiting chip + in the desktop alert; reply/approve already works inline via the "Needs you" banner (`writeInput`). P4.2 *(architect-scale, deferred)* — a paired mobile client that mirrors the "Needs you" surface remotely, finishing the inert `FleetPairDevice` handshake.
- **Fleet recipes (F5).** User-authored multi-session workflows: fan a task out across N repos, or sequence sessions where one's `Stop` hook seeds the next.
