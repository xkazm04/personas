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
5. **Broadcast decisions:** Fleet → Decisions → write your prompt → click "Select waiting (N)" → Send. Each session receives the bytes via its PTY's stdin (or via the hook stdin path for external sessions in a future enhancement).

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
- Per-session output ring-buffer (re-attaching to a session that's been off-screen should replay scrollback).
- Persisted session memory across Personas restarts (currently registry is in-memory only).
