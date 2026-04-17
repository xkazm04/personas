# Trust and governance

How the system restricts what a persona is allowed to do. Six
independent controls — trust level, sensitive flag, headless mode,
budget caps, turn limits, gateway exposure — each covering a different
failure mode. This doc explains what each one is for and how they
interact.

## The six controls

```
Persona
  │
  ├── trust_level           → tool-call auto-approval (Manual / Verified / Revoked)
  ├── sensitive             → PII/financial audit tagging (bool)
  ├── headless              → bypass manual approval (bool)
  │
  ├── max_budget_usd        → monthly cost cap (REAL or NULL)
  ├── max_turns             → agentic-loop iteration cap (INT or NULL)
  ├── max_concurrent        → simultaneous execution cap (INT, default 1)
  ├── timeout_ms            → per-execution timeout (INT, default 300_000)
  │
  └── gateway_exposure      → external HTTP API visibility (LocalOnly / InviteOnly / Public)
```

## Trust level

**Column**: `trust_level: PersonaTrustLevel`
**Values**: `manual` | `verified` (default) | `revoked`

Gates tool-call auto-approval during execution:

| Level | Tool calls | Execution |
|---|---|---|
| `manual` | Every tool call waits for user approval via `persona_manual_reviews` | Allowed, but slow |
| `verified` (default) | Auto-approve all tool calls | Allowed, normal speed |
| `revoked` | N/A | **Blocked** — execution fails fast at validation |

**Bypass**: `headless == true` overrides `manual` → auto-approve.
Headless personas skip the approval prompt even if trust level asks
for it. This is the "fully automated agent" mode for personas that
run in the background with no user watching.

**When to set `manual`**:
- Brand-new personas from untrusted templates
- Personas with side effects in production systems (transfers, DB
  writes, public API posts)
- During a debugging period where you want to watch every step

**When to set `revoked`**:
- Security incident response: freeze a compromised persona
- Decommissioning without deletion: preserve history but block future runs
- Temporary quarantine: investigate before re-enabling

## Trust origin + score

**Columns**:
- `trust_origin: PersonaTrustOrigin` — `builtin` (default) | `user` | `system`
- `trust_score: f64` — 0.0–1.0
- `trust_verified_at: Option<String>` — ISO8601 timestamp

These are **audit metadata**, not gates. `trust_origin` records where
the classification came from; `trust_score` is a derived metric from
execution history (success rate, review approval rate, etc.); `verified_at`
tracks the last time trust was re-evaluated.

The UI surfaces these in the persona list as a trust badge. Org-level
policies can use them to require re-verification after N days or
promote/demote based on score thresholds.

## Sensitive flag

**Column**: `sensitive: bool` (default false)

Marks personas that handle **PII, financial, health, or regulated
data**. Effects:

1. Audit log entries get tagged with a `sensitive` marker for
   compliance review
2. The UI shows a red/amber chip next to sensitive personas
3. Policy layer (future) can require `trust_level == Manual` for
   sensitive personas, enforce sensitive data never flows to external
   providers, require encryption-at-rest for execution outputs, etc.

Currently advisory. Set it on any persona that touches regulated data
so the policy layer has something to work with later.

## Headless mode

**Column**: `headless: bool` (default false)

When `true`:
- Tool calls auto-approve regardless of `trust_level` (yes, even
  `Manual`)
- Notification channels default to the "background" set (no
  interactive channels like Slack DMs that expect a reply)
- The UI hides this persona from the "needs attention" surface

Used for personas that run purely in the background — scheduled
cleanups, monitoring pipelines, automation-heavy workflows. The
trust-level approval prompt doesn't make sense when there's no user
to answer it.

**Interaction**: `headless: true` + `trust_level: Manual` is a valid
combination. The `Manual` trust level still affects audit logging
and may affect future policy checks, but the runtime approval prompt
is skipped.

## Budget cap

**Column**: `max_budget_usd: Option<f64>`

When set, every execution start queries `exec_repo::get_monthly_spend(persona_id)`
and **fails the execution fast** if current spend ≥ cap:

```rust
// executions.rs line ~108
let monthly_spend = exec_repo::get_monthly_spend(&state.db, &persona_id)?;
if let Some(budget) = persona.max_budget_usd {
    if monthly_spend >= budget {
        return Err(AppError::Validation(
            "Monthly budget exceeded".into()
        ));
    }
}
```

**Calculation** (`engine/cost.rs`):
```
cost_usd = (input_tokens / 1000) * input_cost_per_1k
         + (output_tokens / 1000) * output_cost_per_1k
```
Per-model rates hard-coded in `cost.rs`.

**Granularity**: monthly, computed from `persona_executions.cost_usd`
rows. Budget resets implicitly at the month boundary (no explicit
reset column; `get_monthly_spend` filters by current month).

**Not set means no cap** — unlimited spend. Default for new personas.
Set a reasonable cap for production personas that run on schedules or
webhooks where runaway loops could rack up cost.

## Turn cap

**Column**: `max_turns: Option<i32>`

Hard ceiling on agentic-loop iterations (tool calls) per execution.
Prevents infinite loops when a persona keeps calling tools and never
decides it's done.

Passed to the Claude CLI at spawn time. The CLI enforces the limit
and ends the execution if reached.

**Not set means CLI default** — usually 30–50 depending on the Claude
version. For production personas with well-defined workflows, set this
to ~3x the expected tool-call count as a safety net.

## Concurrency cap

**Column**: `max_concurrent: i32` (default 1)

Maximum number of simultaneous executions for this persona. Checked at
execution start; additional invocations queue until a slot frees.

Default 1 means **serial** — useful for personas that write to files
or have non-idempotent side effects. Raise it for stateless
personas that can run in parallel (e.g. fan-out across many targets).

Enforced in `engine/background.rs` via the subscription tick — triggers
that fire while the persona is already running get skipped with a
"cascade guard" log line.

## Timeout

**Column**: `timeout_ms: i32` (default 300_000 = 5 minutes)

Hard timeout for a single execution. The runner wraps the entire
CLI subprocess in `tokio::time::timeout()`. On expiration the process
is killed, the execution is marked `Failed`, and a `HEALING_EVENT`
fires so the auto-healing system can retry if configured.

Raise for long-running tasks (reports, batch processing); lower for
quick-response personas (5s for a webhook handler that should reply
instantly).

## Gateway exposure

**Column**: `gateway_exposure: PersonaGatewayExposure`
**Values**: `local_only` (default) | `invite_only` | `public`

Controls visibility to the **external management HTTP API** (the
"A2A gateway"). This is a separate surface from the app UI — it
exposes persona execution via authenticated HTTP for programmatic use.

| Value | Who can invoke |
|---|---|
| `local_only` (default) | **Nobody** via HTTP — app UI only |
| `invite_only` | Authenticated API keys with explicit grant (scope filtering comes with the grants system) |
| `public` | Any authenticated API key |

Existing personas default to `local_only` so external visibility is
opt-in. Flip to `invite_only`/`public` only for personas that are
designed for programmatic invocation (e.g. a "webhook ingest" persona
meant to be hit by external services).

## Interaction matrix

How the controls combine in common scenarios:

| Scenario | trust_level | headless | sensitive | max_budget | Effect |
|---|---|---|---|---|---|
| Interactive test persona | `verified` | `false` | `false` | None | Normal: auto-approve, no caps |
| Production automated persona | `verified` | `true` | `false` | $50/mo | Auto-approve, budget-capped, no approval prompts |
| PII-handling persona | `manual` | `false` | `true` | $100/mo | Every tool call prompts for approval, audit-tagged |
| Compromised persona | `revoked` | any | any | any | Execution blocked outright |
| Background monitoring persona | `verified` | `true` | `false` | $10/mo | Silent, cheap, auto-approve |
| Publicly-exposed webhook persona | `verified` | `true` | depends | Set cap | + `gateway_exposure: public` |

## Policy evolution

These controls are **foundation for policy**, not the policy itself.
What's currently enforced:
- `trust_level == Revoked` → execution blocked at validate stage
- `trust_level == Manual` + `headless == false` → tool calls pause
- `max_budget_usd` → fail-fast on monthly spend overage
- `max_turns` → CLI ceiling
- `max_concurrent` + `timeout_ms` → engine enforcement
- `gateway_exposure` → HTTP API filter

What's **advisory** (stored but not enforced yet):
- `sensitive` — tagging only; policy layer can read but no rules yet
- `trust_origin` + `trust_score` — UI display only
- `trust_verified_at` — no expiration rules yet

Add enforcement logic in `src-tauri/src/engine/policy.rs` (if it
exists) or at the relevant stage in `runner.rs`. Keep the **storage**
broad and the **enforcement** narrow — rules can be tightened later
without migrating data.

## Files

| File | Role |
|---|---|
| `src-tauri/src/db/models/persona.rs` | Enum definitions (`PersonaTrustLevel`, `PersonaGatewayExposure`, `PersonaTrustOrigin`) |
| `src-tauri/src/commands/execution/executions.rs` | Budget check + trust_level validation at execute_persona entry |
| `src-tauri/src/engine/runner.rs` | Timeout wrapping + tool-call approval flow |
| `src-tauri/src/engine/cost.rs` | Token → USD calculation |
| `src-tauri/src/db/repos/execution/executions.rs` | `get_monthly_spend` for budget queries |
| `src-tauri/src/engine/background.rs` | `max_concurrent` cascade-guard enforcement |
