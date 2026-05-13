# Runner-level lifecycle hooks — design exploration

> **Status:** design-only. No code in this commit. Future session executes against this doc.
>
> **Origin:** `/research` run on OpenAI Symphony (2026-05-09, video `n8qDKMPpLXc`). Symphony's primary configuration surface IS its lifecycle hooks (`create_after`, `run_after`) — the value prop the user sees in the demo is "wire your own steps around the agent run." Personas explicitly does **not** have a runner-level hook surface today (see `.claude/codebase-stack.md` §2: "There is no `pre_tool_call` / `post_tool_call` / `pre_llm_call` / `post_llm_call` / `on_session_start` / `on_session_end` plugin hook system at the personas Rust layer"). This doc explores three shapes the surface could take.
>
> **Companion finding shipped in same session:** `auto_pr_on_success` flag + `task_executor` wiring (see `commands/infrastructure/task_executor.rs::try_auto_pr_after_success`). That's a *hardcoded* lifecycle step. This doc considers the *generalised* surface where users compose arbitrary steps.

## What Symphony actually does

- `workflow.md` (YAML frontmatter + Markdown prompt) declares hooks:
  - `create_after`: runs after the per-issue workspace dir is created. Symphony users put `git clone` + `git checkout -b` here.
  - `run_after`: runs after the agent finishes. Symphony users put `git add` + `git commit` + `git push` + `gh pr create` here.
- Hooks are shell commands defined in YAML, executed in the workspace dir, with env vars carrying issue ID, workspace path, etc.
- The hook is the user's escape hatch: if Symphony doesn't ship a feature, you write a 3-line bash hook.

## What we are choosing between

The decision is **what shape the personas hook surface takes**, not whether to build one. Three viable shapes:

### Approach A — `.claude/settings.json` sidecar (extend existing pattern)

`engine/hooks_sidecar.rs` already writes Claude Code's NATIVE hooks (`SessionStart`, `Stop`, `PreCompact`) into a per-execution `.claude/settings.json` to capture session transcripts. Extend that file with personas-level `runner_hooks` keys that personas itself reads back (NOT Claude Code).

**Shape:**
```jsonc
// .claude/settings.json (already written by hooks_sidecar.rs)
{
  "hooks": { /* Claude Code's native hooks — unchanged */ },
  "personasRunnerHooks": {
    "onTaskStart":    [{ "command": "git clone $REPO $WORKSPACE", "timeoutSec": 60 }],
    "onTaskSuccess":  [{ "command": "git push origin $BRANCH" }, { "command": "gh pr create --title '$TITLE'" }],
    "onTaskFailure":  [{ "command": "rm -rf $WORKSPACE" }]
  }
}
```

Personas reads `personasRunnerHooks` from the same sidecar and dispatches the shell commands at the appropriate runner stage.

✅ **Benefits**
- Zero new infrastructure — extends a file we already write
- Symphony-shape: user writes a shell command, personas runs it
- Per-execution scope (each `exec_dir` has its own copy)
- Falls back gracefully (no `personasRunnerHooks` block = no hooks fire)

⚠️ **Risks**
- Shell-out is dangerous: arbitrary commands run with the user's privileges. Same risk class as Claude Code's native hooks but without the centralised `--dangerously-skip-permissions` framing.
- Per-execution sidecar means hooks have to be re-rendered every run — no good place to live for "always run on every task in this project"
- Shells differ across platforms (Windows cmd vs bash) — cross-platform contract is fragile

**Effort:** ~1.5 days. Mostly schema + dispatch wiring. No new tables.

### Approach B — Rust trait registry in dispatch (in-process plugin)

Add a `RunnerHook` trait to `engine/runner/mod.rs`. Plugins (`dev-tools`, `companion`, future ones) register implementations at startup. Each runner stage (`on_task_start`, `on_task_success`, `on_task_failure`, `on_tool_call`, `on_llm_call`) iterates registered hooks and calls them in registration order.

**Shape:**
```rust
// engine/runner/hooks.rs
#[async_trait]
pub trait RunnerHook: Send + Sync {
    fn name(&self) -> &'static str;
    fn stages(&self) -> &[HookStage];
    async fn fire(&self, ctx: &HookContext) -> Result<HookOutcome, AppError>;
}

pub enum HookStage { TaskStart, TaskSuccess, TaskFailure, ToolCall, LlmCall, SessionEnd }

pub struct HookContext { /* persona, task, exec_dir, exit_code, output_lines, ... */ }
pub enum HookOutcome { Continue, Skip, Fail(String) }

// engine/runner/mod.rs::run_persona
for hook in HOOKS.read().filter(|h| h.stages().contains(&HookStage::TaskSuccess)) {
    match hook.fire(&ctx).await { /* ... */ }
}
```

Plugins like `dev-tools` would register `AutoPrHook` (replacing today's `try_auto_pr_after_success`) and any future steps as separate hooks.

✅ **Benefits**
- Type-safe, in-process, no shell escape hazard
- Easy to test — hooks are unit-testable Rust
- Clear ownership: each hook lives in its plugin, not in the runner
- Migration path: today's `try_auto_pr_after_success` becomes the first `RunnerHook` impl, no behaviour change

⚠️ **Risks**
- Less Symphony-shape: users can't add custom shell hooks without writing Rust + a plugin
- Hard-coded set of hooks at compile time; "add a Slack notification step" requires a new plugin or a generic `WebhookHook` impl
- Stage taxonomy locked to what the trait declares — extending stages later means breaking the trait

**Effort:** ~2.5 days. Trait, registry, dispatch, migrate `auto_pr_on_success` wiring, write 1-2 sample hooks.

### Approach C — Hybrid: trait registry (B) + a single `ShellCommandHook` impl that reads YAML config

Take Approach B as the primary shape, then ship one concrete `RunnerHook` impl that loads YAML/JSON configs from a per-project file (`personas-hooks.yml` in the project root, or a row in `dev_projects.runner_hooks_config TEXT`) and runs the listed shell commands. Users get Symphony-shape escape hatch (a shell hook) AND plugin authors get Rust-shape extension points.

**Shape:**
- All of Approach B's trait machinery
- Plus `engine/runner/hooks/shell_command_hook.rs` — one impl that fans out user-defined shell commands keyed by stage
- Per-project config loaded at runner startup, refreshed on file change

✅ **Benefits**
- Best of both worlds: Rust plugins AND user-customisable shell hooks
- The shell hook is just one hook among many — same plumbing
- Clear cost basis: only the shell hook bears the shell-out hazard, and it's opt-in per project

⚠️ **Risks**
- Larger surface to ship in v1 — both trait machinery AND one config-loading impl
- Config schema is its own decision (YAML vs JSON, file vs DB column, per-project vs per-persona)
- The "right" first shell hook to ship is not obvious — auto-PR is already in dev-tools as a hardcoded hook; the value of moving it out is debatable until a second user-supplied hook exists

**Effort:** ~3.5 days. Trait + registry + dispatch + sample hook + shell_command_hook + per-project config schema + tests.

## Recommendation

**Approach B** is the recommended starting point, with Approach C deferred to a follow-up after the trait surface is exercised.

Reasoning:
- **Migration value is highest in B.** Today's `try_auto_pr_after_success` (shipped in this same session) is the perfect first `RunnerHook` impl. Extracting it validates the trait shape against a real working caller.
- **Approach A is a worse Approach C.** Both expose shell-out, but A skips the trait registry entirely — when someone wants a Rust-shape hook later (e.g., the companion plugin wanting to react to task success), there's no architecture to plug into and we end up building B anyway.
- **Approach C is right in the long run, wrong as v1.** The shell-hook config schema is a non-trivial decision (per-project YAML? per-persona DB column? both?), and we don't know yet what shape users prefer. Ship B, watch which trait impls naturally emerge, then add the shell hook as #N+1 with the right shape, not the speculated shape.

## Out of scope for the first execution PR

- **Pre-LLM-call / per-tool-call hooks.** The Symphony surface is task-level only; engine-level intra-execution hooks (`on_tool_call` etc.) are a separate scope and need their own design. Ship task-level first.
- **Frontend UI for hook management.** Hooks are configured via plugin code or future config files, not via a UI. UI is a v2 question.
- **Cross-platform shell normalization.** Approach B has no shell-out, so this question deferrs until C.
- **Hook ordering / dependency declaration.** Registration-order dispatch is enough for v1. If two hooks fight, the plugin authors fix the order. Topological scheduling is a v2 if it ever becomes necessary.
- **Hook timeouts.** Each `RunnerHook::fire` call gets a fixed 30-second timeout in v1; per-hook overrides are a v2 nicety.

## Acceptance checklist for the future execution PR

When this design is implemented, the PR should:

- [ ] Land a `RunnerHook` trait + `HookStage` enum + `HookContext` / `HookOutcome` types in a new `engine/runner/hooks/` module.
- [ ] Wire dispatch into `engine/runner/mod.rs::run_persona` for `TaskStart`, `TaskSuccess`, `TaskFailure`, `SessionEnd`.
- [ ] Wire dispatch into `commands/infrastructure/task_executor.rs::run_task_execution` for the dev-tools task path (mirror the persona-runner sites).
- [ ] Migrate `try_auto_pr_after_success` from `task_executor.rs` to a new `infrastructure::dev_tools::hooks::AutoPrHook` impl. Behaviour unchanged: same gate, same logs, same fields.
- [ ] Document the trait at the top of the new module with one paragraph + a worked example matching the migrated `AutoPrHook`.
- [ ] Add a `runner_hooks` test module with at least: stage dispatch ordering, error-doesn't-fail-the-task semantics (matches today's `try_auto_pr_after_success` contract), and the migrated `AutoPrHook` reproducing today's behaviour.

## What this design does NOT commit to

- Nothing about how the `RunnerHook` trait gets registered (static `LazyLock` vs `AppState`-bound vs ctor macro). Discover the right shape during execution; pick the simplest that passes the tests.
- Nothing about whether `companion` or `twin` plugins should also adopt this immediately. They can — but that's their owners' call. The trait should be available, not mandatory.
- Nothing about the `--dangerously-skip-permissions` framing. Hooks here are personas-level, post-CLI-exit; they have no relationship to the CLI's own permission model.

## How this connects to the Symphony source

The companion finding from the same `/research` run (`auto_pr_on_success` + `try_auto_pr_after_success`) closes the **specific** Linear→PR loop Symphony demoed at [00:05:01]. This document closes the **generalisation** of that loop: the hook surface that lets users compose Symphony's `create_after` / `run_after` shape themselves without each combination being hardcoded into personas.

If only the specific finding ships, personas matches Symphony's headline demo. If this design also ships, personas matches Symphony's underlying configuration model — and surpasses it on type safety and testability.

## v2 scope reference — intra-execution hooks (forward grounding)

Added 2026-05-13 from `/research` run on Hermes Agent codebase (v0.12 + v0.13 releases). Hermes ships a wider hook surface than Symphony's task-level shape. When personas designs v2 intra-execution hooks, the Hermes list is the reference catalogue to evaluate:

| Hook | What it transforms | Real-world use |
|---|---|---|
| `pre_tool_call(ctx) -> Optional[Block]` | Allow blocking / rewriting a tool call before it fires | Approval gating, dangerous-command guard, secret-arg redaction |
| `post_tool_call(ctx, result) -> None` | Observe results — read-only | Audit logging, metrics, anomaly detection |
| `transform_tool_result(ctx, result) -> result` | Reshape tool output before the LLM sees it | Truncation, normalization, citation injection, secret redaction |
| `transform_terminal_output(ctx, output) -> output` | Reshape stdout/stderr from shell tool calls | Strip ANSI, redact env vars, summarize verbose output |
| `pre_llm_call(ctx, messages) -> messages` | Reshape conversation before it goes to the provider | Compression, context-window trimming, persona-specific prepends |
| `post_llm_call(ctx, response) -> None` | Observe LLM response — read-only | Cost telemetry, completion-quality scoring |
| `transform_llm_output(ctx, output) -> output` | Reshape LLM output before it hits the conversation (Hermes v0.13 PR #21235) | Context-window reducers, content filters, format normalization |
| `on_session_start(ctx) -> None` | Fire once when a session begins | Setup, initial context loading |
| `on_session_end(ctx, outcome) -> None` | Fire once when a session ends — outcome carries final state | Cleanup, summary emission, archive triggers |

**Translation to personas' two-channel runner:**
- `pre_tool_call` / `post_tool_call` / `transform_tool_result` land in `engine/runner/mod.rs::run_persona`'s `match &line_type` block (~line 1301), where `StreamLineType::ToolUse` and `StreamLineType::ToolResult` are dispatched.
- `pre_llm_call` is harder under personas' `-p` mode — there's no per-call hook into the spawned `claude` binary's conversation. Skip or relocate to "stream-line pre-emit" if needed.
- `transform_llm_output` could attach to the structured-event channel `Message` arm — would let plugins redact / truncate / inject before the chat surface renders.
- `on_session_start` / `on_session_end` fold into the task-level `TaskStart` / `SessionEnd` already in v1 scope above; don't duplicate.

**Use-case examples worth capturing before v2 design starts:**
- Context-window reducer (Hermes's own use case for `transform_llm_output`): when the model produces a verbose response, plugin trims it before the next turn sees it as history.
- Secret redaction in tool output (Hermes had this as a `redaction.enabled` flag; flipped to off-by-default in v0.12, on-by-default in v0.13 after the corruption-incident pendulum swing).
- Post-write delta lint (Hermes v0.13 PR #20191): a `transform_tool_result` impl for `write_file` / `patch` that parses Python / JSON / YAML / TOML and surfaces syntax errors back to the agent before the next turn.
- Citation injection: a `transform_tool_result` impl for web-search tools that appends source URLs to the output.

**Anti-patterns to avoid in v2:**
- Letting hooks recurse — a `transform_llm_output` that calls the LLM is a footgun. Each hook should be synchronous-ish or have a hard timeout.
- Letting hooks introduce ordering coupling — two hooks each thinking they're "the last to run". v1 says "registration order"; v2 should keep that and let plugin authors fix ordering by re-registration order, not by topological declarations.
- Letting hooks bypass `--dangerously-skip-permissions` framing — a `pre_tool_call` hook that approves dangerous commands silently is its own security problem; treat hook decisions as advisory, not authoritative.

This section is **forward grounding only** — no v2 design commitment. When a concrete personas consumer surfaces (Hermes's "post-write lint" use case is a candidate via N2 of the 2026-05-13 Hermes codebase run, but is itself currently deferred), revisit this list to pick which hooks ship and in what shape.
