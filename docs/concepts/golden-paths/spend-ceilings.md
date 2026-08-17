# Golden path — spend ceilings

> Situation node: `ai-agents/cost-governance/spend-ceilings` · [situation spine](../situation-spine.md)
> Composed 2026-08-16 against `master` @ `19884e1f0`. **Recurrence 11 · risk HIGH · sides: both · convergence: diverged.**
> Sweep: all **963** non-generated Rust files under `src-tauri/` walked by the census engine and re-walked
> by two independent scanners written for this path; every `*_DEFAULT` in `db/src/settings_keys.rs`
> enumerated by type; every `SUM(cost_usd)` in the tree classified by table, status filter and period
> boundary (two implementations, reconciled exactly at **33 matches / 16 files**).
> `db/src/chain.rs`, `core/src/run_budget.rs`, `src/commands/infrastructure/overnight.rs`,
> `src/engine/director_lab.rs`, `src/engine/deliberation.rs`, `engine/src/tier.rs`,
> `engine/src/config_merge.rs`, `engine/src/enclave.rs`, `db/src/policy_tuning.rs` and
> `src/features/settings/sub_limits/components/LimitsSettings.tsx` read in full.
> **Read-only copies of the operator's two live SQLite databases** (`personas.db` 347 MB,
> `personas_data.db` 17.5 MB, copied 2026-08-16 00:56) queried for what has actually been spent:
> **five money ledgers, 8,198 billing rows, $2,512.29 of independent lifetime spend**, and a
> replay of the cumulative month against seven candidate ceilings.
> The census rule in §9 was built, hand-verified at 8/8, fault-injected six ways, positive-controlled,
> and re-extracted from this document and re-run.
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent`**.
> Dimensions: **cost · function · resilience · security · ui**.
> **Settles:** where a dollar limit is declared, what its unconfigured value means, which number it is
> compared against, and what happens the moment it is crossed.

---

## 0. The headline, before anything else

**This application has spent $2,512.29 and has never once run under a dollar ceiling — and the reason is
not that nobody set one. It is that the code which reads a dollar ceiling and the code which reads a
count ceiling were written eighteen lines apart, by the same author, in the same file, with the
argument for an always-on default written out in full — and applied only to the count.**

`db/src/settings_keys.rs`:

```rust
pub const CHAIN_MAX_COST_USD_DEFAULT: f64 = 0.0;   // :669  "0.0 means no ceiling (disabled)"
pub const CHAIN_MAX_LINKS_DEFAULT:    u32 = 50;    // :687  "a generous always-on safety net,
                                                   //        since the whole point of this guard is
                                                   //        that nothing else bounds breadth"
```

Both guard the same feature (a chain cascade). Both are "the only brake" on their axis — the docstrings
say so, in those words, for both. One ships on. One ships off. Nothing in either docstring explains the
difference, because there isn't one: **breadth got a default and money got a convention.**

The whole tree repeats the split. Measured at `19884e1f0`:

| | Count | Default | Meaning of the default |
|---|---:|---|---|
| `*_DEFAULT: f64` naming a dollar limit | **2 of 3** | `0.0` | **no ceiling** (`MONTHLY_COST_CEILING_USD:357`, `CHAIN_MAX_COST_USD:669`) |
| `*_DEFAULT: f64` naming a dollar limit | **1 of 3** | `2.0` | a real number (`DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD:348`) |
| non-money limit defaults in the same file (`i64`/`u32`/`usize`) | **11 of 11** | a positive number | the guard is armed out of the box |
| sites that apply a dollar bound **only if the bound is positive** | **8** | — | an unconfigured limit bounds nothing (§9) |
| sites that resolve the unconfigured case into a number or a type **first** | **5** | — | the compliant form (§6) |

And the live install, copied today:

- **`app_settings` holds 32 rows and not one of them is a money key.** No `monthly_cost_ceiling_usd`, no
  `chain_max_cost_usd`, no `director_weekly_experiment_budget_usd`.
- **78 of 78 personas have `max_budget_usd = NULL`. 78 of 78 have `max_turns = NULL`. 8 of 8 workspace
  teams have `default_max_budget_usd = NULL`.** 2,011 of 2,188 executions carry an explicit
  `"max_budget_usd": null` in `execution_config`; the other 177 have no config at all.
- **`run_budgets`: 0 rows. `budget_alert_rules`: 0 rows. `policy_proposals`: 0 rows.
  `autopilot_night_runs`: 0 rows. `chain_stop_reasons`: 0 rows. `persona_messages`: 0 rows** — so the
  budget-alert message at `engine/mod.rs:2785` has never been written either.

**What that cost, replayed against the operator's own June.** 2,188 terminal executions, $2,036.26, one
calendar month:

| ceiling | crossed at | at run # | runs that would have been refused |
|---:|---|---:|---|
| $10 | 2026-06-03 12:23 | 20 / 2,188 | 2,168 (**$2,026.16**) |
| **$50** — *the literal example in the docstring* (`settings_keys.rs:359`) | **2026-06-03 17:48** | **77 / 2,188 (3.5%)** | **2,111 (\$1,986.17 — 97.5% of the month)** |
| $200 | 2026-06-04 02:34 | 264 / 2,188 | 1,924 ($1,835.87) |
| $1,000 | 2026-06-10 21:40 | 996 / 2,188 | 1,192 ($1,036.09) |

A $50/month ceiling — the value the code itself uses as its example — would have been crossed **on the
third day of the month, 3.5% of the way into it.**

**The second headline is worse, and it is the one this path exists to prevent.** There *is* one place in
this app that enforces the global monthly ceiling as a hard, pre-dispatch, degrade-the-project governor:
`commands/infrastructure/overnight.rs`. It compares the ceiling against `dev_llm_spend`. The Limits tab —
the only screen where the operator can set that ceiling — compares it against `persona_executions`
through `get_metrics_chart_data`. **For June 2026 those two numbers are $3.37 and $2,036.26. A factor of
604.** Meanwhile the screen tells the operator, in a shipped translated string, that the ceiling does
nothing at all:

> *"Stage 1 (this build) is informational — it shows progress and warnings but does not block runs."*
> — `en.json` › `settings.limits.description`

So the operator reads "this limit is not enforced", one subsystem enforces it hard enough to permanently
downgrade a project's autopilot, and it enforces it against 0.17% of the money.

**The good news, and it is specific and reusable: the repo already contains the type this document would
otherwise have to invent.** `db/src/chain.rs:150-206` declares a private three-state ceiling reading —
`Disabled | Configured(f64) | Corrupt(String)` — where a corrupt stored value **fails restrictive and
halts the cascade** rather than collapsing into "disabled". [`autonomy-gating`](./autonomy-gating.md)'s
Type-over-gate move 2 calls `Ceiling<T>` "the one the repo has not done". **It has done it, once, for one
setting, and never lifted it out of the file.** §6 is about that function.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every
clause carries its warrant, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics, and the sharpest clause here.** **A limit's unconfigured value is a policy, and the
> only safe policies are "a number" or "refuse".** "Absent" is not one of them. Teams reliably ship
> non-money limits armed — a retry cap, a depth cap, a page size, a concurrency cap all get a sensible
> constant — and ship the money limit off, because a dollar figure feels like it must be the operator's
> choice while a retry count feels like the engineer's. It is the same decision and only one of the two
> can bankrupt anybody.
>
> **P2 — physics.** **"Unlimited" must be a value of the type, not a value of the number.** The moment
> zero (or null, or empty) is overloaded to mean "off", every site must re-spell that convention, they
> will spell it differently, and no two of them will agree on the corrupt case. Count the spellings in
> your own codebase before you argue this is pedantic; if there is more than one, the concept is not
> named anywhere and the compiler cannot help.
>
> **P3 — physics.** **A stored limit has three states, not two: absent, valid, and corrupt — and corrupt
> must not resolve to absent.** An unset limit is a decision somebody made. An unparsable one is data
> damage, and treating damage as consent removes the only brake at exactly the moment something is
> already wrong.
>
> **P4 — physics.** **The gauge and the gate must read the same rows.** Not the same table — the same
> rows: same source, same status filter, same period boundary, same exclusions. A ceiling the operator
> sets on one screen and a subsystem enforces against a different query is not a ceiling, it is two
> unrelated numbers that share a name. This is the clause most likely to be violated by a codebase that
> is otherwise careful, because both queries are individually correct.
>
> **P5 — physics.** **A limit checked against completed work cannot see work in flight.** Spend is
> known only when a call ends, so a pre-flight check admits one more unit of unbounded cost per lane,
> and N concurrent lanes multiply that. Either reserve before the call and settle after, or state the
> overshoot in the same breath as the ceiling — but do not describe a check-then-spend gate as a cap.
>
> **P6 — physics, as a failure mode.** **The limit is applied where it is convenient to apply it, not
> where the money is spent.** Every system grows one door with a gate — the one a human pressed — and
> then adds doors. Audit by enumerating the ways work can *start*, not by reading the gate.
>
> **P7 — ergonomics.** **A breach must produce a durable, queryable record that names the refusal.**
> "Nothing ran last night" and "we refused to run last night because the ledger was dry" are the same
> observation to a log and different products to an operator. A refusal that only logs is a refusal
> nobody can act on.
>
> **P8 — ergonomics.** **Prefer degrading the subject to disabling it.** A degraded run keeps reporting;
> a disabled one is indistinguishable from an idle one. Where a degrade is impossible, prefer a
> *retryable* refusal to a terminal one — the ledger refills.
>
> **P9 — ergonomics.** **A limit inherited through a cascade must be inherited by every reader.** If a
> team/workspace/org default flows into one consumer and not the others, the screen showing the
> "effective" limit and the code enforcing it describe different systems, and the screen is the one the
> operator believes.
>
> **P10 — security/product.** **The tier a customer pays for should bound what the customer can spend on
> your behalf, or you should be able to say why not.** A plan that caps requests-per-minute and not
> dollars-per-month has capped the axis that is cheap to exceed and left the expensive one open.
>
> **P11 — physics, and the one that decides whether any of the above is real.** **Count the times the
> limit has said no.** A ceiling nobody set, on a table with no rows, guarded by a branch never taken, is
> a design document that compiles. The query is one line and it is the only evidence that exists.
>
> **Scale condition.** P1, P2 and P3 are correctness on day one — they are wrong before any load. P4 and
> P9 begin to bite the moment a second reader of "what have we spent" exists, which is the moment
> somebody builds a dashboard. P5 and P6 bite when a second launch path exists. P7, P8, P10 and P11 are
> what make the rest operable, and P11 is what makes them auditable.

### Warrant evidence — the five sibling repos, censused independently

`personas-web` (Next.js — **the negative control, re-confirmed: zero LLM SDKs in `package.json`; the only
provider-key strings in `src/` are mock fixtures at `mock-dashboard-data.ts:1218,1712`; its 232
`budget|spend|quota` hits across 111 files are all i18n catalogs and guide prose**), `brainiac` (Rust
workspace), `personas-cloud` (Node orchestrator + worker), `vibeman` (Next.js + Tauri), `ascent`
(Next.js).

- **P1/P2 are a CONVERGENT FAILURE — 3 of the 4 billable repos read "unset" as "unlimited", and one says
  so in a type comment.** `personas-cloud/packages/shared/src/types.ts:444` — *"Monthly budget cap in
  USD — null means unlimited"* — with the column defaulting to NULL (`db.ts:116`), and its per-run
  sibling `prompt.ts:479` `if (persona.maxBudgetUsd && persona.maxBudgetUsd > 0)` treating **0 and
  negative** as unlimited too. `vibeman`'s `max_budget_usd: Option<f64>` (`claude_cmds.rs:39,651`) is
  applied at `:566-569` and `:697-699` and has **zero assignment sites in the entire repo** — 7 grep hits,
  4 of them type declarations and 1 a research note. `ascent` is the deliberate case:
  `includedCredits: null` for enterprise (`plans.ts:72`) is documented unlimited, and
  `entitlement.ts:17` makes a missing database unmetered. **This repo commits the same failure at 8 sites
  in 4 spellings and is the only one of the six whose non-money limits are uniformly armed** — which is
  what makes the split visible here and invisible elsewhere.
- **P3 is MIXED 2–2, and this repo lands on the right side by a hair.** Fail-restrictive: `ascent` at
  **six** parse sites, all clamping to the *smaller* value and test-pinned (`rate-limit.ts:118-121`,
  `public-scan-quota.ts:50-53,61-65`, `alerts.ts:322-327` with *"A blank/missing var means 'default',
  never 0"*, `plans.ts:99-102` where a garbage plan string resolves to **free**, `credits.ts:91`
  `?? 0` ⇒ denied, `usage.ts:234-241` where an unparsable rate yields **no dollar figure at all** rather
  than a confident $0); and `brainiac`, uncorruptibly, by making its budget a `const usize`
  (`extract.rs:497`) with `.max(1)` clamps on its neighbours (`worker.rs:73-74`). Fail-open:
  `personas-cloud` twice — `mapRow` has no override for `maxMonthlyBudgetUsd` (`db.ts:447-473`) so NULL
  skips the gate entirely, and a TEXT value surviving SQLite's REAL affinity makes `monthCost >= "abc"`
  NaN-false, which **permits and also suppresses the 80% warning**; and `vibeman`, by omission.
  **This repo has exactly one fail-restrictive reader (`chain.rs`) and five that flatten.**
- **P4 is a CONVERGENT FAILURE and the strongest external result in this audit — both repos that have
  more than one spend number have two numbers that disagree, and one of them renders them against the
  same denominator.** `ascent`'s gate counts `Scan` rows with `engineProvider != "mock"` over a **UTC
  calendar month** (`credits.ts:285-287`); its usage gauge counts `repo.isPrivate` rows over a **rolling
  30 days** with no provider filter (`usage.ts:135`), and `usageDashboard.tsx:110` hands that gauge
  number to `AllotmentPanel`, which compares it to `PLAN_FEATURES.includedCredits` — *the exact number
  the gate enforces*. So a private scan that degraded to mock counts in the gauge and not the gate; a
  public scan counts in the gate and not the gauge; and at a month boundary they are simply out of phase.
  `personas-cloud` has **four** unreconciled numbers plus a silent-loss bug: the gate's counter is fed
  only via `getDeploymentByPersona` (`db.ts:1419-1422`), a `SELECT * … .get()` returning an arbitrary
  single row, so a persona with two deployments accrues all its spend to one of them and the other's
  ceiling never moves. **This repo has five ledgers and the same disease (§7.A).**
- **P4's positive half is physics too, and `ascent` states it better than we do.** `plans.ts:136-142`
  makes `resolveScanCharge` *"the single source for the `plan → {unlimited, allowance}` wiring… Used by
  BOTH the read gate and the write gate so the input assembly can't drift"*; `entitlement.ts:49-55`
  forces read/write agreement on org existence; `credits.ts:14-21` binds the refund **writer** and the
  reconciliation **reader** to one constant, *"makes that drift structurally impossible."* Personas'
  `MONTHLY_SPEND_PREDICATE` is the same move, better executed — a shared SQL fragment, not a shared
  helper. **Two teams independently invented "the gauge and the gate must share their query", and both
  applied it to exactly one of their gauge/gate pairs and none of the others.**
- **P5 does NOT converge — 1 of 4. Reserve-before-spend exists only in `ascent`, and it is that repo's
  central doctrine.** `scan-credit.ts:36-56` (`reserveScanCredit` / `refundScanCredit` /
  `shouldRefundScan`), shared by three fan-out entry points because *"each used to reproduce this money
  loop inline, so the refund/dedup invariant lived in triplicate… a billing-correctness hazard."* The
  reserve **is** the gate — an atomic conditional decrement,
  `updateMany({ where: { slug, scanCredits: { gt: 0 } }, data: { decrement: 1 } })` (`credits.ts:344-347`)
  — with retry-safe idempotency (`externalId` synthesized once *outside* `withRetry`, `credits.ts:328-334`)
  and an honestly-documented residual: *"the allowance pre-check is a SOFT, non-atomic read… the overshoot
  is O(in-flight lanes)… so only the FREE allowance can be marginally overshot, never paid credits."*
  `personas-cloud` is the textbook race — read at `httpApi.ts:1296`, write at `dispatcher.ts:473-484`.
  `vibeman` and `brainiac` have nothing. **This repo has nothing.** Adopt P5 as a proposal, not doctrine.
- **P6 is a CONVERGENT FAILURE — the gate is always built for one door.** `personas-cloud`'s only
  monetary comparison in the whole repo is `httpApi.ts:1293-1304`, reachable from
  `POST /api/deployed/{slug}` alone; the webhook route (`:1272-1281`), both compile routes (`:1836+`),
  the event-subscription processor (`eventProcessor.ts:505`, which checks only `maxConcurrent`) and the
  trigger scheduler all start billable runs with no budget read. `ascent` is the counter-example that
  proves the clause is achievable: **five** enforcement sites covering the interactive scan, the org
  batch, the org import, the cron rescan and the anonymous funnel. This repo gates the manual/API path
  and the `trigger_type == "schedule"` branch and nothing else — already recorded as
  [`llm-spend-accounting`](./llm-spend-accounting.md) §7.E(4).
- **P7 is physics, 2 of 4, and both reinvented HTTP 402 for a self-hosted agent run.** `ascent`
  `entitlement.ts:71-80` (`INSUFFICIENT_CREDITS`), `personas-cloud` `httpApi.ts:1297-1298` plus an
  `X-Budget-Warning: approaching-limit` header at 80% (`:1301-1303`). `ascent` additionally sends a
  structured `notice` event naming the skipped repos (`org/scan/route.ts:112`) and serves the last
  report at any age rather than a dead end (`scan/route.ts:109-110`). **This repo's `declined_budget`
  row (§6) is the same idea and the only one of the six that is *retryable in place*.**
- **P8 does NOT converge and must be labelled an invention. 0 of 5 have a spend-driven degrade
  governor.** `ascent`'s degrade-to-mock is a *resilience* fallback that triggers a **refund**
  (`scan-credit.ts:62-67`), so it is not a cost governor; `vibeman`'s provider fallback triggers on
  health and 429, never on cost. `ascent`'s bulk path degrades by **truncating the batch to capacity**
  (`org/scan/route.ts:80-83`), which is the closest external analogue and is a different mechanism.
  This repo's `full → suggest` (`overnight.rs:406-427`) has no external warrant — the same verdict
  [`autonomy-gating`](./autonomy-gating.md) reached on the same mechanism from the permission side.
- **P9 has no external trace at all** — no sibling has a workspace/team cascade for a money limit, so
  §7.E's finding is local. Mark it a house convention.
- **P10 is SILENT — 0 of 5 give a paid tier a dollar spend cap.** Only `ascent` has a tier system
  (`PlanFeature`, `plans.ts:12-30`) and it caps **volume** (5/100/500 scans) and states a **price**
  ($0/$10/$20), never a spend ceiling; its header is explicit that *"pricing itself lives in the billing
  provider… so no dollar amounts are invented here."* `vibeman`'s `tier` is a request-rate tier
  (`createRouteHandler.ts:124`); `brainiac`'s is a **visibility** tier (`types.rs:50`). This repo's
  `TierConfig` (§7.D) is the fourth instance of the same shape. **Six codebases, zero dollar-denominated
  plans.** Either P10 is wrong or the whole cohort has the same hole; state it as an open question, not
  doctrine.
- **P11 is SILENT — nobody counts their refusals.** No sibling contains a query, test or metric asserting
  that a spend gate has ever fired. The clause survives on this repo's own evidence: the only way any
  number in §0 was learned was by copying the database.
- **A bonus finding with no clause, because it is too strange to generalise and too instructive to
  drop.** `personas-cloud`'s third ceiling, `CompileRequest.maxBudgetUsd`, is documented as *"default:
  $1.00"* (`types.ts:359-360`), is never defaulted, and its **sole use in the codebase** is
  `prompt.ts:638-640`, which writes `"## Budget Constraint\nMaximum execution budget: $X USD per run."`
  into the prompt. The ceiling is a request to the model. It is worth knowing that this is a shape a
  reasonable team shipped.

**Two silences worth naming as silences,** per the doctrine: **nobody caps dollars per tier (P10, 0/5)**
and **nobody proposes a ceiling from observed spend (0/5)** — this repo's `policy_tuning.rs` budget
candidate (§6) is an invention, and `ascent`'s `AllotmentPanel` "a smaller tier may fit" advice is the
nearest analogue and writes nothing back.

**And one asymmetry that frames everything above:** across the four billable repos, **bounding *calls* is
physics — 4 of 4 cap fan-out, and three independently chose the literal number 4** (`ascent/pool.ts:37`,
`vibeman/types.ts:15`, `brainiac/worker.rs:41`) — while **bounding *dollars* is 2 of 4, and one of those
two is dead code.** Engineers cap the unit they can reason about locally. Money is not that unit.

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "add a budget / a cap / a spend limit", "stop it after $N", "don't let it run away"
- "make the ceiling configurable", "put it in settings", "let the user set a monthly cap"
- "0 means unlimited" / "null means no limit" / "leave it blank for no cap"
- "show them how much they've spent this month"
- "what should the default be?" — **especially when the honest answer is "the user should decide", which
  is how every ceiling in this repo ended up at zero**
- "the paid tier should get more"
- **If you are about to write `if <limit> > 0.0 {`, `.filter(|v| *v > 0.0)`, `None => Allow`, or
  `unwrap_or(0.0)` on anything denominated in currency — you are in this situation and §9 counts you.**
- **If you are about to add a `_usd` column, a `*_CEILING_USD` / `*_BUDGET_USD` settings key, or a
  `SUM(cost_usd)`, you are in this situation.** There are already five money ledgers and 33 aggregates
  over them (§7.A); adding a sixth is a decision, not a detail.

You are **not** in this situation for: token/character budgets that bound context assembly rather than
money (`memory_recall.rs:209`, `retrieval.rs:361` — the word "budget" is overloaded and those are not
dollars); wall-clock timeouts; retry counts; or rate limits.

### Boundaries with the four adjacent paths — stated because all four touch `max_budget_usd`

- **[`llm-spend-accounting.md`](./llm-spend-accounting.md)** owns **whether the number is correct** — the
  price table, the nullable column, the re-aggregation, cancelled runs recording $0, orphan audit rows,
  the two units on one field. This path owns **whether a limit exists to compare it against, what its
  unconfigured value means, and which query it is compared to.** Non-overlap test: a monthly ceiling
  compared against a perfectly-computed, fully-attributed, retention-safe spend total, whose *default is
  zero and therefore never fires*, is **100% compliant with that path and 0% compliant with this one.**
  That path's §7.E lists four ways the cap can be bypassed; this path is about the fifth thing it names —
  *"the cap has never been set"* — and treats that as a design defect rather than an operator choice.
- **[`autonomy-gating.md`](./autonomy-gating.md)** owns **whether an unattended action was permitted to
  start**. This path owns **the money bound on it**. That path's §0 established the accelerator/brake
  asymmetry and named `Ceiling<T>` as the move nobody made. This path measures the brake side in full and
  **corrects that claim: the move was made, once, in `chain.rs`** (§6).
- **[`headless-model-call.md`](./headless-model-call.md)** owns **the per-call envelope** — the payer,
  the model, the meter, the turn cap. Its §0 finding that `--max-budget-usd` has one construction site is
  the *symptom*; this path owns the *cause*, which is that the value it would carry is `NULL` on all 78
  personas and would be declined by `cli_args.rs:133` even if it weren't.
- **[`app-settings-store.md`](./app-settings-store.md)** owns how a setting is stored, keyed, validated
  and decoded. This path owns what its **absence** means. The seam: `validate_value` correctly rejects
  `-5`, `nan`, `inf` and `""` for a ceiling (`settings_keys.rs:961`, tested at `:1562-1567`) — and
  accepts `"0"`, which is the entire problem and is not a validation bug.

---

## 2. The one way

**Declare the limit with a number, not with zero; resolve its unconfigured and corrupt states into a
closed type at the read, once; compare it against exactly the rows the operator is shown; and make the
breach write a row.** Concretely: give every dollar limit a `*_DEFAULT` that is a real positive number
chosen the way `CHAIN_MAX_LINKS_DEFAULT = 50` was chosen — generous enough that no legitimate run reaches
it, present enough that a pathological one does — and if you genuinely mean "unlimited", spell it as a
variant of the type (`Ceiling::Unlimited`) so it is a thing somebody typed rather than a thing nobody
typed. Read it through a function that returns three states, not one scalar: model
`db/src/chain.rs:150-206`'s `CostCeilingReading { Disabled, Configured(f64), Corrupt(String) }`, where a
transient database error is treated as unset (infrastructure trouble is not consent to change policy) and
a **corrupt stored value halts** — because a malformed row must not silently disable the only brake. Never
write `if budget > 0.0 { …apply the bound… }` at the use site; the positivity question belongs to the
read, and re-asking it at the use site is what turns one convention into eight spellings (§9). Compare
the limit against **the same rows the UI shows the operator** — share the predicate as a constant the way
`MONTHLY_SPEND_PREDICATE` (`db/src/repos/execution/executions.rs:1732`) is shared verbatim between the
gate that blocks a run and the badge that reports it, and if you cannot share it, do not ship the second
number. Check **before** the spend, and say out loud how much can be in flight while you check — a
pre-flight check against terminal rows admits one more unbounded unit per concurrent lane, and this
install has measured **$34.58 of simultaneously-in-flight spend the monthly gate could not see**. On
breach, prefer degrading the subject to disabling it, and prefer a *retryable* refusal to a terminal one:
write a durable row naming the refusal, as `director_lab.rs`'s `declined_budget` does, so "nothing
happened" and "we refused, here is the arithmetic" are different rows. And before you claim any of this
works, **run the query that counts how many times the limit has said no** — for every ceiling in this
repo today, that number is zero.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`db/src/chain.rs:150-206` — `enum CostCeilingReading { Disabled, Configured(f64), Corrupt(String) }` + `read_chain_cost_ceiling(pool)`** | **The best money type in this repo and the shape §2 is generalising.** Three states, each with its policy written down at the variant: `Disabled` is *"a deliberate, legible choice, not data damage"*; `Corrupt` carries the raw string for the audit trail and **halts** (`:325-344`), with the reason stated — *"a malformed row must not silently disable the only brake on runaway cascade spend the way a genuinely-unset setting does"*. A transient `Err` from the settings read resolves to `Disabled`, deliberately, because *"infrastructure trouble is not data corruption"*. **This is `Ceiling<T>`, already written.** Lift it to a shared crate; do not write a second one. |
| **`db/src/settings_keys.rs:672-689` — `CHAIN_MAX_LINKS` / `CHAIN_MAX_LINKS_DEFAULT: u32 = 50`** | **The argument for an always-on default, in the repo's own words.** *"Unlike the cost ceiling this defaults to a NON-zero value on purpose — the depth ceiling is a hard always-on constant, so breadth (the other unbounded axis) gets a generous default too rather than shipping the guard off."* Copy that reasoning to every dollar limit you declare. Its reader `read_chain_link_ceiling` (`:207-216`) is one line and correct. |
| **`db/src/repos/execution/executions.rs:1732` — `MONTHLY_SPEND_PREDICATE`** | **P4, implemented.** One `&str` const holding status set + UTC month boundary + ops-chat exclusion, interpolated verbatim into both the gate that blocks a run (`get_monthly_spend`, `:1734`) and the feed that draws the badge (`metrics.rs:195`), with a doc comment naming all three axes that must match and why. **This is the only gauge/gate pair in the app that shares a query, and it is the only one that has never been observed to disagree.** |
| **`src/engine/director_lab.rs:91 — weekly_budget_usd(pool)`** | **The strictest ceiling reader in the tree, and a one-line pattern.** `.filter(\|v\| v.is_finite() && *v >= 0.0).unwrap_or(DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT)` — a corrupt value *and* an absent one both resolve to a **positive** default (2.0). Its spend counterpart `weekly_spend_usd` (`:104`) is scoped by `trigger_kind` to exactly the rows the budget governs — P4 on a second axis. |
| **`src/engine/director_lab.rs:285-371` — the `declined_budget` outcome** | **The best breach behaviour in the app, and the only retryable one.** `if ledger.remaining_usd <= 0.0` writes a durable row with `STATUS_DECLINED_BUDGET` (`:54`) **before any model call is attempted**, carrying the arithmetic (`"{spent} of {budget}"`), and the row *"retries in place once the ledger refills"* (`:293`). P7 and P8 in fourteen lines. Copy this over a `return Err(...)`. |
| **`src/commands/infrastructure/overnight.rs:125 — budget_verdict(month_spend, ceiling: Option<f64>, projected)` + `:389-427`** | The only **pre-dispatch, projected-cost** governor: it estimates what it is about to spend (`EST_COST_PER_SESSION_USD = 1.5` × capacity), adds it to the month, and refuses *before* committing. On breach it persists a `full → suggest` degrade through `settings::set`, emits `tracing::warn!` and sends a user-visible notification. Pure and unit-tested. **Copy the shape; do not copy `None => Allow` (§7.C) or the ledger it reads (§7.A).** |
| **`src/engine/deliberation.rs:162 — floor_breach(spent, budget: Option<f64>, idle_deadline, now)` + `:48 DEFAULT_COST_BUDGET_USD = 5.0`** | **The only dollar ceiling in the app that has ever actually been armed on live data** — 142 of 142 deliberations ran under it by default, and the largest reached **$4.73 against a $5.00 floor**. Also the only **two-axis** ceiling: cost *and* an idle deadline, because a cheap run that never finishes is also a cost. |
| **`core/src/run_budget.rs` — `RunBudgetLedger` (`register` → `record` → `should_halt` → `finish`) + `DEFAULT_{EVOLUTION,LAB,PIPELINE}_CEILING_USD = 2.0 / 3.0 / 5.0`** | The aggregate ceiling for a multi-spawn operation, with **three positive per-kind defaults** — the only place a family of dollar limits ships armed. Its header states the honest limit of the whole category: *"a spawn's cost is only known after it finishes, so the ceiling bounds 'don't start new spawns past X', while each spawn's own `--max-budget-usd` bounds the single in-flight call."* That sentence is P5. |
| **`db/src/policy_tuning.rs:384-400` — the budget-ceiling candidate** | **The only thing in six codebases that proposes a ceiling from observed spend:** `ceiling <= 0.0 && spend > 0.0` → propose `introduce` at `spend × 1.5`; `spend > ceiling × 0.9` → `raise`; `spend < ceiling × 0.4` → `lower`. Gated on `min_spend_rows = 20` so sparse data yields an honest decline instead of a stretched inference. Keep it; **feed it the right ledger** (§7.A). |
| **`db/src/settings_keys.rs:961` — `validate_value` for the two money keys** | Rejects negative, `nan`, `inf`, empty and whitespace-padded values at the write door, with 11 assertions. The *reason* the `Corrupt` state above is rare-but-real: this door is not the only writer. |

**Explicitly NOT primitives.**
`engine/src/enclave.rs:31 EnclavePolicy.max_cost_usd` looks like a per-execution ceiling, defaults to a
sensible `1.0`, and has **zero enforcement sites in 963 files** (§7.D). The `budget_alert_rules` table
(`migrations/schema.rs:564-572`) has a schema, an index, a `threshold_usd REAL NOT NULL` and **zero
readers and zero writers** (§7.D). `engine/src/tier.rs::TierConfig` is a rate/queue tier and carries **no
money field at all** — do not reach for it expecting a spend cap (§7.D).

---

## 4. Steps

1. **Choose the default before you choose the key name, and make it a number.** Add
   `pub const X_CEILING_USD_DEFAULT: f64 = <positive>;` next to the key, and write the
   `CHAIN_MAX_LINKS_DEFAULT` sentence in its docstring: what makes this generous enough that no
   legitimate run reaches it, and what makes it present enough that a pathological one does. If you
   truly want an off-by-default limit, that is a product decision and it belongs in the docstring as a
   sentence, not in a `0.0` that eight later readers must each re-interpret.
2. **Write one reader that returns three states.** Model `read_chain_cost_ceiling`. `Ok(None)` and blank
   → `Disabled`. `Err(_)` from the store → `Disabled` (infrastructure trouble, not consent). Unparsable,
   negative or non-finite → `Corrupt(raw)`, and the caller **refuses**. This is the step that retires
   §9's rule entirely — once the read owns the positivity question, no use site asks it.
3. **Never re-ask positivity at the use site.** `if let Some(ceiling) = resolved { if spend >= ceiling { … } }`.
   The eight sites in §9 all violate this and they do it in four different spellings.
4. **Pick the rows before you pick the number, and share the predicate.** Write the status set, the period
   boundary and the exclusions as one `const &str` and interpolate it into *every* reader — the gate, the
   badge, the chart, the digest. If a second query cannot use it, that is the signal you are about to
   ship a second, disagreeing answer. There are already five money ledgers and 33 `SUM(cost_usd)` sites
   here; **31 of the 33 do not share anything** (§7.A).
5. **Check before the spend, and write down the overshoot.** Say in the docstring how much can be in
   flight while the check runs (`live lanes × p99 cost` — here that is 10 × $3.96 ≈ $40, and the measured
   maximum was $34.58). If that overshoot is unacceptable, you need a reservation (§8.4), not a bigger
   ceiling.
6. **Emit the ceiling to whatever actually spends.** A per-call bound is only real if it reaches the argv
   / the request. `cli_args.rs:132-138` is where that happens here — and it declines the bound when the
   value is `0.0`, so step 1 and step 6 are the same fix.
7. **On breach, write a row and name it.** A status token (`declined_budget`, `budget_exceeded`,
   `cost_ceiling_corrupt`), the arithmetic that produced it, and a decision about whether it retries. Log
   lines are not this.
8. **Prefer a degrade to a stop, and a retry to a terminal refusal.** `full → suggest` keeps a project
   observable; `declined_budget` refills. A hard `Err` at the ceiling is the last resort, not the first.
9. **Thread the cascade to every reader, or to none.** If a workspace/team default exists, the admission
   gate, the preview, the badge and the argv must all resolve through it. Today one of the four does
   (§7.E).
10. **Write the query that counts refusals, and run it.** `SELECT count(*) FROM <breach table>`. If the
    answer is 0 and the feature has shipped, either the ceiling is unset (fix step 1) or the branch is
    unreachable (fix the branch). Both were true here.
11. **And then stop.** Whether the recorded number is *right* belongs to
    [`llm-spend-accounting`](./llm-spend-accounting.md); whether the run was allowed to start at all
    belongs to [`autonomy-gating`](./autonomy-gating.md); the per-call envelope belongs to
    [`headless-model-call`](./headless-model-call.md). Re-deriving any of them here is how one
    `Option<f64>` ended up carrying two units.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and this repo has already written it once and left it in one file.** See "Type over gate", below.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`pub const X_CEILING_USD_DEFAULT: f64 = 0.0;`** | Ships the brake off. The operator who types nothing gets no protection and no warning; the operator who types `0` gets the same thing while believing they typed a hard stop. **2 of 3 money defaults, against 11 of 11 non-money defaults in the same file that are armed.** |
| **`if budget > 0.0 { …apply the bound… }`** | Makes the limit self-disabling, and moves the "what does unset mean" decision to every call site, where it will be spelled differently. **8 sites, 4 spellings** (§9). `cli_args.rs:133` is the worst instance: it is the only per-call dollar bound in the app and it declines itself. |
| **`.filter(\|v\| *v > 0.0)` on a stored ceiling** | Collapses *unset*, *zero* and *corrupt* into one `None`, and then `None` permits. `overnight.rs:321-325` does this to the global monthly ceiling; `chain.rs:173` faces the identical question and separates the three, ten files away. |
| **`None => Allow`** | The unconfigured case is the only case that has ever occurred in production. `overnight.rs:127`. |
| **Comparing the ceiling to a different table than the UI shows** | Two correct queries, one wrong product. Live: **$3.37 vs $2,036.26 for the same month** (§7.A). Nothing fails, nothing warns, and the operator's mental model is the UI's number. |
| **A UI string that describes the enforcement, maintained separately from the enforcement** | `settings.limits.description` says the ceiling *"does not block runs"*; `overnight.rs:406-427` refuses dispatch and permanently degrades the project's autopilot mode. Whichever is true, one of them is a lie the operator will act on. |
| **Hardcoding the backend's default in the frontend** | `?? 5` for `costBudgetUsd` at `ConversationCards.tsx:234` **and** `DeliberationRail.tsx:41`, duplicating `DEFAULT_COST_BUDGET_USD = 5.0`. Three copies, no link; the Rust one changes and two progress bars silently lie. |
| **Overloading `0` in opposite directions** | `deliberations.rs:43` normalises `0` → `None`, and `floor_breach` turns `None` into **$5.00**. So typing `0` into the deliberation budget gives you the *strictest* ceiling in the app, while typing `0` into the monthly ceiling gives you *none*. Same literal, opposite meaning, same binary. |
| **A limit inherited by one reader of four** | `resolve_effective_config` applies a workspace's `default_max_budget_usd` inside the runner (`runner/mod.rs:174`); the admission gate (`executions.rs:353`), the cost preview (`:886`) and the spend badge (`metrics.rs:195`) all read the raw persona column. The panel labelled "effective config" shows a number three of the four consumers do not use. |
| **A declared money limit with no consumer** | `EnclavePolicy.max_cost_usd = 1.0` — 0 enforcement sites. `budget_alert_rules.threshold_usd` — a table, an index, 0 readers, 0 writers. Both read as shipped features. |
| **A tier that caps requests and not dollars** | `TierConfig` — free/pro/enterprise, three limits, zero money — and `from_plan` is never called outside its own tests, so every install is `free` forever. The axis the customer is billed on is the one nobody bounded. |
| **Checking the ceiling against terminal rows only, without saying so** | The gate cannot see in-flight spend. Measured: **$34.58 concurrently invisible** at 10 lanes. Defensible; undocumented at the gate. |

---

## 6. Evidence

**The one site to copy: `src-tauri/db/src/chain.rs:150-206` and `:318-350` — `CostCeilingReading` and
`read_chain_cost_ceiling`.**

It is the only place in 963 Rust files where a stored dollar limit is read as a *type* rather than a
number, and all three of its decisions are argued at the point of decision:

1. **Unset is `Disabled`, and the docstring says that is a choice, not damage** — *"Mirrors the
   monthly-ceiling convention where `0` means 'no ceiling' — a deliberate, legible choice, not data
   damage."*
2. **Corrupt is its own variant and it halts** — *"a malformed row must not silently disable the only
   brake on runaway cascade spend the way a genuinely-unset setting does"* — carrying the raw string into
   a named `chain_stop_reasons` token (`stop_reason::COST_CEILING_CORRUPT`, `:86-90`) so the refusal is
   queryable.
3. **A database error is *not* corruption** — *"A transient DB read failure is infrastructure trouble,
   not data corruption — treat like unset (fail open) rather than halting every cascade because the
   settings table hiccuped."* That distinction is the difference between a safe gate and an outage.

The use site is then trivially correct because the read did the work: `if let Some(cost_ceiling) = … { if
chain_cost_usd >= cost_ceiling { … } }` (`:345-347`) — no positivity test, nothing to get wrong.

**Also exemplary:**

- **`db/src/settings_keys.rs:672-689` — `CHAIN_MAX_LINKS`.** The *argument* for §2, written by this
  repo about this repo. Read it before you set any default to zero.
- **`db/src/repos/execution/executions.rs:1719-1752` — `MONTHLY_SPEND_PREDICATE` + `get_monthly_spend`,
  with `commands/communication/observability/metrics.rs:172-205`.** Two readers, one SQL fragment, and a
  27-line doc comment naming the three axes ("status set / month boundary / ops-chat excluded") and the
  consequence of drift ("the UI badge stops matching what the server actually enforces"). The metrics
  side goes further and **deliberately ignores its own `utc_offset_minutes` argument** — *"a
  local-timezone boundary would make the badge disagree with the gate that actually blocks runs"* —
  which is a team choosing correctness over the more obvious behaviour. Copy this whenever a number is
  both shown and enforced.
- **`src/engine/director_lab.rs:91-140, 285-371`.** The reader that cannot be corrupted into permission
  (`.filter(is_finite && >= 0.0).unwrap_or(POSITIVE_DEFAULT)`), the spend query scoped to exactly the
  rows the budget governs, and a refusal that is a **row**, carries its arithmetic, happens before any
  spend, and retries in place when the ledger refills.
- **`src/commands/infrastructure/overnight.rs:125-146, 389-427`.** Pure verdict; projected cost added to
  actual before the decision; a breach that **degrades durably** through the same setting the cockpit
  reads, warns, and notifies. The only forward-looking ceiling in the app.
- **`src/engine/deliberation.rs:48, 162-176`.** A positive default, so 142 of 142 live deliberations ran
  under a ceiling without anyone configuring anything — and the largest reached $4.73 against $5.00. That
  is the counterfactual proof for §2: a default that is a number is both harmless and load-bearing.
- **`db/src/policy_tuning.rs:384-400` with its evidence floor at `:114 min_spend_rows: 20`.** A system
  that notices it has no ceiling and proposes one, and declines honestly when the evidence is thin.

---

## 7. Deviations found

### 7.A Five money ledgers, 33 aggregates, and the ceiling is compared against the smallest one

The live databases hold five columns that record dollars:

| Ledger | DB | rows | USD | Who compares a ceiling to it |
|---|---|---:|---:|---|
| `persona_executions.cost_usd` | main | 2,188 | **$2,036.26** | the per-persona monthly gate, the badge, the Limits tab's bar |
| `provider_audit_log.cost_usd` | main | 4,001 | **$3,682.25** | **nobody** — a finer-grained mirror of the same executions incl. failovers/retries |
| `companion_turn.cost_usd` | **user** | 1,779 | **$357.96** | **nobody** — a different database entirely |
| `dev_llm_spend.cost_usd` | main | 88 | **$118.07** | **the global monthly ceiling governor, and the auto-tuner** |
| `team_deliberations.cost_spent_usd` | main | 142 | **$138.35** | `floor_breach` (the one that works) |

Independent lifetime spend (excluding `provider_audit_log`, which mirrors executions at a finer grain):
**$2,512.29.**

**The consequence is exact.** `overnight.rs:307-315 month_spend_usd` reads `dev_llm_spend`.
`db/src/repos/execution/policy_evidence.rs:98-103` — the auto-tuner's evidence — reads `dev_llm_spend`.
For June 2026 that table holds **$3.37**. The same month in `persona_executions` is **$2,036.26**. So:

- the "hard PRE-dispatch governor" for the *global* monthly ceiling is measuring **0.17%** of the money;
- the auto-tuner that would propose a ceiling proposes `spend × 1.5` — it would suggest **$5** for a month
  that cost **$2,036**;
- and neither of those numbers is what the Limits tab draws.

**The Limits tab is a third answer.** `LimitsSettings.tsx:56` calls `getMetricsChartData(186)` and buckets
`chart_points[].cost` by month. That query (`db/src/repos/execution/metrics.rs:759-772`) sums `cost_usd`
over `persona_executions` with **no status filter and no ops-chat exclusion** — i.e. deliberately not
`MONTHLY_SPEND_PREDICATE`, whose entire doc comment exists to stop exactly this. **On today's data the two
happen to agree** ($2,036.26 both ways: 0 non-terminal rows carry cost and there are 0 `_ops` rows in the
whole database), which is an accident of this dataset and not a property of the code. The divergence is
structural and currently unexercised — report it as such.

Across the tree: **33 `SUM(cost_usd)` sites in 16 files** (two independent implementations reconciled
exactly), of which **2 use `MONTHLY_SPEND_PREDICATE`**, 3 hand-roll their own status filter, and 28 apply
none. Most of the 28 are charts and digests and are fine; the point is that nothing distinguishes an
authority from a chart, so the next money aggregate has 33 examples and no rule.

### 7.B The UI says the ceiling is not enforced. One subsystem enforces it hard.

`en.json` › `settings.limits`, rendered on the only screen that writes `monthly_cost_ceiling_usd`:

> `description`: *"Stage 1 (this build) is informational — it shows progress and warnings but does not
> block runs. Stage 2 will enforce the ceiling at execution-dispatch time."*
> `stage1_note`: *"Stage 1: informational only. Stage 2 will gate execution dispatch when the ceiling is
> crossed."*
> `over_budget`: *"You have exceeded your monthly ceiling. Stage 2 will block new executions when this
> happens; for now, treat this as a warning."*

Three strings, all shipped in 14 locales, all saying the same thing. `settings_keys.rs:350-353` agrees:
*"Stage 1 is informational-only; Stage 2 will gate execution dispatch."*

`commands/infrastructure/overnight.rs:389-427` does not agree. It reads the same key, computes a
`BudgetVerdict`, and on `Block` **refuses the night's dispatch and writes `autopilot_mode:<project> =
"suggest"` through `settings::set`** — a durable, persisted downgrade of that project's autonomy that the
operator must undo by hand, triggered by a setting they were told was informational.

Both behaviours are defensible. Shipping both is not. And note the asymmetry in who is protected: the
enforcement applies to the *unattended* lane (which spends $118) and not to the *interactive* one (which
spends $2,036) — P6, inverted.

### 7.C Eight sites decide whether a dollar limit applies by asking whether it is positive

Enumerated by the census rule in §9; all eight opened and confirmed.

| Site | The expression | What it costs |
|---|---|---|
| `engine/src/prompt/cli_args.rs:133` | `if budget > 0.0 { push("--max-budget-usd") }` | **the only per-call dollar bound in the app declines itself.** With `max_budget_usd` NULL on 78 of 78 personas, the flag has been emitted zero times |
| `src/commands/execution/executions.rs:354` | `if budget > 0.0 { …get_monthly_spend… }` | the manual/API admission gate is skipped entirely |
| `src/engine/background.rs:2052` | `matches!(max_budget, Some(b) if b > 0.0 && spend >= b)` | the cron gate, in a helper whose docstring correctly calls `0.0` *"a LEGAL value … that means 'unlimited'"* — the convention is documented, which is why it propagated |
| `src/engine/background.rs:2510` | `if matches!(max_budget, Some(b) if b > 0.0)` (short-circuit) | a fourth spelling of the same test, four lines from the third; invisible to §9's rule because the binding is named `b` |
| `src/engine/mod.rs:2783` | `if budget > 0.0 && monthly_spend >= budget` | the post-hoc budget-alert message. **0 rows in `persona_messages`** |
| `src/engine/deliberation.rs:168` | `if budget > 0.0 && cost_spent_usd >= budget` | **defeats its own default**: `:167` resolves `None` to `DEFAULT_COST_BUDGET_USD = 5.0`, and then a stored literal `0.0` still disables the floor |
| `src/commands/teams/deliberations.rs:43` | `cost_budget_usd.filter(\|b\| *b > 0.0)` | normalises `0` → `None` at the IPC door — which `floor_breach` then turns into **$5.00**, the inversion in §5 |
| `core/src/run_budget.rs:198` | `if entry.state.ceiling_usd > 0.0 && spent >= ceiling` | the aggregate ledger; `0.0` is documented as *"unlimited (track-only)"* |
| `src/commands/infrastructure/overnight.rs:321-325` | `settings::get(…).ok().flatten().and_then(parse).filter(\|v\| *v > 0.0)` | collapses unset, zero **and corrupt** into one permissive `None` |
| `db/src/repos/execution/policy_evidence.rs:115` | `settings::get(…).and_then(parse).unwrap_or(0.0)` | same collapse, feeding the auto-tuner (already counted by `unknown-money-as-zero`; not re-counted here) |

**Four spellings** — `> 0.0`, `matches!(… if … > 0.0)`, `.filter(|v| *v > 0.0)`, `unwrap_or(0.0)` — plus
`None => Allow` at `overnight.rs:127`. The reason there are four is that the concept has no name; §2's fix
is to give it one.

### 7.D Three money surfaces are declared and consumed by nothing

- **`engine/src/enclave.rs:31 EnclavePolicy.max_cost_usd: f64`**, defaulting to a perfectly sensible
  `1.0` (`:47`), documented *"Maximum cost in USD the enclave may spend per execution"*, exported to TS
  via ts-rs, and settable through `commands/network/enclave.rs:17`. A grep for `max_cost_usd` across all
  963 Rust files returns **five hits: the declaration, the default, and three unrelated `chain` strings.
  Zero enforcement sites.** An integrator can seal an enclave with a $1 cap and nothing will ever read it.
- **`budget_alert_rules`** (`migrations/schema.rs:564-572`) — `persona_id`, `rule_type DEFAULT
  'per_execution'`, `threshold_usd REAL NOT NULL`, `enabled DEFAULT 1`, plus an index. It is the **only
  money column in the entire schema declared `NOT NULL`**, which means somebody thought carefully about
  it. Grep for the table name or the column across `src-tauri/` and `src/`: **the DDL and the index. No
  insert, no select, no type, no UI.** 0 rows live.
- **`engine/src/tier.rs::TierConfig`** — `tier_name` (free/pro/enterprise), `event_source_max`,
  `webhook_trigger_max`, `max_queue_depth`. **No money field.** `enterprise` spells unlimited as
  `usize::MAX`, which is a *fifth* spelling of unlimited in this repo and incidentally the safest one
  (it cannot be confused with "off", and `tier_usage.rs:85` guards it explicitly). And
  `TierConfig::from_plan` — the function that would ever make an install anything but free — **has zero
  call sites outside its own unit tests**; `lib.rs:1135` constructs `TierConfig::default()`, which is
  `free()`. So the paid tiers exist, cap no dollars, and are unreachable.

This is the money-axis mirror of [`autonomy-gating`](./autonomy-gating.md) §7.G, which found two autonomy
*flags* with no consumer. Here it is three *limits*.

### 7.E The workspace cascade reaches one of four consumers

`engine/src/config_merge.rs:155-159` resolves `max_budget_usd` through persona → workspace → global
(*"No global budget default"*), and `runner/mod.rs:174` applies the result back onto the persona *"so
that downstream code (prompt building, budget enforcement, etc.) sees the cascaded result"*. It does —
for the argv.

The other three readers do not go through the cascade:

| Reader | Reads | Effect of a workspace default |
|---|---|---|
| `runner/mod.rs:174` → `cli_args.rs:132` | **cascaded** | a workspace `$5` becomes `--max-budget-usd 5` |
| `commands/execution/executions.rs:353` (admission gate) | `persona.max_budget_usd` raw | **no monthly cap at all** |
| `commands/execution/executions.rs:886` (cost preview) | `persona.max_budget_usd.unwrap_or(0.0)` | preview shows "no budget" |
| `metrics.rs:195` (the spend badge) | `p.max_budget_usd` from the `personas` table | badge shows no budget |

So a workspace-level budget produces a per-call cap and no monthly cap, and the panel literally titled
"effective config" (`EffectiveConfigPanel.tsx:109`) displays a number that three of the four consumers
ignore. **Live this is latent — all 8 teams have `default_max_budget_usd = NULL`** — so it is a trap set
for the first operator who uses the feature, which is the worst kind.

This compounds [`llm-spend-accounting`](./llm-spend-accounting.md) §7.H (one field, two units): the same
field now also has two *resolution paths*.

### 7.F The gate cannot see in-flight money, and the amount is measurable

`MONTHLY_SPEND_PREDICATE` counts terminal statuses only — correctly, and its doc comment says so. The
consequence is that a pre-flight check is blind to every run currently executing.

Replaying the live `started_at`/`completed_at` intervals for all 2,188 executions:

- **max simultaneous executions: 10** — exactly `MAX_PARALLEL_EXECUTIONS_DEFAULT` (`settings_keys.rs:580`),
  so the *concurrency* ceiling is the only ceiling in this app that has ever bound anything;
- **max simultaneous spend invisible to the gate: $34.58**, on 2026-06-10;
- per-run cost distribution (n = 1,970 non-zero): **p50 $0.843 · p90 $1.892 · p99 $3.961 · max $7.160**.

So the theoretical overshoot is `10 × p99 ≈ $40` and the observed one was $34.58. A `$50` monthly cap
could therefore be crossed by up to ~70% before the gate saw a dollar of it. Nothing in the gate, the
docstring or the UI states this. The fix is not a smaller ceiling; it is a reservation (§8.4).

### 7.G What a per-persona budget would have caught, and why 0 of 78 have one

The per-persona gate is the **best-built ceiling in the app** — one predicate, three call sites, a
documented incident history (*"the old query had no `budget > 0.0` guard, so `0.0 >= 0.0` made such
personas permanently 'over budget' and silently paused"*, `background.rs:2489-2492`). It has never run,
because the field is NULL on all 78 personas and the persona editor offers an empty text box
(`PersonaDraft.ts:130` `maxBudget: persona.max_budget_usd ?? ''`) with no default, no placeholder value
and no suggestion.

Replayed against the live month — 59 personas with spend, max **$94.87**, median **$32.99**:

| a per-persona budget of | personas paused | spend that would have been prevented |
|---:|---:|---:|
| $5 | 57 of 59 | $1,746.71 |
| $10 | 52 of 59 | $1,472.79 |
| $25 | 40 of 59 | $751.18 |
| $50 | 10 of 59 | $160.79 |

And the runs that produced nothing: **238 failed executions cost $53.48; 98 retries cost $76.66.**

### 7.H The frontend hardcodes a backend default, twice

`src/features/fleet/monitor/channels/ConversationCards.tsx:234` and
`src/features/fleet/monitor/channels/DeliberationRail.tsx:41`:

```tsx
const budget = Number(detail.costBudgetUsd ?? 5);
```

`DEFAULT_COST_BUDGET_USD = 5.0` lives at `src/engine/deliberation.rs:48`. Three copies, no binding, no
test. Every live deliberation (142 of 142) has `cost_budget_usd = NULL`, so **every progress bar in the
app is currently drawn against a constant the frontend guessed** — and it happens to be right. Changing
the Rust constant changes what the engine enforces and not what either bar shows.

The leaf is `sides: both`, and this is the contract: **the backend owns the default; the frontend must
receive it, not restate it.** The correct shape is to resolve the effective budget server-side and put it
on `DeliberationDetail`, so `?? 5` becomes unwritable.

### 7.I What this path CLEARED

Four things the obvious reading predicts and the measurement refutes:

- **"The status set is wrong and billed work escapes the ceiling."** No. `MONTHLY_SPEND_PREDICATE` names
  **all four** terminal statuses — `completed, failed, incomplete, cancelled` — and reasons about why
  (*"Cancelled rows may have consumed API credits before the process was killed"*). It is the
  **reliability** queries that name three; on the *money* axis the four-status set is the compliant form
  and this repo has it. Live, the two extra statuses contribute **$0.00 across 22 rows**, so the axis is
  correct and currently inert. (The genuinely uncounted category is `running`/`queued`, which is §7.F.)
- **"Nothing checks a ceiling before the money is committed."** No — **four** things do:
  `executions.rs:353` (before the record is created), `background.rs:2510` (before the cron fires),
  `overnight.rs:389` (before dispatch, against a *projected* cost — the only forward-looking one), and
  `director_lab.rs:316` (before any model call, with a durable decline). The defect is not the ordering;
  it is that three of the four compare against a limit that is unset and one compares against the wrong
  ledger.
- **"`0 = unlimited` is undocumented folklore."** No — it is written down four times
  (`settings_keys.rs:353, 669, 680`; `background.rs:2045-2048`) and unit-tested
  (`chain.rs:2004-2032 test_chain_budget_disabled_by_default`). **The convention is well-documented,
  consistently applied and load-bearing, which is exactly why it spread to eight sites.** A convention
  everyone follows correctly is harder to dislodge than a bug.
- **"Nobody in the app can propose a ceiling."** `policy_tuning.rs:384-400` can, with an evidence floor,
  and no sibling repo has anything like it (0/5). It is pointed at the wrong ledger (§7.A) and its output
  table has 0 rows, but the design is right and should be kept.

---

## 8. Gaps in the primitives

### 8.1 There is no shared ceiling type, and the one that exists is private to one file

`CostCeilingReading` is `enum` (not `pub enum`) inside `db/src/chain.rs`, with `read_chain_cost_ceiling`
as a private `fn`. Nothing outside that file can use it, so `overnight.rs`, `policy_evidence.rs`,
`director_lab.rs` and `run_budget.rs` each re-derive the same read in a different shape. **This is the
root cause of §7.C and most of §0.** The fix is small and mechanical: move the enum to
`personas_core` (or `db::settings_keys`), generalise it to `Ceiling<T>`, and give it one constructor from
a settings key.

### 8.2 `Option<f64>` is the money type, and it cannot carry a unit or a period

One `Option<f64>` on the persona is a **monthly** ceiling at `executions.rs:355` and a **per-call**
ceiling at `cli_args.rs:134` — [`llm-spend-accounting`](./llm-spend-accounting.md) §7.H. The gap this path
adds is that **no type in the tree carries a period at all**: `MONTHLY_COST_CEILING_USD`,
`DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD`, `CHAIN_MAX_COST_USD` (per-trace) and
`DEFAULT_EVOLUTION_CEILING_USD` (per-run) are all bare `f64`, and the period lives only in the key's
name. A `Ceiling<T>` that does not also encode `{ PerCall, PerRun, PerDay, PerMonth }` will let the same
confusion recur under a nicer name.

### 8.3 Nothing reconciles the five ledgers, and no type says which one is authoritative

`persona_executions`, `provider_audit_log`, `companion_turn` (a **different database**), `dev_llm_spend`
and `team_deliberations.cost_spent_usd` all hold dollars. There is no view, no function and no test that
sums them, and the two subsystems that enforce a *global* ceiling both picked `dev_llm_spend` — the
smallest, at 4.7% of the total — apparently because it is the one their neighbours were writing to. Until
one function answers "what has this app spent in period P", every new ceiling will pick a ledger by
proximity.

### 8.4 There is no reservation, so every ceiling is check-then-spend

The convergence oracle found exactly one repo of five with a reserve→settle pattern (`ascent`), and it is
that repo's stated central doctrine, with the reasoning that applies verbatim here: *"the old 'scan first,
debit after' ordering let the loser run real LLM inference and then fail to debit."* Personas has no
equivalent — no held balance, no atomic conditional decrement, no refund path. The measured cost of the
absence is §7.F's $34.58. A minimal version is one table and two functions
(`reserve(run_id, projected) -> Option<Handle>` with a `WHERE remaining >= projected` conditional update,
and `settle(handle, actual)`), and it would make the ceiling exact rather than approximate.

### 8.5 A breach has no shared shape

Four subsystems refuse on money and produce four different artifacts: a `chain_stop_reasons` row
(`budget_exceeded`), a `declined_budget` status on a Director experiment, an `AppError::Validation`
string from the admission gate, and a `blocked_reason` field on a night-run row. There is no
`gate_decisions(gate, verdict, day, count)` rollup, so "has any spend ceiling ever said no" is five
queries against five schemas — which is how §0's zeros stayed invisible. This is the money instance of
[`autonomy-gating`](./autonomy-gating.md) §8.6; one rollup would serve both.

### 8.6 The persona editor offers a budget field with no default and no guidance

`PersonaDraft.ts:130` binds `maxBudget: persona.max_budget_usd ?? ''` and `useEditorSave.ts:74` writes
`d.maxBudget === '' ? null : d.maxBudget`. An empty box, no placeholder amount, no "typical run costs
$0.84" hint, and no indication that leaving it blank means unlimited. 78 of 78 personas took the default.
**A field whose empty state is the dangerous state must say so in the field**, and this one is where the
$2,036 went.

### 8.7 `TierConfig` has no money axis and no way to grow one

Adding a spend cap per tier today means adding a field to `TierConfig`, finding a reader (there is no
central admission point that knows the tier — `tier_config` is consulted only by the webhook/event rate
limiter and the usage snapshot), and reconciling it with a global `app_settings` ceiling that is not
tier-aware. The convergence result (0/5 siblings cap dollars per tier) suggests this is a genuinely open
design question rather than an oversight — but the current shape actively prevents answering it.

---

## Convergence — what the five sibling repos say

| Clause | brainiac | personas-cloud | ascent | vibeman | personas-web | Verdict |
|---|---|---|---|---|---|---|
| A monetary ceiling exists at all | **no** (call-count only) | **yes** ×3 | credits, not $ | declared, **0 assignment sites** | **negative control** | **MIXED — 2 of 4 billable repos, one of them dead code** |
| Unset ⇒ unlimited | n/a | **yes** (documented) | yes (enterprise, deliberate) | **yes** (`None`) | — | **Convergent failure 3/4. This repo: 8 sites, 4 spellings** |
| Corrupt ceiling fails restrictive | **yes** (uncorruptible `const`) | **no** (NaN compare permits *and* mutes the warning) | **yes**, 6 parse sites, test-pinned | **no** | — | **Mixed 2–2. This repo: 1 of 6 readers (`chain.rs`)** |
| Checked before the money is committed | mid-run halt | 1 of ≥4 doors | **5 of 5 doors, reserve-first** | none | — | **Physics 3/4 on the idea; coverage is where they differ** |
| Reserve→settle (not check-then-spend) | no | **no** (documented race) | **yes**, central doctrine | no | — | **1 of 4. This repo: absent (§8.4)** |
| The gauge and the gate read the same rows | n/a | **no** (4 numbers, unreconciled) | **no** (gate ≠ gauge, same denominator) | n/a | — | **Convergent failure 2/2 among repos that have two numbers. This repo: 5 ledgers (§7.A)** |
| A documented "these must stay in lock-step" invariant | — | — | **yes** ×3 — but gate↔gate only | — | — | **Physics 2/2, and both cover one pair and miss the UI** |
| Spend-driven degrade governor | — | — | batch truncation (different mechanism) | health-driven only | — | **Silence 0/5 — this repo's `full → suggest` is an invention** |
| Ceiling proposed from observed spend | — | — | advisory only, writes nothing | — | — | **Silence 0/5 — `policy_tuning.rs` is an invention** |
| A paid tier carries a **dollar** cap | visibility tier | no tiers | volume + price, **no $ cap** | rate tier | — | **Silence 0/5 (six with this repo)** |
| Concurrency caps the fan-out | **4** | 1 | **4** | **4** | — | **Physics 4/4, three chose the literal 4** |
| Failed/cancelled spend counts against the ceiling | **yes**, deliberately | yes, no refund path | **no** — refunded at 6 sites | no policy | — | **Mixed. This repo counts it: $53.48 of failures** |
| Anyone counts how often the gate fired | **no** | **no** | **no** | **no** | — | **Silence 5/5** |

**The sharpest external finding, and the one that most directly validates P4:** `ascent` is by a distance
the most careful money codebase of the six — reserve before inference, atomic conditional decrement,
idempotent retries, refund on no-product, and three explicitly-documented "these two must agree"
invariants — and its usage gauge is still computed by a different query than its gate
(`credits.ts:285-287` vs `usage.ts:135`), then rendered against **the gate's own denominator**
(`usageDashboard.tsx:110` → `AllotmentPanel.tsx:29-36`). If a team that writes
*"makes that drift structurally impossible"* in a comment can ship that, the clause is not a discipline
problem. It is a type problem.

**The second sharpest, and the reason P1 is stated the way it is:** across four billable codebases,
**capping calls is physics and capping dollars is not.** Everyone bounds fan-out — three of them at the
literal number 4 — and half of them have no dollar ceiling at all. The unit engineers can reason about
locally gets a constant; the unit the business is billed in gets a config field and a blank default.

---

## Type over gate — the answer

**Yes, decisively, and the unusual part is that the type is already written and shipping — it is just
private to one file.**

[`autonomy-gating`](./autonomy-gating.md)'s Type-over-gate move 2 proposed
`enum Ceiling<T> { Unlimited, At(T) }` and called it "the one the repo has not done".
**`db/src/chain.rs:150-206` is that type**, with one variant more and a better name for each:

```rust
enum CostCeilingReading { Disabled, Configured(f64), Corrupt(String) }
```

Held against the seven earned qualifications:

**1. Promote `CostCeilingReading` to `Ceiling<T>` in a shared crate — the whole move.**
**Qualification 2 is the trap and it is worth restating because it is the reason this looks like a
non-fix**: making `ceiling: f64` *required* changes nothing, because `0.0` is already required and
already means unlimited. Requiredness is not the axis. **Closedness is the entire win**, and the third
variant is what makes it more than a rename: `Corrupt` is a state the current `f64` cannot represent at
all, and it is the state where the brake matters most. **Qualification 1 bounds the claim honestly**: the
type constrains the *shape*, not the *policy* — somebody can still write `Ceiling::Unlimited` as a
default, and only review of that one line stops them. That is still strictly better than four spellings
of zero, because `Ceiling::Unlimited` is a thing a person typed and `0.0` is a thing nobody typed.
**Qualification 3 decides the scope**: a type nobody constructs constrains nothing, so the constructor
must be the *only* way to read a money key — `settings::get` for `MONTHLY_COST_CEILING_USD` /
`CHAIN_MAX_COST_USD` / `DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD` must become unreachable outside the module
(the keys `pub(crate)` to it), or the eight sites in §9 will simply keep reading the raw string.

**2. Make the unconfigured value a number at the declaration.** The cheapest edit in this document and
the one with the largest measured effect: `MONTHLY_COST_CEILING_USD_DEFAULT` and
`CHAIN_MAX_COST_USD_DEFAULT` from `0.0` to a real figure, chosen with the `CHAIN_MAX_LINKS_DEFAULT`
sentence attached. **Qualification 5 — withholding beats requiring — is why this beats "make the operator
set it"**: the operator was already free to set it and 0 of 78 did. Withhold the *unarmed state*, not the
choice. The proof it is safe is in this repo's own data: `DEFAULT_COST_BUDGET_USD = 5.0` armed **142 of
142** deliberations with no configuration, cost nothing (max spend $4.73), and is the only dollar ceiling
that has ever been live.

**3. Encode the period in the type, not the key name.** `Ceiling<PerCall>` vs `Ceiling<PerMonth>`, so the
`Option<f64>` that is simultaneously a monthly cap and a per-call cap
([`llm-spend-accounting`](./llm-spend-accounting.md) §7.H) becomes two fields the compiler keeps apart.
**Qualification 1 again**: a required `max_budget_usd` carries only "a number of dollars" — it cannot
carry "per what", which is precisely the fact the bug turns on.

**4. Withhold the un-predicated money aggregate.** `MONTHLY_SPEND_PREDICATE` is a `pub const &str`
anybody may interpolate or ignore; 31 of 33 `SUM(cost_usd)` sites ignore it. **Qualification 7 says
widening the callers' types is inert here** — they supply their own SQL voluntarily. The construction is
what must be withheld: a `fn monthly_spend(scope: SpendScope) -> f64` that owns the predicate, with the
raw aggregate unavailable outside the repo layer. **Qualification 4 bounds it**: a newtype anyone can
construct authenticates nothing, so the win is at *visibility*, not at the signature.

**5. Send the default down the wire instead of restating it.** §7.H's `?? 5` in two TSX files is a
type-level absence: `DeliberationDetail` has no *effective* budget field, so the frontend has nothing to
render but a guess. **Qualification 6 identifies the dangerous freedom correctly**: what to withhold is
"the ability to invent a fallback", not "the ability to display a budget" — add
`effectiveCostBudgetUsd: number` (non-null) to the binding and `?? 5` becomes unwritable.

**What the gate is for.** None of the five is a substitute for §9's rule and §9 is not a substitute for
them. Move 1 makes §9's condition unrepresentable — at which point the rule reaches zero and, per the
census contract, must be **deleted** rather than baselined. Until then it holds the line at 8 and makes
the ninth spelling visible on the day it lands.

---

## 9. The missing gate

**Manifestation layer** ([`golden-path-contract.md:43-69`](../golden-path-contract.md)). The warning must
be loud: **no sibling repo gates anything in this document**, and two of the four billable ones have no
dollar ceiling for a gate to key on. The condition below travels; the signal does not. An adopting repo
must re-derive its own proxy for *"the code decides whether a money limit applies by asking whether the
limit is positive"* — in a TypeScript repo that is `if (x && x > 0)` or `?? Infinity`; in a
Prisma/Postgres repo it is a nullable numeric column with no `DEFAULT`.

**Where this gate executes, and why not CI.** `npm run census:check`, which runs **from a developer shell
and from the repo's pre-push hook.** As of composition, `ci.yml` runs its Rust tests but is red on **10
pre-existing `personas-db` failures**, and `frontend-checks` is red on a platform-incomplete lockfile — a
gate that only runs in CI right now runs nowhere. `npm run census` prints surviving counts on success, so
a passing run is distinguishable from one that checked nothing.

### Checked first — the existing 101 census rules

| Rule | Overlaps? |
|---|---|
| **`unknown-money-as-zero`** (21 files / 25, `llm-spend-accounting.md`) | **Yes, adjacently — and this path deliberately does not extend it.** It counts a monetary quantity *collapsed to 0 by a zero-default operator* (`unwrap_or(0`, `?? 0`), and its own description names `background.rs:2510` and `engine/mod.rs:2778`'s `get_monthly_spend(...).unwrap_or(0.0)` as the two highest-severity matches because they *open* the cap. That is the **observed-spend** side of the same arithmetic. Mine is the **limit** side: `budget > 0.0`. Zero file overlap on the matched lines (`unwrap_or(0` vs `> 0.0`), and the two compose — a spend of 0 against a ceiling of 0 is two independent failures reaching the same `Allow`. `policy_evidence.rs:115` is theirs, not mine, and is excluded from my count by shape. |
| `partial-terminal-status-set` (6 / 14, `terminal-state-and-recovery.md`) | Counts a `status IN (…)` list bound to `persona_executions` that cannot contain `incomplete`. `MONTHLY_SPEND_PREDICATE` names all four and is **compliant** with it (§7.I). Orthogonal, and its existence is why I did not re-gate the status axis. |
| `settings-bool-by-string-compare` (15 / 18) · `settings-key-declared-outside-registry` (8 / 10) | Both `app-settings-store.md`. The first counts a **bool** decoded by string compare; every money key is an `f64` parse, so zero overlap. The second counts a key const outside the registry; all three money keys are correctly in it. |
| `config-value-frozen-at-compile-time` (4 / 11) · `env-default-conflates-unset-with-empty` (4 / 4) | Environment-sourced config. `run_budget.rs`'s `PERSONAS_RUN_BUDGET_*` are arguably theirs; not re-counted here. |
| `undeclared-tier-branch` (13 / 13, `tier-and-capability-gating.md`) | Product-tier booleans in `src/`. §7.D's finding is that `TierConfig` carries no money — an **absence**, which the census cannot express (below). Disjoint. |
| `hand-assembled-currency` (39 / 50) · `locale-blind-percent` | `number-and-cost-formatting.md`. Rendering money, not bounding it. |
| `empty-sample-as-confident-zero` (16 / 34, `metric-definition.md`) | Counts a `> 0` guard whose *then* branch divides and whose *else* is `0.0`. Shares the `> 0` token and nothing else — its consequent requirement (`as f64 … /`) excludes every one of my eight. Checked line-by-line: **zero overlapping matches.** |
| `untimed-repo-query` (36 / 245) · `nullable-default-column` (4 / 27) · `constraintless-table-declaration` (6 / 15) | Checked; no overlap with a ceiling's positivity test. |

### The semantic conditions, stated stack-free

**C1 — a money limit is applied only when it is positive, so an unconfigured one applies nothing.**
*Gated below.*

**C2 — a money limit is declared with "no limit" as its default.** *Not gateable; see below.*

**C3 — the ceiling is compared against a different row set than the operator is shown.** *Not gateable;
specification for a different instrument below.*

**C4 — a declared money limit has no consumer.** *Not gateable by counting; see below.*

**C5 — a paid tier carries no dollar cap.** *An absence; not gateable, and per the oracle not yet
doctrine.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C2 (a zero-valued money default) — measured and declined, because the population is 3.** The whole
  tree holds **three** `*_DEFAULT: f64` naming a dollar limit (`settings_keys.rs:348, 357, 669`), two of
  them `0.0`. A census rule over a three-item population is a ratchet on a hand-countable list; the right
  instrument is a **`#[test]` in `settings_keys.rs`** asserting that every `*_USD_DEFAULT` is `> 0.0` or
  is named in an explicit `INTENTIONALLY_UNLIMITED` allowlist with a comment. One assertion, not a
  matcher. Filed as backlog item 13.
- **C3 (gauge ≠ gate) — designed, measured, rejected on precision.** The condition is "a `SUM(cost_usd)`
  used as an authority does not share the canonical predicate". Anchor: **33 `SUM(cost_usd)` matches
  across 16 files** (two independent implementations agreeing exactly). Partition: **2 use
  `MONTHLY_SPEND_PREDICATE`, 3 hand-roll a status filter, 28 apply none** — but the great majority of
  those 28 are charts, digests and observability panels that *legitimately* want unfiltered rows. Gating
  it would fire on correct content at roughly **80% false-positive rate**, and the contract forbids that.
  **Refusing is the finding**, and the reason is instructive: "is this aggregate an authority?" is a
  question about the *consumer*, and the consumer is in another file. The right instrument is a
  **`#[test]`** asserting that the ceiling-enforcing readers and the ceiling-displaying readers return
  the same number for a seeded fixture — one test, three call sites, and it would have caught the
  $3.37/$2,036.26 split on the day it landed. Filed as backlog item 4.
- **C4 (a declared money limit with no consumer) — not gateable.** "This field is referenced only by its
  declaration and its default" is a whole-program reachability question, not a regex. The instrument is
  the same one [`autonomy-gating`](./autonomy-gating.md) §9 specified for orphan settings keys, widened
  to money-typed struct fields and DDL columns. It would have caught `EnclavePolicy.max_cost_usd` and
  `budget_alert_rules.threshold_usd` on the day each became an orphan.
- **C5 (no dollar cap per tier) — an absence, and per the oracle not yet doctrine.** The census
  explicitly cannot assert an absence. And 0 of 5 sibling repos cap dollars per tier, so gating it here
  would ratchet a practice with no external evidence that it pays. It stays §7.D and an open design
  question.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "self-disabling-money-ceiling",
      "goldenPath": "docs/concepts/golden-paths/spend-ceilings.md",
      "title": "A dollar ceiling applied only when it is positive — so an unconfigured one bounds nothing",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:\\b(?:budget|ceiling)\\w*\\s*>\\s*0\\.0\\s*(?:&&|\\{)|\\b(?:budget|ceiling|cost_budget|max_budget)\\w*(?:[^;\\n]{0,90}?)\\.\\s*filter\\s*\\(\\s*\\|\\s*&?\\w+\\s*\\|\\s*\\*?\\w+\\s*>=?\\s*0(?:\\.0)?\\s*\\)|(?:CEILING|BUDGET|COST)_USD\\s*\\)(?:[^;]{0,220}?)\\.\\s*filter\\s*\\(\\s*\\|\\s*&?\\w+\\s*\\|\\s*\\*?\\w+\\s*>=?\\s*0(?:\\.0)?\\s*\\))",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a site that decides whether to apply a MONEY limit by testing whether the limit is greater than zero — either an inline positivity guard on a budget/ceiling identifier, or an Option chain that normalises a stored dollar ceiling's zero away with .filter(|v| *v > 0.0). PROXY FOR the stack-free condition: a limit's unconfigured value is read as 'no limit', so the protection an operator never configured is the protection that never exists, and the convention has to be re-spelled at every use site. THE FOUR SPELLINGS ARE THE POINT: `budget > 0.0 &&` (background.rs:2052, deliberation.rs:168, mod.rs:2783, run_budget.rs:198), `if budget > 0.0 {` (cli_args.rs:133, executions.rs:354), `.filter(|b| *b > 0.0)` on an IPC argument (deliberations.rs:43), and the same filter on a settings read (overnight.rs:321) — four expressions of one idea, which is what a codebase looks like when the idea has no name. PRECISION 8/8, every match opened and confirmed. THE SEVERITY IS NOT UNIFORM AND THE WORST ONE IS cli_args.rs:133: it is the ONLY per-call dollar bound this application can emit, and it declines to emit itself when the value is 0.0 — which it is, on 78 of 78 personas in the operator's live database. deliberation.rs:168 is the subtlest: line 167 resolves an absent budget to DEFAULT_COST_BUDGET_USD = 5.0, and then this guard lets a literal stored 0.0 defeat that default anyway. RECALL is deliberately partial and three gaps are named: background.rs:2510 is a fourth spelling four lines from background.rs:2052 whose binding is named `b` rather than `budget`; policy_evidence.rs:115 flattens the same ceiling with .unwrap_or(0.0), which belongs to `unknown-money-as-zero`; and executions.rs:886 does the same for a cost preview. A site whose positivity test uses a single-letter binding or an integer zero is invisible here. PRECONDITION (must be re-derived per repo): this repo denominates limits in f64 USD and spells 'no limit' as 0.0, a convention documented four times (settings_keys.rs:353,669,680; background.rs:2045) and unit-tested (chain.rs:2004). A TypeScript repo expresses the identical condition as `if (x && x > 0)` or `?? Infinity` and scores ZERO here — which is what all four billable sibling repos audited for this path do, and why none of them has this rule."
      },
      "exclude": [
        { "path": "src-tauri/db/src/policy_tuning.rs", "reason": "the budget AUTO-TUNER, not a gate: policy_tuning.rs:387-393 classifies an existing ceiling against observed spend to propose introduce/raise/lower, so testing the ceiling's positivity is the whole subject of the branch rather than a way of skipping a bound. Excluding it moved precision from 8/10 to 8/8." }
      ],
      "baseline": { "files": 8, "matches": 8 },
      "floor": 900
    },
    {
      "id": "self-disabling-money-ceiling-positive-control",
      "goldenPath": "docs/concepts/golden-paths/spend-ceilings.md",
      "title": "Positive control — a limit whose unconfigured state is resolved into a number or a type before the use site",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "(?:(?:if\\s+let\\s+Some\\(\\s*\\w*(?:ceiling|budget)\\w*\\s*\\)|Some\\(\\s*\\w*(?:ceiling|budget)\\w*\\s*\\)\\s*=>)(?:(?!>\\s*0\\.0)[\\s\\S]){0,300}?\\b\\w*(?:cost|spend|spent|after|links_so_far)\\w*\\s*>=?\\s*\\w*(?:ceiling|budget)\\w*|(?:budget|ceiling|BUDGET|CEILING)[\\w:]*(?:(?!;)[\\s\\S]){0,260}?\\.\\s*unwrap_or\\s*\\(\\s*(?:(?:[A-Za-z_][A-Za-z0-9_:]*?)?DEFAULT[A-Za-z0-9_]*|[1-9][0-9]*\\.[0-9]+)\\s*\\))",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT half of self-disabling-money-ceiling: the same decision — 'what does an unconfigured limit mean' — taken ONCE, at the read, and resolved into either a positive default or an Option/enum whose Some arm is then compared unconditionally. Scores 5 matches across 4 files against the violating rule's 8 across 8: chain.rs:211 (read_chain_link_ceiling -> unwrap_or(CHAIN_MAX_LINKS_DEFAULT=50)), chain.rs:346 (the cost breach test taken with no positivity guard, because CostCeilingReading already resolved it), overnight.rs:128 (the Some(ceiling) arm of budget_verdict), deliberation.rs:163 (unwrap_or(DEFAULT_COST_BUDGET_USD=5.0)) and director_lab.rs:91 (unwrap_or(DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT=2.0)). Precision 5/5, every match opened. Violating and compliant do not share a lexical anchor — that is the NATURE of this condition, since the compliant form's whole point is that the positivity question never reaches the use site — so the partition is semantic: 8 + 5 = 13 is the complete set of places in 963 files where this application decides what an unconfigured dollar limit means. It must stay materially non-zero and must not overlap the violating set; a violating count that rose while this one fell would mean a compliant read had been unwound into an inline guard. It carries NO baseline by design — a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "exclude": [],
      "floor": 900
    }
  ]
}
```

### Validation — reproduced, hand-verified, fault-injected six ways, positive-controlled, re-extracted

Run against a private registry (never `scripts/census/rules.json`, per the contract's concurrent-writer
warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — **8 files / 8 matches / 963 walked / floor 900** · **exit 0** |
| Runtime | **0.44 s** for both rules. No lookbehind of any kind; the only unbounded constructs are the tempered classes `[^;\n]{0,90}`, `[^;]{0,220}` and `(?:(?!…)[\s\S]){0,300}`, none of which can leave its statement |
| Precision | **8/8** — all opened and confirmed: `run_budget.rs:198`, `cli_args.rs:133`, `executions.rs:354`, `overnight.rs:321`, `deliberations.rs:43`, `background.rs:2052`, `deliberation.rs:168`, `mod.rs:2783` |
| False positives found and excluded | `policy_tuning.rs:390,392` — the budget **auto-tuner** classifying an existing ceiling, not a gate skipping a bound. Excluded with that reason; precision went **8/10 → 8/8** |
| **Positive control** — the same decision resolved at the read | **5 matches / 4 files**, precision 5/5. Together the two rules enumerate **all 13** places in 963 files where this app decides what an unconfigured dollar limit means |
| **Two implementations disagreed, and the disagreement was a finding** | A hand-written scanner found **11 raw guard sites** where the census pattern found 9, and the census pattern found `overnight.rs:321` which the scanner missed (its money anchor was case-sensitive and the settings key is `MONTHLY_COST_CEILING_USD`). Reconciling them produced the third alternation branch and the exclusion. The same thing happened on the control: its first form silently missed `deliberation.rs:167` because `[A-Za-z_][A-Za-z0-9_:]*DEFAULT` cannot match a **leading**-`DEFAULT` constant (`DEFAULT_COST_BUDGET_USD`), only a trailing one — a two-of-five recall loss that looked like a clean result |
| Fault: baseline `7/7` (a new violation appears) | `[drift] files rose 7 -> 8 (+1)`, `matches rose 7 -> 8 (+1)` · **exit 1** |
| Fault: baseline `9/9` (a silent drop) | `[drift] files dropped 9 -> 8 (-1) without the baseline moving` · **exit 1** |
| Fault: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `zero-matches` + the stale-exclude error · **exit 1** |
| Fault: an `exclude` entry matching nothing | `[structural] exclude "…/gone.rs" matched no file. The exemption is stale` · **exit 1** |
| Fault: an `exclude` with a one-word reason | `exclude[0] … needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` at `validateRule` · **exit 1, 0 rules scanned** |
| Fault: the positive control given a `baseline` | `a positive control must NOT carry a baseline — it exists to fail, and a baselined control would ratchet against improving adoption` · **exit 1, 0 rules scanned** |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 8 files / 8 matches / 5 control matches / exit 0** |

The positive control is the load-bearing check, and here it works semantically rather than lexically. The
violating and compliant forms cannot share an anchor, because the compliant form's defining property is
that the positivity test *never appears at the use site*. What makes the partition auditable instead is
that **8 + 5 = 13 is the complete population**: every place in 963 Rust files where this application
decides what an unconfigured dollar limit means. If somebody adds a fourth money key with a proper
three-state read, the control rises; if somebody adds a ninth inline guard, the violating count rises;
and only one of those two fails the build.

### How it fails loudly if its own precondition is absent

`floor: 900` against 963 Rust files means a repo whose `roots`/`extensions` no longer describe it reports
**"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than a clean run. The `zero-matches` structural
check means a port to a TypeScript repo — where the identical condition wears `if (x && x > 0)` or
`?? Infinity` — fails immediately rather than baselining at 0, which is the correct outcome, because the
condition is present there in different syntax and this proxy cannot see it. The single `exclude` names a
real file and carries a prose reason the runner enforces, so deleting or moving `policy_tuning.rs` breaks
the build instead of silently widening the rule.

### The census cannot express "must be zero"

This condition **should** reach zero: once `Ceiling<T>` owns the read (Type-over-gate move 1), no use site
has a positivity question to ask. `assertRule` treats a zero-match rule as a structural failure (*"a rule
pinned at 0 is a gate that can never fail"*), so the correct sequence is: promote `CostCeilingReading` out
of `chain.rs`, convert the eight sites, ratchet 8→7→…→1 with `npm run census -- --update`, and when the
last one lands, **delete the rule and this section** and let the enum keep it there — which is the type
doing the work the gate was renting.

---

## 12. Corrections to the brief

**1. "Both dollar-ceiling `*_DEFAULT: f64` are `0.0`" — there are THREE, and the third is `2.0`.**
`DIRECTOR_WEEKLY_EXPERIMENT_BUDGET_USD_DEFAULT: f64 = 2.0` (`settings_keys.rs:348`) sits nine lines above
`MONTHLY_COST_CEILING_USD_DEFAULT` and is a dollar ceiling with a real, armed default, read by the
strictest ceiling reader in the tree (`director_lab.rs:91`, which also rejects corrupt values). This
correction also applies to [`autonomy-gating`](./autonomy-gating.md) §0, whose table reads "2 of 2", and
it matters because the brief's framing ("the ceilings all fail open") makes the fix sound like a policy
argument, whereas the measured shape is that **the repo already ships an armed dollar ceiling and knows
how to read one** — the fix is a generalisation, not a new idea. Recorded here rather than edited there,
per the parallel-composition rules.

**2. "`Ceiling<T> { Unlimited, At(T) }` was already proposed by the autonomy path as the move nobody
made" — somebody made it.** `db/src/chain.rs:150-206` is that type with a third variant, shipping,
unit-tested (`:2100-2130` covers the corrupt case with a stored `"-5"`), and with each variant's policy
argued in its own docstring. This is the single most important correction in this document, because it
changes the recommendation from *"design a type"* to *"move a file-private enum into a shared crate and
delete eight guards"* — a mechanical change with a working reference implementation, rather than a design
exercise. The brief's warning that "qualification 2 is the trap" is **correct and survives**: requiredness
buys nothing here. But the reason is sharper than the brief states — the win is not merely closedness, it
is the **third variant**, because `Corrupt` is a state `f64` cannot represent and it is the state where
the brake matters most.

**3. "`monthly_cost_ceiling_usd` is absent from a 32-row `app_settings`, so `budget_verdict` returns
`Allow` for every input" — confirmed, and it undersells the defect by an order of magnitude.** Setting
the key would not fix it. `overnight.rs:307-315` compares that ceiling against `dev_llm_spend`, which
holds **$118.07 of the app's $2,512.29** and **$3.37 of the $2,036.26** spent in the month the app
actually ran. An operator who reads the brief's finding and sets `monthly_cost_ceiling_usd = 50` gets a
governor that would refuse the unattended lane at $50 of *scanner* spend while the interactive lane spends
$2,036 unobserved — and would be told by the settings screen that nothing is enforced at all (§7.B).
**"The ceiling is unset" and "the ceiling is pointed at the wrong ledger" are two independent bugs and
only the first is visible from the source.**

**4. "A sibling's `MONTHLY_SPEND_PREDICATE` names all four terminal statuses while the reliability queries
name three — you are billed for a lost run and it never counts against you." — the observation is right
and the direction is backwards for money.** On the spend axis the four-status set is the **compliant**
one, and this repo has it, with the reasoning written down (*"Cancelled rows may have consumed API credits
before the process was killed, so they count toward the budget"*). Live, `incomplete` (20 rows) and
`cancelled` (2 rows) contribute **$0.00**, so the axis is correct and inert. The genuinely uncounted
category is not a terminal status at all — it is `running`/`queued`, and the measured amount is **$34.58
concurrently invisible to the gate** (§7.F). A brief that asks "which statuses are counted" gets a review
of a list; the question that produced the finding is **"how much money can exist that is in no status the
gate counts?"**

**5. "Whether the frontend shows a limit the backend does not honour" — inverted, and the inversion is
the finding.** The frontend shows a limit and **tells the operator, in three shipped strings across 14
locales, that the backend does not honour it** — while one backend subsystem honours it hard enough to
permanently downgrade a project's autopilot mode (§7.B). The failure is not a UI overclaiming; it is a UI
*underclaiming* while an unattended lane acts on the same value. That is worse, because an operator who
believes a control is inert will set it casually.

**6. "convergence = diverged" (the leaf's own metadata) is right about dollars and wrong about limits.**
On money the oracle found genuine divergence — 2 of 4 billable repos have a USD ceiling and one of those
is dead code. But it found hard convergence one level up: **4 of 4 cap concurrency, three of them at the
literal number 4**, and **2 of 2 repos with more than one spend number have two numbers that disagree**.
The generalisable statement is not "spend ceilings vary" but **"engineers reliably bound the unit they can
reason about locally, and money is not that unit"** — which is a much more actionable thing to put in
front of the next person adding a limit.

**7. "Whether any ceiling is enforced BEFORE the money is committed rather than after" — yes, four of
them, and the interesting question is one layer down.** `executions.rs:353`, `background.rs:2510`,
`overnight.rs:389` and `director_lab.rs:316` all check before spending, and `overnight.rs` checks against
a *projected* cost, which is stronger than any sibling repo manages. The unasked question that produced
the real finding is **"before the money is committed, or before the money is *known*?"** — and the answer
is that all four check before commitment and after the last completed run, so each admits one more
unbounded unit per concurrent lane. The primitive that closes the gap is a reservation (§8.4), which
exists in exactly one of six codebases.

**8. What the brief did not ask and should have: "what would this ceiling have caught?"** The highest-value
measurement in this sweep was not any of the listed questions — it was replaying the live month's
cumulative spend against seven candidate ceilings. "The ceiling is unset" is a code fact and reads as
housekeeping. "**A $50 ceiling — the value the docstring uses as its own example — would have been crossed
on the third day of the month, at run 77 of 2,188, leaving 97.5% of the month's $2,036 unrefused**" is the
same fact and it is a decision. Recommend adding the counterfactual replay to any brief about a limit:
*set the limit to the value the code suggests, replay the history, and report the day it would have
fired.*

---

## Backlog

| # | Item | Where | Size |
|---|---|---|---|
| 1 | **Promote `CostCeilingReading` to a shared `Ceiling<T>`** (three states, corrupt fails restrictive) and make it the only way to read a money key | `db/src/chain.rs:150-206` → `core`/`db`, + the 3 money keys `pub(crate)` | **L** |
| 2 | **Give the two zero-valued money defaults a real number**, with the `CHAIN_MAX_LINKS_DEFAULT` rationale in the docstring | `settings_keys.rs:357, 669` | S |
| 3 | Convert the 8 self-disabling guards to `if let Some(ceiling) = resolved` and ratchet §9 to 0 | §9's 8 sites | M |
| 4 | **A `#[test]` asserting the ceiling's enforcer and the ceiling's UI return the same number** for a seeded fixture — would have caught the $3.37 / $2,036.26 split on day one | `overnight.rs:307`, `metrics.rs:759`, `executions.rs:1732` | M |
| 5 | **Point the global monthly governor and the auto-tuner at a reconciled spend figure**, not at `dev_llm_spend` alone | `overnight.rs:307`, `policy_evidence.rs:98` | M |
| 6 | **Resolve the Stage-1 contradiction**: either enforce the monthly ceiling on the interactive path or stop enforcing it on the unattended one — and make the three i18n strings match whichever wins | `en.json settings.limits.*` (14 locales), `overnight.rs:406-427` | M |
| 7 | Thread the workspace cascade to the admission gate, the preview and the badge, or drop `default_max_budget_usd` | `executions.rs:353,886`, `metrics.rs:195`, `config_merge.rs:155` | M |
| 8 | Send `effectiveCostBudgetUsd` on `DeliberationDetail` and delete the two `?? 5` fallbacks | `deliberation.rs:48`, `ConversationCards.tsx:234`, `DeliberationRail.tsx:41` | S |
| 9 | Enforce or delete `EnclavePolicy.max_cost_usd` (0 consumers) and `budget_alert_rules` (0 readers, 0 writers) | `enclave.rs:31`, `schema.rs:564` | S |
| 10 | Give the persona editor's budget field a placeholder amount, a "typical run costs $X" hint, and an explicit "blank = unlimited" label | `PersonaDraft.ts:130`, `useEditorSave.ts:74` | S |
| 11 | **A reservation table + `reserve`/`settle`** so a ceiling is exact rather than overshooting by one run per lane (measured: $34.58) | new, `queue.rs`, `executions.rs:353` | L |
| 12 | A `gate_decisions(gate, verdict, day, count)` rollup so "has any spend ceiling ever said no" is one query, not five | new (shared with `autonomy-gating` §8.6) | M |
| 13 | A `#[test]` asserting every `*_USD_DEFAULT` is `> 0.0` or is in a commented `INTENTIONALLY_UNLIMITED` allowlist | `settings_keys.rs` | S |
| 14 | Encode the period in the ceiling type (`PerCall` / `PerRun` / `PerMonth`) so one `Option<f64>` cannot be two units | `core/src/models/persona.rs:586`, `cli_args.rs:134`, `executions.rs:355` | L |
| 15 | Decide whether `TierConfig` should carry a dollar cap — note the oracle found **0 of 5** siblings that do, so this is an open design question, not a backlog item with a known answer | `engine/src/tier.rs`, `lib.rs:1135` | M |
| 16 | Wire `TierConfig::from_plan` (currently 0 call sites outside tests, so every install is `free`) or delete the paid tiers | `tier.rs:47`, `lib.rs:1135` | S |
| 17 | Withhold the un-predicated money aggregate: a `monthly_spend(scope)` fn owning `MONTHLY_SPEND_PREDICATE`, with the raw `SUM(cost_usd)` unavailable outside the repo layer | `executions.rs:1732` + 31 sites | L |
