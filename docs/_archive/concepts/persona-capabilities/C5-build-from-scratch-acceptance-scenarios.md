# C5 — Build-from-scratch acceptance scenarios

> **Purpose**: a flat, stable artifact that defines the *expected behaviour*
> of the build-from-scratch pipeline through a series of representative user
> use cases. Each entry is an **acceptance contract**: if the pipeline can
> drive every scenario end-to-end without any of its rules being hardcoded
> to that scenario's specifics, the building experience is ready to ship.
>
> Use this doc as the canonical input for:
> 1. **Analysis** — does the proposed flow cover this case? What's missing?
> 2. **Development** — what feature must exist for the LLM/UI to handle the
>    questionnaire path described here?
> 3. **Live tests** — the assertions block at the bottom of each scenario is
>    the ground truth for `tools/test-mcp/e2e_*.py` runners.
>
> **Hard rule**: nothing in the build prompt or runtime prompt is allowed
> to special-case "translation" or "news" or "Sentry". The framework must
> handle these because of its general design (capability decomposition,
> connector-category questioning, vault picker, MCP tool semantics) — not
> because we wrote a regex for "translate" somewhere.

---

## Anatomy of every scenario

| Block | Purpose |
|---|---|
| **Intent** | The free-text prompt the user types into the build textarea. |
| **Use cases** | How the framework should decompose intent into capabilities. |
| **Questionnaire — ideal flow** | Round-by-round walkthrough with cellKey, scope, expected variants. The LLM may skip a round if intent disambiguates, but the *order and shape* must hold. |
| **New features required** | Anything the framework cannot do today — the implementation backlog this scenario unlocks. |
| **Acceptance assertions** | Concrete testid + DB-shape checks an automated runner asserts. Pass/fail signal. |
| **Out of scope** | Explicit non-requirements so the next session doesn't expand the contract by accident. |

`cellKey` values referenced below are the v3 build-pipeline tokens:
`behavior_core`, `connectors` (source), `destination` (sink), `triggers`,
`human-review`, `memory`, `messages`. The `connectors` cellKey carries an
optional `category` token (`storage`, `messaging`, `email`, `vector_db`,
`crm`, `monitoring`, `task_management`, etc.) that drives the vault
picker rendering.

---

## Scenario 1 — Document Translation (English → Czech)

**Status**: ✅ **shipped**, used as the reference scenario throughout this
sub-tree (see `C4-build-from-scratch-scenario-handoff-2026-04-23.md` for the
authoring history).

### Intent

> *Translate every document I drop into my local drive from English to Czech
> and save the translated copy next to the source file.*

### Use cases (1)

- `uc_document_translation` — react to a new document arriving in a storage
  connector, produce a Czech sibling.

### Questionnaire — ideal flow

| Round | cellKey | scope | Variants offered | Acceptance answer |
|---|---|---|---|---|
| 0 | `behavior_core` | `mission` | 3 design directions | Pick the event-driven translator |
| 1 | `connectors` | `connector_category=storage` | Vault picker keyed off `storage` | `local_drive` (or any `storage` cred) |
| 2 | `destination` | `connector_category=storage` | Vault picker (defaults to source) | Same connector — saves sibling next to source |
| 3 | `triggers` | `field=suggested_trigger` | A: Manual / B: Schedule / C: On `drive.document.added` / D: From another persona | C |
| 4 | `human-review` | `field=review_policy` | Never / On low confidence / Always | Never |
| 5 | `memory` | `field=memory_policy` | No / Yes | No |
| 6 | (terminal) | `phase=test_complete` | — | — |

### New features (already implemented)

- ✅ `CapabilityGates` state machine that refuses out-of-order
  `capability_resolution` events for trigger / connectors / review /
  memory.
- ✅ `vault-connector-picker-<category>` driven by
  `connectorCategoryTags(c.service_type)`.
- ✅ Built-in `local_drive` connector + auto-seeded
  `builtin-personas-drive` credential.
- ✅ Drive-event bus (`drive.document.added|edited|renamed|deleted`)
  emitted from every `commands::drive` mutation.
- ✅ MCP drive tools (`drive_write_text` / `drive_read_text` / `drive_list`)
  exposed to the runtime persona via the `personas-mcp` stdio server
  registered through `exec_dir/.claude/settings.json`.
- ✅ Runtime prompt section "Personas Tool Semantics" instructing the LLM
  to prefer `mcp__personas__<tool>` for connector I/O over generic Write.

### Acceptance assertions

`tools/test-mcp/e2e_full_translation.py` must report:

```text
[OK] start_build              persona_id=<uuid>
[OK] round0.wait              phase=awaiting_input
[OK] dom.panel.behavior_core
[OK] dom.card.behavior_core
[OK] round0.submit
[OK] round1.wait              phase=awaiting_input
[OK] dom.vault.connectors     picker>=1, empty=0   ← seeded local_drive
[OK] round1.submit
[OK] roundN.wait              phase=test_complete
[OK] promote                  persona_id=<uuid>
[OK] drive.write              path=inbox/eng-sample.md
[OK] exec.wait                status=completed, cost_usd>0
[OK] drive.read_translation   path=inbox/eng-sample_cs.md, bytes>0   ← landed in DRIVE, not exec_dir
```

### Out of scope

- Backwards translation (Czech → English) is a *different* capability and
  belongs to a separate persona unless the user adds it via Phase B
  enumeration.
- Retry-on-failure is a runtime concern, not a build-scenario one.

---

## Scenario 2 — Scrape news (AI agent / orchestration / research)

**Status**: 🚧 **planned** — needs free-text-or-delegate clarifying type
and category-branched output.

### Intent

> *Watch news regarding the AI agent market — orchestration patterns,
> research breakthroughs, and tooling launches — and keep me informed.*

### Use cases (1)

- `uc_news_watch` — periodically scan a defined set of sources, surface
  what changed since last run.

### Questionnaire — ideal flow (two-phased — phase B depends on phase A
answers)

| Round | cellKey | scope | Variants offered | Acceptance answer |
|---|---|---|---|---|
| 0 | `behavior_core` | `mission` | Two-three design directions for "newsroom curator vs personal digest vs market signal" | Personal digest |
| 1 | `connectors` (source) | **`free_text_or_delegate`** | "Paste sources (one URL per line)" textarea **OR** "Let the agent pick reputable AI-news sources (Hacker News AI tag, arXiv cs.AI, etc.)" radio | Either — both must produce a valid `connectors` resolution |
| 2 | `destination` | `field=output_target_category` | A: Knowledge base (vector DB) / B: Built-in messaging digest / C: Both | A |
| 3 | `connectors` (output) | `connector_category=<chosen above>` | Vault picker keyed on **vector_db** (if A) or **messaging** (if B) or both (if C) | First credential of that category |
| 4 | `triggers` | `field=suggested_trigger` | A: Manual / B: Daily / C: Hourly / D: When upstream emits | B |
| 5 | `human-review` | `field=review_policy` | Never / On low confidence / Always | Never |
| 6 | `memory` | `field=memory_policy` | Track read items / Stateless | Track read items (avoids re-surfacing) |
| 7 | (terminal) | `phase=test_complete` | — | — |

### New features required

1. **Free-text-or-delegate clarifying type.** New `scope: "free_text_or_delegate"`
   on `clarifying_question`. UI renders both a `textarea` and a "Let agent
   pick" affordance; submitting either is a valid answer. Backend records
   the answer's mode so the LLM can resolve `connectors` differently
   downstream.
2. **Conditional follow-up.** When the user picks an output category, the
   build prompt MUST emit a follow-up `connector_category` question with
   that category as the token — without re-asking source. The
   `CapabilityGates` ledger needs an *optional* `destination_category`
   gate that opens once the category answer is captured.
3. **Built-in vector DB credential** — already seeded as
   `builtin-personas-vector-db`. The vault picker in scenario 2 must show
   it for the `vector_db` category.
4. **Agent-defined source set.** When the user delegates source choice,
   the persona's `agent_ir.tools` must include `web_search` and the
   capability's `tool_hints` must reference it. The runtime prompt's
   "Personas Tool Semantics" already nudges the LLM to use the connector
   path; for agent-curated sources we additionally must allow `web_search`
   as a built-in tool.

### Acceptance assertions

`tools/test-mcp/e2e_news_watch.py` (to be authored) must produce:

```text
[OK] start_build
[OK] round1.wait              phase=awaiting_input
[OK] dom.panel.connectors
[OK] dom.input.freetext       data-testid="glyph-freetext-input" present
[OK] dom.option.delegate      "Let the agent pick" radio present
[OK] round1.submit            mode=free_text|delegate
[OK] round2.wait              phase=awaiting_input
[OK] dom.card.destination     options ["Knowledge base", "Messaging", "Both"] present
[OK] round2.submit            output_target_category="knowledge_base"
[OK] round3.wait              phase=awaiting_input
[OK] dom.vault.destination    picker>=1 for category="vector_db"   ← built-in vector DB
[OK] roundN.wait              phase=test_complete
[OK] promote                  persona_id=<uuid>
# Live execution (manual or scheduled tick) — not part of the bridge run today
```

### Out of scope

- Cross-language news translation.
- Surfacing the same story to multiple destinations is captured by the
  "Both" branch; if the user wants different destinations *per source* that
  is two capabilities.

---

## Scenario 3 — Sentry watcher with autotriage → GitHub issue

**Status**: 🚧 **planned** — needs quick-add-connector mid-build and the
autotriage behaviour pattern.

### Intent

> *Watch my Sentry project, triage findings, write up the analysis +
> proposed solution as a GitHub issue.*

### Use cases (2)

- `uc_sentry_watch` — pull new Sentry issues on a cadence; surface a
  triaged shortlist.
- `uc_issue_writeup` — for each accepted item, emit a GitHub issue with
  analysis + proposed solution.

### Questionnaire — ideal flow

| Round | Capability | cellKey | scope | Variants offered | Acceptance answer |
|---|---|---|---|---|---|
| 0 | (persona) | `behavior_core` | `mission` | 2-3 directions: "ops backstop vs PR review vs on-call assistant" | Ops backstop |
| 1 | `uc_sentry_watch` | `connectors` (source) | `connector_category=monitoring` | Vault picker for `monitoring` | Sentry credential — **or** "+ Add Sentry credential" CTA opens **inline modal** (the quick-add pattern) |
| 2 | `uc_sentry_watch` | `behavior` | `field=structured_prompt` | "Triage rules" + "Output content" sub-questions | Free-text or guided variants |
| 3 | `uc_sentry_watch` | `triggers` | `field=suggested_trigger` | A: Manual / B: Hourly / C: Daily | B |
| 4 | `uc_sentry_watch` | `human-review` | `field=review_policy` | Auto-accept / Auto-triage (LLM-judged) / Always pause | Auto-triage |
| 5 | (UC1 → UC2 link) | `event_subscriptions` | (implicit) | UC2 listens on `sentry.issue.triaged` emitted by UC1 | derived |
| 6 | `uc_issue_writeup` | `connectors` (output) | `connector_category=task_management` | Vault picker for `task_management` (GitHub) | GitHub credential — **or** quick-add modal |
| 7 | `uc_issue_writeup` | `triggers` | `field=suggested_trigger` | C: When UC1 emits `sentry.issue.triaged` (auto-derived; only ASK if ambiguous) | C |
| 8 | `uc_issue_writeup` | `human-review` | `field=review_policy` | Same shape | Auto-accept (because UC1 already triaged) |
| 9 | (terminal) | `phase=test_complete` | — | — |

### New features required

1. **Quick-add connector mid-build modal.** When the vault picker is
   empty for a category the user has already answered, render an
   inline CTA "+ Add <Category> connector" that pops the same `QuickAddCredentialModal`
   the template adoption flow uses (`src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx`).
   On credential added, the picker re-renders without restarting the build
   session. This already exists for adoption — exposing it from the
   build flow is the work.
2. **Autotriage behaviour pattern.** A new `review_policy.mode` value:
   `"auto_triage"`. At runtime, instead of emitting `manual_review` and
   waiting, the persona executes a *self-review pass* — the LLM
   re-evaluates the candidate output against the persona's
   `decision_principles`, accepts or rejects, and emits an
   `auto_triage_decision` protocol message. Acceptance flips the artefact
   to `published`; rejection writes a `agent_memory` entry explaining why
   and emits `<persona>.<task>.rejected`.
3. **UC1 → UC2 event chaining.** UC1's `event_subscriptions` declares
   `direction: "emit"` on `<persona>.<uc_sentry_watch>.triaged`. UC2's
   declares `direction: "listen"` on the same `event_type`. Build prompt
   must derive this when the user picks "auto-triage" + a separate
   downstream UC; only ASK when the chain is ambiguous.
4. **Two-capability gate ledger.** `CapabilityGates` must track each UC
   independently. Already supported in the per-capability map but the
   gate-question synthesizer must round-robin instead of always asking
   the first unopen capability — otherwise UC2's questions starve until
   UC1's are answered. Acceptable but worth re-examining.

### Acceptance assertions

`tools/test-mcp/e2e_sentry_watcher.py` (to be authored) must produce:

```text
[OK] start_build              persona_id=<uuid>
[OK] enumeration.use_cases    count=2  (uc_sentry_watch, uc_issue_writeup)
[OK] round1.wait              phase=awaiting_input
[OK] dom.vault.connectors     picker=0, empty=1
[OK] dom.empty.cta            data-testid="vault-connector-picker-empty-add" visible
[OK] click.add                opens modal with category=monitoring pre-filled
[OK] modal.submit             creates Sentry credential
[OK] dom.vault.connectors     picker>=1 (re-rendered)
[OK] round1.submit
…
[OK] roundN.wait              phase=test_complete
[OK] promote                  persona_id=<uuid>
[OK] uc_sentry_watch.review_policy.mode == "auto_triage"
[OK] uc_issue_writeup.event_subscriptions[0].event_type matches "<...>.triaged"
[OK] uc_issue_writeup.event_subscriptions[0].direction == "listen"
# Live tick: synthetic Sentry payload → triage → GitHub issue. Out of
# the bridge scenario — covered by a separate runner once the autotriage
# protocol is shipped.
```

### Out of scope

- Filtering Sentry issues by environment / project / release tag is a
  capability config detail, not a build-scenario one.
- The actual Sentry → GitHub mapping shape (which fields go where) is
  the persona's runtime decision, not a build-time gate.

---

## Cross-cutting requirements (shared by every future scenario)

These hold across all 10 planned scenarios, not just the three above.

| # | Requirement | Status |
|---|---|---|
| X1 | Build prompt rules NEVER hardcode a product name (Sentry, GitHub, Drive). Always category-first, with category populated from the connector catalog. | Partial — prompt rewritten 2026-04-24, rules 16a/16b call this out |
| X2 | Every clarifying_question variant supported by the LLM has a matching frontend renderer. New scopes (`free_text_or_delegate`, `output_target_category`) MUST land both Rust event shape and React surface in the same change. | Pending |
| X3 | `vault-connector-picker-empty` ALWAYS includes a quick-add CTA opening `QuickAddCredentialModal` for the asked category. | Pending — only the adoption flow has this today |
| X4 | When the gate auto-opens via intent heuristic, the synthesized question prose is generic — "Which storage service should X read from?" — never product-named. | Done (rule 16a wording) |
| X5 | After promotion, the persona's `system_prompt` MUST contain the "Personas Tool Semantics" preamble teaching it to prefer `mcp__personas__<tool>` over generic Write/Bash/Read for any connector-mediated I/O. | Done (`engine/prompt.rs::assemble_prompt`) |
| X6 | Every scenario has a self-contained `e2e_<name>.py` runner that asserts the testid path AND the resulting persona's IR shape (post-promotion DB row). | 1/3 done |

## How a new scenario is added

1. Append a section to this doc using the four-block anatomy above.
2. Identify which "New features required" overlap with already-implemented
   capability and which are new — track new ones in
   `docs/concepts/persona-capabilities/10-deferred-backlog.md`.
3. Author the `e2e_<name>.py` runner. It MUST be testid-driven (poll
   `[data-testid="build-inline-questions"]`, never pre-supply answers
   the LLM didn't ask for).
4. Run against a clean dev app with `--features test-automation`. Every
   round either matches the table or fails the run loudly.
5. When green, mark **shipped** in the section header and link the
   scenario from `README.md`.

The non-negotiable: if the runner needs to special-case the scenario in
order to pass — by hardcoding answers that don't come from a
`clarifying_question` variant, by patching the prompt with a Sentry
keyword, by giving the persona a fixed tool name — that's a bug in the
framework, not in the runner.
