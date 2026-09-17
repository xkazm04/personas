# The codex maintenance lane (G48)

> Operator decision, 2026-09-15: "we do have large capacity of codex-cli usage with gpt 5.6.
> This model is not so intelligent as you or Opus App masters, but can code and execute
> refactors, technical design/architecture upgrades, balancing code structure and code files.
> We should leverage it for maintaining/optimizing existing code. Ideally each App master
> should run one cli instance as additional worker for such activities, yet App master should
> decide always the scope and whether it is needed."

## The shape in one paragraph

Every App Master holds one more charter, **`codebase-stewardship`**, whose code dispatches are
carried by the **codex CLI on `gpt-5.6`** instead of the claude CLI on the persona's own model.
Nothing else about the lane is new: the App Master decides at its wake whether maintenance is
worth a run at all, writes the scope in its own words in the dispatch brief, the dispatcher
prepares the same isolated authoring worktree it prepares for every code charter, spawns
`codex exec` in it with the same guardrails and the same write-back doors, registers the worker
in the same fleet registry under the same `app-master:<persona>` run label, and the same
sweeps (stale, orphaned task, dispatch reconciliation) see it. The worker leaves a branch and a
structural report; the App Master runs the gates from the main checkout and merges under its
own rung 3. The worker never merges.

## Why a charter and not a second persona

The operator's constraint is that the App Master decides scope and need every time. A second
persona would decide for itself; a charter is a lever the owner pulls. It also keeps the
organisation inside the cap (ten active personas app-wide), because a charter's worker is a
fleet session, not a persona. And it keeps one ledger: the maintenance run's verdict, cost and
outcome sit beside the delivery run's on the same `persona_attention_ledger` rows.

## What the App Master sees and does

The wake brief lists the charter like any other, and carries one standing rule (in the decide
prompt, `attention_decide.rs`):

> MAINTENANCE LANE: a charter whose engine is `codex` is carried by the codex CLI on a coding
> model — cheaper and less able than you. Dispatch it ONLY with a scope you write in the brief:
> which files or module family, what kind of work (a behaviour-preserving refactor, a
> structural rebalance, a toolchain move, a coverage or build-time repair), and what must not
> change. Never scope behaviour, money-path semantics, gates, migrations or public contracts to
> it. One such worker at a time; it hands you a branch and never merges — you run the gates
> from the main checkout and merge under your rung. Refusing to dispatch it is the normal
> outcome of most wakes.

The recipe's own `guidance` says the same from the worker's side, and its first outcome makes
a scope without all three parts (files, kind of work, what must not change) a refusal by the
worker, so a lazy brief costs one refused run rather than a mangled tree.

"One worker at a time" needs no new cap: the decide lane never re-dispatches a charter whose
last dispatch is still in flight, and the persona holds exactly one charter on this lane.

## How the platform routes it

| Piece | Where | What |
|---|---|---|
| `ResponsibilitySpec.worker_engine` | `core/src/models/responsibility.rs` | `"claude"` (absent) or `"codex"`. |
| `apply_worker_engine` | `commands/infrastructure/app_master_adopt.rs` | Keyed by the recipe slug `codebase-stewardship`, applied after the door's model stamp: sets the engine and `model_override = "gpt-5.6"`. |
| `DecisionCharter.worker_engine`, `dispatch_model_for` | `engine/subscription/attention.rs` | The claude model chain drops every non-`claude-*` id; the codex lane reads its model straight from the override. |
| `dispatch_into_worktree` | same | Routes on the engine: `spawn_codex_worker_in_run` or the claude spawn, same worktree, same rung guardrails, same run label. |
| `spawn_codex_worker`, `codex_exec_argv`, `normalize_codex_event`, `resolve_codex_launch` | `commands/fleet/headless.rs` | `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C <wt> -m <model>`, prompt on stdin then EOF; codex JSONL mapped onto the claude stream-json types the loop already reads, so the state machine, the display lines and the one-shot settle are shared. |
| the recipe | `scripts/templates/_app_master/codebase-stewardship.json` | Merged into the bundle (131 recipes); adopted on the six App Masters through `POST /dev-tools/app-master/adopt`. |

On Windows the npm-global `codex` is a `.cmd` shim, which `Command::new` cannot run; the
resolver follows the shim's own layout (`<dir>/node.exe <dir>/node_modules/@openai/codex/bin/codex.js`)
and `PERSONAS_CODEX_EXE` overrides it. Probed 2026-09-15: `codex exec --json` answered a
one-line prompt with `thread.started`, `item.completed` (`agent_message`), `turn.completed`,
exit 0.

## What is deliberately not in v1

- **No sandbox.** The worker runs with approvals and the sandbox bypassed, inside a worktree
  the dispatcher prepared, and the project's own gates are the guard, exactly as for the claude
  workers. A sandboxed mode is one flag away if a run ever writes outside its worktree.
- **No resume.** A codex worker is one turn; a run that stops mid-scope reports and the App
  Master re-scopes. The fleet row records the exit like any headless session.
- **No usage gauge for codex.** The governor gauges the Claude windows; codex capacity is the
  operator's statement, not a measurement. If it becomes one, the fleet worker verdict is the
  place to read it.
- **No second recipe on the lane.** The engine is keyed by one slug on purpose; a recipe-level
  engine field is the right move the day a second recipe wants it.

## What to watch on the first runs

The first codex dispatch on each project answers, in order: does the App Master write a scope
at all (or refuse, which is fine); does `codex exec` start under the worktree with the write-back
doors reachable; does the worker's completion line reach `settle_one_shot_turn` through the
normalizer; does the App Master merge the branch from the main checkout under its rung. Each is
a query on `fleet_sessions` (args carry `--engine codex`), the attention ledger and the project's
`git log`.
