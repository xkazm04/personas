# Golden path — model and effort selection

> Situation node: `ai-agents/model-invocation/model-and-effort-selection` · [situation spine](../situation-spine.md)
> Composed 2026-08-17 against `master` @ `2a874e692`. **Recurrence 15 · risk medium · sides: client · convergence: mixed.**
> Sweep: all **963** non-generated Rust files under `src-tauri/` and all **3,793** `.ts`/`.tsx` files under `src/`
> (4,336 counted together for the catalogue scan, tests excluded), walked by the census engine and re-walked by
> four independent scanners written for this path. Read in full:
> `engine/src/prompt/cli_args.rs`, `engine/src/prompt/capabilities.rs`, `engine/src/config_merge.rs`,
> `db/src/model_routing.rs`, `src/companion/model_routing.rs`, `src/companion/brain/oneshot.rs`,
> `src/companion/athena_reaction.rs`, `src/engine/runner/mod.rs` (model-resolution block),
> `src/engine/failover.rs` (model chain), `engine/src/test_runner.rs` (lab cells),
> `src/lib/models/modelCatalog.ts`, `src/features/agents/sub_glyph/personaCore/*`,
> `src/features/studio/StudioBuildSettings.tsx`,
> `src/features/settings/sub_engine/components/ModelRoutingSection.tsx`, `src/i18n/tokenMaps.ts`,
> and `docs/development/model-effort-guide.md`.
> A **read-only copy of the operator's two live SQLite files** (`personas.db` 347 MB, `personas_data.db` 17.5 MB,
> copied 2026-08-17 12:43, **deleted after measurement**) was queried and the model/effort resolution order was
> **replayed verbatim over all 78 live persona rows**. Ledgers read: 78 personas · 8 teams · 32 `app_settings` rows ·
> 2,188 `persona_executions` · 4,001 `provider_audit_log` · 1,779 `companion_turn` · 89 `dev_llm_spend` ·
> 58 `lab_arena_results` · 316 `recipe_definitions`.
> The census rule in §9 was built, fault-injected, positive-controlled, overlap-measured at **exact-line** level
> against all 165 baselined rules, and re-extracted from this document and re-run.
> Convergence oracle run against **`brainiac`, `personas-cloud`, `ascent`, `vibeman`, `personas-web`**.
> Dimensions: **cost · function · code-quality · ui · resilience**.
> **Settles:** which model runs, how hard it thinks, who decided that, and whether anything can tell you afterwards.

---

## 0. The headline, before anything else

**The app offers three model tiers × four reasoning-effort levels. Replayed over the operator's 78 live
personas, all 78 resolve to the same cell: `claude-sonnet-4-6 @ medium`. Seventy-four of them get there
by falling through every layer of a six-layer cascade and hitting a hardcoded constant in the runner.**

The replay executes `config_merge::resolve_effective_config` → `model_routing::resolve_for_persona`
(`runner/mod.rs:185`) → the sonnet floor (`runner/mod.rs:340-359`) → `build_cli_args_inner`
(`cli_args.rs:91-257`) against the real rows:

| how the 78 resolved | rows |
|---|---:|
| `cascade:none \| routing:no-rule \| floor=sonnet` | **74** |
| `cascade:persona=claude-sonnet-4-6` | 4 |
| **resolved `(model, effort)` — distinct values across all 78** | **1** |

Every layer that could have differentiated them is empty:

| layer | state on this machine |
|---|---|
| global `global_model_profile` | **absent** from a 32-row `app_settings` |
| workspace `persona_teams.default_model_profile` | **NULL on 8 of 8 teams** |
| persona `personas.model_profile` | **NULL on 74 of 78**; the other 4 name `claude-sonnet-4-6`, which is what the floor gives anyway |
| routing cascade `model_routing_rules` | **key absent — 0 rules**, and `provider_audit_log.routing_rule` is NULL on 4,001 of 4,001 rows |
| per-capability `use_case.model_override` | **3 occurrences, all the string `"claude-sonnet-4-6"`** |
| recipe tier `recipe_definitions.model_preference` | **NULL on 316 of 316** |
| persona effort `model_profile.effort` | **set on 0 of 78** |

So the model is chosen by `DEFAULT_CAPABILITY_MODEL` (`capabilities.rs:24`) and the effort by
`DEFAULT_EFFORT` (`cli_args.rs:39`), and **`persona_executions.thinking_level` carries exactly one
distinct value across the whole ledger: `medium`, on 1,004 of 2,188 rows** (NULL on the other 1,184).

**The floor works, and the data proves what it is holding back.** Cross-tabulating the config the app
recorded against the model the CLI reported:

| `execution_config.model_profile` | recorded `model_used` | rows | |
|---|---|---:|---|
| `null` — no model chosen | `NULL` — never learned | 1,058 | |
| `null` — no model chosen | **`claude-opus-4-8[1m]`** | **141** | ← every expensive run is here |
| set — `claude-sonnet-4-6` | `claude-sonnet-4-6` | 812 | |

**141 of 141.** Not one run that named a model landed on the expensive one, and not one run that landed
on the expensive one had named a model. Those 152 rows (11 have no config) cost **$193.24 in 37 hours**
— $1.27 per run against sonnet's $0.72, **1.76×** — and they stop dead at `2026-06-14T09:15`, which is
the day commit `7c32f91e4` added the floor. **Since 2026-06-15: 569 executions, 100% sonnet, zero opus.**
This is a *cleared* finding and it is the strongest evidence in the document for the prescription: the
fix was not a policy, a gate, or a warning. It was a constant supplied where the value was missing.

**The effort half has no such constant anywhere except the one in the argv builder, and four things
downstream of it are broken.**

1. **The catalogue's i18n-correct effort vocabulary has zero consumers.** `EFFORT_OPTIONS`
   (`modelCatalog.ts:83-88`) binds each level to `models.effort_<id>`, a key translated into 14 locales.
   Grep across 3,793 client files: **0 importers**. So are `getAnthropicModels(t)`, `getAllModels(t)`,
   `MODEL_I18N_KEYS` and `selectedModelsAndEffortsToConfigs` — **every i18n-aware and every
   effort-aware export of the model catalogue has zero call sites**.
2. **Five surfaces render an effort level and they produce 11 distinct English strings for 4 values:**

   | surface | low | medium | high | xhigh |
   |---|---|---|---|---|
   | `models.effort_*` (the dead `EFFORT_OPTIONS`) | Low | Medium | High | **`xhigh`** |
   | `status_tokens.thinking.*` — `tokenLabel(t,'thinking',x)`, 2 render sites | Low | Medium | High | **MISSING → raw token** |
   | `personaCore/catalog.ts:113` `EFFORT_TIERS` (hardcoded) | Low | Medium | High | **Max** |
   | `StudioBuildSettings.tsx:11` `EFFORTS` (hardcoded) | **Fast** | **Balanced** | **Deep** | **Max** |
   | `ModelRoutingSection.tsx:91-94` `<option>{eff}` | `low` | `medium` | `high` | `xhigh` |

   A user who sets "Deep" in Studio and "High" in Persona Core has set the same thing twice under two
   names, and a user who sets "Max" in either has set the level the app's own benchmark advises against.
3. **`models.effort_xhigh` is the raw token in 4 of 14 locales — including English**, the source of
   truth (`en`, `ko`, `vi` = `"xhigh"`; `id` = `"Xhigh"`). Its siblings are `Low`/`Medium`/`High`.
4. **The Lab's effort dimension is complete end to end and unreachable.** `usePanelRunState.ts:25`
   holds `selectedEfforts`, `:54` exposes `toggleEffort`, `modelCatalog.ts:116` builds the model×effort
   product, `TestModelConfig.effort` (`test_runner.rs:126`) carries it, and `test_runner.rs:756` puts it
   in the argv. `selectedEfforts` and `toggleEffort` have **0 consumers** outside the hook, and
   `ArenaPanelColosseum.handleStart` (`:193`) calls `selectedModelsToConfigs` — the function whose own
   docstring says "no effort variation… Existing call sites get pre-effort behavior". The app's one
   instrument for measuring effort cannot be started, which is why the repo's effort benchmark
   (`docs/development/model-effort-guide.md`) was run in git worktrees with raw `claude -p` instead.

**And the app cannot tell you what ran.** Four ledgers record a model; **one records the effort**:

| ledger | rows | model column | effort column |
|---|---:|---|---|
| `persona_executions` | 2,188 | `model_used` (NULL ×1,184) | **`thinking_level`** — 1,004 rows, all `medium` |
| `companion_turn` | 1,779 | `model` — **6 distinct models** | — |
| `dev_llm_spend` | 89 | `model` — 2 distinct | — |
| `provider_audit_log` | 4,001 | `model_used` — **NULL ×4,001, 0 distinct** | — |
| `lab_*_results` (5 tables) | 58 | `model_id` — bare tier slugs | — |

The inversion is exact: **the one surface where effort is genuinely decided — the companion tiers, which
carry a 1,026-turn bench in their docstrings — writes to the only ledger with no column for it; and the
one ledger with a column for it serves the surface where the value has never been anything but `medium`.**
`execution_config` mentions `model_profile` in 2,011 rows and `routing_rule` in 2,011 rows and the string
`effort` in **0 of 2,188**.

Meanwhile `persona_executions` records **0 input tokens and 0 output tokens on 2,188 of 2,188 rows against
$2,036.26 of spend** ([`llm-spend-accounting`](./llm-spend-accounting.md) §7.A; `parser.rs:340-341`). So
even where the choice *is* recorded, there is nothing to evaluate it against: a model/effort chooser can be
measured on quality, latency, or tokens, and this ledger has none of the three. **The dial and the gauge
were built by different hands and neither knows the other exists.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every
clause carries its warrant, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics, and the one clause everything else hangs off.** *Unspecified resolves upward.* A call
> that names no model does not get a cheap model; it gets whatever the vendor, the account tier, or the
> runtime defaults to, and those default toward the newest and most capable. The correct response to "no
> model was chosen" is a **named constant you own**, not a fall-through. A fall-through is a purchasing
> decision made by someone who does not pay.
>
> **P2 — physics.** *Which model* and *how hard it thinks* are two axes of one decision, and they must
> travel as one value. Split them across two parameters, two config layers, or two ledger columns and the
> cheaper axis will silently stop travelling — because it is the one nobody notices the absence of. The
> model has a visible consequence in the output; the effort does not.
>
> **P3 — physics.** A resolution cascade with N layers and one populated layer is not a cascade; it is a
> constant with N-1 places to look before finding it. Count how many of your layers ever hold a value
> before you add the N+1th. A layer nobody fills is worse than no layer: it makes the constant look like
> a policy.
>
> **P4 — physics.** Any level of a bounded ordinal scale that you can select must be a value you can
> *name*, in every place the scale is shown. An enumeration that is complete at the point of choice and
> short an arm at the point of display leaks the machine token onto a screen — and the completeness
> checks you already run compare the display catalogues *to each other*, so an arm missing from all of
> them is invisible by construction.
>
> **P5 — physics.** The choice must be recorded with the thing it caused, at the moment it is made, in
> the same row. A choice reconstructed later from configuration is a reconstruction of what the
> configuration says today, not of what ran. This is sharper for effort than for model, because a
> provider will usually tell you which model it used and no provider tells you how hard it thought.
>
> **P6 — physics.** A control the user can move must move something. A picker that writes into a prompt,
> a recommendation card that "doesn't write any selection", a state hook whose setter has no caller —
> each is a lie with a hover state. The failure is worse than an absent control, because an absent
> control invites the question and a dead one answers it.
>
> **P7 — ergonomics, and the most expensive to get wrong.** *More reasoning is not monotonically better,
> and the axis can be silently disabled by the shape of the task.* Escalation buys defect-freedom, not
> better ideas; on long-form work it can invert, because a model that thinks longer writes longer and
> loses track of what it wrote. And a hard output cap can collapse the axis entirely — you pay for effort
> you do not receive. Therefore a *default* at the top of the scale is a bet against your own
> measurements, and must be justified per task shape or not made.
>
> **P8 — physics, stated as a warning about instruments.** You cannot introspect reasoning depth. Thinking
> content is redacted in the stream and in the transcript, so neither an operator nor the model itself can
> observe how much reasoning happened. Every claim about the effort axis is therefore a claim about a
> *proxy* — output tokens, latency, or graded quality — and a system that records none of those cannot
> evaluate its own effort policy at all, no matter how carefully it sets it.
>
> **P9 — ergonomics.** One vocabulary, one enumeration, one owner. When the same closed set is re-typed at
> each surface, the copies do not merely drift in wording — they drift in *arity*, and the shortest copy
> becomes the effective contract for whoever reads that surface.
>
> **P10 — physics.** A price attached to a model choice is part of the choice. If the UI that helps a user
> pick a tier states a cost, that cost is a claim the system is making at the moment of decision, and it
> ages faster than any other string in the product.
>
> **Scale condition.** P1, P2 and P5 are correctness on the first call. P3, P6 and P9 begin to bite the
> moment a second surface can set the same thing. P4 bites at the second locale. P7 and P8 pay the first
> time someone asks whether the setting was worth it. P10 pays the first time a vendor reprices.

**Which of these are physics and which are this repo's invention is measured, not asserted** — the
per-clause verdicts, the cohort determination, and three named silences are in
[Convergence](#convergence--five-sibling-checkouts-and-the-cohort-is-three) below. Read it before
adopting P2, P5b or the effort default: **0 of 5 sibling repos carries model and effort as one value,
0 of 5 records the effort, and 0 of 5 names its effort default.**

---

## 1. Trigger

You are in this situation when you are about to type any of:

- "let the user pick the model", "add a model dropdown", "which tier should this run on"
- "make this one use Opus", "this can run on Haiku, it's just classification"
- "add a reasoning-effort / thinking-depth setting", "crank the thinking up for build turns"
- "route research personas to Opus and utility ones to Haiku"
- "why did this run cost so much / which model actually ran"
- **If you are about to write a `ModelProfile`, a `TurnTier`, a `--model` or `--effort` argv push, a
  `model_override`, a tier-slug → model-id map, or an option list containing `haiku`/`sonnet`/`opus` or
  `low`/`medium`/`high`/`xhigh` — you are in this situation.**

You are **not** in this situation for:

- *whether a call that nobody asked for is allowed to happen, and under what ceiling* —
  [`headless-model-call`](./headless-model-call.md).
- *whether the number the app reports as spend is correct* —
  [`llm-spend-accounting`](./llm-spend-accounting.md). The price table lives there; this path owns only
  the fact that a **choice surface** repeats it (§7.J).
- *whether a dollar limit exists and refuses* — [`spend-ceilings`](./spend-ceilings.md).
- *what goes into the prompt* — [`prompt-assembly`](./prompt-assembly.md), which hands this leaf its
  subject explicitly at `prompt-assembly.md:148-150` ("You are **not** here if you are choosing a model,
  setting effort…").
- *how a closed backend vocabulary gets a coloured badge* —
  [`status-and-severity-badges`](./status-and-severity-badges.md). This path owns the vocabulary's
  **arity**, not its colour.

### Non-overlap test

A headless scan that spawns through the mandated helper, strips the billing credential, arms a timeout, a
turn cap and a dollar budget, meters both success and failure into the right ledger, and runs on
`--effort medium` because nobody ever considered the question is **100% compliant with all three
neighbours and 0% compliant with this one**.

---

## 2. The one way

**Make the model and the reasoning effort one value, resolve it once, hand it to the invocation as a pair,
and write both halves onto the row the call produces — then never re-type either of them anywhere else.**
Concretely: put the decision in a named tier constant that carries its own justification
(`companion/model_routing.rs`'s `TurnTier { model, effort }` is the shape; each of its three constants
records the bench number that chose it), and pass the *whole tier*, never `TIER.model` alone — seven call
sites in this repo reach into a tier struct for its model and leave the effort on the floor. Where the
tier cannot be known statically, resolve it through **one** cascade whose terminal case is a named constant
you own, because the alternative to a constant is the vendor's default and this repo has measured that
default costing 1.76× per run. Emit both flags unconditionally from **one** argv builder and never push
either flag again at a call site — the builder already pushed `--effort`, so a second push is a duplicated
flag whose winner is the CLI's arg parser's business, not yours. Record the pair on the row at spawn time,
from the *final argv* rather than from the configuration, so failover and resume are covered; and give
every ledger that stores a model a column for the effort beside it, because "cost unknown" and "effort
unknown" are the same class of fact and only one of them is currently spellable. On the client, the four
effort levels and three model tiers are **one exported catalogue with i18n keys** — import it; do not
re-type the option list, and do not invent a friendlier synonym for a level the rest of the app already
names. And before you default anything to the top of the effort scale, read
[`docs/development/model-effort-guide.md`](../../development/model-effort-guide.md): on this repo's own
measurements quality *inverted* above medium on long-form work, and a hard output cap collapsed the axis
entirely.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/companion/model_routing.rs:12-47` — `TurnTier { model, effort }` + `MAIN` / `ASIDE` / `MICRO`** | **The decision, made once, with its evidence attached, as ONE value.** Three constants, each carrying the measurement that chose it (`MAIN`: *"Opus@low matched Opus@default accuracy exactly (93.9% over 114 runs per cell) at 16% lower p50 latency"*; `MICRO` records a **negative** result: *"reinforcement at low effort regressed awareness 94→78%"*). This is the only place in 963 Rust files where model and effort are declared together as a deliberate pair. **Copy this shape; pass the whole struct.** |
| **`engine/src/prompt/cli_args.rs:114-127` — `build_cli_args(persona, model_profile)`** | **The one argv assembly that emits both halves.** `--effort` is pushed **unconditionally** at `:116-117` via `resolve_effort()`, so no caller can forget it; `--model` at `:120-127` when the profile names one. Its `DEFAULT_EFFORT` docstring (`:30-38`) is the reason the unconditional push exists: *"CLI 2.1.94 silently changed the implicit default from `medium` to `high` for API-key, Bedrock, Vertex, Foundry, Team, and Enterprise users — silently increasing cost and latency."* 30 call sites push `--model` onto its result and inherit the effort correctly. |
| **`engine/src/prompt/capabilities.rs:9-24` — `tier_slug_to_model_id(slug)` + `DEFAULT_CAPABILITY_MODEL`** | **The terminal constant.** A three-entry slug→id map plus a named default whose docstring contains the incident report that justifies it: *"without this fallback a profile-less persona silently rides the CLI ACCOUNT default — observed live as opus-4-8[1m] on every team step, the dominant fleet cost driver (2026-06-12 cost review)."* §0 shows this working: 141 of 141 expensive runs were unpinned runs, and they stop the day the floor landed. |
| **`db/src/repos/execution/executions.rs:699-726` — `set_launch_model_info(pool, id, model, thinking_level)`** | **The only recorder in the repo that takes both halves**, and it takes the effort as a **required `&str`** while the model is `Option`. Called from `runner/mod.rs:1806-1820`, which reads both values back out of the **final argv** (`flag_value("--model")` / `flag_value("--effort")`) rather than from the configuration — so failover and resume paths are covered by construction. This is the shape every other ledger is missing. |
| **`db/src/repos/execution/executions.rs:731-744` — `set_model_used_actual(pool, id, model)`** | Stamps the model the CLI reported on its `system`/`init` event, authoritative over anything configured. This is how the 152 account-default rows were identifiable at all. |
| **`db/src/model_routing.rs:60-131` — `ModelRoutingRule { match, model, effort }` + `resolve()` + `validate()`** | **The cascade, and the only rule type that carries both halves.** CSS-like specificity (persona_id 3 > category 2 > universal 0), last-declared wins a tie, `validate()` rejects an unknown effort against `EFFORT_LEVELS`. Consulted at exactly one site, `runner/mod.rs:185`. Use it instead of adding a sixth layer. |
| **`src/lib/models/modelCatalog.ts:16-88` — `ANTHROPIC_MODELS`, `EFFORT_LEVELS`, `DEFAULT_EFFORT`, `EFFORT_OPTIONS`, `MODEL_I18N_KEYS`, `getAnthropicModels(t)`** | **The client catalogue.** `EFFORT_OPTIONS` is the correct shape — `{ id, labelKey: \`models.effort_${EffortLevel}\` }`, a template-literal type that makes an unkeyed label unrepresentable. **Import it.** It currently has zero consumers (§7.A) and that is the defect, not the design. |
| **`src/i18n/tokenMaps.ts:35` — `tokenLabel(t, category, token)`** | The backend-token → translated-label resolver, with a DEV `console.warn` on an unmapped token. The right destination for `thinking_level` off the wire — see §7.C for why arriving is not the same as succeeding. |
| **`engine/src/test_runner.rs:119-131,748-756` — `TestModelConfig { model, effort }`** | **The experiment.** The Lab's cell type carries both axes and `:756` hands them to `build_cli_args` as one `ModelProfile`. This is the only place in the app that can *measure* an effort choice rather than assert one. It has no UI (§7.B). |

**Explicitly NOT primitives.**
`engine/src/failover.rs:638-642 CLAUDE_MODEL_CHAIN` is a **second** Rust model catalogue that says in its
own comment that it duplicates `tier_slug_to_model_id`; do not add a third.
`src/lib/utils/platform/pricing.ts:6-28 MODEL_PRICING` is a client-side price table that is wrong on the
two rows this app actually uses (§7.J) — never quote a price from it in a choice surface.
`personaCore`'s `MODEL_TIERS` / `EFFORT_TIERS` (`catalog.ts:104-118`) and `StudioBuildSettings`'s `EFFORTS`
(`:11-16`) are hardcoded English re-declarations of the catalogue; they are §9's baseline, not a primitive.

---

## 4. Steps

1. **Decide whether this is a tier or a knob.** A *tier* is a class of call (main turn, aside, micro,
   build) whose model+effort you can name once for everyone. A *knob* is a per-run experiment. Almost
   everything is a tier; if you are reaching for a knob, check whether the Lab already has the axis
   (it does — `TestModelConfig.effort`) before adding a second one.
2. **Add the tier to `model_routing.rs` with its evidence, not to your call site.** One `TurnTier` const,
   one docstring, one number that justifies it. That is one edit and one review, against a 78th model
   literal in a 59th file ([`headless-model-call`](./headless-model-call.md) §7.J).
3. **Pass the whole tier.** `f(&MICRO)`, not `f(MICRO.model)`. If the function you are calling has no
   effort parameter, that is the bug — add the parameter before you add the caller. Seven sites in this
   repo took the model and left the effort (§7.D).
4. **Let the argv builder emit both flags. Do not push either flag yourself.** `build_cli_args` already
   pushed `--effort`; a second push produces `--effort medium … --effort low` in one argv (§7.E), and the
   unit test that guards against exactly this (`prompt/mod.rs:1849`) runs *inside* the builder, one frame
   below where the violation happens.
5. **If you must hand-assemble an argv, re-state the effort explicitly.** Five hand-assembled Claude
   invocations exist and only the builder's two re-state it (§9). A hand-built argv is an opt-out of the
   `DEFAULT_EFFORT` pin, and the pin exists because the CLI's own default moved under this app once
   already.
6. **Terminate every cascade in a named constant you own.** Not `None`, not "the provider will pick".
   `DEFAULT_CAPABILITY_MODEL` is the model half; there is no effort equivalent above `DEFAULT_EFFORT`,
   and that is why effort has one layer where model has six.
7. **Record both halves at spawn, from the final argv.** `set_launch_model_info(pool, id, model, effort)`.
   Reading from the argv rather than the config is what makes failover and resume correct; reading from
   the config is what makes `execution_config` name a `model_profile` for 812 runs and an effort for zero.
8. **On the client, import the catalogue.** `EFFORT_OPTIONS` for the levels, `getAnthropicModels(t)` for
   the tiers. If you find yourself typing `{ value: 'xhigh', label: 'Max' }`, stop — that string is the
   census baseline in §9.
9. **Do not default to the top of the effort scale without a task-shape argument.** Two surfaces do
   (§7.G) and the repo's own benchmark contradicts both.
10. **And then stop.** Spawn envelope, billing identity, ceilings, cancellation and metering are
    [`headless-model-call`](./headless-model-call.md)'s territory; the price of the tokens is
    [`llm-spend-accounting`](./llm-spend-accounting.md)'s.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is worth more than the gate.** See "Type over gate", below. The short version: the
condition §9 counts is a formatting habit; the conditions in §7 are all a missing product type
(`TurnTier` exists and is not required anywhere) and a missing column.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Reaching into a tier for one half — `TIER.model`** | The effort field is right there, carrying a benchmark result, and it does not travel. **7 sites read `.model`; 1 reads `.effort`.** `MICRO`/`ASIDE` explicitly document `None = the model's default (high)`, so dropping `Some("low")` moves the call *up* the scale, not to a neutral middle. |
| **A resolution layer that nothing ever fills** | Six layers can supply a model here; **five have never held a value** on this machine. The cascade reads like policy and behaves like a constant, and the next person adds a seventh layer instead of reading the sixth. |
| **A cascade for one axis and a constant for the other** | `EffectiveModelConfig` (`config_merge.rs:45-56`) resolves model, provider, base_url, auth_token, budget, turns and cache policy across three tiers, and **has no `effort` field**. So a workspace can set a model for nine personas and cannot set an effort for one. |
| **Pushing `--effort` after `build_cli_args`** | The builder pushed it unconditionally at `cli_args.rs:116`. A second push is a duplicated flag. `athena_reaction.rs:552` does this at the only tier-aware spawn in the tree. |
| **Hand-assembling a Claude argv** | Silently opts out of the `--effort` pin whose entire purpose is to survive a CLI default change. 5 of 8 hand-assembled print-mode invocations state no effort (§9). |
| **`ModelProfile { model: Some(x), ..Default::default() }`** | `effort` becomes `None`. Used by `resolve_use_case_model_override` (`capabilities.rs:40-43`), so applying a per-capability *model* override **erases the persona's effort**, silently, in the same expression. |
| **A recommendation surface that cannot write the recommendation** | `ModelTierChoiceWidget` renders three tiers with rationales and its docstring says *"The card is informational — it doesn't write any selection."* The user must now carry the advice to a different screen by hand. |
| **A picker that writes into the prompt instead of the config** | `usePersonaCore.launchAugmentation` (`:101-102`) turns the model and effort selection into the sentence `Model tier: Sonnet (balanced); reasoning effort: xhigh` appended to the build intent. The CLI runs at `--effort medium`. The prompt now contains a false statement about the run's own configuration, and its own docstring admits it: *"Wiring these to real persona config (model_profile, --effort) is the next-leverage follow-up."* |
| **A friendlier synonym for a level** | `Fast`/`Balanced`/`Deep`/`Max` in one surface, `Low`/`Medium`/`High`/`Max` in another, `low`/`medium`/`high`/`xhigh` raw in a third. **11 distinct strings for 4 values.** A support answer that says "set effort to High" is now ambiguous. |
| **An enumeration that is complete where you choose and short where you display** | `EFFORT_LEVELS` has 4 arms; `status_tokens.thinking` has 3, in **14 of 14 locales**. `tokenLabel`'s `token` parameter is a bare `string` while its `category` is a closed union, so the compiler is content and the screen shows `xhigh`. |
| **Recording the model and not the effort** | Four ledgers store a model; one stores an effort. The three that do not are the three that carry a *varied* model (`companion_turn` alone holds 6 distinct models); the one that does carries a single value 1,004 times. |
| **Defaulting to the top of the scale** | `BUILD_TURN_EFFORT = "xhigh"` (`session.rs:1789`) and `studioStore.ts:221 effort: 'xhigh'`, both on long-form build work, against a benchmark in this repo that ranked xhigh **4th of 8** at 33% more spend than the winner, with the xhigh run the only protocol violator in its wave. |
| **Quoting a price beside a model choice** | `compareHelpers.ts:22-24` shows `~$0.25/1K`, `~$3/1K`, `~$15/1K`. Those are per-**million** figures wearing a per-thousand label, and two of the three numbers are also wrong (§7.J). |

---

## 6. Evidence

**The one site to copy: `src/companion/model_routing.rs:12-47`.**

Thirty-six lines. It is the only place in 963 Rust files that does all four things a model-and-effort
decision must do:

1. **The two axes are one value.** `TurnTier { model: &'static str, effort: Option<&'static str> }` — you
   cannot take a tier without taking both.
2. **Each constant carries the measurement that chose it**, in the docstring, with sample sizes:
   `MAIN` cites *93.9% over 114 runs per cell* and *16% lower p50 latency*; `ASIDE` cites *100% on
   awareness, restraint and format with a 30% p50 latency win*; `MICRO` cites *40% p50 win, p90 9.2s vs
   19.3s*.
3. **It records a negative result**, which is what makes it defensible against the next person who wants
   to "just use Opus": *"Deliberately receives NO constitution/act-doctrine: reinforcement at low effort
   regressed awareness 94→78%."*
4. **It documents what `None` means** — `/// CLI --effort value; None = the model's default (high)` — so
   omitting the flag is a stated position rather than an oversight.

**It is also the site this document is hardest on**, and that is the point: a perfect decision type is
worth nothing if callers can take half of it. Seven call sites read `.model`; one reads `.effort`.

Also exemplary:

- **`engine/src/prompt/cli_args.rs:114-127` — the unconditional `--effort` push.** Two lines, no `if`,
  before the conditional `--model` block. That asymmetry is deliberate and correct: the model has a
  legitimate "let the caller decide later" state and the effort does not. Its `DEFAULT_EFFORT` docstring
  is the incident report that produced it.
- **`db/src/repos/execution/executions.rs:699-726` — `set_launch_model_info`.** Effort is a required
  `&str`, model is an `Option<&str>`, and the two SQL arms differ only in whether the model is written —
  so an unknown model never overwrites a known one and an unknown effort is not representable.
  `runner/mod.rs:1802-1806` reads both from the **final argv**, with the reason in a comment:
  *"extracted from the final argv, so failover/resume paths are covered."*
- **`engine/src/prompt/capabilities.rs:18-24` — `DEFAULT_CAPABILITY_MODEL`.** A constant whose docstring
  contains the dated cost review that justifies it. §0 measures it working.
- **`db/src/model_routing.rs:133-151` — `validate()`.** Rejects an unknown effort against `EFFORT_LEVELS`
  *before* a run reaches it, and returns human-readable diagnostics rather than silently dropping the
  value. The frontend calls it through `set_model_routing_rules` (`settings.rs:79`) and surfaces the
  diagnostics.
- **`src/lib/models/modelCatalog.ts:77-88` — `EffortOption`.** `labelKey: \`models.effort_${EffortLevel}\``
  is a template-literal type: a label that is not an i18n key for a real level **does not compile**. This
  is the correct client shape and it is the correct answer to §7.A; it needs consumers, not a redesign.

---

## 7. Deviations found

### 7.A Every i18n-aware and every effort-aware export of the model catalogue has zero consumers

`src/lib/models/modelCatalog.ts` is the declared client catalogue. Measured across **3,793** `.ts`/`.tsx`
files: **5 importers**, all in `sub_glyph/personaCore` and `sub_lab`.

| export | line | consumers |
|---|---:|---:|
| `EFFORT_OPTIONS` (the i18n-keyed effort ladder) | `:83` | **0** |
| `selectedModelsAndEffortsToConfigs` (the model × effort product) | `:116` | **0** |
| `getAnthropicModels(t)` (translated tier labels) | `:30` | **0** |
| `getAllModels(t)` | `:41` | **0** |
| `MODEL_I18N_KEYS` | `:23` | **0** |
| `ALL_MODELS` (raw, hardcoded English `label`) | `:62` | 2 |
| `ANTHROPIC_MODELS` | `:16` | 1 |
| `selectedModelsToConfigs` (**pre-effort**) | `:94` | 1 |
| `DEFAULT_EFFORT` / `EffortLevel` | `:75,:73` | 2 |

The pattern is exact: **the localized half and the effort half are dead; the raw half and the
model-only half are alive.** `LabVersionsTable.tsx:49` renders `ALL_MODELS.find(...)?.label` — the
hardcoded English string — while `getAnthropicModels(t)`, which exists to replace precisely that, sits
unused two exports away.

### 7.B The Lab's effort dimension is fully built and cannot be started

Every layer exists:

| layer | site | state |
|---|---|---|
| state + setter | `usePanelRunState.ts:25,54` — `selectedEfforts`, `toggleEffort` | **0 consumers outside the hook** |
| config builder | `modelCatalog.ts:116` — `selectedModelsAndEffortsToConfigs` | **0 consumers** |
| IPC type | `TestModelConfig.effort` (`test_runner.rs:126`) | present |
| argv | `test_runner.rs:748-756` — `ModelProfile { effort: model.effort.clone() }` → `build_cli_args` | correct |
| results | `lab_arena_results.model_id` | **no effort column** |

`ArenaPanelColosseum.handleStart` (`:191-198`) calls `selectedModelsToConfigs(selectedModels)`, whose
docstring reads *"one config per model, no effort variation… Existing call sites get pre-effort
behavior."* So the arena runs a model-only grid. Live: **58 `lab_arena_results` rows, `model_id` ∈
{`sonnet` 20, `opus` 20, `haiku` 18} — bare tier slugs, no effort recoverable.**

The consequence is in the repo already: `docs/development/model-effort-guide.md` describes the effort
benchmark being run as **eight isolated git worktrees driving raw `claude -p`**, one sample per cell,
because the instrument inside the product could not be pointed at the question. Its §3 says the intended
acceptance test *"cannot be run"* at all — thinking blocks are redacted to empty strings — which is P8,
discovered the expensive way.

### 7.C `status_tokens.thinking` is short an arm in 14 of 14 locales, and `models.effort_xhigh` is a raw token in 4

Two render sites resolve a backend thinking level:
`ExecutionValueBadges.tsx:44` and `LlmCallsTable.tsx:219`, both `tokenLabel(t, 'thinking', …)`.

`status_tokens.thinking` holds **3 arms — `low`, `medium`, `high` — in every one of the 14 locale files.**
`EFFORT_LEVELS` holds 4. `tokenLabel` (`tokenMaps.ts:35-51`) falls through to `return token`, so `xhigh`
renders as `xhigh`; the `console.warn` at `:44` is inside `if (import.meta.env.DEV)`, so production is
silent.

**The correction published at [`i18n-string-authoring.md:258-268`](./i18n-string-authoring.md) is right
about the missing arm and wrong about the escape hatch.** It states that the same concept *"**is**
translated everywhere else under `models.effort_xhigh`"*. Measured across all 14 locale files:

| locale | `models.effort_xhigh` | |
|---|---|---|
| en | `"xhigh"` | **raw token — and this is the source of truth** |
| ko | `"xhigh"` | raw token |
| vi | `"xhigh"` | raw token |
| id | `"Xhigh"` | capitalized raw token |
| ar bn cs de es fr hi ja ru zh | translated | |

**4 of 14 do not translate it, and English is one of them.** So the fallback the earlier correction
points at is itself broken for the majority-language user, and `check-coverage.mjs` cannot see it: the
value is present and non-empty in every locale, and the untranslated-string check compares locales to
each other, where `en = "xhigh"` and `ko = "xhigh"` look like a *deliberate* do-not-translate term.

A fourth and fifth place the enumeration is short an arm, both in docstrings that a developer reads
before a locale file: `core/src/types.rs:431` — *"Effort level: "low", "medium", or "high""* — and
`engine/src/test_runner.rs:125` — *"Effort level: "low" / "medium" / "high"."* Both omit `xhigh`; both
sit on the struct field that carries it.

### 7.D Seven call sites take a tier's model and leave its effort

`TurnTier` bundles the pair. Grep across 963 Rust files for accesses to the three constants:

| access | sites |
|---|---:|
| `MAIN.model` / `ASIDE.model` / `MICRO.model` | **7** |
| `MAIN.effort` / `ASIDE.effort` / `MICRO.effort` | **1** (`session.rs:2199`) |

The seven: `briefing.rs:173`, `sleep_cycle.rs:726`, `planner.rs:86`, `unattended.rs:145` and `:171`,
`session.rs:1783`, `tours.rs:365`.

The cause is one signature. `oneshot::call_claude_text(pool, prompt, model, leg, call_timeout)`
(`oneshot.rs:122-127`) — the door
[`headless-model-call`](./headless-model-call.md) §6 names *"the best type in this document"* for
withholding an unmetered path — **has no effort parameter**, and its inner `run_oneshot` (`:171-189`)
hand-assembles an argv with `"--model"` and no `"--effort"`. All **8** of its callers therefore run at
whatever the CLI's account-tier default is, not at the `ASIDE`/`MICRO` levels their tier constants
declare. Per `model_routing.rs:14`, `None` there means *the model's default (high)* — so the omission
does not land on `medium`; it lands **above** the level the bench chose, on exactly the calls the bench
was run to make cheaper.

### 7.E The only tier-aware spawn emits `--effort` twice

`athena_reaction::cli_text_inner` (`:543-556`):

```rust
let mut cli_args = crate::engine::prompt::build_cli_args(None, None);  // pushes --effort medium
cli_args.args.push("--model".to_string());
cli_args.args.push(model.to_string());
if let Some(effort) = effort {
    cli_args.args.push("--effort".to_string());                        // pushes --effort <tier>
    cli_args.args.push(effort.to_string());
}
```

Replayed verbatim for `MICRO`:

```
claude -p - --output-format stream-json --verbose --dangerously-skip-permissions
  --exclude-dynamic-system-prompt-sections --effort medium --model claude-sonnet-5 --effort low
```

`--effort` occurrences: **2**. Values, in order: `["medium", "low"]`. Which one the CLI honours is its
arg parser's business; this repo has no position on it, and the repo's own unit test has the *opposite*
position — `prompt/mod.rs:1849-1852` asserts `effort_count == 1` with the comment *"Sanity: only one
--effort flag was pushed"*. **The invariant is tested inside the primitive and violated one stack frame
above it**, at the single site in the tree that is tier-aware. This is the
[`client-rule-mirroring`](./client-rule-mirroring.md) shape in miniature: a test that runs on one side of
a boundary is a third copy, not a check.

### 7.F A resume states neither half

`build_resume_cli_args(claude_session_id: &str)` (`cli_args.rs:261-303`) takes **only a session id**, and
its body pushes:

```rust
args.push("--effort".to_string());
args.push(DEFAULT_EFFORT.to_string());          // :302-303
```

with the comment *"Pin effort on resume too — keeps continued sessions on the same effort policy as their
initial run regardless of CLI version drift."* **It does not.** It pins the *constant*, and the signature
makes anything else impossible — no persona, no profile, no session lookup. A persona configured at
`high` or `xhigh` resumes at `medium`, and the comment says the opposite.

Replayed, a resume argv is:

```
claude --resume <sid> -p - --output-format stream-json --verbose
  --dangerously-skip-permissions --exclude-dynamic-system-prompt-sections --effort medium
```

— **no `--model` at all**, which by this repo's own doctrine (`capabilities.rs:20-24`) means the account
default. Three real callers: `provider/claude.rs:45` (the persona-execution resume path),
`query_debug.rs:492`, `n8n_transform/cli_runner.rs:482`. Latent today only because 0 of 78 personas set
an effort; it becomes live the first time one does.

### 7.G Two surfaces default to the top of the effort scale, against this repo's own benchmark

- `src/companion/session.rs:1789` — `const BUILD_TURN_EFFORT: &str = "xhigh";` with the rationale
  *"Build sessions prefer quality over speed/cost — non-technical users can't specify the quality bars a
  dev would, so we lean on the model's deepest thinking."*
- `src/features/studio/studioStore.ts:221` — `effort: 'xhigh'` as the per-runtime default, and
  `StudioBuildSettings.tsx:30` re-defaults to `'xhigh'` when the runtime is missing.

`docs/development/model-effort-guide.md` measured the opposite on the closest available task shape
(long-form design, eight runs, blind-ranked):

| rank | variant | output tokens | rubric |
|---|---|---:|---:|
| 1 | **Opus-medium** | 47,489 | 4.00 |
| 4 | Opus-xhigh | 63,211 | 4.00 |

*"Opus inverts above medium — medium ranked 1st, xhigh 4th at 33% more spend"*, and the xhigh run *"was
also the only protocol violator in its wave."* The guide's negative control is sharper still for a chat
surface: with a hard output cap, Opus showed **no effort response at all — 104 / 96 / 101 / 104 / 112
output tokens from low to max** — *"If you cap the output, you may be paying for effort you are not
getting."*

**This document does not claim `xhigh` is wrong for build turns.** The guide is explicit that it covers
ONE problem shape with one sample per cell and that its build-and-verify arm was descoped as invalid. What
it does claim is that the two defaults were set with no reference to the measurement that exists in the
same repository, and that `provider/claude.rs:232-235` already records the unresolved question in
writing: CLI 2.1.166's thinking-disable controls are *"NOT adopted (personas has no thinking knob today;
deferred alongside the open companion-path `--effort`/cost decision)"*. The decision is open, two
defaults have already been taken, and neither cites the bench.

### 7.H The effort axis has one resolution layer where the model has six

`config_merge::EffectiveModelConfig` (`config_merge.rs:45-56`) is the three-tier
(global → workspace → persona) cascade. Its fields: `model`, `provider`, `base_url`, `auth_token`,
`max_budget_usd`, `max_turns`, `prompt_cache_policy`. **There is no `effort` field.**

| | model | effort |
|---|---|---|
| per-capability `model_override` | ✔ `executions.rs:331-340` | ✘ (and it *erases* effort — see below) |
| persona `model_profile` | ✔ | ✔ (the only layer) |
| workspace default | ✔ `persona_teams.default_model_profile` | ✘ |
| global default | ✔ `global_model_profile` | ✘ |
| routing cascade | ✔ | ✔ but only when the model is also unset (`runner/mod.rs:186`) |
| terminal constant | ✔ `DEFAULT_CAPABILITY_MODEL` | ✔ `DEFAULT_EFFORT` |

And the capability override is destructive: `resolve_use_case_model_override` (`capabilities.rs:33-48`)
returns `ModelProfile { model: Some(id), ..ModelProfile::default() }` for a tier slug, and
`executions.rs:336-339` **replaces** `persona.model_profile` with that serialization. Setting a
capability's model to "haiku" therefore silently discards the persona's effort. Three `model_override`
values exist live, all `"claude-sonnet-4-6"`, so this is latent — but it is one `serde_json::to_string`
away from being live.

`executions.rs:346-350` then constructs a profile with a **format-string literal**
(`format!("{{\"model\":\"{}\"}}", DEFAULT_CAPABILITY_MODEL)`) rather than the struct — a fourth spelling
of "build a model profile", and one that no type reaches.

### 7.I Four ledgers record a model; one records the effort — and it is the wrong one

| ledger | rows | model | effort |
|---|---:|---|---|
| `persona_executions` | 2,188 | `model_used`: 852 `claude-sonnet-4-6`, 152 `claude-opus-4-8[1m]`, **1,184 NULL** | `thinking_level`: **1,004 rows, one value, `medium`** |
| `companion_turn` (user DB) | 1,779 | `model`: **6 distinct** — `claude-sonnet-4-6` 1,042 · `claude-haiku-4-5-20251001` 327 · `claude-opus-4-8` 393 · `claude-sonnet-5` 15 · `claude-fable-5` 1 · `claude-opus-5` 1 | **no column** |
| `dev_llm_spend` | 89 | `model`: `claude-sonnet-4-6` 88, `claude-sonnet-5` 1 | **no column** |
| `provider_audit_log` | 4,001 | `model_used`: **NULL ×4,001, 0 distinct** | **no column** |
| `lab_arena_results` | 58 | `model_id`: tier slugs `sonnet`/`opus`/`haiku` | **no column** |

Two things follow.

**The BYOM Audit Log renders a dash 4,001 times.** `ByomAuditLog.tsx:55` is
`{entry.model_used || '-'}` — a screen whose purpose is to answer "which model ran and did it fail over",
against a table where the column has never been written. (`llm-spend-accounting` §7.F reported the same
4,001/4,001 from the cost side; this path reports the *UI* consequence, which is the part a user meets.)

**The richest model vocabulary in the app is in the ledger with no effort column.** `companion_turn`
holds 6 distinct models — including `claude-fable-5` and `claude-opus-5`, which appear in **no** catalogue
in the repo (`tier_slug_to_model_id`, `CLAUDE_MODEL_CHAIN`, `modelCatalog.ts`, `MODEL_PRICING` all know
neither) — and those are exactly the calls whose tier constants carry an effort. Meanwhile
`persona_executions.thinking_level` has a column, 1,004 populated rows, and one value.

`execution_config` completes the picture: `model_profile` appears in 2,011 of 2,188 rows,
`routing_rule` in 2,011, and the substring `effort` in **0**.

### 7.J Thirty files enumerate the three Anthropic tiers, and two of them quote a price

Scanning 4,336 non-test `.rs` + `.ts` + `.tsx` files for a declaration naming all three of
`haiku`/`sonnet`/`opus` within one window: **30 files**. Five are genuine catalogues that a reader could
mistake for *the* catalogue:

| catalogue | site | contents |
|---|---|---|
| tier-slug map | `engine/src/prompt/capabilities.rs:9-16` | 3 model ids |
| failover ladder | `src/engine/failover.rs:638-642` `CLAUDE_MODEL_CHAIN` | 3 model ids, and its own comment says it duplicates the map above |
| price table (Rust) | `engine/src/cost.rs:15-60` | substring → price |
| price table (client) | `src/lib/utils/platform/pricing.ts:6-28` | prefix → price |
| client tier list | `modelCatalog.ts:16-20` + re-declarations at `compareHelpers.ts:22-24`, `useCaseDetailHelpers.ts:23-25`, `personaCore/catalog.ts:104-108` | 3 slugs, hardcoded labels |

`CLAUDE_MODEL_CHAIN`'s docstring is the best available argument that this is not cosmetic:

> *"The previous chain pinned `claude-opus-4-20250514` and `claude-sonnet-4-20250514`, both retired
> 2026-06-15 and now returning 404 — so a healthy opus-4-8 persona whose primary hiccuped was actively
> failed over into a guaranteed 404."*

`FailoverCandidate` (`failover.rs:619-625`) carries `model: Option<String>` and **no effort**, so a
failover changes one axis of the pair and leaves the other wherever it was.

**And the choice surface quotes prices.** `compareHelpers.ts:22-24` — the model-comparison picker —
renders `cost: '~$0.25/1K'` (haiku), `'~$3/1K'` (sonnet), `'~$15/1K'` (opus). Those numbers are the
per-**million** figures from `cost.rs`, labelled per-**thousand**: a 1,000× unit error. Two of the three
numbers are also wrong at the source — [`llm-spend-accounting`](./llm-spend-accounting.md) §7.A measured
`cost.rs` as **3× over on opus and 4× under on haiku** against current list prices, and
`pricing.ts:8-10` re-types the same two errors independently in TypeScript
(`'claude-opus-4': {15, 75}`, `'claude-haiku-4': {0.25, 1.25}`). This path does not re-open the price
table — it reports that the numbers have reached **a decision surface**, where a wrong price does not
merely misreport a bill, it changes which model the user picks.

### 7.K The model-tier advisor cannot set the model tier

`ModelTierChoiceWidget` (`src/features/home/sub_cockpit/widgets/ModelTierChoiceWidget.tsx`) is the chat
card Athena emits via `show_model_tier_choice { intent, recommended, tiers: [{tier, rationale}] }`. Its
docstring:

> *"The card is informational — it doesn't write any selection. The user picks the tier when they reach
> the build flow."*

It is the only surface in the app that reasons about *which* tier suits *this* job — the actual subject
of this leaf — and it terminates in prose. Its `tierLabel()` (`:120-124`) is, to its credit, the one
tier-label function that resolves through i18n (`t.plugins.companion.model_tier_*`), which makes it a
**seventh** naming of the three tiers.

### 7.L The Persona Core model/effort picker writes into the prompt

`usePersonaCore` (`src/features/agents/sub_glyph/personaCore/usePersonaCore.ts`) exposes `setModel` and
`setEffort` behind a tile grid and a stepped meter (`ConfigTiles.tsx:44,58-66`), defaulting to
`{ model: "sonnet", effort: DEFAULT_EFFORT }`. Its only output is `launchAugmentation()` (`:91-104`),
which ends:

```ts
lines.push(`Model tier: ${modelWord}; reasoning effort: ${state.effort}`);
```

appended to the build intent as prose (`GlyphDialogueCinemaLayout.tsx:62`). Nothing writes
`model_profile` and nothing reaches `--effort`. The module docstring states this plainly at `:14-15`:
*"Wiring these to real persona config (model_profile, --effort) is the next-leverage follow-up."*

So the run receives a sentence asserting a configuration it does not have. When the user picks "Max", the
prompt says `reasoning effort: xhigh` and the CLI is invoked with `--effort medium`. **This is the
sharpest instance of the leaf's condition in the repo: a control that does not reach what it names, and
that tells the model it did.**

### 7.M The Configuration tab shows a dash for 74 personas and names the wrong resolver

`PersonaConfigPanel.tsx` is the app's own answer to "what will this persona run at" — the Configuration
tab under All Personas, rendering `resolve_effective_config_bulk`. Two things are wrong with it, and
both are downstream of §7.H rather than of the component.

**It has no effort row.** `FIELDS` (`:227-233`) is `model · provider · maxBudgetUsd · maxTurns ·
promptCachePolicy` — the exact field list of `EffectiveModelConfig`, which has no `effort`. So the one
screen built to answer "what is this persona configured to do" **cannot display the reasoning effort at
all**, and every persona in the operator's fleet is running at `medium` with no surface saying so.

**Its explanation of the empty cell is out of date by the exact fix that closed the leak.** Its header
comment (`:13-19`) reads:

> *"Cells read `--` with a source badge when a tier doesn't supply that field — that's the accurate state
> for personas that inherit the CLI default."*

For **74 of 78 personas** the Model cell is `--` with a `default` source badge. But those personas do
**not** inherit the CLI default: `runner/mod.rs:340-359` pins `claude-sonnet-4-6` before the argv is
built, and §0 measures that working (zero opus rows after 2026-06-15). The panel is truthful about the
*cascade* — no tier supplies a model — and wrong about the *consequence*, and the wrongness is in the
operator's favour by exactly the amount the floor saves. **A configuration view that models the cascade
and not the terminal constant will describe a fixed leak as though it were still leaking**, which is the
same class of error as a stale price on a choice surface (§7.J): a screen making a claim about a
decision, aged past the code.

### 7.N What this path CLEARED

- **"Unpinned personas ride the CLI account default."** *Was* true and is **fixed**. 141 of 141 opus-4-8
  runs are unpinned runs, they end at `2026-06-14T09:15`, and the 569 executions after 2026-06-15 are
  100% sonnet. The mechanism — a named constant at the end of the cascade — is the prescription, banked.
- **"The Lab's effort plumbing is broken."** No — `TestModelConfig.effort` → `ModelProfile.effort` →
  `build_cli_args` is correct end to end (`test_runner.rs:748-756`). The defect is that no UI sets it.
- **"`build_cli_args` forgets the effort for headless calls."** No — `--effort` is unconditional at
  `cli_args.rs:116`. All 30 call sites that push `--model` onto its result get `medium`. The gap is the
  **5** hand-assembled argvs that never go through it.
- **"The routing cascade is dead code."** Not quite. It is wired (`runner/mod.rs:185`), validated
  (`model_routing.rs:136`), has a settings UI, has a self-tuning writer (`policy_tuning.rs`), and a
  regression test guarding its settings key (`settings_keys.rs:1409-1418`, added because *"the engine
  read/wrote `model_routing_rules`… `set_model_routing_rules` was REJECTED by `validate_key`, so BYOM
  routing silently did nothing"*). It has **0 rules configured**. The finding is unexercised, not broken —
  and per `headless-model-call` §7.H, that distinction matters.

---

## 8. Gaps in the primitives

### 8.1 `TurnTier` is a type nobody is required to take whole

`pub struct TurnTier { pub model: &'static str, pub effort: Option<&'static str> }` — both fields public,
so `MICRO.model` is as easy to write as `&MICRO`. **Qualification 4 exactly** (a type anyone can
construct — or destructure — authenticates nothing). Seven of eight consumers took half. The fix is not a
lint; it is that the functions downstream (`call_claude_text`, `spawn_headless_claude`) accept a `&str`
model, so passing the tier whole is not *possible* without changing them.

### 8.2 There is no `EffortLevel` type in Rust

`ModelProfile.effort`, `ModelRoutingRule.effort`, `TestModelConfig.effort`, `TurnTier.effort` and
`set_launch_model_info`'s `thinking_level` are all `String`/`&str`/`Option<String>`. The four legal
values exist as `EFFORT_LEVELS: &[&str]` (`model_routing.rs:25`) consulted by exactly one function
(`validate`). Everything else — including the argv push — accepts any string. `companion_effort_override`
(`session.rs:1809-1813`) validates by hand with a `matches!`, and the comment says why: *"Validated
against the known CLI levels so a typo can't inject an arbitrary flag value."* One function does the
right thing; the type would do it everywhere.

### 8.3 `EffectiveModelConfig` cannot carry the effort, so no shared tier can set it

Adding `effort: ConfigField<String>` to `config_merge.rs:45-56` is the smallest edit in this document with
the largest reach: it gives workspace and global tiers an effort, which is the layer an operator actually
wants ("all SDLC teams run at high"). Today the only way to set an effort for nine personas is to edit
nine `model_profile` JSON blobs.

### 8.4 `tokenLabel`'s token parameter is open while its category is closed

```ts
export function tokenLabel(t: Translations, category: TokenSection, token: string): string
```

`TokenSection` is `keyof Translations['status_tokens']` — genuinely closed. `token` is `string`. So
`tokenLabel(t, 'thinking', 'xhigh')` compiles and returns `'xhigh'`. **Qualification 1** in its purest
form: the closed parameter constrains exactly what it names and the defect lives in the one beside it. A
second generic (`tokenLabel<C extends TokenSection>(t, c: C, token: keyof Translations['status_tokens'][C])`)
would make the missing arm a compile error at the call site — but only for callers holding a literal, and
`e.thinking_level` arrives from the wire as `string`. Which is 8.5.

### 8.5 No type reaches a token that arrived over IPC

`thinking_level` crosses a serialization boundary (`ts-rs` binding → `string`). This is the doctrine's
fifth "where types cannot reach", from the receiving side: the value is unforgeable in Rust and arbitrary
in TypeScript. The only mechanism that reaches it is a **runtime** one — and the runtime mechanism this
repo has (`console.warn` at `tokenMaps.ts:44`) is gated on `import.meta.env.DEV`, so it is silent exactly
where a user is looking at the raw token.

### 8.6 `en.json` is not TypeScript, so the arity of the display vocabulary is unconstrained

Inherited from [`client-rule-mirroring`](./client-rule-mirroring.md) Gap 2 and specialized here: the
construction that would close §7.C — `Record<EffortLevel, string>` over `status_tokens.thinking` — cannot
be written where the data lives. And the checks that *do* run over locale files
(`check-coverage.mjs`, `check-untranslated.mjs`) compare locales to each other, so an arm punched
identically out of all 14 is invisible, and an English value that *is* the raw token
(`models.effort_xhigh = "xhigh"`) reads as a deliberate do-not-translate term.

### 8.7 The effort has no equivalent of `set_model_used_actual`

The model gets two writes: the launch value from the argv, then the CLI-reported actual overwriting it.
The effort gets one, and there is no "actual" — no provider reports the reasoning depth it used, and
`docs/development/model-effort-guide.md` §3 establishes that the thinking blocks are redacted to empty
strings in both the stream and the transcript. **So the effort is permanently a claim about intent, never
an observation**, which is precisely why the intent must be recorded (P5) and why three of four ledgers
having no column for it is not a small omission.

### 8.8 Nothing joins a model/effort choice to an outcome

Even with `thinking_level` recorded, evaluating a choice needs a second number: tokens, latency, or a
grade. `persona_executions` carries `input_tokens = 0` and `output_tokens = 0` on **2,188 of 2,188 rows**
(`llm-spend-accounting` §7.A; `parser.rs:340-341`), `duration_ms` is present, and `director_score` is
sparse. So the question this leaf exists to answer — *was that the right model at the right effort* — has
no denominator in this database. That is the honest answer to "what can a model/effort chooser be
measured against": **latency and dollars only**, and dollars are themselves reconstructed from the CLI's
own `total_cost_usd` rather than from tokens.


---

## Convergence — five sibling checkouts, and the cohort is three

Run against `brainiac` (Rust workspace, 8 crates, 6 provider constants), `vibeman` (Next.js + Tauri,
5 provider clients), `ascent` (Next.js + Prisma, 6 transports, **the only sibling with a
reasoning-effort axis**), `personas-cloud` and `personas-web`.

**Cohort determination, verified rather than inherited.**

- **`personas-cloud` is a PORT — re-verified, and the tell is textual.** Six explicit "ported from"
  comments: `packages/shared/src/prompt.ts:268` *"Prompt assembly (ported from engine/prompt.rs)"*,
  `:447` *"CLI args builder (ported from engine/prompt.rs)"*, `:517` *"…ported from engine/design.rs"*,
  `:143` *"matching desktop engine/prompt.rs"*; plus `bus.ts:5` and two orchestrator files naming
  `engine/background.rs`. Scored as a port, not as corroboration.
- **`personas-web` is the NEGATIVE CONTROL — re-verified.** `package.json:36-66` carries no
  `@anthropic-ai/*`, no `openai`, no `@google/*`, no `ai`, no `langchain`; a grep for every provider
  endpoint and SDK constructor across `src/` returns **no matches**; all ten API routes are Supabase
  CRUD. One nuance the earlier sweeps did not report: the repo *does* contain a real Gemini caller, in
  **dev tooling outside the product** (`.claude/skills/leonardo/tools/gemini-recognize.mjs:14`,
  `.claude/skills/icon-gen/tools/gemini-recognize.mjs:17`). Product code: zero.
- **Independent cohort = 3:** `brainiac`, `vibeman`, `ascent`.

| Clause | brainiac | vibeman | ascent | personas-cloud (port) | Verdict |
|---|---|---|---|---|---|
| **P1** unspecified resolves upward → terminate in a constant you own | 6 per-provider defaults, one dispatch chokepoint | 3 disagreeing default tables + ≥9 loose literals | 5 per-provider `DEFAULT_*` | **never passes `--model` at all** → container default | **Physics as a practice (3/3 have per-provider defaults) and physics as a failure (the port reinvented the hole)** |
| **P2** model + effort travel as ONE value | no effort axis | no effort axis | effort read from `process.env` **inside** `bedrock.ts:100`, never in a signature | no effort field on `ModelProfile` | **SILENCE — 0 of 5. ~22 model-carrying declarations across the sweep, 0 carry an effort beside it. Personas is the only repo where the pair exists as a type (`TurnTier`)** |
| **P3** one cascade, implemented once | **1 chain**, `lib.rs:166-180` + `:209-246`, documented in source *and* `docs/deploy/providers.md:29-35` | **≥20 re-derivations**, no documented order | **6 re-derivations** of `opt \|\| env \|\| DEFAULT`; only Bedrock factored it out (`bedrock.ts:42-46`) | 1 chain (`httpApi.ts:567`) | **Physics as a failure — 2 of 3 re-derive. brainiac is the reference and Personas is closer to brainiac (1 cascade at `runner/mod.rs:185`) than to the other two** |
| **P4** the display vocabulary is complete and localized | no UI | 2 hardcoded option lists (`types.ts:310-320`) | 0 option lists — free-text `<input>` | no UI | **Converges on the disease, 1 of 1 comparable: `personas-web` ships an i18n system with two CI gates and its own model/effort list (`MultiProviderAI.tsx:18-22`) is hardcoded English with no `useI18n` import and 0 relevant keys in `src/i18n/`** |
| **P5a** the model that ran is recorded | **5 migrations carry `model_ref`**, 5 meter sites, 5 stamp sites, asserted in 6 tests | 4 tables carry `model`, but every write is `?? null` → records the *request*, not the resolution | `Scan.engineModel` (`schema.prisma:303`), 1 write, **6 reads** incl. a `groupBy(["engineModel"])` cost rollup | `model_used` column exists with **0 write sites** | **Physics — 3/3 independent record the model** |
| **P5b** the effort that ran is recorded | n/a | n/a | **NO** — has the knob *and* a rich recording layer, and they never meet | n/a | **SILENCE — 0 of 5. Personas is the only repo in the fleet with an effort column** |
| **P6** a control must move something | env-only | — | `ModelScorecard.tsx:65,89` ranks measured models **and is not selectable** | `buildCliArgs` emits `--model` correctly and has **ZERO call sites**; the real spawn (`executor.ts:96-101`) omits the flag | **Physics as a failure — reinvented in 2, and the port is the extreme case (see below)** |
| **P7** escalation is not monotonic | no measurement | no measurement | **`tiger/models.md:41`: *"opus is a premium toggle, not a default"*; `sam-staff-engineer.md:162`: *"Going sonnet→opus is ~1.7× in, ~1.7× out and buys me nothing"*** | — | **Physics — independently reinvented, and it is the only external corroboration of the repo's own bench** |
| **P8** the effort axis cannot be observed | — | — | **`tiger/models.md:39`: *"sonnet/opus + thinking \| low/high \| **not run** (harness can't vary thinking)"*** | — | **Physics, and the sharpest result of the oracle — see below** |
| **P9** one vocabulary, one owner | 6 constants + 2 strays | **3 mutually contradictory tables** + ≥9 strays | 5 constants + 4 duplicates | context-window map only | **Physics as a failure — 0 of 5 has a single canonical catalogue** |
| **P10** a price beside a choice ages | prices only in a moonshot doc | `CostEstimation.tsx:23-27` prices **a model generation the app can no longer select** | `MODEL_PRICES` (`config.ts:127-149`) + a test asserting every shipped default has a price row (`config.test.ts:35,68`) | — | **Mixed 1–1: ascent gates it, vibeman shows the exact failure Personas has** |

### The two findings that matter most

**1. P8 is physics, and it explains why Personas' Lab effort dimension is unreachable.** Two repos in
the fleet have a reasoning-effort axis. **Both built the axis and neither can vary it in its own
harness.** Ascent's benchmark note is explicit — `tiger/models.md:39` lists the `sonnet/opus × thinking`
cells as **"not run (harness can't vary thinking)"**, and
`tiger/sessions/2026-06-20-tiger-benchmark.md:47` repeats *"Thinking-level axis NOT run… the knob itself
is backlog P2-6c"*. Personas is the same story with the parts in a different order: the knob shipped
(`TestModelConfig.effort` → `build_cli_args`), the UI to move it did not, and the benchmark was run
outside the product in eight git worktrees. **Two teams, two languages, one shape: the effort knob gets
built and the instrument that would justify it does not.** That is the strongest argument in this
document for wiring §7.B before adding any more effort defaults.

**2. The port dropped the wiring and kept the plumbing — the mirror image of the compare-and-set case.**
In `personas-cloud`, the model path is *structurally the best in the sweep*: `ModelProfile.model` is a
typed field (`shared/src/types.ts:56`), persisted (`db.ts:245`), validated (`httpApi.ts:2205-2208`), and
`buildCliArgs` correctly emits `args.push('--model', modelProfile.model)` (`shared/src/prompt.ts:473-475`).
**`buildCliArgs` has zero call sites** — one grep across `packages/` and `facade/` returns only its own
`export function` line. The real spawn builds argv by hand and omits the flag entirely
(`worker/src/executor.ts:96-101`); the dispatcher parses the profile and reads only `.provider`,
`.baseUrl`, `.authToken` (`dispatcher.ts:733-752`), **never `.model`**; and `persona_executions.model_used`
(`db.ts:359`) has **0 write sites**, only a columnMap entry. So the port carried the *type* across and
left the *call* behind. Since a port is not a second opinion, this is not corroboration — but it is a
precise measurement of which half of a model-selection system is easy to carry and which half falls off,
and the half that falls off is the half that reaches the process.

### Silences worth naming as silences

- **Nobody records the effort.** 0 of 5, and ascent is the case that proves it is an omission rather
  than an absence: it has the knob at `config.ts:184-187` and a six-read-site recording layer at
  `schema.prisma:303`, and a scan run at `LLM_THINKING_BUDGET=8000` is forever indistinguishable from one
  run at 0. **Personas is ahead of the entire fleet here** — `persona_executions.thinking_level` exists,
  is required in the writer's signature, and is populated on 1,004 rows. That it holds one value is a
  configuration fact, not a design one.
- **Nobody names the effort default.** 0 of 5. Ascent's default is the inline literal
  `envNumber("LLM_THINKING_BUDGET", 0)` at `config.ts:185`, three lines from a file that defines
  `MIN_LLM_TIMEOUT_MS` as a named constant for exactly this reason. Personas' `DEFAULT_EFFORT`
  (`cli_args.rs:39`), with its docstring naming the CLI version that moved the default underneath it, is
  the fleet's best answer and has no external warrant.
- **Nobody has a canonical model catalogue.** 0 of 5. This is the clause where Personas is *worst*:
  30 files enumerate the three tiers, against brainiac's 6 constants behind one dispatch chokepoint.


---

## Type over gate — the answer

**Yes, three times, and all three are worth more than §9's rule.** Held against the seven earned
qualifications.

**1. Make the effort a closed type, and make `EffectiveModelConfig` carry it.**
Today `effort` is `String` / `&str` / `Option<String>` in five declarations, and the four legal values
live as `EFFORT_LEVELS: &[&str]` consulted by exactly one function. A `#[derive(TS)] enum EffortLevel
{ Low, Medium, High, XHigh }` makes `session.rs:1809`'s hand-written `matches!` guard unnecessary, makes
`ModelRoutingRule::validate`'s effort arm unnecessary, and — crucially — **makes the arity visible to
ts-rs**, so `status_tokens.thinking`'s missing fourth arm becomes checkable from a generated union
instead of from a locale file.

**Qualification 2 bounds this honestly: requiredness is orthogonal to closedness, and here only
closedness helps.** Making `effort` required would be a lie — `None` legitimately means "use the
builder's default" at 30 call sites. Closing it does the whole of the work.

**And Qualification 5 says where to put the win.** Adding `effort: ConfigField<String>` to
`EffectiveModelConfig` (`config_merge.rs:45-56`) is the single highest-leverage edit in this document:
it is ~10 lines, it gives the workspace and global tiers an effort they cannot express today, and it
turns effort's one resolution layer into six — the same six the model already has. Without it, "all SDLC
personas run at high" requires editing nine JSON blobs.

**2. Make the tier unsplittable at the doors that matter.**
`TurnTier { pub model, pub effort }` is public-fielded, so `MICRO.model` is as easy to write as `&MICRO`
— **Qualification 4 exactly: a type anyone can destructure authenticates nothing.** But the fix is not
to privatise the fields; it is **Qualification 7** — the requirement is not forcing the bad value, the
*downstream signature* is. `oneshot::call_claude_text(pool, prompt, model: &str, leg, timeout)` cannot
accept a tier, so every one of its 8 callers must reach in and take half. Change the parameter to
`tier: &TurnTier` and all 8 sites become correct in one edit, and `run_oneshot` gains the two lines that
put `--effort` in its argv.

This is the same move the repo already banked once on the neighbouring axis:
[`headless-model-call`](./headless-model-call.md) §7.E measured three sibling doors — withhold → 8/8
correct, hand back → 2/2 present but wrong, permit → 0 callers. `call_claude_text` is the *withholding*
door for metering and the *handing-back* door for effort, in the same signature. It should withhold both.

**3. Close the label parameter, not the category parameter.**
`tokenLabel(t, category: TokenSection, token: string)` closes exactly the half that was never the
problem (**Qualification 1**). A second type parameter —
`tokenLabel<C extends TokenSection>(t, c: C, token: keyof Translations['status_tokens'][C])` — makes
`tokenLabel(t, 'thinking', 'xhigh')` a compile error **at literal call sites**. It reaches neither of the
two real ones, because `e.thinking_level` crosses IPC as `string` (doctrine, "where types cannot reach"
#5). **So this is the one place in the document where a type genuinely cannot reach the condition**, and
the honest answer is the instrument in §9's "not gated" list: a locale-catalogue arity check against the
generated union, which is a *script*, not a matcher.

**What the gate is for.** None of the three touches the condition §9 counts, because that condition is
about a hardcoded string in a UI option list, and no Rust type reaches a TSX literal. The rule holds the
line on the client vocabulary at 20 while moves 1–3 land on the server.

---

## 9. The missing gate

**Manifestation layer** ([`golden-path-contract.md:43-69`](../golden-path-contract.md)). The warning must
be loud: **no sibling repo gates anything in this document, and two of them cannot.** `brainiac` and
`personas-cloud` have no model/effort UI at all; `ascent` and `vibeman` ship ESLint configs that say
nothing about model vocabularies; `personas-web` has i18n gates and its own model list evades them by
living in a component that never imports `useI18n`. The *conditions* below travel; the signal does not.

### Checked first — the existing 165 baselined census rules

Overlap of the FINAL pattern measured two ways: **exact matched line**, and **±25 lines** (same
declaration block).

| Rule | Overlaps? |
|---|---|
| `frozen-ui-copy-constant` (62 files / 818, `i18n-string-authoring.md`) | **Nearest neighbour, and disjoint by construction.** Shares 2 files. Its pattern requires a **two-word** English label (`[A-Z][^'"]*[a-z] [a-zA-Z]`), so in `useCaseDetailHelpers.ts` it matches the *Qwen* rows (`:29,:30` — `'Qwen Coder'`, `'Qwen Max'`) and cannot match the Anthropic rows (`:23-25` — `'Haiku'`, `'Sonnet'`, `'Opus'`), which are the ones this path is about. Its roots also exclude `.tsx`, so `StudioBuildSettings.tsx` is invisible to it. **Exact-line overlap: 0.** |
| `untranslatable-token-label` (241 / 38, `status-and-severity-badges.md`) | Counts labels authored beside their colour. Zero shared files with this rule. That path owns the *colour* of a closed vocabulary; this one owns its *arity and its owner*. |
| `comment-kept-cross-language-mirror` (37 / 40, `client-rule-mirroring.md`) | Shares 1 file (`StudioBuildSettings.tsx`) at line 22 — the `MCP_CONNECTORS` comment, a different const. **Exact-line overlap: 0.** |
| `undeclared-tier-branch` (13 / 13, `tier-and-capability-gating.md`) | Product/plan tiers (free/pro/enterprise), not model tiers. 0 shared files. |
| `unpinned-billing-account-spawn` (5 / 5, `headless-model-call.md`), `unbound-child-lifetime` (12 / 13), `self-disabling-money-ceiling` (8 / 8), `unknown-money-as-zero` (21 / 25), `prompt-extended-outside-its-assembler` (3 / 8) | All Rust-rooted. 0 shared files with a `src/**/*.{ts,tsx}` rule. Relevant to the **declined** candidate below, not to the shipped one. |
| `illegible-foreground-alpha` (384) | Shares `StudioBuildSettings.tsx`; no site within 25 lines. Colour rule, no conceptual overlap. |

**Measured, not asserted: 0 of 20 matched lines is matched by any of the 165 baselined rules
(0.0% exact-line overlap). Two rules match a different line inside a shared declaration block.**

### The semantic conditions, stated stack-free

**C1 — a closed model/effort vocabulary is re-declared at a choice surface with a hardcoded display
label instead of being imported from the catalogue that owns it.** *Gated below.*

**C2 — a hand-assembled model invocation states the model and not the reasoning effort.** *Designed,
built, run at 5/5 precision with a perfect anchor partition, and DECLINED — see below.*

**C3 — a display catalogue has fewer arms than the enumeration it displays.** *Not gateable by counting;
an instrument is specified below.*

**C4 — a control writes nothing.** *Not gateable; see below.*

**C5 — a resolution layer that has never held a value.** *A data question, not a source question.*

### Conditions deliberately NOT gated, each with the number that decided it

- **C2 (model stated, effort omitted) — built, validated at 5/5 precision with a 5+3 = 8-of-8 anchor
  partition, and declined on SITE overlap.** The rule anchored on a hand-typed Claude print-mode argv
  (`"-p", "-", "--output-format"`), tempered against `"--effort"`, terminating at `Command::new` or
  `.spawn()`. It scored **4 files / 5 matches, precision 5/5** (`ocr/mod.rs:583` and `:597`,
  `oneshot.rs:180`, `fix_pass.rs:194`, `consolidator.rs:343`); the same anchor with the middle inverted
  scored **2 files / 3 matches** (`cli_args.rs:102`, `:291`, `session.rs:2158`); and 5 + 3 = **8 of the
  anchor's 8 raw matches**, a clean partition. Runtime 0.78 s. It is a better-shaped rule than the one
  shipped, and it still loses: **4 of its 5 sites sit within 25 lines of an existing rule's match** —
  `unbound-child-lifetime` at `ocr/mod.rs:{579,596}`, `fix_pass.rs:205`, `consolidator.rs:354`;
  `unpinned-billing-account-spawn` at `ocr/mod.rs:596`, `consolidator.rs:354`;
  `shell-vehicle-nonliteral-arg` at `ocr/mod.rs:579`. Exact-line overlap is 0, but *the same four
  functions are already on three ratchets*, and `headless-model-call` §9 declined its own C3 for
  precisely this at a weaker 4-of-6. The one site nothing else counts — `oneshot.rs:180`, the corpus's
  own named exemplar — is a **named fix** in the backlog instead. **Refusing is the finding**, and the
  reason is worth stating: the sites that hand-assemble an argv are a small, already-heavily-policed
  population, while the condition's real mass is on the *client*, which no Rust rule can see.
- **C3 (a display catalogue short an arm) — not gateable, and this is the doctrine's "cannot assert an
  absence" in its purest form.** `status_tokens.thinking` has 3 arms and `EFFORT_LEVELS` has 4. No count
  of anything *present* detects a missing key: the 14 locale files agree with each other perfectly, and
  `check-coverage.mjs` compares them to each other. **The instrument is a script, not a matcher**, and it
  is ~30 lines: extend `scripts/i18n/check-coverage.mjs` with a `status_tokens` mode that reads the
  generated ts-rs unions in `src/lib/bindings/` (once `EffortLevel` exists — Type-over-gate move 1) and
  asserts `Object.keys(en.status_tokens.<category>)` is a superset of the union's arms. Precedent:
  `scripts/check-csp-hosts.mjs` exists for exactly this class. `client-rule-mirroring` §9 independently
  specified the same instrument and reached the same conclusion — *"a join again, and across languages"*.
- **C4 (a control that writes nothing) — not gateable.** `EFFORT_OPTIONS` (0 importers), `selectedEfforts`
  / `toggleEffort` (0 consumers), `ModelTierChoiceWidget` (informational by design),
  `usePersonaCore.setEffort` (writes prose). Detecting these needs whole-program reachability from an
  exported symbol to a network call, not a regex. `knip`/`ts-prune` would find the first two and would
  be **wrong** about the third and fourth, which are imported, rendered, and still write nothing. Named
  fixes in the backlog.
- **C5 (an empty resolution layer) — a data question.** "Has this cascade layer ever held a value" is
  answered by a query against `app_settings` / `persona_teams` / `personas`, not by scanning source. It
  is the single most valuable measurement in this document (§0) and it belongs in a startup diagnostic —
  a boot-time log line naming which of the six model layers is populated — not in the census.
- **Model-id literal drift (30 files enumerating the three tiers) — not gated, deferring to a
  neighbour's reasoned decline.** [`headless-model-call`](./headless-model-call.md) §9 already declined
  a count of `"claude-*"` literals, on the grounds that the right instrument is a `#[test]` asserting
  every literal resolves through `model_routing` / `tier_slug_to_model_id`. That decline stands and this
  path does not re-litigate it. It adds one datum: `companion_turn` holds **`claude-fable-5` and
  `claude-opus-5`**, two ids that appear in **no** catalogue in the repo — so the test that decline
  specifies would fail today, which is the correct outcome.

### The rule — validated

```json
{
  "rules": [
    {
      "id": "hardcoded-model-choice-label",
      "goldenPath": "docs/concepts/golden-paths/model-and-effort-selection.md",
      "title": "A model-tier or reasoning-effort option whose display label is a hardcoded literal instead of a catalogue key",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:value|id)\\s*:\\s*(['\"])(?:low|medium|high|xhigh|haiku|sonnet|opus)\\1\\s*,\\s*label\\s*:\\s*['\"]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an option object whose value is one of the app's SEVEN closed model/effort tokens (the four EFFORT_LEVELS from src/lib/models/modelCatalog.ts:72 plus the three tier slugs from ANTHROPIC_MODELS at :16-20) and whose display label is a string literal typed right there. PROXY FOR the stack-free condition: a closed model/effort vocabulary is re-declared at a choice surface with a hardcoded label instead of being imported from the catalogue that owns it. PRECISION 20/20, every match opened. The COMPLIANT form is the same option shape with `labelKey: 'models.effort_<id>'` (modelCatalog.ts:83-88), whose template-literal type makes a label that is not an i18n key for a real level fail to compile; the positive control counts exactly that and scores 4. 20 + 4 = 24 is the COMPLETE population of option objects in 4,829 files that pair one of these seven tokens with a display label, so the rule partitions its own population rather than reporting a ratio. WHY IT MATTERS beyond i18n: the five surfaces that render an effort level produce ELEVEN distinct English strings for FOUR values (Low/Medium/High/xhigh, Low/Medium/High/MISSING, Low/Medium/High/Max, Fast/Balanced/Deep/Max, and the raw token), so a support answer naming a level is ambiguous, and the arity drifts too - status_tokens.thinking has 3 arms against EFFORT_LEVELS' 4 in 14 of 14 locales. EXCLUDE: src/stores/themeStore.ts, where low/mid/high is a DISPLAY BRIGHTNESS scale - the only homonym in 4,829 files, and its four matches are correct code. RECALL is deliberately partial: a list using `name:` or `title:` instead of `label:`, or ordering the keys label-first, reads as compliant; ModelRoutingSection.tsx:91-94 renders the bare token straight into an <option> with no label key at all and is invisible here; and the vocabulary is derived from the tree (modelCatalog.ts) rather than imagined, which is what keeps the brightness homonym the only false positive. PRECONDITION (must be re-derived per repo): this repo exposes a CLOSED, SEVEN-VALUE model/effort vocabulary to the user AND owns a catalogue module with i18n-keyed options. A repo with free-text model inputs (ascent: two <input> fields, zero option lists) or no model UI at all (brainiac, personas-cloud) scores ZERO here while the condition is absent, and a repo with hardcoded option lists and no catalogue (vibeman: 2 lists, 6 inline English labels) scores zero because the token set differs. Four of five sibling repos audited for this path would report a clean run.",
        "note": "Zero of the 20 matched lines is matched by any of the 165 baselined rules (0.0% exact-line overlap, measured with the final pattern). The nearest neighbour, frozen-ui-copy-constant, requires a TWO-WORD label and therefore matches the Qwen rows of the same array while structurally unable to match the Anthropic ones."
      },
      "exclude": [
        {
          "path": "src/stores/themeStore.ts",
          "reason": "DARK_BRIGHTNESS_LEVELS / LIGHT_BRIGHTNESS_LEVELS use low/mid/high as a DISPLAY BRIGHTNESS scale, not a reasoning-effort level. A genuine homonym in this repo's vocabulary and the only one in 4,829 files; the four matches there are correct code."
        }
      ],
      "baseline": { "files": 5, "matches": 20 },
      "floor": 2000
    },
    {
      "id": "hardcoded-model-choice-label-positive-control",
      "goldenPath": "docs/concepts/golden-paths/model-and-effort-selection.md",
      "title": "Positive control — the identical option shape resolving its label through a catalogue i18n key",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:value|id)\\s*:\\s*(['\"])(?:low|medium|high|xhigh|haiku|sonnet|opus)\\1\\s*,\\s*labelKey\\s*:",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "the COMPLIANT half of hardcoded-model-choice-label: same anchor, same seven-token vocabulary, same option shape, `label:` swapped for `labelKey:`. Scores 4 matches in 1 file (src/lib/models/modelCatalog.ts:84-87, EFFORT_OPTIONS) against the violating rule's 20 in 5. It must be non-zero and disjoint, and 20 + 4 must equal the anchor population (24) - otherwise the violating rule is measuring 'is this an option list' rather than 'is the label owned by the catalogue'. The 5x separation is the honest headline and it is ALSO the finding: the compliant form exists, is correctly typed (`labelKey: `models.effort_${EffortLevel}``, a template-literal type), and has ZERO IMPORTERS across 3,793 client files - so this control counts a primitive nobody reaches. It carries NO baseline by design: a ratchet is monotone-downward and a control counting compliant code would fail the build every time adoption improved."
      },
      "floor": 2000
    }
  ]
}
```

### Validation — reproduced, fault-injected, positive-controlled, overlap-measured, re-extracted

Run against a private registry with a composer-unique filename (never `scripts/census/rules.json`, per
the contract's concurrent-writer warning):

```
node scripts/census/run-census.mjs --rules <private>.json --check --verbose
```

| Check | Result |
|---|---|
| Baseline reproduces | `OK` — **5 files / 20 matches / 4,829 walked / floor 2000** · exit 0 |
| Runtime | **1.9 s** for both rules over 9,658 file-visits. No lookbehind, no nested quantifier, no unbounded `[\s\S]` |
| Precision | **20/20** — all opened: `personaCore/catalog.ts:104,105,106,110,111,112,113` (3 tiers + 4 efforts), `StudioBuildSettings.tsx:12,13,14,15`, `compareHelpers.ts:22,23,24`, `useCaseDetailHelpers.ts:23,24,25`, `modelCatalog.ts:17,18,19` |
| **Positive control** | **4 matches / 1 file** (`modelCatalog.ts:84-87`). **20 + 4 = 24 = the complete option-object population.** Disjoint sets, same file only |
| Homonym handling | Without the exclude the rule scores **6 files / 24 matches**; the 4 extra are `themeStore.ts:35,37,42,44`, a brightness scale. Excluded with a prose reason rather than by narrowing the vocabulary, because narrowing to `xhigh\|haiku\|sonnet\|opus` also drops the control from 4 to 1 |
| **Exact-line overlap vs all 165 baselined rules** | **0 / 20 = 0.0%.** 3 rules share a file; 2 share a declaration block (different lines) |
| Overlap re-measured after the registry moved mid-composition | The registry grew **162 → 165 → 166** during this sweep as sibling composers merged. Both the 162-rule and the 165-rule runs returned **0 / 20**, and the shared-file set was identical (`frozen-ui-copy-constant`, `comment-kept-cross-language-mirror`, `illegible-foreground-alpha`). A composer measuring overlap on a live registry should state the size it measured at; this one is 165 |
| Fault 1: baseline `4/19` (a new violation appears) | `FAIL … 5 4 20 19` · exit 1 |
| Fault 2: baseline `6/24` (a silent drop) | `FAIL … 5 6 20 24` · exit 1 |
| Fault 3: a stale `exclude` added beside the real one | `[structural] exclude "src/stores/doesNotExist.ts" matched no file. The exemption is stale — the file moved or was deleted.` · exit 1 |
| Fault 4: the positive control given a `baseline` | `rules[1] … a positive control must NOT carry a baseline — it exists to fail` at `validateRule` · exit 1, **0 rules scanned** |
| Fault 5: `roots` → a non-existent dir | `[structural] walked 0 files but floor is 2000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` + `matched zero files anywhere` + a stale-exclude error + a drift drop — **four independent alarms** · exit 1 |
| Fault 6: the `exclude` removed | rule rises to **6 files / 24 matches** — the four brightness-homonym lines return and the drift check catches them · exit 1 |
| Fault 7: vocabulary narrowed to `xhigh\|haiku\|sonnet\|opus` (removing the homonym by construction instead of by allowlist) | rule 5/14, control **1/1** — a control of one is not a control. This is why the shipped shape is the wide vocabulary plus one excluded file |
| **Re-extraction** — rule pulled back out of this document's fenced block and re-run | **identical: 5 files / 20 matches / 4 control matches / exit 0** |

The positive control is the load-bearing check, and here it does double duty. It proves the pattern
discriminates on `label` vs `labelKey` rather than on "is this an option list" — 20 + 4 accounts for the
whole population. And its value, **4**, *is* a finding: the compliant form is one array in one file, and
that array has no importers.

### How it fails loudly if its own precondition is absent

`floor: 2000` against 4,829 client files means a repo whose `roots`/`extensions` no longer describe it
reports **"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"** rather than a clean run. The `zero-matches`
structural check means a port to a repo with free-text model inputs (ascent) or no model UI (brainiac,
personas-cloud) fails immediately rather than baselining at 0 — which is correct, because the condition
is genuinely absent there and this proxy would otherwise manufacture confidence. The single `exclude`
fails the run if `themeStore.ts` is renamed, so the one allowlist entry cannot go stale silently.

### The census cannot express "must be zero" — and here it should not reach zero

Unlike most rules in this corpus, this one has a **floor above zero**: `modelCatalog.ts:17-19`
(`ANTHROPIC_MODELS`) is the catalogue itself, and its three hardcoded labels are the English fallback
that `getAnthropicModels(t)` overlays. The correct end state is therefore **3, not 0** — the other 17
migrate to `labelKey`, and the rule is deleted at 3 rather than baselined there, since a rule pinned at
its own floor can never fail. State that in the commit when the migration lands.

---

## 12. Corrections to the brief

**1. "`thinking.xhigh` renders as a raw token while the same concept **is** translated under
`models.effort_xhigh` in all 14 locales" — the first half is right; the second half is wrong in 4 of 14
locales, and the worst of the four is English.** Measured across every locale file:
`models.effort_xhigh` is the literal string `"xhigh"` in **en, ko, vi** and `"Xhigh"` in **id**. English
is the source of truth, so the escape hatch the brief (and the published correction at
[`i18n-string-authoring.md:258-268`](./i18n-string-authoring.md), which says the concept *"**is**
translated everywhere else"*) points at renders the raw token for the default-locale user. Two
consequences worth carrying upstream: (a) that correction should be amended where it lives; (b) the
reason no gate saw it is *not only* that the completeness checks compare locales to each other — it is
that when `en = "xhigh"` and `ko = "xhigh"`, `check-untranslated.mjs` reads them as a deliberate
do-not-translate term, which is exactly what a brand name looks like. **A locale check cannot tell a
missing translation from a proper noun, and a machine token is shaped like a proper noun.**

**2. "`persona_executions.model_used` says `claude-sonnet-4-6` while `provider_audit_log.model_used`
says NULL for the same run, written 40 lines apart" — true, and the framing understates it by a factor
of the whole table.** `provider_audit_log.model_used` is NULL on **4,001 of 4,001 rows, 0 distinct
values ever**; `routing_rule` and `compliance_rule` are NULL on all 4,001 too. It is not a disagreement
between two writers, it is one writer that has never written. And the operator-visible consequence,
which the brief does not mention, is `ByomAuditLog.tsx:55` — `{entry.model_used || '-'}` — a screen
whose job is to say which model ran, showing a dash 4,001 times.

**3. "`FANOUT_DIRECTIVE` promises `--max-budget-usd` bounds cost; 0 of 78 personas set it" — confirmed,
cited, not re-derived**, per [`prompt-assembly`](./prompt-assembly.md) §7 D12 and
[`headless-model-call`](./headless-model-call.md) Q3. This path adds one adjacent datum from the same
replay: **`max_turns` is also NULL on 78 of 78**, and `deep_fanout` is set on 0 of 78, so all three of
`build_cli_args_inner`'s persona-gated flags are unemitted on every execution — which is *why* the two
flags this leaf owns (`--effort`, `--model`) are the only two that ever reach a real argv, and therefore
why they are the only two worth auditing.

**4. "Check whether the app's own defaults reflect the measured warning or contradict it" —
they contradict it, in two places, and the contradiction is narrower than it looks.** `BUILD_TURN_EFFORT
= "xhigh"` (`session.rs:1789`) and `studioStore.ts:221 effort: 'xhigh'` both sit at the top of the scale
on long-form build work, against a bench in the same repo that ranked xhigh 4th of 8 and named its
1,327-line output as the failure. **But the brief's framing invites an overcorrection this document
declines to make.** The guide's own banner says it covers ONE problem shape with one sample per cell and
that its build-and-verify arm was descoped as invalid — and *build* is precisely the shape those two
defaults govern. So the honest finding is not "xhigh is wrong"; it is that **two defaults were chosen
with no reference to the only measurement in the repository, and the repo has already written down that
the question is open** (`provider/claude.rs:232-235`: *"personas has no thinking knob today; deferred
alongside the open companion-path `--effort`/cost decision"*). The negative control is the part that
should actually change behaviour: with a hard output cap, Opus showed **no effort response at all**
(104→112 tokens low→max), and the companion's chat turns are short-output turns.

**5. "What can a model/effort chooser be measured against when the token columns are zero?" — the
answer is worse than the question assumes, and it is the best question in the brief.** Not only are
`input_tokens` and `output_tokens` 0 on 2,188 of 2,188 rows; the effort has **no observable at all**.
`docs/development/model-effort-guide.md` §3 establishes that thinking blocks are redacted to empty
strings in both the stream and the persisted transcript, so the intended acceptance test *"cannot be
run"* — a fact the sibling sweep independently confirms, since `ascent` lists its own
`sonnet/opus × thinking` benchmark cells as **"not run (harness can't vary thinking)"**. So a model/effort
chooser in this app can be evaluated on **latency and dollars only**, and dollars come from the CLI's own
`total_cost_usd` rather than from tokens. That is why §8.8 exists and why the backlog's highest item is
wiring the Lab's effort dimension rather than tuning a default.

**6. "recurrence 15, risk medium, sides=client, convergence=mixed" — `sides: "client"` is UPHELD for the
first time on a non-DOM leaf, and it is upheld for half the document.** The corpus ledger stood at seven
contradictions and two upholdings, both DOM leaves. This one is genuinely split and the split is
structural. Counted over the thirteen deviations in §7: **5 server** (D, E, F, H, I), **5 client**
(A, C, K, L, M), **3 both** (B, G, J). The **census rule** is client — and the server candidate was built,
validated at 5/5 precision with a perfect 8-of-8 anchor partition, then *declined* on site overlap, so
the client half won on merit rather than by scoping. The **positive control** is client; the
**headline** is server-side data. The mechanism that makes the client half real is the same one that
made the two DOM upholdings real — *the server never sees the label*. `status_tokens.thinking`'s missing
arm, the 11 competing English strings, the dead `EFFORT_OPTIONS`, the unreachable Lab knob and the
prompt-writing picker are all conditions no Rust type, test or census rule can reach. **Report it as
`both`, with the client half load-bearing** — which is the first time in this corpus that `"client"` was
not simply inverted.

**7. `convergence: mixed` — TESTED AND UPHELD, the second time a spine convergence label has survived.**
Measured over an independent cohort of **3** (`brainiac`, `vibeman`, `ascent`; `personas-cloud`
disqualified as a port on six textual tells, `personas-web` as a negative control on package.json + a
zero-match endpoint grep). Three clauses are physics — the model that ran is recorded (3/3), escalation
is not monotonic (ascent reinvented it: *"opus is a premium toggle, not a default"*), and the effort axis
cannot be observed in one's own harness (2 of 2 repos that have the axis). Three are physics-as-failure —
no canonical catalogue (0/5), re-derived precedence (2 of 3), a choice control that writes nothing
(2, plus the port's extreme case). And three are **silence**: nobody carries model and effort as one
value (0/5), nobody records the effort (0/5), nobody names the effort default (0/5). Mixed is exactly
right, and it is right *per clause*, which is what the label is supposed to mean.

**8. What the brief did not ask and should have: "how many of this cascade's layers have ever held a
value?"** Every question in the brief was about code — where is the choice made, which wins, what is
recorded. The single highest-value measurement in this sweep was a *data* question answered by replaying
the resolution order over the real rows: six layers, **five of them empty**, 78 personas, **one**
resulting cell. No amount of source reading produces that number, and without it the six-layer cascade
reads as a working policy rather than as an expensive way to reach a constant. Recommend adding *"replay
the resolution over live rows and count the distinct outcomes"* to every brief whose leaf contains the
word "selection", "routing", "precedence" or "override".

---

## Backlog

| # | Item | Where | Size |
|---|---|---|---|
| 1 | **Wire the Lab's effort dimension to a control** — `ArenaPanelColosseum.handleStart` calls `selectedModelsAndEffortsToConfigs`, and the panel renders `toggleEffort`. Without this the app cannot measure the axis it sets. | `ArenaPanelColosseum.tsx:193`, `usePanelRunState.ts:54` | M |
| 2 | Add `xhigh` to `status_tokens.thinking` in all 14 locales; fix `models.effort_xhigh` in **en, ko, vi, id** (it is the raw token) | `src/i18n/locales/*.json` | S |
| 3 | `call_claude_text` / `run_oneshot` take a `&TurnTier`, not a `&str` model — 8 callers, and `run_oneshot` gains `--effort` | `oneshot.rs:122,171` + 8 callers | M |
| 4 | Remove the duplicate `--effort` push at the only tier-aware spawn | `athena_reaction.rs:551-554` | S |
| 5 | `build_resume_cli_args` takes the profile (or a `TurnTier`) — today it pins `DEFAULT_EFFORT` and emits no `--model`, and its comment claims the opposite | `cli_args.rs:261-303` + 3 callers | S |
| 6 | **Add `effort: ConfigField<String>` to `EffectiveModelConfig`** — gives effort the same six layers the model has | `config_merge.rs:45-56` | S |
| 7 | A closed `EffortLevel` enum with `#[derive(TS)]`, replacing 5 stringly-typed declarations and the hand-written `matches!` guard | `core/src/types.rs:437`, `model_routing.rs:25`, `test_runner.rs:126`, `session.rs:1809` | M |
| 8 | Migrate the 17 non-catalogue hardcoded option labels to `labelKey`; make `getAnthropicModels(t)` / `EFFORT_OPTIONS` the only source | §9 baseline, 4 files | M |
| 9 | `resolve_use_case_model_override` must preserve the persona's effort instead of `..Default::default()` | `capabilities.rs:40-43`, `executions.rs:336-339` | S |
| 10 | Add an `effort` / `thinking_level` column to `companion_turn`, `dev_llm_spend` and `provider_audit_log` — three of four ledgers cannot record it | 3 migrations | M |
| 11 | Write `provider_audit_log.model_used` (NULL on 4,001 of 4,001; `ByomAuditLog.tsx:55` shows a dash) | audit writer | S |
| 12 | `usePersonaCore`'s model/effort selection writes `model_profile` + `--effort`, not prompt prose | `usePersonaCore.ts:91-104` | M |
| 13 | Fold `CLAUDE_MODEL_CHAIN` into `tier_slug_to_model_id` — its own comment says they duplicate | `failover.rs:638-642` | S |
| 14 | `compareHelpers.ts:22-24` states per-1M prices as `/1K`, and two of the three numbers are wrong at source — remove the price or resolve it from one table | `compareHelpers.ts` | S |
| 15 | `check-coverage.mjs --status-tokens` mode: assert each `status_tokens.<category>` is a superset of its generated union's arms (needs #7) | `scripts/i18n/check-coverage.mjs` | M |
| 16 | Correct the four docstrings that enumerate three effort levels instead of four | `core/src/types.rs:431`, `test_runner.rs:125`, `cli_args.rs:31`, `modelCatalog.ts:65` | S |
| 17 | A boot diagnostic logging which of the six model-resolution layers is populated (§0 was invisible from source) | `runner/mod.rs` or boot | S |
| 18 | Decide the `BUILD_TURN_EFFORT` / Studio `xhigh` default against the bench, or record why it stands | `session.rs:1789`, `studioStore.ts:221` | S |

---

## 13. Model identity is data, not a literal — 2026-08-25

> Added by `/research` against Apache Maka's `model-metadata` (a committed models.dev snapshot,
> generated consumers, and a `refresh` that fails closed when a committed model disappears).
> Personas is subscription-CLI-first, so the shape is smaller: no fetch, one door.

**Measured 2026-08-25, before the change:** a double-quoted `claude-<family>-<n>` literal appeared in
**54 production `.rs` files** (55 files / 120 matches once inline test fixtures are counted, which is
what the census sees). Five of them declared the same default-judge string independently —
`auto_triage.rs:268`, `eval.rs:607`, `prompt/capabilities.rs:24`, `test_runner/lab.rs:21`,
`settings_keys.rs:169/175`. This is why the retired `*-20250514` ids stayed live in the failover
ladder after the vendor removed them (`failover.rs:634`): there was no single file to patch.

**The one way:** `src-tauri/core/src/model_ids.rs`.

- A `claude` subprocess spawn names a model by **CLI alias** (`ALIAS_SONNET` = `"sonnet"`). The CLI
  resolves the alias to its current model; aliases never retire.
- An API-shaped caller that must pin a version reads the dated id from the same file
  (`SONNET_CURRENT`, …). A vendor bump is a one-line diff there.
- A job names its **tier**, not its family: `DEFAULT_FAST` / `DEFAULT_BALANCED` / `DEFAULT_STRONG`.
- `is_retired(id)` lets a failover ladder, a stored `model_profile`, or an imported bundle refuse a dead
  id before the 404.

**The gate:** census rule `bare-model-id-literal` (baseline 55 files / 120 matches), ratcheting down.
Migrate a site when you touch it; do not bulk-migrate. Backlog item #13 above (fold
`CLAUDE_MODEL_CHAIN` into `tier_slug_to_model_id`) is the natural next site, because the ladder is where
a stale id does the most damage.
