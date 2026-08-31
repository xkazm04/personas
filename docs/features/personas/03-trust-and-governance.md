# Trust and governance

How the system restricts what a persona is allowed to do. Two layers:

1. **The classic controls** — trust level, sensitive flag, headless
   mode, budget caps, turn limits, gateway exposure — each covering a
   different failure mode.
2. **The living-agent layer** — the [write-lane law](#the-write-lane-law)
   (who may write which part of a persona's self),
   [charters](#charters-scope-rungs-refusal-classes-tenure) (scope
   rungs, refusal classes, tenure), and the
   [three budget ceilings](#budgets--three-ceilings).

## The classic controls

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

## The write-lane law

The living-agent rebase splits a persona's self into three lanes with
three different owners. The law is structural — each lane has exactly
one write door, and the door enforces its contract.

### Lane 1: the Core is operator-owned

`personas.core_profile` (the `PersonaCore` — dials, identity, voice,
principles) has **no agent write path**. The only SQL that writes the
column is the generic persona `update()`
(`src-tauri/db/src/repos/core/personas.rs`), reached from the
operator-facing `update_persona` command (the Design hub's Core sub-tab);
`create()` does not insert it at all. No engine path — evolution,
healing, build, dispatch, director, management API, MCP tools — ever
populates `UpdatePersonaInput.core_profile`; the management API only
*reads* the live Core to carry it into prompt-version snapshots. The
two seed-if-absent stamps (template adoption, build promote) are
guarded in SQL: `WHERE core_profile IS NULL OR core_profile = ''` —
an operator-authored Core is never overwritten (see
[01-data-model.md](01-data-model.md#the-core-core_profile)).

Every operator Core edit auto-versions into
`persona_prompt_versions` and lands in the persona change log, so the
lane is not just exclusive — it is audited.

### Lane 2: the self-model changes only by approved, anchored diffs

`~/.personas/personas/<id>/identity.md` (the persona's self-model) is
never edited directly by any loop. Consolidation **proposes**: it
files a `persona_memory_review_proposal` row of kind
`self_model_diff` carrying up to 5 anchored diffs (`{section, op,
anchor_text, new_text}`; ops append/replace/remove a bullet, anchors
match by trimmed equality or prefix). A human approves; only then does
`apply_approved` (`src-tauri/src/engine/persona_brain/identity.rs`):

- verify kind, persona ownership, and `pending_review` status;
- validate every diff against the **live** file (a failed anchor is
  skipped; if none validate, the proposal stays pending and errors);
- compare-and-set the proposal to `applied` BEFORE touching disk, so
  a concurrent double-apply loses and errors;
- back up the file (`identity.bak-<ts>-<uuid>.md`) and write.

**There is deliberately no full-content replacement op** — anchored
diffs only, so every change is reviewable per claim. The diff grammar
is reused verbatim from the companion brain.

### Lane 3: memories are agent-owned — within a contract

Between the operator-owned Core and the approval-gated self-model,
the memory store is the lane the agent genuinely owns. The contract
is enforced by the single consolidation write door,
`create_consolidated` (`src-tauri/db/src/repos/core/memories.rs`):

| Clause | Enforcement |
|---|---|
| new facts land at tier `working` | the tier is a SQL literal in the INSERT, not a parameter |
| importance clamped to 2–4 | `draft.importance.clamp(2, 4)` — an agent cannot mint a `critical` (5) memory or a throwaway (1) |
| episode provenance is mandatory | a draft with empty `sources` is rejected; provenance rows (`persona_memory_sources`) are written in the same transaction |
| tombstones block re-derivation | the `persona_memory_tombstone` check runs INSIDE the immediate transaction, before the write; a hit is recorded as `skipped_tombstoned` |
| `preference` is not consolidatable | a `preference` draft is coerced to `learned` and the coercion is recorded — preferences belong to people, not to distillation |
| facts have one identity | a live row with the same `fact_key` is updated in place (provenance unioned), never duplicated |

The consolidation loop itself (`persona_brain/sleep_cycle.rs`) drops
hallucinated episode ids against the known set before the door even
sees them, caps each cycle (40 episodes, 12 facts), and advances its
episode watermark only on a completed pass — a failed leg retries the
same window. Tier promotion beyond `working` is earned through the
ordinary access-count lifecycle, not granted at write time.

## Charters: scope rungs, refusal classes, tenure

`persona_responsibilities` (schema in
[01-data-model.md](01-data-model.md#persona_responsibilities-charters))
is where a persona's authority is bounded per domain of work.

### Scope rungs (0–2)

Defined in `src-tauri/engine/src/app_master.rs`:

```rust
pub const RUNG_READ: u8 = 0;    // Observe and report; no writes at all.
pub const RUNG_RETRY: u8 = 1;   // Re-run existing work; no new change.
pub const RUNG_BRANCH: u8 = 2;  // Author a change and propose it; a human merges.
pub const MAX_GRANTABLE_RUNG: u8 = RUNG_BRANCH;
```

Rung 3 (deploy/merge) and rung 4 (change gates) are **never granted**;
charter intake (`responsibility::validate`) refuses a rung ≥ 3 rather
than storing it and remembering to ignore it. Enforcement runs at two
production gates — the Overnight dispatch decision and the diff
chokepoint below — via `Mandate::permits_rung`, and every autonomy
`Action` declares its own `required_rung`. The prompt restates the
ceiling cumulatively ("never merge, deploy, or change your own
gates").

### Refusal classes — and the honesty note

Two vocabularies, per charter domain
(`src-tauri/engine/src/responsibility.rs`):

- **`software_engineering`** — 6 diff-shaped classes:
  `test_deletion_or_skip`, `suppression_directive`,
  `gate_configuration`, `dependency_bump_to_satisfy_check`,
  `credentials_or_permissions`, `delivery_configuration`.
- **`general`** — 4 action families: `ExternalSend`, `CredentialUse`,
  `DataDeletion`, `PublicPublish`. Plus free-form `custom:<label>`
  entries in any domain.

**Only the software classes have a deterministic enforcement layer.**
`app_master::scan_diff` is a pure function over a unified diff —
nothing probabilistic, every hit carries the rule id, path and line —
and it runs at the one production chokepoint where agent-authored
diffs land (`dev_tools_apply_diff` →
`enforce_app_master_mandate` in
`commands/infrastructure/dev_tools/git_ops.rs`). Its signature takes
`&[ForbiddenClass]` — the closed 6-value enum — so it is structurally
incapable of scanning a general or custom class.

**Every other class is prompt-level law + human review, and the code
says so**: a class outside the software vocabulary is deliberately
dropped from the enforcement view ("a class the enforcement layer
does not understand cannot be enforced"), and surfaces only as
refuse-and-escalate prose in the assembled prompt's `##
Responsibilities` section and the attention brief. Do not read a
general charter's refusal classes as a technical guarantee; read them
as the persona's standing orders, checked by the human at review
gates.

### Tenure

`ResponsibilityTenure` carries `hired_at`, `probation_ends_at`,
`review_cadence_days`, `retire_criteria[]`, and the probation decision
trail (`probation_decided_at`, `probation_decision`
`activated|extended|retired`, `probation_review_id`,
`headless_incomplete_streak`) — a persona is hired into a charter,
proves itself through probation, and can be retired against its own
criteria. Status runs `draft → active → suspended/retired`. The
App-master mandate is the software-domain profile of this same row
(the `MandateRecord` round-trip is lossless in both directions).

## Budgets — three ceilings

**Column**: `max_budget_usd: Option<f64>` (persona-level), plus
`persona_responsibilities.budget_monthly_usd` (per charter).

### 1. The persona monthly pre-flight gate

Every execution start checks spend before spawning
(`src-tauri/src/commands/execution/executions.rs`, in
`execute_persona_inner`):

```rust
// 2. Check budget limit (concurrency is handled by the engine's queue)
if let Some(budget) = persona.max_budget_usd {
    if budget > 0.0 {
        let monthly_spend = executions::get_monthly_spend(&state.db, &persona_id)?;
        if monthly_spend >= budget {
            pipeline.fail_stage("budget limit exceeded");
            return Err(AppError::Validation(/* "Budget limit exceeded for '<name>'" */));
        }
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
reset column; `get_monthly_spend` filters by current month). Not set
(or 0) means no cap.

### 2. The per-charter ceiling

`budget_monthly_usd` on the charter rides onto the mandate view and is
enforced by the Overnight dispatch governor
(`commands/infrastructure/overnight.rs`): the mandate holder's own
monthly rollup — not the project aggregate — is checked against the
charter's ceiling via the pure `budget_verdict(month_spend, ceiling,
projected)` before dispatch. (The incident that earned this: a $5
mandate sailed past a governor that only consulted the app-wide
ceiling.) The charter budget is also restated as prose in the
assembled prompt ("Budget: stay within $X per month for this
responsibility").

### 3. The attention admission ladder

The attention loop pre-flights the persona-level budget as rung 5 of
its admission ladder — the same
`get_monthly_spend` vs `max_budget_usd` pair as the execution gate,
checked early so the ledger records a typed `budget_exhausted` refusal
instead of the spawn failing validation (see
[02-capabilities.md](02-capabilities.md#the-attention-loop)). The
per-charter ceiling is not consulted at admission; it binds at the
Overnight governor and in the prompt.

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
| Chartered living agent | `verified` | either | depends | Set cap | + active charters with `cadence.attention_enabled`, scope rung ≤ 2, refusal classes; attention loop ON globally |

## Policy evolution

These controls are **foundation for policy**, not the policy itself.
What's currently enforced:
- `trust_level == Revoked` → execution blocked at validate stage
- `trust_level == Manual` + `headless == false` → tool calls pause
- `max_budget_usd` → fail-fast on monthly spend overage (execution
  pre-flight + attention admission)
- charter `budget_monthly_usd` → Overnight dispatch governor
- `max_turns` → CLI ceiling
- `max_concurrent` + `timeout_ms` → engine enforcement
- `gateway_exposure` → HTTP API filter
- the write-lane law → structural (one door per lane, contract in the
  door)
- scope rungs → intake refusal (≥ 3) + `Mandate::permits_rung` at the
  Overnight and diff gates
- software refusal classes → deterministic `scan_diff` at the diff
  chokepoint
- attention loop → global default-OFF switch + admission ladder +
  typed, ledgered refusals

What's **advisory** (stored but not enforced yet):
- `sensitive` — tagging only; policy layer can read but no rules yet
- `trust_origin` + `trust_score` — UI display only
- `trust_verified_at` — no expiration rules yet
- general-domain and `custom:` refusal classes — prompt-level law +
  human review (see the honesty note above)

New enforcement belongs where the existing gates live —
`engine/src/autonomy.rs` (action gating), `engine/src/app_master.rs`
(rungs + diff scanning), or the relevant stage in `runner.rs`. Keep
the **storage** broad and the **enforcement** narrow — rules can be
tightened later without migrating data.

## Files

| File | Role |
|---|---|
| `src-tauri/core/src/models/persona.rs` | Enum definitions (`PersonaTrustLevel`, `PersonaGatewayExposure`, `PersonaTrustOrigin`) |
| `src-tauri/src/commands/execution/executions.rs` | Budget pre-flight + trust_level validation at execute_persona entry |
| `src-tauri/src/engine/runner/` | Timeout wrapping + tool-call approval flow + living-prompt input loading |
| `src-tauri/engine/src/cost.rs` | Token → USD calculation |
| `src-tauri/db/src/repos/execution/executions.rs` | `get_monthly_spend` for budget queries |
| `src-tauri/src/engine/background/` | `max_concurrent` cascade-guard enforcement |
| `src-tauri/db/src/repos/core/personas.rs` | The one Core write door (+ auto-versioning) |
| `src-tauri/src/engine/persona_brain/identity.rs` | Self-model diff proposal + human-gated apply |
| `src-tauri/db/src/repos/core/memories.rs` | `create_consolidated` (the memory contract) + tombstones |
| `src-tauri/engine/src/responsibility.rs` | Charter validation, domain class sets, mandate round-trip |
| `src-tauri/engine/src/app_master.rs` | Scope rungs, `ForbiddenClass`, `scan_diff` |
| `src-tauri/src/commands/infrastructure/dev_tools/git_ops.rs` | The diff chokepoint (`enforce_app_master_mandate`) |
| `src-tauri/src/commands/infrastructure/overnight.rs` | Per-charter budget governor |
| `src-tauri/src/engine/subscription/attention.rs` | Attention admission ladder + typed refusals |
