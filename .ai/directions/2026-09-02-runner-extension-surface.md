---
subject: software-engineering/agent-runtime-assembly
project: personas
raised_by: intake intake-hermes-0902 (peer comparison)
source: librarian/sources/2026-09-02-hermes-agent.md
stage: execution pipeline — `src-tauri/src/engine/runner/` (dispatch around the four `run_execution` stages and around the `match &line_type` stream arm)
size: 6 files / ~900 lines / M
status: proposed
---

## Why the scope implies it

`.ai/manifest.yaml:97-99` says personas exists to "run local AI agent personas
over wrapped CLIs" and to "observe runs — cost, health, traces — and tune
routing from evidence". Both halves of that sentence land on the same seam and
personas does not have it. Observation today is hard-wired: the runner emits on
two parallel channels (`.claude/codebase-stack.md:161`) and every consumer —
the execution inspector, the replay sandbox, the lab event stream, the
file-change tracker — is a compiled-in subscriber to a fixed variant list, so
adding an observer means editing four files in lockstep
(`.claude/codebase-stack.md:170-173`). Behaviour change is worse: it does not
exist. `.claude/codebase-stack.md:141` states the absence outright — "There is
no `pre_tool_call` / `post_tool_call` / `pre_llm_call` / `post_llm_call` /
`on_session_start` / `on_session_end` plugin hook system at the personas Rust
layer" — and the one hard-coded lifecycle step that does exist,
`try_auto_pr_after_success` in `commands/infrastructure/task_executor.rs`, was
written as a special case because there was nowhere to put it. A design already
exists at `src-tauri/src/engine/runner/HOOKS_DESIGN.md:1` and recommends
Approach B (a Rust trait registry); its §"v2 scope reference" (`:154`) is
literally a catalogue of the peer's hook list, added on 2026-05-13. What that
design does not have — and what this direction adds — is the one decision the
peer got right and both of *its* peers got wrong: **which surface may change
behaviour, and how it says so.**

## What the first context contains

**The module.** `src-tauri/src/engine/runner/hooks/` — a new sibling to
`credentials.rs` / `env.rs` / `globals.rs` / `stages.rs`, with:

- `mod.rs` — two registries, not one. `Observer` and `Interceptor` are separate
  traits registered through separate functions, and the split is the whole
  point: an `Observer::fire(&Ctx)` returns `()` by signature, so "did this
  observer change anything?" is not a question a reader can ask. An
  `Interceptor` declares which of a closed set of points it wraps and returns a
  typed decision — `Proceed`, `Replace(args)`, `Refuse { reason }` — never a
  bare `Result` (veto-by-throw makes a policy denial and a bug indistinguishable
  downstream, which is the failure the peer names and rejects).
- `stages.rs` addition — a `HookStage` enum whose variants are the four the
  design already names (`TaskStart`, `TaskSuccess`, `TaskFailure`, `SessionEnd`)
  and **nothing else**. No stage name enters the enum before a live dispatch
  site exists for it; a declared-but-never-fired stage is the defect the peer's
  own spike found sitting typed-and-dead in a competitor for six months.
- Ordering, stated in the module doc and asserted by a test: an `Interceptor`
  that rewrites an argument runs **before** `scope_enforcement` and before any
  approval path, so the gate evaluates the effective value. Today
  `src-tauri/engine/src/scope_enforcement.rs:16` already records a hole where
  MCP calls bypass the gate; adding a rewrite point on the wrong side of it
  would create a second, worse one.
- Exactly-once wrapping: if an interceptor calls the inner path successfully and
  then fails in post-processing, the inner result is preserved and the tool is
  not re-run. Personas' direct-invocation path (`tool_runner.rs:22`) has no
  idempotency guarantee, so this is not theoretical.
- One migration as proof: `try_auto_pr_after_success` becomes the first
  `Observer` impl, behaviour unchanged, as `HOOKS_DESIGN.md:135` already
  prescribes.

**The boundary — what it must NOT absorb.**

- **The CLI's own hooks.** `src-tauri/engine/src/hooks_sidecar.rs` writes
  Claude Code's native `SessionStart` / `Stop` / `PreCompact` into a per-run
  `.claude/settings.json`. That is a *delegation* to the child's hook system and
  stays exactly where it is; the two must never be merged, because one fires in
  personas' process and the other in the child's.
- **Intra-execution hooks.** `pre_llm_call` has no attachment point under
  `claude -p` — there is no per-call seam inside the spawned binary. The design
  says so (`HOOKS_DESIGN.md:124`) and this context keeps that scope: task-level
  only, plus the stream-line arm for `ToolUse` / `ToolResult` observation.
- **The escape hatches.** Cancellation (`runner/mod.rs:1786`, `:1973`, `:2064`,
  `:2774`) and the resource governor's pause are never hook stages. A slow or
  wrong extension must not be able to become a way to lose control of a running
  execution.
- **Third-party code loading.** Nothing here is dynamic. These are in-tree Rust
  impls registered at startup; personas has no plugin loader and this does not
  add one.
- **The event registry.** `src-tauri/engine/src/event_registry.rs` and the
  structured `EXECUTION_EVENT` channel keep owning what the frontend sees. Hooks
  are a backend seam; they do not become a second event bus.

## The measurable

Three numbers, all available today.

1. **Hard-coded lifecycle steps in command modules.** Count call sites in
   `src-tauri/src/commands/**` that run work conditioned on an execution's
   terminal status. Today's baseline is at least one
   (`try_auto_pr_after_success`); the direction pays off if new such steps land
   as `Observer` impls instead, i.e. the count stays flat while the impl count
   rises.
2. **Files touched to add one observer.** Today: four, in lockstep
   (`.claude/codebase-stack.md:170-173`). Target after: one.
3. **Bypass count on the policy gate.** `scope_enforcement.rs:16` records one
   known bypass. After the interceptor ordering ships, the number of paths that
   reach a credential without passing the gate must be **zero or one**, and
   named — never "unknown".

A census rule is the honest way to hold (1) and (3): a regex over
`src-tauri/src/commands/**` for terminal-status-conditioned work, baselined at
adoption, so a rise is visible at pre-push (`lefthook.yml:99`).

## What would make this wrong

- **If the observer count never exceeds two.** Hermes' own rubric rejects
  "speculative infrastructure — hooks, callbacks, or extension points with no
  concrete consumer" (`AGENTS.md:98`). Personas has exactly one concrete
  consumer today. If, six months on, `AutoPrHook` is still the only impl, this
  bought a trait and a test module and nothing else, and the honest close is to
  delete it — the design doc's own Approach A (extend the sidecar) would have
  been cheaper.
- **If the four stages turn out to be the wrong four.** The design commits to
  task-level stages because that is where the peer's *task*-level analogue
  lives, but personas' interesting events are mid-stream (`ToolUse`,
  `SubagentMessage`, `TaskStarted`). If the first three real consumers all want
  a stream-line stage and none wants `TaskFailure`, the enum was drawn around
  the wrong seam and should be redrawn before impls accumulate.
- **If the ordering claim does not survive a test.** The interceptor-before-gate
  invariant must be provable by a test that fails when the order is swapped. If
  it cannot be written — because `scope_enforcement` runs somewhere the runner
  cannot reach — then the ordering is a comment, not a contract, and the
  interceptor half should not ship at all; the observer half is still worth
  having on its own.
- **If a uniform 30s timeout is wrong for a real stage.** The design plans one
  (`HOOKS_DESIGN.md:129`). That is defensible while every stage is post-hoc. The
  first stage where abandonment has no safe direction — a last-chance flush, or
  anything that gates a credential — falsifies the uniform bound, and the fix is
  an allowlist with a written reason per exemption, not a longer number.
