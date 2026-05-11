# Athena CLI Session Awareness (Phase 5 v1)

**Status:** Shipped 2026-05-09 across 8 atomic commits (steps 1, 2, 3, 4, 4b, 5, 6, 7). Persona-editor UI shipped 2026-05-11 (`4c08b020`).
**Pairs with:** [`ambient-context-fusion.md`](../../concepts/ambient-context-fusion.md), [`../../architecture/athena-phase1-audit.md`](../../architecture/athena-phase1-audit.md), [`./athena-daemon-bridge.md`](./athena-daemon-bridge.md).
**Source roots:** `src-tauri/src/engine/cli_session_awareness/{discovery,transcript,render}.rs`, `src-tauri/src/engine/cli_session_audit_repo.rs`, runner wiring in `engine/mod.rs::run_execution_with_ceiling` and `daemon/runtime.rs::inject_cli_session_for_daemon`. Editor UI in `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx`.

---

## TL;DR

A persona execution can now be **read-aware** of the user's currently-active interactive Claude CLI session. When the user is mid-conversation in `claude` and a persona fires (trigger, schedule, daemon), the persona can see the recent turns of that interactive session as additional prompt context — gated by both a per-persona toggle and a global toggle, capped at 8 turns × 500 chars, freshness-bounded to 10 min.

**Read-only** by design. The persona's `claude` invocation never `--resume`s the user's session; we read the JSONL transcript, render a markdown prefix, and prepend it. The user's interactive history stays clean.

## What was already built (and what wasn't)

| Already existed | The Phase 5 v1 gap |
|---|---|
| `SessionPool` caches per-persona `session_id`; persona X's next run auto-resumes its prior session. | Persona X has zero awareness of the user's *separate* interactive Claude CLI session. |
| `Continuation::SessionResume(sid)` + `build_resume_args` produce `--resume` CLI flags. | No mechanism to *detect* the user's active session id (the one their CLI is currently writing to). |
| `claude_session_id` is persisted per-execution to the DB. | The on-disk JSONL transcripts at `~/.claude/projects/<encoded-cwd>/*.jsonl` are never read by the engine. |

Phase 5 v1 closed the third gap. The first two are reused — persona session continuity is unchanged.

## Architecture

```
windowed-app process                          daemon process
─────────────────────                         ──────────────
run_execution_with_ceiling                    run_one
  ├ ambient injection (Phase 3 c v2)          ├ ambient injection (Phase 3 c v3)
  └ CLI session injection (Phase 5 v1)        └ CLI session injection (Phase 5 v1)
       ↓                                              ↓
    persona.cli_awareness_enabled (per-persona gate)
       ↓                                              ↓
    fusion.is_source_enabled("cli_session")     app_settings:
    (in-memory global gate)                       cli_session_awareness_enabled (cross-process)
       ↓                                              ↓
    discovery::discover_active_session  ←──── ~/.claude/projects/<cwd>/*.jsonl
    transcript::read_recent_turns(8)           (oldest jsonl whose mtime is within 10 min)
    render::render_cli_session_for_prompt
    ambient_context::prepend_ambient_to_system_prompt   (Phase 3 c v1 helper, reused)
       ↓
    cli_session_audit_repo::insert_audit  ───→  cli_session_read_audit table
                                                       ↓
                                                  "What did Athena see?" modal
                                                  (companion_list_cli_session_reads IPC)
```

## Two privacy gates (both required at runtime)

| Gate | Storage | Default | Set by |
|---|---|---|---|
| **Per-persona** `cli_awareness_enabled` | `personas` table column (BOOL, default 0) | OFF | Persona editor (future UI; column exists from step 4) or template adoption |
| **Global** `cli_session_enabled` | In-memory on `AmbientContextFusion` AND persisted in `app_settings` (key `cli_session_awareness_enabled`) | OFF | SetupPanel desktop-awareness card → "Active Claude CLI session" toggle |

The cross-process persistence is only needed for the global gate — the per-persona gate is on the persona row itself, which both runners read from the same DB. The global gate's persistence is what lets daemon-fired personas honor a user's "OFF" toggle even though the daemon can't see in-memory state.

**Both gates must be true.** The persona's `cli_awareness_enabled=true` alone doesn't fire — the user's master switch must also be ON. A user toggling the global switch OFF stops *all* CLI session reads instantly across both runners.

## Other bounds (defense in depth)

| Bound | Value | Rationale |
|---|---|---|
| Freshness cutoff | 10 min | A daemon at 3am shouldn't pick up yesterday afternoon's debugging. |
| Max turns extracted | 8 (~4 user + 4 assistant on alternating conversations; tail-N is role-agnostic) | Bounds prompt-token cost; recent turns are the load-bearing context. |
| Max chars per turn | 500 (with trailing `…` on truncation) | Caps long pastes (logs, code) so the prefix stays manageable. |
| Total prefix budget | ~4 KB worst case | Stays small relative to the 200K Sonnet 4.6 context window. |
| Skipped block types | `thinking`, `tool_use`, `tool_result` | Internal monologue / tool plumbing isn't "what was said" — keep the prefix focused. |

## Redaction posture

Extracted CLI content is **NOT** run through the Phase 3 v1 redactor (`redact_clipboard_content`).

**Rationale**: explicit consent is the gate. The user opted both toggles ON; the JSONL came from their own interactive session. Redaction would corrupt code/snippets they want the persona to see (tutorial pastes with example tokens, sample API responses, etc.) that are legitimate context.

This differs from ambient signals where capture is passive: a clipboard event that happens to contain a JWT is *captured* without explicit-per-event consent, so redaction at capture is the right gate. CLI session reads are explicit-per-persona and explicit-per-app-globally. The right gate for "this persona shouldn't see X" is the per-persona toggle, not content redaction.

## Transparency: the audit log

Each successful CLI session injection writes one row to `cli_session_read_audit`:

```
id              cliread_<uuid>
persona_id      <fk-to-personas>
persona_name    <snapshot at read time — survives persona rename/delete>
project         <encoded-cwd of the active session>
turn_count      <how many turns were extracted (1..8)>
read_at         <unix epoch seconds>
```

The "What did Athena see?" modal surfaces these rows under a new filter chip. **Append-only** by design — there's no delete counterpart because the read already happened. The right privacy lever is the gate, not retroactive deletion.

TTL eviction: the same `AmbientSignalEvictionSubscription` that drops old `ambient_signal` rows also drops old `cli_session_read_audit` rows. 24h cutoff, 30-min cadence. One subscription, two evictions.

## Failure modes (all non-fatal)

| Stage | Failure | Behavior |
|---|---|---|
| Per-persona gate read | `cli_awareness_enabled=false` | No-op pass-through |
| Global gate read (windowed) | in-memory gate false | No-op pass-through |
| Global gate read (daemon) | `app_settings` row missing or read error | Treated as `false` (privacy-conservative). Logged. |
| `dirs::home_dir()` returns None | platform anomaly | No-op |
| Discovery returns None | `~/.claude/projects/` missing OR all transcripts older than 10 min OR no jsonl files | No-op |
| Transcript read I/O error | file deleted between discovery and read | Returns `Vec::new()` |
| JSONL parse error on a line | format drift | Skip the line; log at debug; continue with remaining lines |
| Renderer returns None | empty turn list | No-op prepend |
| Audit insert error | DB write failure | `tracing::warn!` and continue. The persona's run still happened; only the audit footprint is missed. |

## Trust boundary

Don't confuse **who consented** with **who's reading**:

- **Consent**: the user, via two explicit toggles. Both UI-visible. Both default OFF. Both reversible.
- **Reader**: the persona's underlying `claude` process. Sees the rendered markdown prefix as part of its system prompt. Has no special access — the model can't `--resume` the user's session, can't modify the transcript, can't escalate.

A persona authored by an external party (downloaded from a marketplace) inherits the `cli_awareness_enabled=false` default on import. The user must explicitly flip it ON in the editor. There's no automatic "persona X claimed it needs CLI awareness" mechanism — the toggle is the user's choice.

## Known limitations / future work

1. ~~**No persona-editor UI yet for `cli_awareness_enabled`.**~~ **CLOSED 2026-05-11 (`4c08b020`).** Toggle now lives in the Settings tab (Execution group, hidden in Simple mode), threaded through the canonical `UpdateSettings` → `PartialPersonaUpdate` → `UpdatePersonaInput` save funnel. `PersonaDraft.cliAwarenessEnabled` joins `SETTINGS_KEYS`; the compile-time exhaustiveness check will catch future drift. `data-testid="agent-cli-awareness"` for e2e harness reach. Defaults to OFF — no behavior change for existing personas.
2. **Global gate persistence on startup is async.** The seed-from-app_settings runs in a `tauri::async_runtime::spawn`, so a persona execution that fires within ~50ms of app launch could see the gate at its default false. This is a near-zero-impact issue in practice (executions don't fire immediately at startup).
3. **Active-app cwd binding.** The discovery picks "newest jsonl globally"; a v2 could use Phase 3 c app_focus to prefer the project whose cwd matches the user's foreground claude window.
4. **No per-turn timestamps in the rendered prefix.** Claude Code's transcript format doesn't always include them on user/assistant lines (queue-operation lines do). The prefix omits "Nm ago" qualifiers per turn; the file-mtime-derived "Last activity: Nm ago" header gives session-level recency.
5. **No attachment mode.** v1 is read-only. A future v2 could add an opt-in "actually `--resume` the user's session" mode for personas explicitly designed for that workflow (e.g. a "continue this conversation" assistant). Higher UX entanglement; deliberately deferred.
6. **No companion (Athena) integration.** Athena's chat surface is its own runtime; today's CLI session awareness fires only for non-Athena persona executions. Wiring Athena would be a one-line config change but raises questions about constitution-level consent that v1 doesn't address.

## Test inventory

- `engine::cli_session_awareness::discovery::tests` — 6 (filesystem walk, freshness cutoff, multi-project, multi-jsonl, non-jsonl filter, missing root).
- `engine::cli_session_awareness::transcript::tests` — 10 (string content, array content, thinking/tool filter, queue-op skip, malformed-line tolerance, empty content, chronological tail-N, oversize truncation, max=0, multibyte safety).
- `engine::cli_session_awareness::render::tests` — 4 (None on empty, header + metadata, chronological order, age formatter).
- `engine::cli_session_awareness::integration_tests` — 3 (full pipeline, empty home, stale session).
- `engine::cli_session_audit_repo::tests` — 5 (insert+list, newest-first, max_count, eviction, INSERT OR IGNORE).

**Total: 28 tests** for the Phase 5 v1 surface. Plus all pre-existing ambient tests still pass (53 ambient_context + 8 ambient_signal_repo = 61 unchanged).
