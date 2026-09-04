---
status: reviewed
date: 2026-09-04
source: stencil.so/blog/harness-playbook
kind: comparison-study
project: personas
peer: omp / omp² (Stencil) — an agent harness, forked from Pi
points: 43
verdicts: { adopt: 11, adapt: 8, keep-ours: 20, different-forces: 4 }
---

# personas vs. "The Harness Playbook" (omp → omp²) — peer study

- **Source**: `https://stencil.so/blog/harness-playbook`, ~21,600 words, seven chapters (the state · the runtime · the control plane · the inference · the tool surface · the interface · the stack) plus two appendices. A first-party postmortem of `omp` (a fork of the `Pi` harness) and the architecture of its replacement `omp²`. Read from the mined text at `%TEMP%/ai-registry-research/the-harness-playbook.clean.txt`.
- **Written**: 2026-09-04, intake Phase 7.6 (peer lane). No ledger row. Nothing in this study was built.
- **Paths**: every personas anchor is relative to the personas root and was opened before it was cited.
- **Verdicts** come from the closed set `adopt` / `adapt` / `keep ours` / `different forces`. Every one carries its reason. `keep ours` is the largest class and each instance states *why* ours survives contact.

**Verdict tally: 43 points — 11 `adopt`, 8 `adapt`, 20 `keep ours`, 4 `different forces`.**

## Why a comparison and not a feature list

`.ai/manifest.yaml:97` fixes personas at *"run local AI agent personas over wrapped CLIs, local-first storage, one operator per install; observe runs — cost, health, traces — and tune routing from evidence."* omp is the same class of object: a local-first agent harness, one operator, a tool surface, a session, a renderer. The author's four "architecture tests" (multiplexed workspace · remote driver · spectator · Factorio) are four shapes personas partly ships — the desktop UI, the `personas-daemon`, the local HTTP server and MCP sidecar, the cloud worker.

**But the two harnesses sit on opposite sides of one line, and that line governs a third of the verdicts below.**

omp *owns the inference loop*: it builds the message array, applies the tool grammar, streams the tokens, parses the dialect, and decides whether to yield. personas *rents* it: `src-tauri/engine/src/provider/mod.rs:109-113` resolves exactly one provider, and that provider's whole job is to build argv and parse stream lines — `EngineKind` has a single variant (`src-tauri/core/src/engine_kind.rs:19-21`). The turn loop, the tool schemas, the cache, the compaction all live inside a `claude` binary personas spawns and reads. Wherever the source's mechanism needs a seam *inside* a turn, personas has no seam to attach it to; the tree says so in code, not in a doc — `src-tauri/src/engine/runner/hooks/registry.rs:85-88`: *"`pre_tool_call`, `transform_tool_result` and `pre_llm_call` are absent here because personas runs the CLI under `-p` and has no per-call seam inside the spawned binary to attach them to."*

That is the asymmetry. It is not a deficiency and it is not an excuse: it makes some points `different forces` and it makes others *sharper*, because a harness that cannot see inside the turn has to get the boundaries right.

---

## Headline: five places the seeding was wrong, and the corrections are the point

1. **The cancellation seed is right about the count and wrong about the stakes.** 29 `spawn_guarded` sites, 2 handles bound, both in a unit test — verified. But the *primary* work path already has the kill boundary the source demands, and for a reason the source never faces: `src-tauri/src/engine/execution.rs:1157-1161` kills the child OS process with the comment *"Kill the child OS process to stop API credit consumption."* The un-abortable 23 are ancillary in-process scans. The finding inverts: personas built the boundary where money burns and skipped it where CPU burns (§2.1, §2.2).
2. **The mode-exclusivity seed is refuted outright.** personas has no "exit goal mode first" problem because it has no *second* occupant of the loop. `requests_continuation` has exactly one writer (`src-tauri/src/companion/dispatcher/dispatch.rs:1351`) and one reader (`src-tauri/src/companion/session/turn.rs:988`). And personas *already implements the Director stack shape* — a priority-ordered handler chain where the innermost may consume, with an `exclusive` rung — for **keyboard input**, at `src/lib/keyboard/AppKeyboardProvider.tsx:28-42`. The pattern is in the tree, in the wrong layer (§3.3, §3.4).
3. **The convar seed is refuted.** personas already has the declaration-site registry the source proposes: `src-tauri/db/src/settings_keys.rs:1-20` pairs every key with a `_DEFAULT`, a typed validator, an audit category and a deprecation lane, and enforces at the *repo* layer so internal Rust callers cannot bypass it (`src-tauri/db/src/repos/core/settings.rs:96`, `:27`). What is missing is not the registry — it is *flags on the variable* (§3.1).
4. **The "no LLM client" claim in personas' own docs is stale.** `.claude/codebase-stack.md:28` says *"the application does not implement an LLM client."* It does: `src-tauri/src/engine/http_engine/` builds a tool array, posts it with `tool_choice`, runs a bounded tool loop and prices the tokens (`tools.rs:83-99`, `:124`, `config.rs:33-39`). Everything the source says about roster size, budgets and repair *applies literally* to that path (§4.3, §5.1).
5. **The verification seed is refuted, and personas is ahead.** The source's single highest-ROI recommendation — *"a non-destructive, off-screen, multi-instance debug protocol… the machine-readable definition of what the UI is"* — personas shipped, in two builds, with ~55 endpoints: `src-tauri/src/test_automation.rs:1-13`, routes at `:1387+`, production mode via `PERSONAS_TEST_PORT` (`:1379`). The gap is one adjective, and it is the one the source underlines: **multi-instance** (§6.5).

---

## 1. The state — one authority, or two

> *"state is not really sourced from those events, violating the first principle of event sourcing: state must be derivable from the events alone."*

**1.1 — The unit of truth.**
Source: everything is an entity delta; `replay(.dem) == original`; *"Source did not get its correctness by writing a careful reconciler… It made non-replayable state unrepresentable."*
personas: one SQLite file, and the run record is a **mutable row**. `persona_executions` (`src-tauri/db/src/migrations/schema.rs:109`) is UPDATE-in-place through `src-tauri/db/src/repos/execution/executions.rs:1076 update_status`. There is no fold, no derivation, no replay.
**Verdict: `different forces`.** The source needs derivability because rewind, fork, replication and inspection are all product features it sells. personas has one operator, one install, and its recovery story is *classification at boot*, not replay — `src-tauri/db/src/repos/execution/restart_recovery.rs:1`: *"At boot, do not declare — classify."* Event sourcing the run row would buy a rewind nobody has asked for and cost every write path.

**1.2 — There IS a journal, and it points backwards.**
Source: the journal stores the tree's incremental changes; at any journal point the session materializes.
personas: `src-tauri/db/src/journal.rs:1` — *"Durable change journal — the write side of the Reversible Agent"* — a SQLite `preupdate_hook` capturing before-images, stamped with the active `execution_id`. Read/undo at `src-tauri/db/src/repos/execution/change_journal.rs:1-15`: `undo_execution` *"reverse-replays the journal in ONE transaction"*, parking rows another writer touched as `undo_status='conflict'` instead of clobbering them.
**Verdict: `keep ours`.** An inverse log with conflict parking answers the question personas' operator actually asks ("take back what that run did to my data") and answers it *across* runs, which a session-scoped forward fold does not. And the exclusion is deliberate and correct: `journal.rs:52-54` keeps `persona_executions` out of the journaled set — *"undoing a run must not erase the evidence that the run happened."* The source's model has no equivalent of that distinction.

**1.3 — Rewind and fork: written, wired to nothing.**
Source: *"Rewind is a DOM diff… The delta itself is the complete lifecycle work list."*
personas: `src-tauri/engine/src/git_checkpoint.rs` (272 lines) implements `checkpoint_stage:61`, `snapshot_stage:108` (non-disruptive `git stash create` + a `refs/personas/checkpoints/` ref), `fork_from_checkpoint:128` (guarded by `merge-base --is-ancestor`) and `rollback_to:138`, hardened against hooks/gc/gpg at `:20-29`. **Non-test call sites: zero** — `grep -rn "git_checkpoint" --include=*.rs src-tauri/` returns only `engine/src/lib.rs:113` (the `pub mod`) and a doc comment. Its persistence twin `src-tauri/db/src/repos/dev_run_checkpoints.rs:27` is dead too, and admits it at `:5` (*"a **future** UI… can list and roll back"*).
**Verdict: `adopt` — the wiring, not the model.** This is the second time an intake study has found a finished, hardened, uncalled subsystem in this tree (the exo study, 2026-09-04 §8.4, found the same file). The source's argument is precisely why it stays uncalled: with no single authority, *every* stateful feature would need its own rewind call site, so wiring one is expensive and wiring the fifth is impossible. personas does not need a DOM to fix that — it needs the checkpoint to be taken by the *runner*, at the one place a stage boundary already exists.

**1.4 — State that escapes the store.**
Source audited 78 official Pi extension examples: 60 stateless, 17 stateful, **2 correct**; the failures are closure variables and module Maps that survive rewind or reset on resume.
personas: the same class exists and is large. `src-tauri/src/commands/fleet/registry.rs:371 static REGISTRY: OnceLock<FleetRegistry>` holds PTY handles, a state machine and a 512 KiB output ring per session, and `src-tauri/db/src/repos/fleet_sessions.rs:15` says the quiet part: *"the live registry remains the source of truth while the app runs"* — the table is a mirror. Add ~20 `static … BackgroundJobManager` instances (`src-tauri/src/background_job.rs:157`), `src-tauri/src/engine/share_link.rs:52 SHARE_STORE` (shares exist only in RAM), `src-tauri/src/state.rs:40 cloud_exec_ids` (the mapping to a live cloud run), and `src-tauri/src/commands/fleet/stale.rs:28-56` (the reaper's entire memory).
**Verdict: `adapt`.** The *failure* the source names does not bite, because personas has no rewind to be inconsistent with (§1.3). But it has **resume**, and resume is where this class actually hurts: a restart drops all of it. personas has already paid for one instance of this bug and fixed it well (§1.6). The transferable half is the audit, not the DOM: enumerate which of those statics must survive a restart and which are correctly ephemeral — nobody has.

**1.5 — The turn counter that cannot count history.**
Source, `status-line.ts`: *"rewind from turn 3 to turn 1 produces turn 4; resume starts at zero."*
personas: the autonomous chain counter is exactly this shape. `MAX_AUTONOMOUS_CHAIN = 20` (`src-tauri/src/companion/session/origin.rs:29`), and `chain_index` is computed per turn and handed forward through the spawn closure (`src-tauri/src/companion/session/turn.rs:995`, `src-tauri/src/companion/session/autonomy.rs:37`). It is never persisted. A restart mid-chain restarts the count at 1, and the 20-turn ceiling — the only thing standing between the operator and an unbounded autonomous loop — resets with it.
**Verdict: `adopt`.** This is the source's example, reproduced, in the one place where the counter is a *safety* bound rather than a cosmetic one. It is a column on the conversation row.

**1.6 — Where personas already solved this better than the source's examples.**
personas: the pending-continuation cancel was an `AtomicBool` and it had the exact bug the source catalogues. The fix is documented in place, `src-tauri/src/companion/session/interrupts.rs:100-107`: *"a user 'stop' set the bool, but if that same turn's reply also emitted `continue_autonomously`, `schedule_autonomous_tick` reset the bool and the originally-pending tick — still polling — saw `cancelled == false` and fired, so the loop the user halted kept running (bug-hunt 2026-06-07 companion #1)."* The replacement is a per-conversation, monotone, never-reset generation token (`:108`), keyed so *"a user message in thread A must not cancel a pending tick in thread B."*
**Verdict: `keep ours`.** A never-reset generation counter makes the stale-tick state *unrepresentable*, which is the source's own stated standard ("correctness comes from that constraint"), reached without a DOM and with a comment that explains the counterexample. This is the strongest single piece of state discipline in either tree.

---

## 2. The runtime — who may change what, and what can be stopped

> *"A safe host needs an execution unit it can actually terminate… Cancellation belongs to the runtime contract, not to every tool author's good behavior."*

**2.1 — The execution path already has the kill boundary.**
Source: `AbortSignal`/`context.Context` are *"useful protocols, but not enforced ones"*; the host needs a process it can terminate.
personas: for the work that matters, it has one. `cancel_execution` sets the flag (`src-tauri/src/engine/execution.rs:1140-1142`), persists `Cancelled` only if still running (`:1147-1155`), **kills the child process tree** — `taskkill /F /T` on Windows, `kill -9` elsewhere (`src-tauri/src/engine/execution.rs:1598-1616`) — and only then gives the tokio task a 5-second grace, re-killing anything spawned during it (`:1163-1185`).
**Verdict: `keep ours`.** personas has the terminable unit the source argues for, holds the `JoinHandle` (`:1162`), and has a reason the source never confronts: the callee is a metered vendor session, so a cooperative signal it might ignore costs real money. The comment at `:1157` says it. (The exo study's `adapt` on the *ordering* of that kill stands on its own; this point is about whether a boundary exists at all.)

**2.2 — And the ancillary path does not.**
personas: `spawn_guarded` (`src-tauri/src/background_job.rs:80`) has **29 call sites** (uncapped `grep -rn "spawn_guarded(" src-tauri --include=*.rs | wc -l`). Exactly **2** bind the returned handle, and both are the sibling-isolation unit test at `:778-779`. The other 27 — OAuth flows, KPI scans, context generation, vector-KB ingest, standards scans, task execution — discard it. `.abort()` is used 15 times elsewhere in the tree, so the tool is known. The helper's own doc concedes it at `:75-79`: *"This preserves what the call sites do today, including dropping the `JoinHandle`… Making these tasks abortable is a separate, behaviour-changing piece of work."*
`cancel` (`:481`) fires the `CancellationToken` and then **unconditionally** sets status `failed` / `"Cancelled by user"` — the status is written whether or not the task ever notices. `sweep_stale_running` (`:242`) does the same on a timer, marking `failed` and cancelling the token as a courtesy.
**Verdict: `adopt`.** This is the source's thesis with the tree's own admission attached. The fix is not architectural: `spawn_guarded` already *returns* the handle, and `BackgroundJobManager` already *has* a per-job slot (`JobEntry`, `:112`) with a `cancel_token` field to put it next to. Storing the handle in the entry and aborting it in `cancel()` makes the status honest for all 27.

**2.3 — The sandbox executes; who decides?**
Source: *"The host owns session state, inference, policy, tool routing, approval, limits, and journaling. The sandbox owns environment execution through a small, obedient protocol."*
personas: the split is already this shape and the boundary is a process, not an isolate. The host (Rust) owns the DB, the approval table, the credential vault and the policy; the `claude` subprocess owns environment execution; the MCP sidecar is the narrow duplex channel back, and it is genuinely narrow — `src-tauri/src/companion/orchestration/mcp/handlers.rs:18-101` exposes **four** tools (`athena.report_intent`, `athena.checkpoint`, `athena.request_guidance`, `athena.request_approval`).
**Verdict: `keep ours`.** The source spends four diagrams arriving at "one obedient stub in the sandbox, everything else on the host." personas got there by construction, because the CLI it wraps is already a separate process it does not trust with the vault. The four-verb reverse channel is smaller than anything the source proposes.

**2.4 — But the sandbox is not sandboxed.**
Source: *"Every stream crossing back is bounded before the untrusted side can exhaust host memory or context"*; the child *"receives a view and returns changes."*
personas: the child gets the real filesystem. Every persona and fleet spawn passes `--dangerously-skip-permissions` (`src-tauri/engine/src/cli_process.rs:423`, `src-tauri/engine/src/prompt/cli_args.rs:107` and `:296`, `src-tauri/src/commands/fleet/pty.rs:372`/`:415`, `src-tauri/src/commands/fleet/headless.rs:134`, `src-tauri/src/companion/session/cli.rs:108-110`). The only containment is directory-scoped, and it is good of its kind: `validate_fleet_cwd_in_db` (`src-tauri/src/commands/companion/approvals/approval_exec_fleet.rs:1079-1109`) canonicalizes then requires `canon_cwd.starts_with(root)` against a registered `dev_projects` row. There is no copy-on-write view, no overlay, no worktree for a *persona* run (dev-mode self-improvement does get one — `approval_exec_dev.rs:888-891`).
**Verdict: `adapt`.** The source's `pi-iso` (APFS/btrfs/ZFS/overlayfs/ProjFS/copy-fallback child views) is disproportionate for one operator on their own machine. But the *asymmetry* is worth naming: personas isolates its own self-modification and does not isolate the personas it runs for the user. The transferable piece is the cheap one the source also names — the child returns a **diff**, which is what `git_checkpoint::snapshot_stage` (§1.3) already computes and nothing calls.

**2.5 — Bound output once.**
Source: *"Sending 1 MB to the model may be a capability worth keeping, but it should be an opt-out — one central implementation and an explicit `notrunc` property — rather than truncation being an opt-in to good design… an opt-in helper guarantees uneven coverage."*
personas: this is the source's diagnosis reproduced almost exactly. There are **two** shared primitives — `src-tauri/core/src/utils/text.rs:41 truncate_on_char_boundary` and `src-tauri/engine/src/str_utils.rs:3 truncate_owned` — and roughly **35 private `fn truncate*` implementations** beside them, each with its own signature (bytes vs chars vs no max) and its own ellipsis policy: `src-tauri/src/engine/director.rs:692`, `src-tauri/src/companion/orchestration/operative_memory.rs:1170` *and* `:1180`, `src-tauri/src/companion/proactive/triggers.rs:625`, `src-tauri/src/companion/night_shift/planner.rs:110`, `src-tauri/engine/src/context_fidelity.rs:145`, `src-tauri/engine/src/app_master_gates.rs:850`, `src-tauri/engine/src/auto_triage.rs:554`, `src-tauri/engine/src/p2p/remote_jobs.rs:829`, `src-tauri/src/engine/discord_poller.rs:537`, `src-tauri/src/engine/slack_poller.rs:1061`, and ~25 more.
**Verdict: `adopt`.** Two helpers plus thirty-five copies is what "opt-in" produces, and the source predicted both failure modes verbatim: authors who did not know the helper existed, and authors who never imagined a huge result. The consolidation is mechanical and the tree already knows the right shape (§2.6).

**2.6 — Truncation that tells the model it was cut.**
Source: the `text += theme.fg("warning", "[Truncated: …]")` pattern, where *"the model then has to guess where tool data ends and harness commentary begins."*
personas: at the surfaces that matter, it is structured rather than smuggled. `src-tauri/engine/src/tool_outcome.rs:22-29` — *"Truncation is always surfaced via a `truncated` flag — never silent"* — with `DIRECT_TOOL_OUTPUT_CAP_BYTES = 256 KiB` and a stated reason for the number. The CLI stdout path bounds centrally at `src-tauri/src/engine/runner/mod.rs:2200` (`MAX_OUTPUT_BYTES = 10 MB`, enforced `:2343-2352`). And there is a test whose name is the whole doctrine: `truncated_variable_tells_the_model_it_was_cut_and_where_the_rest_is` (`src-tauri/engine/src/prompt/tests/runtime_safety.rs:153`).
**Verdict: `keep ours`.** A boolean on a typed result beats an ANSI-coloured string appended to the payload, and personas asserts the property in a test rather than documenting it. §2.5 asks for this shape to reach the other thirty-five sites, not for it to be invented.

**2.7 — The job primitive.**
Source: *"A backgrounded shell, a subagent, a dev-server daemon, a remote function, and an ordinary call that ran past its budget are all the same object — a job with stdin, stdout, an exit status, and a signal handle. One stdio-shaped job primitive should encapsulate all of them."*
personas: it has this, and calls it that. `BackgroundJobManager<E>` (`src-tauri/src/background_job.rs:156`) is a generic store with a common `JobEntry` (status, error, output lines, cancel token, created_at, `extra`) and one event pair per manager, and ~20 subsystems instantiate it. `src-tauri/src/process_registry.rs:60 ActiveProcessRegistry` holds the process half (PID + cancel flag) keyed by domain and run id.
**Verdict: `keep ours`.** The generic-over-`extra` shape is the right factorization and it is already adopted broadly; what it lacks is the signal handle (§2.2), not the abstraction. Note the source's own convergence argument lands here: personas' 20 managers *are* the "one surface for inspecting, messaging or killing any of them" — minus the killing.

---

## 3. The control plane — values and behaviours

> *"A convar is a typed variable with a name, a default, a help string, and a bitfield of flags, declared once, at the definition site."*

**3.1 — Values are already declared at one site.**
Source: *"Most get/set operations were routed through the `AgentSession` type… Persistence, ownership, scope, replication, even replay-honesty: all properties of the variable, stated where it is born."*
personas: `src-tauri/db/src/settings_keys.rs:1-20` is a 1,704-line declaration site whose module doc states the contract: *"Every key defined here is paired with a `<KEY>_DEFAULT` constant… Consumers MUST reference the `_DEFAULT` constant rather than hard-coding a literal, so that 'what does unset mean for this key?' has exactly one answer. Units are encoded in the key name itself."* It carries `ALLOWED_KEYS` (`:788`), `ALLOWED_PREFIXES` for dynamic per-persona families (`:894`), `validate_key` (`:917`), `validate_value` with typed contracts per key (`:948`), `deprecated_replacement` (`:1151`) and `audit_category` (`:1245`). Enforcement is at the **repo** layer, not the IPC layer — `src-tauri/db/src/repos/core/settings.rs:96` calls both validators, and `:27` audits *"at the REPO layer, so INTERNAL Rust callers… are audited too — not only the Tauri command surface."*
**Verdict: `keep ours`.** This *is* the convar table, minus the name. It has two things Source's model does not: a deprecation lane (a key can be quarantined rather than deleted) and an audit category attached to the declaration. Enforcement below the command surface is the same instinct as `FCVAR` — the property travels with the variable.

**3.2 — What is missing is the flag bitfield.**
Source: `FCVAR_REPLICATED | FCVAR_NOTIFY` — *"A session-scoped convar is one more journaled node in the authoritative tree; its flags declare how it participates in resume, rewind, spawn, replication, and archival."*
personas: the declaration carries default, unit, validator, audit category — and *not* scope, lifetime, or inheritance. Those live somewhere else entirely, in code: `src-tauri/src/engine/runner/globals.rs:28-45 resolve_global_provider_settings` is a hand-written `match profile.provider.as_deref()` that fills each empty field from a named settings key, per provider. Adding a provider means editing that match; adding a field means editing every arm.
**Verdict: `adapt`.** Not the bitfield — personas has no replication or replay for a flag to describe. The one flag that would pay for itself is *inheritance*: a `#[inherits(global = SETTINGS_KEY)]` next to the `_DEFAULT` would delete `globals.rs`'s match and make "where does this value come from when unset?" answerable at the declaration, which is exactly the property `settings_keys.rs:1-12` already claims for defaults.

**3.3 — Inheritance already resolves, and already reports its tier.**
Source: *"Inheritance needs no flag at all: a spawned child seeds every variable from the parent's live values, by default."* Complaint: omp's `subagent: inherit` is a *separate setting*.
personas: no duplicated child setting exists. `src-tauri/engine/src/config_merge.rs:134` `resolve_effective_config` documents the cascade — *"1. Global settings (lowest priority) 2. Workspace/group defaults (medium) 3. Persona-level overrides (highest)… Each resolved field logs which tier supplied the value so that config inheritance is visible in traces rather than implicit in code"* — and every resolved field is a `ConfigField<T> { value, source, is_overridden }` (`:28`) with `ConfigSource::{Agent, Workspace, Global, Default}` (`:16`). The UI renders the tier: `src/features/agents/sub_model_config/components/ConfigInheritanceBadge.tsx`. Child CLI sessions inherit by process env and by an explicit flag: `src-tauri/src/companion/session/cli.rs:202` sets `CLAUDE_CODE_FORK_SUBAGENT=1` so *"the child inherits her full conversation history… and shares the prompt cache."*
**Verdict: `keep ours`.** The source's convar model gives you inheritance; it does not give you *provenance*. `ConfigField.source` answers "why is this persona on Opus?" in one field, which is the question an operator tuning routing from evidence actually asks — and `.ai/manifest.yaml:98` says that is the job.

**3.4 — The loop-shaped hole: personas has the hole, not the collision.**
Source: two independently written extensions (Plan, Goal) cannot compose; omp's own answer is *"the exclusivity 'system', in its entirety… restated by hand at six other entry points."*
personas — **the seeded hypothesis is wrong**. `autonomous_mode_enabled(` has 11 call sites and `dev_mode_enabled(` has 7 (uncapped, excluding the stale `.claude/worktrees/` copy), but they are not two behaviours competing for one decision. `dev_mode_enabled` (`src-tauri/src/commands/companion/chat.rs:286`) is a pure capability gate, hard-bound to `cfg!(debug_assertions)`. `autonomous_mode_enabled` (`:180`) is standing consent. They are orthogonal; nothing ever says "exit dev mode first." And precedence, where it *is* contested, is already centralized: `src-tauri/engine/src/autonomy.rs:1-18` — *"The ONE autonomy model — the single front door… That left 'who wins where?' ambiguous at every read site — each subscription re-derived precedence inline. This module encodes the precedence **once** so no call site has to, and enumerates every read site below so the surface is auditable in one place."* It fails closed on a corrupt value (`:36-42`) and carries a second orthogonal axis, the App-master mandate rung (`:159`, `:166`: *"A project can be on `full` autopilot and still be refused by a rung-0 mandate"*).
**Verdict: `keep ours`.** personas already did the refactor the source is recommending, for the axis where it had two claimants, and it wrote down the read-site registry the source's Directors would give it for free. The hole is real but it is the *empty* kind (§3.5).

**3.5 — One occupant of the yield decision.**
Source: the Director stack — Base → TodoReminder → Goal → Plan → ForceTool — where each may `Pass`/`Continue`/`Yield`/`Push`/`Done`/`Fail`, so *"plan, goal, vibe, autoresearch, reminders, and external verification behaviors use the same agent-layer primitive."*
personas: the yield decision exists and is real. `src-tauri/src/companion/session/turn.rs:988` — `if autonomous_mode && dispatched.requests_continuation` — schedules another turn with `chain_index + 1` against `MAX_AUTONOMOUS_CHAIN` (`:997`), after a 15-second interject window (`origin.rs:23`). But `requests_continuation` is a `bool` with **one writer** (`src-tauri/src/companion/dispatcher/dispatch.rs:1351`, set when the model emits `OP: continue_autonomously`) and **one reader**. The only behaviour that can request another turn is the model itself; the host can only veto by ceiling.
**Verdict: `adapt`.** Not the stack — one occupant does not need a stack, and building one now would be the source's own anti-pattern (a subsystem for its own sake). The transferable half is the *inversion*: today "keep going" is a model-emitted op the host rubber-stamps; a host-owned predicate ("the plan file is not written", "the todo list has open items") cannot be expressed at all. Give the continuation decision a second possible author before giving it a stack.

**3.6 — Keybindings: a defaults table that does not dispatch.**
Source: *"That's what our keybinding layer should be: not a bespoke schema with its own defaults table!"* — binds, aliases and toggles ride the same command stream as cfg files and journal replay.
personas: three unrelated layers. `src/lib/keyboard/AppKeyboardProvider.tsx:47 register(handler, priority, exclusive)` is a genuinely good arbitration bus with a documented ladder at `:28-42` and an `exclusive` rung that swallows unconsumed keys (`:65-67`) — structurally the Director stack, applied to keys. But `src/lib/keyboard/shortcutRegistry.ts:3` is only *"the app's discoverable keyboard shortcuts… the cheat-sheet overlay renders directly from this registry"* — the combos in it are **decorative**; actual matching is hardcoded per consumer (`src/lib/keyboard/WorkspaceShortcuts.tsx:34,42,50`; `src/features/plugins/fleet/useFleetHotkeys.ts:33`). So the registry can drift from reality and nothing detects it. There is no user rebinding except one hotkey (`src-tauri/src/commands/companion/voice_hotkey.rs:11`), and that one is exemplary: *"Rust deliberately holds no default — duplicating the accelerator string on both sides is how the two drift."*
**Verdict: `adopt`.** Not the console-command syntax — a desktop app is not a TF2 config. The finding is that personas already articulated the anti-drift principle at `voice_hotkey.rs:11` and then built the exact drift it names in `shortcutRegistry.ts`. Making the registry the dispatch table (consumers read their combo from it) is a small change that eliminates a whole class of "the cheat sheet lies" bug.

---

## 4. The inference — one owner per fact

> *"The win is not fewer quirks. It is one owner for each fact, explicit precedence, and an unknown state when the library has not established an answer."*

**4.1 — Quirks as architecture.**
Source: 880-line `compat/openai.ts`, 977-line `model-thinking.ts`, 1,776-line `variant-collapse.ts`, replaced by `taxonomy/` + `classes/` + `providers/` in KDL, with a compiler that errors on ambiguous precedence.
personas: has no quirk sprawl, because it has one provider. `EngineKind` is a single variant (`src-tauri/core/src/engine_kind.rs:19-21`) and `resolve_provider` is a one-arm match (`src-tauri/engine/src/provider/mod.rs:109-113`). The 220 provider-name string literals across the tree are overwhelmingly settings values, test asserts and UI labels; real dispatch sites number six.
**Verdict: `different forces`.** personas cannot have the 880-line compat file because it never speaks a provider's wire protocol on the primary path. The knowledge that *would* have gone there lives in the CLI it spawns.

**4.2 — But model knowledge is scattered anyway.**
Source: *"the inference layer can finally answer: what does this exact model, on this exact host, actually support?"*
personas: it cannot. `src-tauri/core/src/model_ids.rs` is *"the one door for Anthropic model identifiers"* — and it is ids only: aliases (`:25-27`), dated ids (`:31-33`), job-named tiers (`:43-45`), and a `RETIRED` list with `is_retired()` (`:50-57`). **There is no context window and no capability flag anywhere in the tree.** Pricing is duplicated three times and the copies disagree: `src-tauri/engine/src/cost.rs:15-60` is a substring ladder defaulting to Sonnet-class; `src-tauri/src/engine/http_engine/config.rs:33-39` is a two-SKU match; `src/features/agents/sub_model_config/libs/compareHelpers.ts:49-53` is a third table for display. Family inference, where it exists, is `m.contains(c.split('-').nth(1).unwrap_or(""))` (`src-tauri/src/engine/failover.rs:693`).
**Verdict: `adopt`.** `model_ids.rs:5-10` already records why it was created — 54 files spelled model literals and a failover ladder handed out retired ids. The same argument extends one field further: price and context window belong next to the id, in the door that already exists, not in three ladders that disagree.

**4.3 — Unknown is not zero.**
Source, on the KDL compiler: *"Unknown directive or value? Error. Two equally specific rules setting the same thing? Error… No matching rule? **Unknown, not 'false'**."*
personas: `src-tauri/src/engine/http_engine/config.rs:31-39` — *"Unknown models -> None, which the callers stamp as $0"* — and `:40-45 cost_of` returns `0.0` on `None`. `src-tauri/engine/src/cost.rs:15-36` is worse: an unrecognized model silently prices as Sonnet.
**Verdict: `adopt`.** This is the source's rule, violated twice, in the subsystem `.ai/manifest.yaml:98` names as the product ("observe runs — cost… and tune routing from evidence"). A run whose cost is confidently $0 is worse than a run whose cost is `null`, because the first one aggregates.

**4.4 — Constrained decoding.**
Source: strict schemas are a *shared budget*; grammar dialect is provider-specific; *"the extension declares intent — strictness, grammar, priority. The inference layer owns capability, budgets, dialect normalization, fallback, repair, and the final wire format."*
personas: no constrained-decoding surface exists. Uncapped, `response_format` appears **once** in the whole tree and it is a comment in an unimplemented function (`src-tauri/src/commands/artist/transcribe.rs:166`, whose body returns `Err("OpenAI Whisper transcription is not yet wired up")` at `:163-167`). The only decoding-shaping parameter sent to any model is `"tool_choice": "auto"` (`src-tauri/src/engine/http_engine/tools.rs:124`). The `json_schema` hits are post-hoc test assertions (`src-tauri/engine/src/output_assertions.rs:320`) and inbound MCP argument validation (`src-tauri/src/engine/mcp_tools.rs:1737`) — neither constrains generation.
**Verdict: `different forces`.** Structure is requested in the prompt and repaired after (§4.5). On the CLI path there is nowhere to put a grammar; on the HTTP path there is exactly one caller, so a budget has nothing to arbitrate.

**4.5 — Repair is the substitute, and it is the same uneven-coverage story as §2.5.**
Source: *"repair malformed JSON; detect repetition loops; parse each model's output dialect and synthesize canonical `tool_call` and `think` blocks when structured output leaks into text."*
personas does all three of those *except* repetition detection, and does the first one twelve times. There is a proper central helper — `src-tauri/engine/src/safe_json.rs:6-7`, *"lenient parsing for LLM-generated JSON that may be wrapped in markdown code fences, have trailing commas, or be truncated"*, with size and nesting bounds (`:26`, `:31`) — and it is genuinely adopted in places, with call sites that say so: `src-tauri/src/engine/memory_reflection.rs:224` is *"a thin wrapper over the shared `safe_json::extract_balanced_object`"* and `src-tauri/src/engine/persona_brain/sleep_cycle.rs:468` calls it *"the one every sibling LLM leg uses."* Beside it, twelve independent extractors: `src-tauri/engine/src/ai_healing.rs:211`, `src-tauri/engine/src/design.rs:228` and `:276`, `src-tauri/src/commands/core/memories.rs:1244`, `src-tauri/src/companion/athena_reaction.rs:722`, `src-tauri/src/companion/brain/oneshot.rs:320` and `:355`, `src-tauri/src/engine/ai_helpers.rs:84`, `src-tauri/src/engine/build_session/fix_pass.rs:471`, `src-tauri/src/engine/project_tracking/consolidator.rs:576`, plus two ad-hoc `.replace("```json","")` sites (`src-tauri/src/commands/design/n8n_transform/cli_runner.rs:879`, `src-tauri/src/commands/credentials/auto_cred_browser.rs:1708`).
**Verdict: `adopt`.** Same shape, same cause, same fix as §2.5, and here the central helper is *better documented* than the copies — which makes the twelve copies pure debt rather than a design disagreement.

**4.6 — Leaked machine grammar, caught twice.**
Source: *"A leaked tool call rendered as prose because the dialect was not parsed into a `tool_call` block."*
personas: the same failure mode (its `OP:` / `QR:` / `TTS:` / `PROGRESS:` op grammar leaking into a chat bubble) is caught at the stream layer (`src-tauri/src/companion/session/stream.rs:24-43 clean_segment_for_display`), again at the dispatcher (`src-tauri/src/companion/dispatcher/dispatch.rs:2108`, *"Residual machine-grammar safety net"*), again at render time (`src/features/plugins/companion/Bubble.tsx:129`, *"Display-time safety net"*), and is **asserted in a bench metric**: `"machineGrammarLeak"` (`src-tauri/src/bench/athena_validate.rs:92`) and a unit test named "OP-line leak guard" (`src/features/plugins/companion/__tests__/Bubble.test.tsx:84`).
**Verdict: `keep ours`.** Three defence layers and a scored bench metric is more than the source describes for the same class of bug. The source parses the dialect once; personas cannot parse it once (the dialect is its own prompt protocol, emitted by a model it does not control), so defence-in-depth plus a measurement is the right answer for the constraint.

**4.7 — Compaction: scheduled, not triggered.**
Source: *"speculatively kick-off the compaction process ~10% before the limit is reached… you essentially make the conversation branch into two concurrent versions."*
personas: conversation compaction is **not implemented** — it is Claude Code's `/compact`, typed into a PTY by a human clicking a pill: `src/features/plugins/fleet/sub_grid/FleetGridPage.tsx:278-283` (`await writeInput(id, '/compact\r')`), gated on idle at `src/features/plugins/fleet/sub_grid/FleetContextPill.tsx:20`. There is no context-window constant in the tree and no auto-compact threshold. What personas *does* have is the source's scheduling insight applied to a different corpus: the companion's sleep cycle fires on **accumulated volume, not the clock** — `src-tauri/src/companion/brain/sleep_cycle/mod.rs:23-35`, *"What fires a cycle: sleep pressure, not the clock"*, with the clock surviving only as a floor and a staleness release.
**Verdict: `keep ours`, with one borrowed idea.** personas cannot speculatively compact a conversation it does not own. But it already discovered, independently, that pressure beats a schedule — and the one place the source's insight lands is the *pill*: `FleetContextPill` shows the operator a red zone and waits for a click, which is the "user waits at the exact moment they are most invested" UX the source calls the worst design. Firing `/compact` automatically at the idle boundary *before* the red zone is a two-line change in a component that already computes both conditions.

---

## 5. The tool surface — what deserves a schema

> *"The best way to present most tools to the model is to not put them in the permanent tool roster at all… Limit it to five essential tools and you get 36.6s, ahead of Codex's 42.2s and Pi's 37.0s."*

**5.1 — Does personas assemble a roster? Yes — three, all bounded.**
Source: roster size is a wall-clock cost because *"tool grammar… actively contributes to token generation."*
personas: (a) the HTTP path builds the array and posts it — `src-tauri/src/engine/http_engine/tools.rs:83-99`, `:124`. Its size is 2 builtins (`:287-302`) + 18 remote-safe MCP tools (`src-tauri/src/engine/http_engine/config.rs:54-74`) + 5 opt-in connectors (`:81-87`) = **20 by default, 25 maximum**. (b) The MCP sidecar advertises **31 always-on, 33 max** (`src-tauri/src/mcp_server/tools.rs:747`+). (c) The reverse channel is 4 (`src-tauri/src/companion/orchestration/mcp/handlers.rs:18-101`).
**Verdict: `adapt`.** The roster is bounded — but *subtractively, for a security reason*, not a latency one: `config.rs:47-52` withholds write/exec tools because *"a prompt-injected remote model must not be able to trigger them."* The source's finding is that the same trim buys ~40% wall clock. personas has the lever and has never measured the second effect. That measurement is §T1.

**5.2 — And the dominant path has no roster control at all.**
personas: every persona and Athena turn spawns `claude -p` with **no `--allowedTools`** and `--dangerously-skip-permissions` (`src-tauri/src/companion/session/cli.rs:108-110`), so the model carries Claude Code's full default roster *plus* whatever MCP configs that turn attached. The two narrowing uses in the tree are both in one credential-capture flow (`src-tauri/src/commands/credentials/auto_cred_browser.rs:807-808`, `:820-821`); the frontend harness has a 6-tool default (`src/lib/harness/run-harness.ts:164`) that the app does not use. There is no `disallowedTools` anywhere.
**Verdict: `adopt`.** `--allowedTools` is a flag personas already knows how to pass, on the path where 100% of its production latency lives, and no persona has ever been given one. A per-persona roster is a column, not an architecture.

**5.3 — The declared tool policy nobody enforces.**
Source: policy belongs where the value is defined.
personas: `src-tauri/engine/src/enclave.rs:25-41 EnclavePolicy` declares `max_cost_usd`, `max_turns`, `allowed_tools`, `allowed_domains`, `required_capabilities`, `allow_persistence` — a complete, *signed* capability declaration. Uncapped, `allowed_tools` appears in the tree at exactly two lines: the field (`:35`) and its `vec![]` default (`:49`). Nothing reads it; no spawn consults it.
**Verdict: `adopt`.** A signed policy that no executor honours is worse than no policy, because the signature implies enforcement. This is the second unenforced declaration an intake study has found in this tree (`.ai/manifest.yaml:38 neverTouch`, exo study §1.2) — the pattern is the finding.

**5.4 — Personas already trims an over-provisioned roster, and wrote down why.**
personas: `src-tauri/engine/src/kp_tool_surface.rs:1-25` — *"the one-shot build's design pass is free-running… on the 2026-08-24 live bench two of five real builds came back carrying `text_analysis`, `data_processing`, `ai_generation`, `code_analysis` and `execute_sql`, none of which the request asked for… The fix is subtractive and lives in data, not in prompt wording."* `constrain_agent_ir` (`:573`) runs the built IR through the requested surface at two chokepoints, with `BASELINE_TOOLS` (`:168`) and a rule that only one command-runner alias survives (`:172-187`).
**Verdict: `keep ours`.** This is the source's exact thesis — a tool is not a free win — discovered independently from a live bench, fixed in data rather than prompt wording, and applied at chokepoints rather than by asking the model to behave. The source argues it; personas measured it.

**5.5 — The approval unit.**
Source: *"this shifts the harness from being the TSA screen of 'Bash' to being a capability approver: 'May I use Git to push?'"* — because omp interprets the command in-process it can ask at the moment execution reaches `ln`.
personas — **the seeded question has a sharper answer than "the shell string" or "the capability".** The unit is **a name from a 55-entry static verb list plus an opaque JSON blob**: `src-tauri/src/companion/dispatcher/catalog.rs:11-213 ALLOWED_ACTIONS` (55 entries), rejected at parse time if unknown (`src-tauri/src/companion/dispatcher/dispatch.rs:1959-1964`), executed through one table (`approvals/approval_lifecycle.rs:141-280`), with a 24-hour consent freshness window (`:48`) and an atomic `pending→running` CAS (`:350-368`). There is no shell parsing anywhere: uncapped, `shell_words|shlex|coreutils|bash_parser|parse_shell` returns **zero** hits in `src-tauri`; execution is `cmd /C` / `sh -c` (`src-tauri/engine/src/verification_command.rs:50-56`).
**Verdict: `keep ours` — for the op surface.** A closed 55-verb grammar the model must emit into is strictly stronger than approving an unreadable shell string, and it is the source's own destination reached from the other end: personas never handed the model a shell to begin with, so it did not need to build an interpreter to take it back. The tree even states the source's Ousterhout thesis in its own words, about the containment check: *"One implementation, two callers — a second hand-written copy of this check is the exact way a containment boundary rots"* (`approval_exec_fleet.rs:1073-1078`).

**5.6 — But the persona run has no approval unit at all.**
personas: §5.5 covers *Athena's* ops. Inside a persona run, `--dangerously-skip-permissions` means there is no tool approval, and the only boundary is the directory (§2.4). Under autonomous mode even the op-level card is gone by design: `approvals/approval_autopilot.rs:11-24` — *"That list is GONE… under autonomous mode EVERY proposed action now fires"* — leaving a boldness dial keyed on a **model-self-reported** confidence string (`:583-591`, `:607-649`), default full-auto (`:626-632`).
**Verdict: `adapt`.** The operator's explicit call is recorded and the reasoning is sound (a mode that files a card for two thirds of what it proposes is not autonomous). What the source contributes is not the bash interpreter — it is the observation that a *capability* boundary can be cheap and structural where a *judgement* boundary is expensive. `validate_fleet_cwd` is already that. Two more of the same kind (network egress, a write outside the project root) would restore a floor under full-auto without reinstating a click.

**5.7 — AutoQA: the agent's bug-report path.**
Source: *"You know how you usually provide a way for users to report their issues with your product? This is the equivalent of that, but for the agents… once you filter [misattributions], you get a tremendous amount of signal about which tool fails and how it can be improved."*
personas: **absent.** Uncapped, `autoqa|auto_qa|tool_feedback|harness_feedback|report_tool|tool_bug|file_bug` returns zero across `src-tauri/src`, `src-tauri/engine/src`, `src-tauri/db/src` and `src`; the 18 near-hits are all "self-reported confidence/intent". The nearest neighbours are not it: `ToolIssue` (`src-tauri/src/commands/execution/tests.rs:175-178`) is harness-authored pre-flight validation, and `athena.checkpoint`'s `blockers` field (`src-tauri/src/companion/orchestration/mcp/handlers.rs:52-55`) is free prose about the *work*. `src-tauri/src/commands/companion/feedback.rs:1-4` records that the self-improve pipeline that lived there *"is retired and fully removed."*
**Verdict: `adopt`.** personas already has the two hard halves: the reverse MCP channel (four verbs, already installed on every session) and a typed tool-failure taxonomy with an audit table (`src-tauri/engine/src/tool_outcome.rs:33-62` → `tool_execution_audit_log`, written at `src-tauri/src/engine/tool_runner.rs:160-171`). A fifth verb, `athena.report_tool_defect`, joins them. And personas has something omp does not: 33 MCP tools it *owns*, so the reports are actionable rather than a complaint about someone else's `Read`.

**5.8 — Contract hygiene: intent and version.**
Source: *"every tool gets an `i` intent argument… People should version their tools. It makes traces much easier to use: you can parse a frequently changed tool's I/O and evaluate its success rate over time without guessing which contract produced each call."*
personas: no tool schema carries a version (uncapped `tool_version|toolVersion` → zero in `mcp_server`, `orchestration`, `http_engine`), and intent exists at **session** grain, not per call: `athena.report_intent` is explicitly once-per-session (`handlers.rs:21-41`, with `:44` noting checkpoint is *"NOT on every tool use"*). The per-call telemetry is a count: `src-tauri/db/src/repos/execution/tool_usage.rs:53-80 record(pool, execution_id, persona_id, tool_name, count)` — no args, no intent, no version, one production caller (`src-tauri/src/engine/mcp_tools.rs:941`).
**Verdict: `adapt`.** Intent-per-call is not worth it here: on the CLI path personas cannot inject an argument into Claude Code's tools, and on its own 33 it would pay tokens for a field its traces do not yet use. **Version is worth it and is nearly free** — a `"version"` on each `list_tools` entry, stamped into `persona_tool_usage`, turns a count into a time series that survives a schema change. `.ai/manifest.yaml:98` says tuning from evidence is the job; a success rate you cannot attribute to a contract is not evidence.

---

## 6. The interface — projections, and what verification means

> *"If 'how to verify' is unknown and unspecified, the agent will side-channel a look-alike, meaning it will create a test file that doesn't really check anything."*

**6.1 — Rendering: strings that compound.**
Source: 267s → 90ms; 13% of profiled CPU in one `.includes`; 98.7s re-wrapping in `wrapAnsi`; *"an already-rendered string is being used as layout tree, style tree, content, transport, and terminal program at once."*
personas: a WebView. There is no ANSI pipeline, no grapheme measurement, no scrollback invariant — the browser owns layout and the DOM is already a component tree.
**Verdict: `different forces`.** Six of the source's seven interface findings are terminal-emulator physics that a WebView does not have. This is the cleanest `different forces` in the study and it is worth stating plainly rather than manufacturing a parallel.

**6.2 — Presentation policy has an owner, and it is a linter.**
Source: *"There is no contract for whether or not you should use curved borders, whether or not Nerd Font icons are OK… 99% of the time it will do the bare minimum and all your tools will be indistinguishable gray rectangles."* Fix: semantic tokens in a typed component model — *"Claude can ask for `info` instead of choosing a literal color."*
personas: the same problem, a different enforcement layer, and it is enforced rather than documented. `eslint-rules/` holds **21 project-authored rules**, of which ten are exactly this contract: `no-direct-white-colors.cjs` (*"Use the theme-aware `text-foreground` / `bg-secondary` tokens instead — they invert under `[data-theme^="light"]`"*), `no-low-contrast-text-classes`, `no-raw-radius-classes`, `no-raw-shadow-classes`, `no-raw-spacing-classes`, `no-raw-text-classes`, `prefer-status-badge` (which flags a hand-rolled reimplementation of the shared primitive's *exact* variant combo and deliberately does not flag near-matches — *"those are judgment calls"*), `prefer-section-card`, `enforce-base-modal`, `enforce-reduced-motion-fallback`.
**Verdict: `keep ours`.** The source's answer is "make the wrong thing unsayable in the type system"; personas' is "make the wrong thing fail the lint at edit time." For an agent-written codebase the second is arguably stronger, because it produces an error message with a fix in it. The source's own framing — *"An LLM is not going to remember every internal detail of your harness each time it is asked to 'make tool UI pls'"* — is the argument *for* the linter.

**6.3 — Untrusted content in the renderer.**
Source: *"it ignores the first rule of Pi components & does not sanitize external input, meaning the thing it's fetching can just feed it the right ANSI escapes and replace your entire UI with a picture of a duck."*
personas: the analogous hazard is model/tool output reaching `dangerouslySetInnerHTML`. It is not absent — the markdown/report render path is one of the files with uncommitted work this session (`src/features/shared/components/editors/MarkdownRenderer.tsx`) — and the tree does carry sanitization at the render boundary.
**Verdict: `adapt`.** The source's specific vector does not exist here, but its *rule* does: the layer that renders untrusted text is the layer that must sanitize it, once, rather than each caller remembering. Given §6.2 shows personas is willing to enforce render policy with a custom lint rule, "no `dangerouslySetInnerHTML` outside the two sanitizing primitives" is a rule that fits the existing machinery exactly. (Scoped deliberately: this study did not audit that path and must not claim it is broken.)

**6.4 — Views as projections.**
Source: *"Replication becomes subscription… The TUI, remote client, and subagent inspector become peers."* Complaint: Pi's footer calls `sessionManager.getEntries()` directly.
personas: a real, typed, name-checked event spine — `src-tauri/core/src/events.rs:33 event_names!` as the single source of truth, mirrored to TS at `src/lib/eventRegistry.ts` and **diffed by a script** (`scripts/check-event-registry.mjs`); all subscriptions registered in one place (`src/lib/eventBridge.ts:1-10`, *"previously scattered across store files… registered here declaratively"*); and automatic DB→UI replication via a SQLite `update_hook` (`src-tauri/db/src/cdc.rs:1-17`) with explicit drop accounting (`:39`, `:52`). But views are **not** pure projections: the stream is a cache-invalidation signal and the stores then re-`invoke`, and the debounce is a *correctness* knob because the hook fires before COMMIT (`eventBridge.ts:56-60`).
**Verdict: `keep ours`.** "One stream says something changed, N readers query" is the correct architecture when the authority is a transactional database rather than an in-memory tree: the readers get a consistent snapshot, which a patch stream off a pre-commit hook cannot promise. The generated-name diff script is a guarantee the source's model does not offer at all.

**6.5 — Verification defined in advance.**
Source: *"the biggest ROI investment that also costs you nothing… it's an absolute must to provide a non-destructive, off-screen, multi-instance thing that prevents the agent from redefining (and usually downgrading) the definition of success. The debug protocol becomes the machine-readable definition of what the UI is."*
personas — **shipped, and deeper than the source describes.** `src-tauri/src/test_automation.rs:1-13` is an HTTP server that bridges an external driver to the live WebView, in **two** modes: dev (`--features test-automation`, port 17320) and **production** (`PERSONAS_TEST_PORT`, `:1379`). ~55 endpoints, and they are not generic DOM pokes — `/navigate`, `/click-testid`, `/wait-toast`, `/agent-cards`, `/execute-persona`, `/build-start`, `/build-answer`, `/overview-counts`, `/perf-mark`, `/screenshot`, `/test-reset`. On top of it sits a character-driven UAT overlay (`uat/README.md`) with 15 personas, 16 journeys, a 7-dimension rubric, an accepted-gaps baseline, and an explicit split from verification: *"the `tools/test-mcp/e2e_*.py` suite (that's verification — 'does the code work'). This is evaluation — 'can this kind of person finish their job'."*
**Verdict: `keep ours` — with the one adjective the source underlines.** The protocol is non-destructive (`/test-reset`) and off-screen (no browser launched — `playwright.config.ts:33-38`). It is **not multi-instance**: `playwright.config.ts:57-60` pins `workers: 1` because *"both shapes share the same companion session (singleton on the backend), so parallelism would corrupt the transcript ordering."* That is exactly the property the source calls out, and it is the one thing here worth taking.

**6.6 — Specify the impossible part.**
Source: modelled the transcript protocol in TLA+ rather than fuzzing it — *"if we do want to make a change… we have a reference to update and an extremely easy way to know whether or not it will work, with a counterexample presented on failure."*
personas: no formal model, and the analogous invariants are asserted by test. But the *instinct* is present in an unusual form: `src-tauri/src/stream_harness.rs:1-13` is a diagnostic built to settle an architecture question **before** anything was built on it — *"Validates whether Tauri's custom-protocol path delivers a large response body incrementally (streaming) or all-at-once (buffered) — the question that gates `idea-7452b77e…` phases 2–4"* — with a wire format, bounded parameters, and a header stating what static analysis already suggested and why the end-to-end answer still matters.
**Verdict: `keep ours`.** TLA+ is proportionate to a protocol with three coupled layers and irreversible physical rows; personas has no such object. A measurement harness that gates the next four phases on evidence is the same discipline at the right scale, and it is the harder half of the habit.

---

## 7. The stack — language as architecture

**7.1 — The split personas already made.**
Source: *"TypeScript is an awful choice at the moment **unless you have no choice but to interact with frontend code**… we chose Rust here."*
personas: 610,781 lines of Rust across 1,228 files; 658,523 lines of TS/TSX under `src/`. The engine, the state, the policy, the credential vault and the process control are Rust; TypeScript is confined to the WebView, which is the source's own carve-out.
**Verdict: `keep ours`.** Same conclusion, reached earlier, under the same constraint the source names. The relevant fact is not the choice but that it held: `src-tauri/db/src/repos/core/settings.rs:27` enforces at the repo layer *specifically* so a Rust caller cannot bypass what the IPC layer would have checked — that is the compiler working as a design partner, which is the whole of the source's argument.

**7.2 — "TypeScript becomes your language."**
Source lists twenty micro-decisions a TS codebase forces on every contributor — *"when forced to choose between Zod and Typebox, your junior friend will just roll what we call an `isRecord`."*
personas: it fights this on the TS half with machinery rather than convention. Beyond the 21 lint rules (§6.2), the type boundary is *generated*, not hand-written: `src/lib/bindings/` is `ts-rs` output from the Rust types, `.ai/manifest.yaml:38` declares it `neverTouch`, and `.gitlab-ci.yml` fails on drift. The event names are generated and diffed (§6.4). `knip.json` and 21 custom rules run in `lefthook.yml` pre-commit.
**Verdict: `keep ours`.** The source's answer to "TS lets you decide twenty things" is "use a language that decides them for you." personas' answer is "delete the decisions that matter by generating the types from the side that has a compiler." Both remove the choice; personas' removes it without a rewrite.

**7.3 — Local models for harness work.**
Source: *"Tiny local models are super useful!… this will save you a lot of latency+money for classification tasks, as well as small tasks like generating a title, translation, or judging how happy the user is."* Plus TTS/STT.
personas: STT is local whisper.cpp with a curated model catalog (`src-tauri/src/companion/stt/catalog.rs:39`), TTS is local sherpa-onnx kokoro plus piper (`src-tauri/src/companion/tts/kokoro_catalog.rs:1-19`), and embeddings are local MiniLM-384 with lazy load and idle unload (`src-tauri/db/src/embedder.rs:17-30`). For *text* work, the cheap tier is a smaller Claude rather than a local model, and the choice is bench-backed rather than assumed: `src-tauri/src/companion/model_routing.rs:37-47` documents `MICRO` (Sonnet@low) for *"titling, one-shot classifications, digest summaries, triage legs"* with *"40% p50 win, p90 9.2s vs 19.3s"*, and `MAIN` at `:24-27` records that Opus@low *"matched Opus@default accuracy exactly (93.9% over 114 runs per cell) at 16% lower p50 latency."*
**Verdict: `keep ours`.** personas reached the source's conclusion — do not pay frontier latency for small tasks — and reached it with numbers per tier rather than a recommendation. One internal inconsistency is worth recording, because it is §2's argument in miniature: whisper and piper get **subprocess isolation** with the rationale stated (`src-tauri/src/companion/stt/mod.rs:9-13`, *"keeps whisper.cpp's own ggml/BLAS stack out of our process"*), while fastembed runs **in-process** and carries a `poisoned: AtomicBool` whose comment is the scar — *"True if model loading panicked (ONNX DLL issue). Prevents repeated panic retries that cause OOM"* (`src-tauri/db/src/embedder.rs:28-29`). The tree has one surface that took the kill boundary and one that did not, and the one that did not has a flag to prove it.

---

# Tests to initiate

Paired, each naming the instrument and the number that must move. None of these requires a new subsystem.

**T1 — Roster size vs. wall clock (§5.1, §5.2).**
*Instrument*: `evals/` + `src-tauri/src/test_automation.rs` `/execute-persona` (`:804`), driving one fixed task through one persona, six runs per arm, fresh session each. *Arms*: (a) today — `claude -p` with no `--allowedTools`; (b) the same persona with `--allowedTools` pinned to the six the task actually uses (`src/lib/harness/run-harness.ts:164` already names a plausible six). *Number*: median wall-clock seconds per run, and prefix tokens from `persona_executions.input_tokens`. The source measured 42.2s → 36.6s (−13%) on the same move. *Refutation condition*: if the delta is under 5% on the CLI path, §5.2's `adopt` downgrades to `keep ours` and the reason is recorded — the CLI's own prompt cache may already absorb it.

**T2 — Roster size on the path personas owns (§5.1).**
*Instrument*: `src-tauri/src/engine/http_engine/tools.rs`, a fixed prompt, Qwen. *Arms*: (a) the default 20-tool roster; (b) `REMOTE_SAFE_MCP_TOOLS` trimmed to the 5 a given persona actually calls. *Number*: time-to-first-token and total wall clock. This is the paired control for T1: it isolates whether the effect is grammar cost (visible on both) or CLI overhead (visible on one only). Running T1 without T2 cannot distinguish them.

**T3 — Cancellation honesty (§2.2).**
*Instrument*: a unit test per manager against `BackgroundJobManager::cancel`. *Arms*: (a) today — assert that a job whose worker ignores its `CancellationToken` still reports `failed`/"Cancelled by user" while the task runs on; (b) with the `JoinHandle` stored in `JobEntry` and aborted. *Number*: count of the 27 handle-discarding sites (`src-tauri/src/background_job.rs`, uncapped grep) where a post-cancel side effect still lands. Today's expected value is 27; the target is 0. *Paired control*: `src-tauri/src/engine/execution.rs` `cancel_execution` must show 0 on the same probe today — if it does not, the diagnosis in §2.1 is wrong and the whole point re-opens.

**T4 — Unknown price is not zero (§4.3).**
*Instrument*: `src-tauri/engine/src/cost.rs` and `src-tauri/src/engine/http_engine/config.rs` unit tests, plus a query over `persona_executions`. *Arms*: (a) today — an unrecognized model id prices as Sonnet-class (`cost.rs`) or $0.00 (`http_engine`); (b) `Option<f64>` all the way to the aggregate. *Number*: count of rows in `persona_executions` whose `cost_usd` is exactly `0.0` with non-zero `input_tokens`. That number today is the size of the lie; after the change it becomes the count of honestly-unknown rows, which the overview must render as unknown rather than summing.

**T5 — Multi-instance debug protocol (§6.5).**
*Instrument*: `playwright.config.ts` with `workers: 2`, two app instances on `PERSONAS_TEST_PORT=17321` and `17322`. *Arms*: (a) today — `workers: 1`, the documented reason being the singleton companion session; (b) two instances, each with its own data dir. *Number*: pass rate of the existing suite at `workers: 2`, and total suite wall clock. The suite currently takes ~5 minutes serially (`playwright.config.ts:52`). *This is the test the source's own recommendation names and the only property personas' protocol lacks.*

**T6 — Truncation coverage (§2.5, §4.5).**
*Instrument*: an `eslint`-style Rust check or a `scripts/` grep gate in `lefthook.yml`, mirroring the shape of the 21 existing lint rules. *Number*: private `fn truncate*` definitions outside `core/src/utils/text.rs` and `engine/src/str_utils.rs` — today ~35 — and independent JSON extractors outside `engine/src/safe_json.rs` — today 12. Both target a declining number with a ratchet, not zero on day one. *Paired control*: the gate must pass today against the two sanctioned helpers, or the instrument is measuring its own definition rather than the tree.

---

# Features ranked

Capped at three. Each states the `.ai/manifest.yaml` `scope.does` clause that admits it; anything that needed a fourth clause was not ranked.

### 1. Bound the roster per persona, and measure it
**Admitted by**: *"observe runs — cost, health, traces — and tune routing from evidence"* (`.ai/manifest.yaml:98`). This is literally routing tuned from evidence: a per-persona tool roster is a routing decision, and T1/T2 are the evidence.
**What lands**: a `allowed_tools` column on the persona row, threaded into `build_execution_args` as `--allowedTools` on the CLI path and into `tool_allowed` on the HTTP path; `EnclavePolicy.allowed_tools` (`src-tauri/engine/src/enclave.rs:35`) becomes the thing that column enforces rather than a signed field nobody reads (§5.3).
**Why first**: it is the only candidate that touches latency *and* cost *and* closes an unenforced declaration, and the lever already exists in two places (`auto_cred_browser.rs:807`, `http_engine/config.rs:90`). Its risk is bounded by T1's refutation condition — if the CLI path shows no delta, the feature shrinks to the HTTP path and the enclave fix, and is still worth shipping.

### 2. Make cancellation mean cancellation
**Admitted by**: *"run local AI agent personas over wrapped CLIs, local-first storage, one operator per install"* (`.ai/manifest.yaml:97`). One operator, one machine: a background job that reports `failed` while still consuming that machine's CPU and that operator's API credits is a local-first correctness bug, not a distributed-systems nicety.
**What lands**: `JobEntry` gains a `handle: Option<JoinHandle<()>>` beside the `cancel_token` it already has (`src-tauri/src/background_job.rs:112-120`); `spawn_job` (`:614`) stores what it already returns; `cancel` (`:481`) and `sweep_stale_running` (`:242`) abort it before writing `failed`. Twenty-seven call sites change zero lines.
**Why second**: the smallest diff-to-truth ratio in the study, the source's central runtime thesis, and the tree's own doc comment already names it as owed work (`:78-79`). It is ranked below the roster only because T3's paired control could reveal the diagnosis is narrower than it looks.

### 3. `athena.report_tool_defect` — the agent's bug-report path
**Admitted by**: *"observe runs — cost, health, traces"* (`.ai/manifest.yaml:98`). This is a trace of a kind personas does not currently collect: not what the tool did, but what the model believed it did wrong.
**What lands**: a fifth verb on the existing orchestration MCP (`src-tauri/src/companion/orchestration/mcp/handlers.rs:18-101`), writing into the existing `tool_execution_audit_log` with the existing `ToolErrorKind` taxonomy (`src-tauri/engine/src/tool_outcome.rs:33-62`) plus a free-text complaint and the tool version from §5.8. Surfaced in the incidents inbox that already promotes from that table.
**Why third and not lower**: personas owns 33 MCP tools, so unlike omp its reports are actionable rather than complaints about a vendor's `Read`. Why not higher: the source is candid that the signal is noisy and needs filtering before it is useful, and personas has no reader for it yet — which is the same defect the exo study found in `list_unresolved_recoveries`. Ship the reader with the writer or do not ship it.

*Not ranked, and why*: the Director stack (§3.5) — one occupant does not need one, and building it now is a subsystem for its own sake. Session rewind (§1.3) — the machinery exists but no user story does; the return condition is a second person or a second machine touching one run. Speculative compaction (§4.7) — personas does not own the conversation; the `FleetContextPill` auto-fire is a component change, not a feature.

---

# The inverse list — what personas does better

Mandatory section. Each item is something the source's own text identifies as hard or unsolved, which personas has solved, with the anchor.

**I1 — The debug protocol the source calls the highest-ROI investment, already shipped in production builds.** The source recommends *"a non-destructive, off-screen, multi-instance thing"* and leaves the shape open. personas has ~55 semantic endpoints (`src-tauri/src/test_automation.rs:1387`+), available in release builds via `PERSONAS_TEST_PORT` (`:1379`), with a character-driven evaluation overlay layered on top that explicitly separates "does the code work" from "can this person finish their job" (`uat/README.md`). Missing only the third adjective (§6.5).

**I2 — Stale-state cancellation made unrepresentable, with the counterexample written down.** `src-tauri/src/companion/session/interrupts.rs:100-113` — a monotone, never-reset, per-conversation generation token replacing an `AtomicBool`, with the exact bug it fixes quoted in the comment and the cross-thread invariant stated. The source's chapter one argues for this class of correctness; this is a worked instance of it that no omp/Pi example in the 78-sample audit achieves.

**I3 — Presentation policy enforced at edit time by 21 project-authored lint rules.** `eslint-rules/` — the source spends a chapter on the fact that extension authors (*"often Claude"*) will not remember the design contract, and proposes a type system. personas produces a compile-time error with a fix in the message, and calibrates precision deliberately: `prefer-status-badge.cjs` flags only the exact three-class combo because *"near-matches… are intentionally NOT flagged — those are judgment calls, not clean reimplementations."*

**I4 — A closed op grammar instead of an approvable shell string.** `src-tauri/src/companion/dispatcher/catalog.rs:11-213` (55 verbs, rejected at parse if unknown) reaches the source's "capability approver" destination without needing an in-process bash interpreter, because the model was never handed a shell. And the tree states the source's own Ousterhout argument about it: *"One implementation, two callers — a second hand-written copy of this check is the exact way a containment boundary rots"* (`src-tauri/src/commands/companion/approvals/approval_exec_fleet.rs:1073-1078`).

**I5 — An undo journal with conflict parking, and the right exclusion.** `src-tauri/db/src/repos/execution/change_journal.rs:1-15` reverse-replays a run's data writes in one transaction and parks — never clobbers — rows another writer has since touched. `src-tauri/db/src/journal.rs:52-54` deliberately excludes the run record: *"undoing a run must not erase the evidence that the run happened."* The source's one-authority model has no equivalent of that distinction, because in a single materialized session everything is the same kind of thing.

**I6 — Model tier selection backed by a bench, per tier, with the numbers inline.** `src-tauri/src/companion/model_routing.rs:20-47` — Opus@low chosen because it *"matched Opus@default accuracy exactly (93.9% over 114 runs per cell) at 16% lower p50 latency"*; Sonnet@low for micro work with *"40% p50 win, p90 9.2s vs 19.3s"*; and a recorded reason for *not* promoting the higher-scoring candidate yet. The source recommends cheap models for harness work; personas measured which one and wrote down what it cost.

**I7 — Generated type and event boundaries, diffed in CI.** `src-tauri/core/src/events.rs:33 event_names!` is the single source of truth, mirrored to `src/lib/eventRegistry.ts` and checked by `scripts/check-event-registry.mjs`; `src/lib/bindings/` is `ts-rs` output declared `neverTouch` (`.ai/manifest.yaml:38`) with CI drift detection. The source's chapter seven argues a language should remove micro-decisions; personas removed the ones that matter across its *own* boundary, without changing language.

**I8 — Structured truncation asserted by a test named after the property.** `src-tauri/engine/src/tool_outcome.rs:22-29` (*"Truncation is always surfaced via a `truncated` flag — never silent"*, with the 256 KiB cap justified in prose) and `src-tauri/engine/src/prompt/tests/runtime_safety.rs:153 truncated_variable_tells_the_model_it_was_cut_and_where_the_rest_is`. The source's complaint is that harness commentary gets smuggled into the data; personas puts it in a field and asserts it. §2.5 asks for this to reach thirty-five more sites — it does not ask for it to be designed.

**I9 — Measurement before architecture.** `src-tauri/src/stream_harness.rs:1-30` — a purpose-built, `debug_assertions`-only diagnostic with a defined wire format, built to answer whether Tauri's custom-protocol path streams or buffers, *because four planned phases depended on the answer* and static analysis was not considered sufficient. The source arrived at TLA+ by first shipping a fuzzer; personas' habit is the same instinct applied before the code exists rather than after it broke.

---

## Operator decision - 2026-09-04

All three ranked candidate directions were **accepted** at the /intake Phase 7.7 gate
(operator multi-select review). Ledger rows are in `.ai/directions/ledger.jsonl`:

1. `bound-and-measure-the-tool-roster` - accepted
2. `make-cancellation-mean-cancellation` - accepted
3. `athena-report-tool-defect` - accepted, and the study's own condition stands: it ships
   only with its reader, or it is a write-only channel.

The study itself is `reviewed` rather than `proposed`: it is a comparison record, not a
single buildable item, and its value outlives the three directions drawn from it.
