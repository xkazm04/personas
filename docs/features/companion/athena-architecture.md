# Athena architecture reference

> **Purpose.** A stack-and-interfaces description of Athena, the AI companion, written so it can be
> read without knowing the Personas app and reused as a reference design for a companion in another
> project. It describes what runs, where state lives, how the model is invoked, how actions are
> gated, and what the process talks to. Product behaviour (what each card does, what each tab shows)
> lives in [`README.md`](./README.md); this document is the layer underneath it.
>
> Verified against the code on 2026-09-06. Paths are relative to the repository root.

## 1. What Athena is, in one paragraph

Athena is a persistent conversational agent embedded in a desktop app. She has a fixed **law**
(a constitution), an evolving **self-model** (an identity file), a **memory** that is markdown on
disk indexed by SQLite, and an **action grammar** she emits as text lines that a dispatcher parses
and gates. She never calls a model API directly: every turn is a spawned Claude Code CLI process
billed to the user's subscription. She can talk (local TTS), listen (local whisper), reach out on
her own (a budgeted proactive pipeline), run unattended overnight (a night shift), and answer
questions from other agents (an MCP server). Everything she does is observable in a per-turn
ledger, and everything she writes to long-term memory carries provenance back to the conversation
that produced it.

## 2. The six design commitments

These are the decisions the rest of the architecture follows from. A port to another project
should keep all six or knowingly drop one.

1. **The model is a subprocess, not an HTTP client.** The Claude Code CLI is spawned per turn with
   the composed prompt on a file and stream-json on stdout. Auth is the CLI's own OAuth keychain;
   `ANTHROPIC_*` variables are stripped so nothing ever bills an API key
   (`src-tauri/src/companion/session/cli.rs`).
2. **Actions are a text grammar, not tool calls.** The model emits `OP: {json}` lines. A catalog of
   allow-listed names is the capability boundary; anything not in it is rejected before it can reach
   a database write (`src-tauri/src/companion/dispatcher/catalog.rs`).
3. **Markdown on disk is the memory's source of truth; SQLite is a rebuildable index.** Every
   long-term memory is a file with frontmatter under `~/.personas/companion-brain/`; the
   `companion_*` tables can be reconciled from the tree (`src-tauri/db/src/lib.rs:934-940`).
4. **Provenance is mandatory.** A fact or procedural with no source episode is rejected at write
   time, and recalled memories are rendered with their citations. Uncited memory is not a legitimate
   shape (`src-tauri/src/companion/brain/semantic.rs:99-105`).
5. **Policy lives in the gate, never in the model.** Fleet spawn directories are checked against
   registered projects by one function; browser tests are pinned to the approved origin by the
   bridge; remote instructions are admitted by device pairing. The model chooses what to propose,
   the gate decides what runs.
6. **Bounded and honest.** Every digest, index and read-op has a size cap and states its own
   truncation ("showing N of M", "3 older turns omitted"). A silently short answer reads downstream
   as an absence of fact.

## 3. System overview

```
┌──────────────────────────── Desktop app (Tauri 2) ─────────────────────────────┐
│                                                                                 │
│  React 19 / Zustand                       Rust backend                          │
│  ┌───────────────────────┐   IPC          ┌──────────────────────────────────┐  │
│  │ footer avatar / orb   │◄──events──────│ companion::session   (turn loop) │  │
│  │ chat panel (always    │──commands────►│ companion::prompt    (composer)  │  │
│  │  mounted shell)       │               │ companion::dispatcher(op grammar)│  │
│  │ chat cards, approvals │               │ companion::brain     (memory)    │  │
│  │ orb decision queue    │               │ companion::proactive (nudges)    │  │
│  │ MCP request panel     │               │ companion::orchestration (MCP)   │  │
│  │ live-ops strip        │               │ companion::night_shift / jobs    │  │
│  └───────────────────────┘               │ companion::tts / stt (sidecars)  │  │
│                                          └───────┬──────────┬───────────────┘  │
│                                                  │          │                   │
│   local HTTP (127.0.0.1:17400+) ◄────────────────┘          │                   │
│     /mcp/rpc  /fleet/hooks/*  /browser-bridge/*             │                   │
└─────────────────────────────────────────────────────────────┼───────────────────┘
                                                              │
        ┌────────────────────────┬──────────────────┬─────────┴──────────┬──────────────────┐
        ▼                        ▼                  ▼                    ▼                  ▼
  claude CLI subprocess   ~/.personas/         personas_data.db    sherpa-onnx-tts     paired devices
  (stream-json, OAuth)    companion-brain/     (companion_* +      whisper-cli         (P2P remote jobs)
                          (markdown truth)     FTS5 + vec0)        (local sidecars)
```

Two other actors talk **to** Athena rather than the reverse: Fleet worker sessions (Claude Code
subprocesses the app spawns for coding work) call her MCP server, and the `/athena` Claude Code
skill reads and writes the same brain from a terminal when the app is closed.

## 4. Stack

| Layer | Technology | Where |
|---|---|---|
| Shell | Tauri 2, Rust backend, WebView2 frontend | `src-tauri/` |
| UI | React 19, TypeScript, Zustand 5, Tailwind 4, Framer Motion | `src/features/plugins/companion/` |
| IPC | Tauri commands (about 150 `companion_*`) and `companion://` / `athena://` events | `src-tauri/src/commands/companion/`, `src/api/companion.ts` |
| Model | Claude Code CLI as a child process, `--output-format stream-json` | `src-tauri/src/companion/session/cli.rs` |
| Model tiers | `claude-opus-4-8` at low effort for conversation; `claude-sonnet-5` for maintenance and headless decisions | `src-tauri/src/companion/model_routing.rs` |
| Memory store | Markdown + YAML frontmatter on disk; SQLite (`personas_data.db`) index; FTS5 keyword index; `sqlite-vec` vec0 vector index | `src-tauri/src/companion/brain/`, `src-tauri/db/src/lib.rs` |
| Embeddings | `fastembed` (AllMiniLML6V2Q, 384 dims) over `ort` ONNX Runtime, behind the `ml` cargo feature | `src-tauri/src/companion/brain/embeddings.rs`, `src-tauri/db/src/embedder.rs` |
| Local HTTP | axum on 127.0.0.1, port scanned from 17400, shared-secret guard | `src-tauri/src/local_http/` |
| MCP server | JSON-RPC 2.0 over HTTP POST, five tools | `src-tauri/src/companion/orchestration/mcp/` |
| TTS | Kokoro and Pocket TTS via the `sherpa-onnx-offline-tts` sidecar binary (v1.13.4); optional Pocket HTTP service on :8080 | `src-tauri/src/companion/tts/` |
| STT | whisper.cpp `whisper-cli` sidecar (v1.9.2), six curated GGML models | `src-tauri/src/companion/stt/` |
| Cross-device | QUIC/mDNS P2P transport behind the `p2p` feature, remote jobs | `src-tauri/src/companion/remote_jobs.rs`, `src-tauri/engine/src/p2p/` |
| Terminal channel | Claude Code skill with a stdlib-only Python helper | `.claude/skills/athena/` |

Production builds use the `desktop-full` feature set (`desktop` + `ml` + `p2p`). The `lite` dev
build drops `ml` and `p2p`; on that build the vector lane and doctrine ingestion are compiled out and
recall runs on the keyword lane alone.

### Code layout

The Rust side is three crates, and older documents routinely cite pre-extraction paths:

| Crate | Holds |
|---|---|
| `src-tauri/src/` | the app binary, every Tauri command, `companion/` (Athena proper), `daemon/` |
| `src-tauri/engine/` | the execution engine shared by app and daemon: ambient context, CLI session awareness, watchers, P2P, the Claude CLI locator |
| `src-tauri/db/` | schema, migrations, repositories, the embedder |

Inside `companion/` the former god-files are directories: `session/`, `prompt/`, `dispatcher/`,
`brain/` (with `sleep_cycle/`), `proactive/`, `orchestration/`, `night_shift/`, `jobs/`, `tts/`,
`stt/`, `templates/`. On the frontend the former `CompanionPanel.tsx` is `chat/AthenaChatPanel.tsx`
plus about 45 `athenaChat*` modules.

Two processes run persona work: the windowed app and a separate `personas-daemon` binary. Athena
herself, her job worker and her schedulers run only in the windowed app; the daemon runs triggers
and executions and shares state with the app through SQLite tables, never memory. Any desktop
sensory feature (clipboard, focused app, file changes, the user's live Claude CLI session) is
therefore wired twice, and the CLI session feed is injected into other personas' prompts, not into
Athena's.

## 5. Runtime: how a turn runs

Entry: `send_turn` in `src-tauri/src/companion/session/turn.rs`. The order of its statements is
behaviour.

1. Acquire the per-conversation turn lock (`session/locks.rs`). Mutual exclusion is per
   conversation because two turns on one conversation would both `--resume` the same Claude session
   id. Across conversations concurrency is unbounded. User turns block on the lock; background
   turns try once and skip; fleet-orchestration turns queue up to 32 deep.
2. Persist the opening episode (role `user`, or `system` with an origin marker for autonomous,
   proactive and external turns).
3. Compose the system prompt (section 6) and emit `companion://recall-preview` so the UI can show
   what memory was consulted before the model answers.
4. Spawn the CLI under a 25-minute timeout. If the saved session id is stale, clear it and retry
   once with a fresh session.
5. Forward every stdout line verbatim on `companion://stream`. The frontend owns the render state
   machine (thinking, tool use, text). The backend captures the `system` line for the session id,
   concatenates `assistant` text blocks into segments, and parses the terminal `result` line for
   cost and tokens.
6. Run the dispatcher over the full assistant text (section 7).
7. Persist the final reply as an episode, write the `companion_turn` ledger row, execute anything
   autonomous mode allows, emit the side-effect events, then `companion://turn-summary` and the
   `finished` stream event.
8. Schedule the next autonomous tick if the model asked for one (15 s delay, chain capped at 20).

### The CLI invocation

```
claude [--resume <sid>] -p - --output-format stream-json --verbose
       --include-partial-messages --dangerously-skip-permissions
       --exclude-dynamic-system-prompt-sections
       --model <tier> --effort <low|medium|high|xhigh>
       --system-prompt-file %TEMP%/athena-prompt-<id>.md
       [--mcp-config <tmp.json>]
```

Notable choices, each recorded next to the code in `session/cli.rs`:

- The prompt goes through a file because it exceeds the Windows argument limit.
- `--bare` is avoided because it disables the OAuth keychain.
- The working directory is the user's home, so an ordinary chat turn does not inherit the
  repository's `CLAUDE.md`. Build turns override it to the project directory.
- `CLAUDE_CODE_FORK_SUBAGENT=1` makes subagents inherit her history and share the prompt cache.
- On Windows the child gets `CREATE_NO_WINDOW`; without it GUI-spawned children exhaust the desktop
  heap and die with `0xC0000142`.
- `PERSONAS_DUMP_PROMPT=1` snapshots the composed prompt to `~/.personas/debug/prompts/`;
  `PERSONAS_ATHENA_MODEL` and `PERSONAS_ATHENA_EFFORT` override the tier per spawn.

### Turn origins and model tiers

`TurnOrigin` (`session/origin.rs`) records why a turn ran and drives the episode marker, lock
policy, prompt addenda and ledger row: `User`, `Autonomous { chain_index }`,
`Proactive { trigger_kind }`, `External { source }` (a synthetic prompt from another surface or a
paired device). External turns from other surfaces run with chat suppressed: no episodes, no
stream events, only the side-effect events.

| Tier | Model | Effort | Used for |
|---|---|---|---|
| `MAIN` | `claude-opus-4-8` | low | conversation turns, full op grammar |
| `ASIDE` | `claude-sonnet-5` | medium | sleep-cycle legs, briefings, tour composition |
| `MICRO` | `claude-sonnet-5` | low | headless decisions: titling, triage, channel reactions. Deliberately receives no constitution |

Every spawn, including maintenance legs, goes through one metered helper and writes a
`companion_turn` row; there is no unmetered entry point.

### Interruption and failure accounting

- `companion_interrupt_turn` sets a flag polled every 200 ms; the child is killed, stdout drained,
  and whatever streamed is persisted with an interrupted marker.
- Autonomy cancellation uses a per-conversation generation counter, not a boolean, so a user
  "stop" cannot be revived by a continuation scheduled in the same turn.
- `FailedTurnCtx` guarantees exactly one `is_error=1` ledger row per failed turn, with a
  low-cardinality reason (`timeout`, `stale_resume`, `spawn_failed`, `cli_nonzero_exit`,
  `empty_reply`, `cli_io`, `other`). Before it existed, error paths returned before the ledger write
  and the health surface reported a flawless error rate by construction.

## 6. Prompt composition

`prompt::build_system_prompt` (`src-tauri/src/companion/prompt/build.rs`) assembles blocks in a
fixed order (`prompt/compose.rs`):

| # | Block | Source |
|---|---|---|
| 1 | constitution | `<brain>/constitution.md`, seeded from `companion/templates/constitution.md` (1,787 lines, version 61), never edited by Athena. The version constant is the delivery mechanism: on init a higher constant backs up and overwrites the disk copy, and the prompt reads only the disk copy, so a change without a bump ships prose nothing reads |
| 2 | identity | `<brain>/identity.md`, the evolving model of the user and of herself |
| 3 | briefing | optional synthesized recall (replaces the six raw memory blocks when present) |
| 4 | facts, goals, procedurals | always-include tiers plus keyword and vector hits |
| 5 | observability | a composite slot: app-state digest, operative-memory digest, conversation roster, agent index, dev-context index, skill index, canvas scene digest, paired devices |
| 6 | episodes, backlog, doctrine | recalled conversation, open promises, app documentation chunks |
| 7 | plugins, connectors | capabilities the user toggled on for her |
| 8 | onboarding, voice, display | situational addenda |
| 9 | static addenda | tells her WebSearch/WebFetch exist and to delegate rather than inline |
| 10 | mode addenda | autonomous mode, dev mode self-model, daily goals, reply language |

Three properties worth carrying to another project:

- **Budgets are tripwires, not caps.** `prompt/budget.rs` declares a character budget per block
  (constitution 24k, observability 48k, recall 40k, and so on). A breach logs one warning and
  changes nothing. The episode block is the exception: it is cut to fit by bisecting on how many
  trailing turns to admit, and the cut is announced in the prompt.
- **Every block is hashed.** Sizes and FNV-1a hashes go into the ledger row
  (`prompt_blocks_json`, `prompt_block_hashes_json`). The hash is what detects prompt-cache churn:
  the motivating datum was cache-creation tokens climbing turn over turn while character counts held.
- **Indexes exist so she can address, not invent.** The agent roster, dev contexts and installed
  skills are rendered as bounded `name → id` listings with a reserved footer that always says
  "showing N of M" (`prompt/indexes.rs`). The structural blocks ride the observability slot on
  purpose so they survive briefing mode.

### Recall

`brain/retrieval.rs` runs three lanes into one bundle: **keyword** (BM25 over the FTS5 table, runs
in every build), **vector** (vec0 KNN, `ml` builds only, with a distance floor), and
**always-include** tiers (top facts, procedurals, active goals, open backlog, query-independent by
design). The episode window is a budget of 20, not a per-lane quota: query-relevant older turns
first, then a recency tail to fill the rest. Both lanes may return empty rather than pad the prompt.
A `RecallTrace` records which lane produced each memory and feeds the recall strip in the UI.

## 7. The action grammar and the dispatcher

### The envelope

The model emits lines, not tool calls. The dispatcher (`dispatcher/dispatch.rs`) scans the
assistant text for four grammars, strips them from what the user sees, and acts on them:

```
OP: {"op":"propose_action","action":"<name>","params":{...},"rationale":"..."}
PROGRESS: <one-line narration beat>          (persisted live as its own episode)
TTS: "<what to speak>"                       (first line wins)
QR: ["quick reply", "quick reply"]           (capped at 6)
```

A bare `{"op":...}` line and an `OP:` marker mid-line are also accepted. If the JSON is missing one
to three closing braces the envelope is repaired; anything else is rejected and the model is told
next turn, as a system episode, that its op was dropped and why.

### The catalog

`dispatcher/catalog.rs` holds every allow-list. As of 2026-09-06 there are 99 addressable names
in three classes:

| Class | Count | Behaviour |
|---|---|---|
| Approval-gated actions (`ALLOWED_ACTIONS`) | 55 | become a `companion_approval` row and an approval card; run only after the user approves, or immediately under autonomous mode |
| Read-only ops (`READ_OPS`) | 12 | answer synchronously from the database, capped at 1,600 chars (6,000 for milestones and notes), and write the answer back as a system episode for the next turn |
| Auto-fire ops | 32 | navigation, surface composition, inline chat cards, `use_connector`, `continue_autonomously`; no approval, but each has its own validator |

Families in the gated set: persona execution, human review, memory writes (identity diffs, facts,
procedurals, goals, rituals, backlog), cross-device `remote_instruct`, ship planning, dev jobs, KPI
ops, proactive scheduling, team assignment, fleet control, browser tests, self-development, backlog
triage, canvas dispatch, skill and knowledge sync.

Smaller allow-lists back the auto-fire ops: 11 routes, 7 lab modes, 6 guided topics, and two
code-generated anchor manifests (`generated_anchors.rs` for orb pointing,
`generated_tour_anchors.rs` for composed tours) so a hallucinated selector cannot drive the UI to an
arbitrary element.

A test asserts that every catalog name appears in the constitution. An op can be wired end to end
and remain unreachable if the one document that teaches the vocabulary never mentions it; on
2026-09-03 eight of sixty-six were in that state.

### Approvals

An approval row is `(id, session_id, kind='op_execute', payload={action,params,rationale},
status)`. Lifecycle: `pending → running → approved | approved_failed | rejected`. Pending rows
older than 24 hours are hidden and refused at act time. Executors are split by family under
`src-tauri/src/commands/companion/approvals/approval_exec_*.rs`, dispatched from one match in
`approval_lifecycle.rs`. An executor may return a `ClientAction` (navigate, prefill a form, open a
tab, open an external URL) that the frontend applies through one shared function.

### Autonomous mode and containment

With autonomous mode on, every proposed action fires; the former auto-approve allow-list was
deleted on 2026-08-10 by explicit operator decision because "a mode whose whole promise is act
without asking me, that then files a card for two thirds of what Athena proposes, is not
autonomous". What remains, and may not be weakened (`approval_autopilot.rs:26-41`):

1. The catalog itself. An op with no grammar never becomes a row.
2. `validate_fleet_cwd_in_db`: a fleet session's working directory must canonicalize to a path
   under a registered project. One function, called from both proposal and execution time.
3. The boldness dial for typing into a live terminal, combined with the model's self-reported
   decision class and confidence, plus a screen re-check between deciding and firing.
4. Per-executor gates: `dev_improve` needs dev mode and a debug build; `remote_instruct` has a
   home-device rule and is asserted absent from any generic auto-resolve path.
5. The editable in-chat plan card as the correction path.

## 8. Memory

### Three planes

| Plane | Location | Role |
|---|---|---|
| Brain on disk | `~/.personas/companion-brain/` (override `PERSONAS_HOME`) | source of truth: one markdown file per memory |
| User database | `%APPDATA%/com.personas.desktop/personas_data.db` | `companion_*` tables: index over the disk plus runtime state; rebuildable |
| System database | `personas.db` | `athena_wake_log`, `remote_jobs`, `owned_devices` |
| Frontend | Zustand `persist` key `companion-drafts` | composer drafts only; everything else is session state |

### The disk tree

```
~/.personas/companion-brain/
├── constitution.md            static law; .bak-<ts>.md on version upgrade
├── identity.md                evolving self/user model; .bak-* on every full write
├── cockpit.md / dashboard.md  singleton JSON specs
├── episodes/YYYY/MM/DD/<ep_id>_<role>.md      append-only, never deleted
├── semantic/{user,project,world}/<fact_id>_<slug>.md   (+ _deleted/)
├── procedurals/{chat,action,memory,build}/<proc_id>_<slug>.md
├── goals/<goal_id>_<slug>.md
├── backlog/{self_promise,capability_gap}/<id>.md
├── rituals/{quiet_hours,cadence,focus_window}/<id>.md
├── reflections/<date>_<id>.md
└── cycles/<date>-<cyc_id>.md   sleep-cycle narrative reports
```

Every file is `---`-fenced frontmatter (`id`, `type`, `created`, and per-kind fields such as
`scope`, `importance`, `confidence`, `sources:`) followed by the body. Nothing on disk is JSON except
the two singleton specs. Importance, decay timestamps and machine markers live in SQL columns, not
frontmatter.

### Memory kinds

| Kind | What it is | Provenance |
|---|---|---|
| episode | one conversation turn or observed agent event; the only kind scoped to a conversation | is the source |
| fact | a distilled claim about `user`, `project` or `world`, with confidence and optional expiry | at least one episode id, enforced |
| procedural | a behaviour rule, "when X do Y", scoped `chat`/`action`/`memory`/`build` | enforced |
| goal | a user-stated objective with status and priority | the user is the source |
| backlog item | Athena's own self-promise or capability gap | optional episode |
| ritual | quiet hours, cadence, focus window; steer the proactive scheduler, never recalled | optional |
| reflection | prose journal of conversational patterns; never recalled | window of episodes |
| doctrine | read-only chunks of the app's own documentation, regenerated every boot from a curated 24-file allowlist under `docs/` that includes this folder's `athena-usecases.md`; a stale doc here is retrieved into her prompt as canon | none |
| identity | the evolving model, edited only by anchored bullet diffs behind an approval card (max 5 diffs, 280 chars each) | approval |
| constitution | shipped law, versioned, never edited by Athena | none |

Machine-generated episodes (fleet correlator records) are written at importance 1 against 3 for
conversation, excluded from the recency lane, capped at 2 of 6 keyword slots, and rendered with a
`[machine]` marker so a load test is never read as conversation.

### SQLite tables

Created by `COMPANION_SCHEMA` in `src-tauri/db/src/lib.rs` on every boot with
`CREATE TABLE IF NOT EXISTS`; columns added later use a failure-tolerant `ALTER TABLE` loop.

| Group | Tables |
|---|---|
| Index core | `companion_node` (id, kind, file_path, content_hash, importance, embedding_model, body_excerpt, session_id, tags_json), `companion_fts` (FTS5: body, tags), `companion_embedding` (vec0, created at runtime), `companion_provenance`, `companion_edge` (declared, no reader yet) |
| Typed sidecars | `companion_fact`, `companion_procedural`, `companion_goal`, `companion_ritual`, `companion_backlog_item`, `companion_fact_tombstone`, `companion_taxonomy` |
| Cycles and sync | `companion_cycle`, `companion_consolidation`, `companion_consolidation_item`, `companion_sync_inbox` |
| Conversation | `companion_session` (one row per thread, holds the Claude session id), `companion_turn` (usage ledger), `companion_turn_sidecar`, `companion_chat_card` |
| Runtime | `companion_approval`, `companion_design_decision`, `companion_proactive_message`, `companion_proactive_budget`, `companion_attention_budget`, `companion_night_plan`, `companion_night_event`, `companion_background_job`, `companion_dev_op`, `companion_dev_feedback`, `companion_known_project`, `companion_active_connector`, `companion_plugin_toggle`, `companion_tours`, `companion_daily_goal`, `companion_ux_signal`, `companion_persona_baseline` |

### Forgetting

Forgetting is demotion to `importance = 0`, never a `DELETE`. Exits: supersede by a newer fact,
expiry, decay after 30 unrecalled days (minus one, floor 1), age-out at the floor after 90 days
(365 for user scope), a 500-per-scope size cap, and a user's explicit delete, which also writes a
tombstone so the next cycle cannot re-derive the same key. The sweep rides the recall path at most
once per six hours per process, and every sweep, including a no-op, writes a
`companion_night_event` row.

### The sleep cycle

`brain/sleep_cycle/` is the maintenance pass. It is triggered by **pressure**, not the clock:
40,000 characters of new non-machine conversation since the last completed cycle, with a six-hour
floor between cycles and a 72-hour staleness valve. The check runs from the night-shift tick every
30 seconds, measured at most every 10 minutes, and deliberately before the night-shift enable gate,
because memory maintenance is not autonomy. Manual entry is `companion_run_sleep_cycle(force)`.

Two legs are implemented: **compress** (episodes since the boundary become candidate facts and
procedurals, each citing episode ids, written through the ordinary writers) and **reconcile**
(drain the sync inbox, judge supersedes and contradictions, run decay). Each leg is one
`claude -p -` call on the `ASIDE` tier, with episode bodies wrapped in a nonce-tagged untrusted
fence and every returned id checked against live memory before a write. Caps per cycle: 12 facts,
6 procedurals, 8 supersedes, 120 episodes and 30,000 characters in. Cycle-written memories start at
importance 3 and confidence 0.7.

Every cycle writes a `companion_cycle` row (status, phase log, stats) and a narrative report on disk
under `cycles/`, indexed and mirrored into FTS so it is findable. The report's most detailed section
is "what I did not see, and what I dropped". A cycle that dies stays `running` forever on purpose:
"the process died" and "still working" are different facts.

### Portability and sync

- **Export bundle** (`src-tauri/src/commands/core/data_portability/*_athena.rs`): identity, three
  portable preference keys, the conversation roster, and the learned kinds (facts, procedurals,
  goals, backlog, rituals, decisions, provenance) with their markdown bodies. Deliberately absent:
  episodes, doctrine, constitution, embeddings, session ids, absolute project paths, and every
  runtime or telemetry table. Provenance pairs land dangling on purpose.
- **Sync inbox** (`brain/sync_staging.rs`, `sleep_cycle/sync_inbox.rs`): a complete receiving
  contract for project-abstract deltas (user/world facts, user procedurals, taxonomy) consumed only
  by reconcile, never force-written. As of 2026-09-06 it has no production producer; the transport
  is not attached yet.
- **Remote jobs** (`remote_jobs.rs`, `p2p` feature): a paired device's instruction runs here as a
  real turn with her full op set; its outcome lands in the other machine's memory as episodes.
  Instructions and results travel; memory does not.

### The terminal channel

`.claude/skills/athena/` lets Claude Code converse as Athena when the app is closed. The Python
helper opens the same database and brain root, returns taxonomy, facts, procedurals, recent
terminal episodes and the pressure gauge on boot, runs the real BM25 lane on `recall`, and appends
episodes disk-first in the exact format the Rust writer uses. It writes exactly three things: a
`cli` conversation row, episodes, and a `companion_turn` row with `origin='cli'`. It never writes
constitution, identity, facts or taxonomy; "remember this" becomes an episode and the sleep cycle
distills it, because episode listing for the cycle is deliberately not session-scoped. Two doors,
one brain.

## 9. Interfaces

### Tauri IPC

About 150 commands under `src-tauri/src/commands/companion/`, grouped by file: chat and
conversations, approvals, brain and consolidation, observability, proactive, jobs, MCP bridge,
fleet bridge, chat cards, canvas control, connectors, plugins, voice, STT, sensory, daily goals,
briefing, tours, templates, decisions, sidecars, browser test, project tracking. The frontend calls
them only through `invokeWithTimeout`.

Events the backend emits, all backend to frontend:

| Event | Payload |
|---|---|
| `companion://stream` | `{sessionId, turnId, kind: started/cli/finished/error, payload: raw stream-json line}` |
| `companion://approvals`, `companion://chat-cards`, `companion://proactive` | new rows for the panel |
| `companion://client-action`, `companion://navigate`, `companion://open-lab`, `companion://guide` | UI side effects of an op |
| `companion://compose-dashboard`, `compose-cockpit`, `explain-cockpit`, `compose-canvas-panel`, `canvas-control` | surface composition |
| `companion://recall-preview`, `companion://turn-summary` | per-turn instrumentation |
| `companion://job`, `companion://hotkey`, `companion://remote-job-turn` | background job transitions, push-to-talk, paired-device notice |
| `companion://kokoro-install`, `pocket-install`, `stt-install`, `stt-download` | sidecar install progress |
| `athena://mcp/guidance-request`, `athena://mcp/approval-request` | a fleet worker is blocked on a question |
| `athena://orchestration/digest-changed`, `athena://fleet/auto-decided` | live-ops signals; the frontend refetches rather than applying deltas |

The frontend's load-bearing decision is that the chat panel shell is **always mounted** and only its
body is gated on the open state, so stream events, navigation, guide steps, cards and voice requests
are consumed even while the window is closed (`chat/athenaChatEngine.ts:1-21`). The orb and the
guide layer are DOM portals inside the same webview, not separate Tauri windows.

Two things are both called "decisions" and share nothing. The hands-free decision queue (orb
bubble, numbered keys, spoken numbers) is a frontend-only, never-persisted aggregator over approval
rows, proactive nudges and manual reviews. The design decision log
(`brain/decisions.rs`, table `companion_design_decision`) is an immutable audit trail of
`show_decision_log` entries. Their only shared point with the model is the "explain" path, which
fires a synthetic turn whose answer rides an event payload and is never stored.

### Athena as an MCP server

Mounted at `POST /mcp/rpc` on the local HTTP server (`orchestration/mcp/`). JSON-RPC 2.0, no
SSE. Each fleet worker gets a `--mcp-config` file at spawn declaring one HTTP server named
`athena` with two headers: a per-session token and the local server's shared secret. Five tools:

| Tool | Blocking |
|---|---|
| `athena.report_intent` (claim or join an operation) | no |
| `athena.checkpoint` (progress or blocker note) | no |
| `athena.request_guidance` (ask her a question) | yes, 10-minute TTL |
| `athena.request_approval` (propose a destructive action) | yes, 10-minute TTL |
| `athena.report_tool_defect` | no |

Blocking tools register a pending request, emit a Tauri event, and await a oneshot resolved by
`companion_mcp_resolve_request`. Inside the night window an unanswered guidance request is
answered by Athena herself; an approval request is always parked, never auto-approved.

The rationale for MCP on top of the existing hook feed: hooks are passive and one-way, so the app
infers what a session is doing; with MCP the session tells her, and she can answer back before it
burns tokens.

### Operative memory

`orchestration/operative_memory.rs` is the in-process working set: operations, the sessions in
them, current tool, files touched, last failure, checkpoints. It evaporates on restart by design;
the brain records what happened, operative memory records what is happening. A session start with
no owning operation auto-creates one; session end synthesizes a summary that becomes the episode
body. Its digest is spliced into the prompt every turn, and mutations emit a change signal the
frontend answers with a refetch.

### MCP consumed

Athena's own turns get `--mcp-config` in two cases: browser tests (the user's real Chrome through a
paired extension at `/browser-bridge/mcp`, or the bundled Playwright MCP as fallback) and web-build
turns with per-project connectors.

### The local HTTP server

`src-tauri/src/local_http/`: 127.0.0.1, first free port from 17400 (16 tried), every router
behind a Host allowlist and shared-secret guard, discovery via a handshake file. Routes:
`/mcp/rpc`, `/fleet/hooks/*`, `/browser-bridge/ws` (extension WebSocket, pairing token),
`/browser-bridge/mcp` (per-test session token, navigation pinned to the approved origin). The
test-automation server on 17320 is a separate, feature-gated module.

### External services

| Service | Transport and auth | Direction |
|---|---|---|
| Claude (model) | CLI subprocess, OAuth keychain, `ANTHROPIC_*` stripped | Athena spawns it |
| GitHub, Sentry (as connectors) | HTTPS with vault credentials, host allowlist, read-only capabilities auto-fire, write capabilities need approval | Athena calls them via the background job worker |
| Paired devices | P2P wire, admitted only by an `owned_devices` row from fingerprint pairing | both directions |
| Obsidian vault | filesystem watcher in project tracking, off by default, hourly pulse consolidated by a small model | app reads it |
| Chrome | extension over WebSocket, pairing token | Athena drives it during an approved test |

## 10. Proactive behaviour and autonomy

- **Proactive pipeline** (`proactive/`): trigger evaluators produce `Nudge` candidates
  (goal approaching, backlog aging, cadence due, on-this-day, dev goal stalled, fleet failed or
  stale, incident blocker, execution review, daily rollup, plus her own `schedule_proactive`
  commitments) → quiet check → budget → persist as `queued` → release. Noticing and delivering are
  decoupled so a lost budget claim cannot strand a row. Tick every 5 minutes.
- **Budget** (`proactive/budget.rs`): a global cap of 12 deliveries per UTC day and a per-kind cap
  (fallback 3, engagement-modulated by ±1 after five observations), both claimed atomically in one
  transaction after a successful enqueue.
- **Quiet hours** (`proactive/quiet.rs`): read from active rituals, not a setting; local time;
  `from` inclusive, `to` exclusive, equal endpoints mean never quiet.
- **Wake window** (`wake_window.rs`): one gate over her autonomous CLI surfaces (execution triage,
  message triage, channel reactions, fleet reassess). Signals accumulate until the window elapses,
  the queue passes 25, or a priority signal arrives. Every real wake is logged to `athena_wake_log`.
- **Night shift** (`night_shift/`): an evening plan lands as an approval card and never runs
  unapproved; a review station classifies finished sessions; a morning report summarizes. Bounded at
  6 sessions regardless of settings, every act attributed and ledgered in `companion_night_event`.
- **Background jobs** (`jobs/`): `queued → running → completed | failed`, polled every 3 seconds,
  six kinds (`scan_codebase`, `connector_use`, `curation_run`, `night_plan`, `session_review`,
  `operations_views`); completion appends a system episode so she sees the result next turn.
- **Channel reactions** (`athena_reaction.rs`): a `MICRO`-tier decision on whether to react to a
  team-channel event; restraint is an explicit outcome and every posted reaction carries a rationale
  footer. A reaction is written straight into the team channel with `author_kind='athena'` and a
  `consumer` of `display` (visible to the user only) or `inject` (delivered into a named persona's
  next step). This is the mechanism by which an Athena message reaches another agent's prompt, and
  it is separate from the proactive pipeline, which targets the companion surface. The same
  headless helper (`cli_text`) also decides execution triage and message triage: a standalone
  prompt, no session, no episodes, which is what makes hundreds of signals per minute affordable.

## 11. Voice

Both directions are local and out of process; there is no cloud voice path.

- **TTS**: two engines through one sidecar binary, `sherpa-onnx-offline-tts` v1.13.4, installed to
  `~/.personas/companion-tts/bin/`. Kokoro (53 voices, one 310 MB model, selected by `--sid`) and
  Pocket TTS (zero-shot cloning from a reference WAV; optionally a long-lived Python HTTP service
  on `127.0.0.1:8080`, override `PERSONAS_POCKET_TTS_URL`). One subprocess per synthesis, 24 kHz
  WAV out. Spoken text is capped at 1,200 characters. Both engines pin the same sidecar version so
  an install of one cannot break the other.
- **STT**: whisper.cpp `whisper-cli` v1.9.2 in `~/.personas/companion-stt/bin/`, models streamed
  from Hugging Face into a curated six-entry catalog. One subprocess per transcription from a 16 kHz
  mono WAV, 25 MB cap, language codes validated so a flag-shaped value cannot reach argv. Browser
  Web Speech is a frontend-only alternative that never reaches Rust.
- **Push-to-talk**: an OS accelerator (`CmdOrCtrl+Shift+A` default) emitting `companion://hotkey`.

## 12. Observability and cost

`turn_ledger.rs` writes one `companion_turn` row per CLI spawn: origin (`chat`, `autonomous`,
`proactive`, `external`, `headless`, `maintenance`, `cli`), trigger kind, model, tokens
(input, output, cache read, cache creation), cost in USD as reported by the CLI's own `result`
event, duration, error flag and reason, prompt block sizes and hashes, and a JSON of dispatcher
side effects. Capture is best-effort and never blocks a turn. Maintenance legs are a separate origin
so the cost of the sleep cycle is visible rather than buried under triage.

Surfaces: the usage lane in the Activity tab (`companion_get_usage_dashboard`), the spend rollup
(`companion_get_spend_rollup`, with an explicit ledger column so nothing double-counts), prompt
block stats and churn, brain health (eight ordered stages, the first non-OK stage is the single
reported cause), cycle reports, the per-turn summary chip, the recall strip, and the dev-mode op
ledger.

## 13. Settings and configuration

Backend-obeyed settings live in the SQLite `settings` table (`src-tauri/db/src/settings_keys.rs`):
autonomous mode, dev mode, fleet boldness, wake window minutes, constitution version, daily rollup,
night shift (enabled, plan hour, wake hour, guidance minutes, max sessions), profile synthesis,
triage cursors, browser bridge pairing token. UI-only preferences (footer icon, orb position, voice
engine and voice ids, STT model, hotkey enabled, hands-free decisions) persist in the frontend store
under `persona-ui-system`; toggles with backend meaning are mirrored through a command and the
SQLite row is what the backend obeys.

Environment variables: `PERSONAS_HOME` (brain and sidecar roots), `PERSONAS_ATHENA_MODEL`,
`PERSONAS_ATHENA_EFFORT`, `PERSONAS_DUMP_PROMPT`, `PERSONAS_KOKORO_BIN`, `PERSONAS_WHISPER_BIN`,
`PERSONAS_POCKET_TTS_URL`, `PERSONAS_BROWSER_BRIDGE_TOKEN`, `PERSONAS_TEST_PORT`.

Ports: local HTTP from 17400, test automation 17320, Pocket TTS service 8080.

## 14. Reusing this design in another project

The minimum set that reproduces the behaviour, in the order to build it:

1. **A constitution file and an identity file** on disk, the first shipped and versioned, the
   second edited only by small anchored diffs behind a confirmation.
2. **A per-turn CLI spawn** with the prompt on a file, stream-json forwarded verbatim to the UI, a
   session id captured for resume, and a per-conversation lock.
3. **An episode log** that is append-only markdown, indexed into SQLite with an FTS5 mirror. Add
   vectors later; keyword recall is what makes recall depend on the question at all.
4. **A line grammar for actions** with an allow-list, an approval table, and a test that the
   constitution teaches every name in the allow-list.
5. **A usage ledger row per spawn**, including failures, before any dashboard.
6. **A pressure-triggered compression pass** that writes facts with provenance and reports what it
   dropped.
7. Then, in any order: proactive nudges with a budget and quiet hours; an MCP endpoint for other
   agents to ask her questions; local voice sidecars; an export bundle that excludes transcripts and
   machine-local state.

Invariants to keep while porting: disk is truth and the database is an index; uncited memory is
rejected; gates check policy and the model only proposes; every truncation is announced; the
maintenance model tier is metered like every other spawn.

## 15. Known gaps (as of 2026-09-06)

- `brain/graph.rs` is a stub; `companion_edge` is created on every boot and has no reader.
- The sync inbox has a consumer and no producer.
- `disk.rs` eagerly creates `semantic/projects/` and `procedural/`, while the writers use
  `semantic/project/` and `procedurals/`; the eager directories stay empty.
- Doctrine ingestion is compiled out on non-`ml` builds, so the keyword doctrine lane finds
  nothing there; in-code comments claiming "the shipped build has no ml" predate `desktop-full`.
- `companion_fts` is a second plaintext copy of every memory body and is outside the encrypted
  sections.
- The briefing IPC types are hand-mirrored in TypeScript rather than generated.
- Desktop focus capture is Windows-only (`engine/src/app_focus.rs`), so desktop awareness is not
  cross-platform today.
- The assignment reconciliation bridge's terminal-state set omits `aborted`
  (`useAthenaAssignmentReconciliation.ts:7`), so aborted Athena-dispatched assignments are never
  reconciled into operative memory.
- The prompt's connector block still tells her `use_connector` auto-fires with no approval
  (`prompt/capabilities.rs:213-220`), which is untrue for the eight write capabilities that file
  a card.

## 16. Where to read next

- [`README.md`](./README.md): the product-level feature reference, section by section.
- [`athena-multiconversation.md`](./athena-multiconversation.md): threads and the conversation registry.
- [`autonomous-signal-economy.md`](./autonomous-signal-economy.md): execution and message triage.
- [`conversation-orchestration.md`](./conversation-orchestration.md) and
  [`../../architecture/companion-fleet-orchestration.md`](../../architecture/companion-fleet-orchestration.md): fleet orchestration and operative memory.
- [`athena-daemon-bridge.md`](./athena-daemon-bridge.md) and
  [`athena-cli-session-awareness.md`](./athena-cli-session-awareness.md): desktop and CLI sensory signals.
- [`../../plans/athena-longevity.md`](../../plans/athena-longevity.md): the memory longevity plan the sleep cycle implements.
- [`../../concepts/golden-paths/hmr-safe-singletons.md`](../../concepts/golden-paths/hmr-safe-singletons.md): why the panel shell is always mounted.
