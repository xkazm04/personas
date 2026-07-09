# onboarding-bench — design

Mass-scale evaluation of the **persona creation / onboarding** experience, driven
through the **real running app UI**, at ~300 scenarios grounded in the shipped
catalog.

It answers five questions the engine change needs answered:

| # | Question | How it's measured |
|---|---|---|
| 1 | Does it work across **different business areas**? | 14 template areas × 20 recipe categories, stratified |
| 2 | Does it react well to a **well-designed prompt**? | `specified` tier + zero-ask controls — asking here is a *failure* |
| 3 | Does it **guide vague needs**? | `vague` + `extreme` tiers are 50% of the suite; `must_clarify` gates |
| 4 | Can the user **choose the right connector**? | connector-choice axis with a **decoy**; picker testid + binding assertions |
| 5 | Does it **process answers** and compose sound **metadata**? | post-promote metadata gates + judge |

---

## 1. Why the real UI (not `/build/start`)

The backend routes (`/build/start`, `/build/answer`) drive the engine but **bypass
the UI entirely**. The onboarding failures that actually matter live in the UI
layer: a question that renders but can't be answered, a connector picker that never
populates, a draft with no promote affordance. So every step goes through
`window.__TEST__` bridge methods that manipulate the same surfaces a user does:

```
startBuildFromIntent    -> types `agent-intent-input`, clicks `agent-launch-btn`
listPendingBuildQuestions / answerPendingBuildQuestions
   + DOM assertion on `vault-connector-picker-<category>`
promoteBuildDraft       -> the real promote path
getPersonaDetail + DB   -> the composed persona's metadata
```

Answers are submitted through the bridge rather than by clicking option buttons for
a source-verified reason: the from-scratch build renders `GlyphAnswerCard`, whose
options carry **no `data-testid`** (only the *template-adoption* renderer does). The
connector picker is the one component we can assert in the DOM — and it is the one
that matters for "can the user choose the right connector". See
[LESSONS.md §B](./LESSONS.md#b-driving-the-real-creation-ui-source-verified).

The suite uses **only bridge methods that already exist**, so it never requires a
`bridge.ts` change (which would force a full app rebuild).

---

## 2. Scenario grounding — real catalog, not invented prose

| Source | Count | Used for |
|---|---|---|
| `scripts/templates/_recipe_seeds.json` | **299 recipes** | one concrete business job each (name, description, category) |
| `scripts/templates/<area>/*.json` | **124 templates** | business area + `service_flow` (source→destination chain) + use-cases |
| `scripts/connectors/builtin/*.json` | **133 connectors** | category taxonomy (37 categories) |

**300 scenarios** = 250 recipe-derived (one job) + 40 template-derived
(multi-capability) + 10 hand-written controls/traps.

---

## 3. The two signal-carrying axes

### Axis 1 — vagueness

| tier | what the user types | expected questions | share |
|---|---|---|---|
| `specified` | trigger + job + source + destination + the exact connector | 0–1 | 73 |
| `partial` | job clear; trigger and/or *which* connector left open | 1–3 | 75 |
| `vague` | goal-only (`"I need something to help with X"`) | 2–5 | 107 |
| `extreme` | one-liner, no job (`"my inbox is a mess"`) | 2–6 | 45 |

Weighted toward vague/extreme (~50%) because *guiding vague needs* is the thing
most in doubt. Crucially the `specified` tier is a **negative control**: asking a
lot there is a failure, not diligence.

### Axis 2 — connector choice (a free oracle from real data)

A template's `service_flow` is one of two kinds:

- **category-valued** (`email`, `messaging`, `CRM`, `spreadsheet`, `knowledge base`)
  → the build **must** raise a `connector_category` question and the user picks.
  *216 scenarios.*
- **concrete-valued** (`GitHub`, `Linear`, `Stripe`, `Jira`) → the connector is named,
  so asking is over-asking. *69 scenarios.*

For every choice scenario we pick a **non-obvious connector** and record the obvious
one as a **decoy**:

| category | pick | decoy |
|---|---|---|
| email | `microsoft_outlook` | `gmail` |
| messaging | `microsoft_teams` | `slack` |
| spreadsheet | `airtable` | `google_sheets` |
| knowledge_base | `confluence` | `notion` |
| crm | `pipedrive` | `hubspot` |
| source_control | `gitlab` | `github` |

Asserting *"bound Outlook"* is weak. Asserting *"bound Outlook **and not** Gmail"*
catches the silent-popular-default bug the real baseline actually exhibited.

### Runtime connector resolution (why picks are placeholders)

A hardcoded pick assumes that credential exists on the machine. It usually doesn't —
and a fresh isolated instance has an **empty vault**. So the ground-truth intent
carries `{{CONNECTOR}}` / `{{DECOY}}` placeholders, and the runner resolves them
against `/list-credentials` at run time:

| vault state | mode | behaviour |
|---|---|---|
| pick **and** decoy present | `choice` | full ask + choose + decoy-absent gates |
| only one credential in category | `single` | ask + bind gates; no decoy gate |
| none in category | `degraded_no_credential` | ask gates apply; **choose gates skipped, not failed** |

A missing credential is an environment fact, never a build defect.

---

## 4. Evaluation — two layers

### Layer 1: deterministic gates (no LLM)

`converged` (`draft_ready`) · `question_band` · `connector_question_asked` /
`connector_question_not_asked` · `connector_picker_rendered`
(`vault-connector-picker-<category>`) · `connector_bound` · `decoy_not_bound` ·
`capability_count` (scope-creep guard) · `system_prompt` · `trigger_type`.

Validated offline against synthetic runs: a build that silently binds the decoy and
never asks scores **3/8**; a build that over-asks the zero-ask control, creeps scope
and emits a stub prompt scores **1/6**.

Two deliberate softenings, so the suite never produces a false failure:
- **Trigger** inferred from a recipe *category* is a guess → `trigger_assertion:
  "soft"` (judge signal). Only hand-written controls assert it `hard`.
- **Choose-gates** are skipped when the credential is absent (see above).

### Layer 2: Claude-as-judge (quality)

Weighted 0–3 rubric over the emitted bundle — see [judge-prompt.md](./judge-prompt.md):
`asked_before_assuming` (2.0) · `no_wrong_assumptions` (1.5) ·
`connector_choice_correctness` (2.0) · `question_quality` (1.5) · `convergence` (2.0) ·
`efficiency_round_cap` (1.5) · `metadata_coherence` (1.0).

`efficiency_round_cap` is load-bearing: the measured baseline asks **serially**
(one question per round, 3–5 rounds) against a design that wants ≤2. Over-asking and
hanging are both failures.

---

## 5. Metadata evaluated after creation

Read from the promoted persona the way a user would see it — `getPersonaDetail`
(triggers, subscriptions, tools, notification channels) plus the `personas` row
(`name`, `description`, `system_prompt`, `design_context.useCases[]`, `model_profile`,
`setup_status`, `icon`, `color`). Connector bindings are derived from
`design_context.credentialLinks` + `requiredConnectors` (they are not columns).

Gated: capability count inside the scope guard, a real system prompt (≥200 chars),
the chosen connector bound, the decoy absent. Judged: name/description/capability
coherence against the true intent.

---

## 6. Nightly execution model

The suite is **incremental and resumable** — `state.json` records each scenario's
status, `--batch N` runs the next N pending and exits. Safe to kill and resume.

- **Preflight** aborts unless the bridge is healthy and the app is **idle** (no
  in-flight build sessions in the last 30 min). Nightly runs require a quiet app;
  a concurrent build both corrupts timings and gets killed by any Rust recompile.
- **Teardown** deletes every persona it creates (all tagged `OB-<scenario-id>`), so a
  batch leaves no residue. `/test/reset` does *not* wipe the DB — deletion is explicit.
- Per scenario it writes `results/runs/<id>.json` (scenario + run + verdict) and
  `results/bundles/<id>.md` (the judge bundle).

Roughly: a vague scenario costs one build (~400–900 s today, dominated by serial
asking). Budget accordingly — ~10–20 scenarios per nightly batch is realistic until
the batched clarify path lands.
