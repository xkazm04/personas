# Director findings — recipe/template consolidation

Running notes the apply pass must act on. Not agent output.

## 1. The corpus is not a library (measured)

- 299 recipes, **290 referenced by exactly one template each**; only 3 recipes are
  reused (14x each), and 9 are referenced by nothing.
- This is the root cause of the apparent duplication: each template got a private
  copy of a capability rather than referencing a shared one.
- **Consequence for the apply pass:** a recipe id that disappears breaks the one
  template pointing at it. Merges and retirements must land together with the
  template remap, which is why reviewers were told to propose rather than delete.

## 2. Same name, different job — do not dedupe on name

Three recipes are titled "Daily Briefing" and they are a news/research digest, a
meeting-day overview, and a product-analytics briefing. Ten names collide across
21 recipes and most are this shape. The spec's rule stands: same name is not
evidence, same outcome is.

## 3. The `messaging` replacement artifact (verified corpus-wide)

A mechanical Slack -> "messaging" connector generalization ran over this corpus and
left ungrammatical prose behind.

- **3 recipe TITLES carry a lowercase mid-title `messaging`** and are genuine
  defects: `messaging Handoff Summary`, `Weekly messaging Digest`,
  `Inbox Triage & messaging Routing`. The slice reviewers are renaming these.
- **107 recipes contain `messaging` in body text.** Most of these are NOT defects:
  `"connector": "messaging"` is a real connector id, and "post to the messaging
  channel" is a deliberate generalization that merely reads stiff. Do not
  bulk-replace; the reviewers' `procedure` rewrites fix the prose that matters.
- **`description` is outside reviewer scope**, so stiff prose survives there. Worth
  a separate small pass, not worth blocking on.

## 4. Domain taxonomy

The corpus carries **43 ad-hoc categories, 20 of which hold exactly one recipe**.
Reviewers collapse these into the closed 16-family vocabulary already used by
`scripts/bench/core-bench/domains.json` (kp's role families). No new vocabulary was
invented for this pass.

## 5. Every recipe shipped with `outcomes: []`

The mechanical v1->v2 transform deliberately refused to fabricate outcomes. Authoring
them is the highest-value part of this pass, and it is what turns a recipe from a
process definition into a responsibility.

## 6. Templates — 131, and 8 declare no capability at all

`_template_inventory.json` + `TEMPLATE_DECISIONS.md` hold the full set. The eight
with zero use cases cannot become preset agents as they stand and are the first
decisions to make: 7 team presets (including `积压与执行`, an untranslated-title
duplicate of `Backlog & Execution`) and `Product Strategist`.

Distribution: 68 templates declare exactly 3 capabilities, 32 declare 2, 12 declare
1. That supports the operator's read that most templates are one-or-few capabilities
presented as an agent.

## 7. `spec.useCaseFlow` is the process definition, and it survived this pass

Surfaced by the automation reviewer, then measured:

- **All 299 recipes carry `spec.useCaseFlow`**, a node/edge graph, **2,528 nodes**
  in total. Nodes are typed `start | action | decision | output` with labels like
  "Manager decision?" and "Halfway -> reminder; full -> escalate".
- **Nothing reads it.** No frontend TypeScript references it outside the generated
  bindings, and it is rendered into **no runtime prompt**. Its only live producers
  and consumers are the build-session wizard (`session_prompt.rs` instructs the
  model to author it; `gates.rs` and `fix_pass.rs` check it) - and that wizard's UI
  was retired in the manifest rebase.
- Reviewers were told to leave `spec` untouched because it carries live wiring, so
  every rewritten recipe still has its old flowchart attached underneath.

**This is the strictness the operator asked to remove, and it is dead weight at
runtime.** RECOMMENDATION for the apply pass: strip `useCaseFlow` from every recipe
payload. It is an artifact of the retired design wizard, not part of the
responsibility model, and keeping it invites a future surface to render a runbook
the agent is not supposed to follow. Operator decision, not mine to take silently.

Note the corollary: `session_prompt.rs` still ASKS the build model to produce a
`use_case_flow`, so newly built personas will keep minting them until that prompt
and its gates are updated. Stripping the corpus without that is a one-time clean.

## 8. `payload.id` is a WEAK duplicate signal - do not promote it to a rule

The reporting reviewer correctly used a shared internal `payload.id` as corroborating
evidence for two real merges (`uc_triage` x3, `uc_conflict_resolution` x2), each
confirmed by reading the jobs. Measured corpus-wide afterwards:

- **18 payload ids are shared by 50 recipes**, but most of those groups are NOT
  duplicates. `uc_weekly_summary` is shared by Weekly Cash Flow Summary, Weekly
  Spending Summary and Weekly Summary; `uc_weekly_report` by six recipes including
  a CRO report and a brand-protection report.
- The field is a slug for the KIND of capability, reused across unrelated templates,
  not an identity.

**A future pass that reads "18 shared ids = 50 duplicates" would destroy roughly 32
real capabilities.** Use it the way the reporting reviewer did: as a hint that two
recipes are worth reading together, never as the merge criterion itself.

## 9. Migration idempotency: checked, and it is safe

Because `spec.migratedFromUseCaseId` is the e19 mint's idempotency key, a template
carrying two use cases with the SAME id would collapse two charters into one. Checked
all 131 templates: **zero have a duplicate use-case id internally**, and the key is
scoped per persona, so the cross-template `payload.id` reuse above cannot collide.
No action needed; recorded so the question is not re-opened.

## 10. Vendor-substitution artifacts, corroborated by two independent reviewers

Beyond the `messaging` case in section 3, the reporting reviewer independently found
garbled "knowledge base X" titles that read as a mechanical `Notion -> knowledge base`
substitution. Two reviewers finding the same class in different slices makes this a
corpus-wide generalization pass that damaged prose, not isolated typos. The reviewers'
title and `procedure` rewrites fix what they touched; `description` remains unswept.

## 11. Domain vocabulary gaps found by real recipes (not speculation)

Reviewers had to force-fit these into approximate families. Worth settling before the
taxonomy is frozen in the UI:

- **cybersecurity / brand protection** (domain-squat monitoring, threat intel,
  vulnerability regression) - split across `legal_compliance` and
  `software_engineering`, fitting neither.
- **personal investing / trading** and **FinOps / cloud cost** - both squatting in
  `finance_accounting` alongside real accounting work.
- **personal CRM / contact management** - put in `general_professional` rather than
  `sales_marketing`, because none of it mentions leads or deals.

## 12. Review complete - all 299 covered, validated as one corpus

Six reviewers, one shared spec. Validated mechanically after the fact, not trusted
from the reports:

- **299 / 299 recipes covered, 0 schema errors.** Every id resolves to a real recipe,
  every domain is from the closed 16-family vocabulary, every recipe carries 1-3
  well-formed outcomes, every `procedure` is inside the length band, no em dashes.
- **Verdicts: 290 keep, 9 merge, 0 retire.**
- **0 duplicate titles remain** (was 10 names over 21 recipes).
- **No merge chains** - no merge target is itself merged away, so the remap is one
  hop and order-independent.
- Domains collapsed 43 ad-hoc categories into **12 of the 16 families**. Unused:
  `healthcare_clinical`, `skilled_trades`, `frontline_service`, `education_academic` -
  expected for this corpus, and a fair signal of where the preset library has no
  coverage at all.

**Zero retirements is a real result, not a reviewer failing to decide.** The slice
briefed as the likeliest source of them (the 14-category junk drawer) came back with
none, reporting that every recipe traced to a genuinely recurring job once read in
full, and that the redundancy there was duplicate-trigger variants of one job - which
is why that slice produced merges instead.

### Apply-pass impact of the 9 merges

Each merged recipe is referenced by exactly one template, so the remap is **9
`recipe_ref` rewrites across 9 template files**:

| merged away | into | template |
|---|---|---|
| finance platform Event Sync | Subscription Event Sync | finance/subscription-billing-use-case.json |
| Monthly Deep Audit | Weekly Health Audit | research/knowledge-base-health-auditor.json |
| Payment Recovery Sequence | Dunning Sequence | finance/revenue-operations-hub.json |
| Conflict Resolution | Contact Data Conflict Resolution | sales/contact-enrichment-agent.json |
| Triage Pipeline | Backlog Candidate Triage | productivity/idea-harvester.json |
| Triage | Backlog Candidate Triage | research/product-scout.json |
| Feed Scanning | Content Curation | research/research-knowledge-curator.json |
| SLA Breach Prevention | SLA Breach Watch & Escalation | support/support-intelligence-use-case.json |
| Journal Rescan | Journal Reflection | productivity/vault-grounded-journal-coach.json |

**3 of the 9 merge a pair that already lives in the SAME template**, so that template
simply loses one of its own use cases. The other 6 make a recipe genuinely shared
between two templates, which is the first real sharing this corpus has ever had.

**Still blocked on the operator's template decision table**, deliberately: several of
these 9 templates may themselves become recipes or be dropped, which would change or
remove the remap entirely. Applying the merges first would mean doing the work twice.

## 13. Operator decisions (templates.csv, 2026-09-04) - 66 of 131 reviewed

**31 Delete · 30 Recipe · 5 Template.** Mapped to real files in `_decisions.json`
(65 exact, 1 fuzzy "Realtime db watcher" -> real-time-database-watcher, 1 manual
"Asset factory" -> visual-brand-asset-factory).

Measured consequences:
- The 31 Delete templates **exclusively own 86 recipes**, and **zero** recipes are
  shared between a Delete template and a survivor. Deletion is therefore clean:
  299 recipes -> 213.
- **1 of the 9 pending merges is now moot** (`c62bbf82 -> b362fec9`, Journal Rescan;
  its only template is deleted). The other 8 stand.

### The design this reveals

The five survivors are not workflows, they are **roles**: Digital Clone, Idea
Harvester, DevOps Guardian, Router, Security Sentinel. The operator's own annotations
say how their responsibilities are cut, and it is not by step:

> "Responsibilities per types of check: DB health, Deployment regression, Infra logs, App logs"
> "Responsibility per type of way how to generate backlog"
> "Scan types as responsibilities including pen tests of the implemented findings"

**A preset agent's responsibilities are the KINDS of work in its role, not the stages
of a process.** That is the same principle the recipe pass applied one level down, and
it is the test for the 65 unreviewed templates: a template that is one workflow becomes
a recipe; a template that is a role with several kinds of work stays an agent.

The `Agent (recommended area)` column sketches a preset roster of ~15: Harvester (6),
App Master (5), Web marketer, DevOps Guardian, Database owner, Digital Clone, Artist,
Librarian, Director, Investor, Router, Sentinel, Content, Contractor.

## 14. Two design decisions to resolve (operator, 2026-09-04)

**(a) Adoption questionnaires are generated, not stored.** Whatever a template or
recipe needs to ask at adoption must be composed by the model for that adoption, with
stored examples serving as reference rather than as the questionnaire itself. This
needs real UX: the adopter must be able to ask questions back in order to personalize
the artifact, so it is a conversation, not a form. **Current state:** adoption asks a
fixed set derived from `spec.inputSchema`. Nothing generates questions today.

**(b) Cadence becomes optional, and the persona owns its own rhythm.** A responsibility
may declare an Event or Time trigger, or declare nothing at all - in which case the
persona evaluates when to act while it is running. Responsibility memory carries
**progress state and debt**, so recurring work resumes rather than restarts, and
activity happens in natural loops instead of on a hardcoded period.

**Current state, and the gap:** `ResponsibilityCadence` already permits absence
(`attention_enabled` false, `interval_minutes` optional) and the attention loop derives
its floor from `max(intervalMinutes)` across charters - so "no cadence" is representable
but means "never wakes", not "decides for itself". The 299 transformed recipes all carry
`cadence.attentionEnabled = false` deliberately. Making (b) real needs: a third cadence
state that means self-paced, an attention lane that asks the charter whether now is the
time, and a durable per-charter progress/debt record. The brain already has the
substrate (episodes carry `responsibility_id`); nothing reads it as progress yet.

## 15. CORRECTION to section 13: my stated rule was wrong

I wrote in §13 that the axis is template SHAPE - "one workflow becomes a Recipe, a role
with several kinds of work stays a Template". The classifier tested that against the
operator's own 66 decisions and it does not survive:

- **Security Sentinel** is a `Template` and declares exactly ONE use case, a single
  workflow. My rule says Recipe.
- **Digital Clone** and **Idea Harvester** are `Template`s that decompose into STAGES of
  one pipeline, which my rule calls a Recipe.
- **Financial Stocks Signaller** is a `Recipe` whose three annotated responsibilities are
  unambiguously kinds of work, not stages.
- **QA Guardian** and **Content Performance Reporter** carry the very same
  "Responsibility per type of X" phrasing that justified keeping DevOps Guardian, and are
  `Recipe`s anyway.

**The rule that does survive: the roster comes first, and every template is filed against
it.** The operator has a fixed cast of ~15 standing agents mirroring the operation he
actually runs. Each file is asked: is this the best embodiment of one of those roles
(`Template`), is its work a KIND of work belonging on a seat that already exists
(`Recipe`, with the seat named in the `agent` column even where that seat has no Template
yet), or does no seat want it (`Delete`).

Consequences my reading missed:
- **At most one file per role becomes a `Template`** - 5 Templates against ~14 named
  seats. The other seats get assembled from Recipe-flagged responsibilities rather than
  inherited from a file.
- `Recipe` does not mean "was one workflow". It means the file dissolves and its content
  survives as responsibilities on a named owner.
- Within a cluster doing the same job, exactly one file is chosen as carrier and the rest
  are deleted regardless of individual quality.
- **Router** survives for a reason none of the other four share: it is the universal event
  door, infrastructure rather than a role.

### `Delete` has three distinct meanings, and they differ in reversibility

1. **Redundant with a chosen carrier** (largest group). The test is "does it add a KIND of
   work", NOT "does it overlap": product-scout is a `Recipe` with a consolidate note
   because it brought new responsibilities; knowledge-base-review-cycle-manager is a
   `Delete` because it brought nothing its carrier lacked.
2. **Outside the operation the operator runs** (clients, staff, sales teams, e-commerce,
   HR, bookkeeping).
3. **A universal step rather than a separable responsibility** - said once, on
   code-reviewer: "Should be part of any development process." Worth separating because
   this one deletes work he obviously still wants done.

Corroborating but NOT decisive: most Deletes are anchored to a SaaS he does not run. Not
decisive because autonomous-issue-resolver is Jira-anchored and kept. The job decides; the
connector only predicts.

## 16. DELETION APPLIED (the operator's 31) - and what it broke

Executed and verified. Ownership was recomputed two independent ways before anything was
removed, and both agreed with the Director's 86 exactly: once by `source_template_id`,
and once by walking the `recipe_ref` graph (the different graph that actually matters,
and the one whose failure mode `recipe_seed.rs`'s own canary comment describes).

| Thing | Before -> After |
|---|---|
| canonical template files | 111 -> 80 |
| recipes in `_recipe_seeds.json` | 299 -> 213 |
| `recipeIndex.generated.json` | 299 -> 213 |
| `templateChecksums.ts` / `template_checksums.rs` | 111 -> 80 |
| translated template copies | 0 removed |
| i18n keys | 0 removed |

**Census delta: ZERO.** Captured a full `--json` run before and after: 0 of 205 rules moved.
The census reads `.ts/.tsx/.rs/.md/.sql`, not template JSON. The 9 rules currently off
baseline are byte-identically off in BOTH runs and belong to other sessions' uncommitted
work in this shared tree. No re-baselining is owed by this change.

### How template translations actually work (previously unknown)

**Per-language sibling files, `<name>.<lang>.json`, next to the canonical English
template** - not i18n keys, not a manifest. `src/lib/personas/templates/templateOverlays.ts`
is the whole mechanism: the canonical file is the structural source of truth (ids, cron,
connector names, event types, `maps_to` paths) and the overlay carries ONLY user-facing
strings, merged at runtime. Overlays are **not independently checksummed**; integrity rides
on the English canonical. Rust mirrors this in `team_preset_loader.rs`.

**Only ONE template in the whole repo is translated** (`development/autonomous-issue-resolver`,
13 locales) plus one team-preset shard. Zero of the 31 deleted templates had an overlay,
so there was nothing to delete - but the mechanism is now written down.

### Live code that pointed at deleted ids (all fixed)

- `engine/deliberation.rs` `SDLC_CORES` read two deleted templates **off disk** (would have
  panicked on file-not-found).
- `engine/recipe_seed.rs` `HAND_MINTED_RECIPE_IDS` carried two of the 86 (list's own doc says
  it must only ever shrink, so this was the sanctioned direction).
- `sub_executions/libs/useExecutionList.ts` `TEMPLATE_SAMPLE_INPUT['code-reviewer']`.
  **Finding: that was the map's only LIVE key** - the other 8 already pointed at template ids
  that do not exist. The map is now provably dead; left in place rather than expanding scope.
- `docs/concepts/paths/templates-scaffolding/...` cited a deleted template as evidence and
  **would have failed `check:evidence`**; re-pointed at a survivor with the measurement redone.

## 17. TEAM PRESETS ARE BROKEN BY THE DELETION - operator decision needed

**5 of the 7 presets in `scripts/templates/_team_presets/` list deleted templates as
members**, and no gate catches it: the schema view silently skips an unloadable member by
design, and adoption fails at runtime with "Template not found".

| Preset | dangling members |
|---|---|
| `sdlc-lifecycle` | code-reviewer, docs-steward |
| `web-development` | design-handoff-coordinator, code-reviewer, docs-steward |
| `backlog-execution` | personal-capture-bot |
| `engineering-triage` | codebase-health-scanner |
| `reflective-journaling` | vault-grounded-journal-coach - its ONLY member, so the preset is now empty |

Removing a member also means editing that preset's `connections` graph, which is a product
redesign rather than a mechanical delete, and team presets were not among the 66 reviewed.
`tests/playwright/preset-questionnaire.spec.ts` drives `reflective-journaling` end to end and
is now dead (Playwright, not part of `npm run test`).

The unreviewed-classifier independently asked the same question: do team presets survive the
responsibility model at all, or do they need re-authoring against the new roster?

## 18. `npm run test` is BROKEN at HEAD, and it is not ours

`package.json:56` is `vitest run --forceExit`, and vitest 4.1.8 rejects the flag outright
(`CACError: Unknown option --forceExit`). Traced to a sibling's merge `e788146ee`
("fix/test-timeout-forceExit"), which landed DURING this session - earlier runs in this same
session succeeded. Local master is **38 commits ahead of origin**, so a sibling is actively
merging branch cleanup. Left untouched deliberately: editing their `package.json` mid-cleanup
risks a conflict, and the operator is reconciling these sessions himself. Workaround:
`npx vitest run`.

## 19. The manifest law/self-model split strained in four places (first real test)

The five surviving presets are the first time the two-author manifest has been authored
for a preset rather than grown by a live agent. It mostly held. Where it did not:

1. **`principles` vs `decision_principles` fall on OPPOSITE sides of the law line and the
   templates do not know it.** "Never auto-send above the threshold" is law. "After 3
   rejections drop the category" is learned craft that is supposed to arrive as an approved
   diff. **Seeding a preset with pre-written self-model is either a useful head start or a
   two-author violation, and the model does not currently say which.** This is the single
   most important unresolved question in the manifest design.
2. **Preset stance has no home in either half.** Security Sentinel is the only survivor
   carrying a `persona.core` block: operator-authored, first-person. Its prose folds into
   `# Mandate` cleanly, but its numeric dials (riskTolerance 0.1, deference 0.2) fit
   NEITHER law nor self-model. We deleted the dials from the runtime for good reasons, and
   this is the case they existed for: an operator wanting to author a preset's disposition
   up front. **Preset stance looks like a third kind of content.**
3. **One number, three plausible homes.** Digital Clone's graduation threshold: the operator
   owns the cap (law), the agent earns its position under it (self-model), and the file
   currently makes it an adoption question (personalization).
4. **Router** breaks it entirely: its Mandate reads as a spec and its Boundaries collapse
   into error-handling config.

**Where the split earned its keep:** `# Operation defaults` is what let all four DevOps
Guardian checks become self-paced WITHOUT losing the 8 AM briefing the operator actually
wants. Delivery preference moved out of the work, exactly as directive (b) intends.

## 20. Router does not fit the responsibility model - recommendation to make it infrastructure

The restructurer's verdict, and the reasoning is strong enough to act on:

- Its work decomposes by SOURCE, which is adopter configuration, not kinds of work.
- Neither use case is ownership: one is a pure function with a deliberately fixed procedure,
  the other is editing that function's config.
- It can never be self-paced, and it carries no debt - only a signature cache and an
  idempotency log.
- Its memory does not compound from human correction.
- Structurally it sits UNDER the roster: every other persona's `event` trigger depends on a
  door like it.

**Recommendation:** make the classify-and-fan-out path app-owned infrastructure, and move the
one genuine responsibility (the residue: events nobody wrote a rule for) onto an existing
seat. Operator decision.

## 21. Trigger evidence across both finished lanes: cadence really was cron costume

| lane | self_paced | event | time |
|---|---|---|---|
| convert B (15 templates, 31 resp.) | 22 | 9 | **0** |
| restructure (5 agents, 17 resp.) | 13 | 4 | **0** |

**Zero calendar triggers out of 48 responsibilities**, from two agents working independently.
Every declared cadence in these files (weekly harvest, daily 8 AM briefing, 4-hourly digest,
1440-minute scans, a 2-minute SLA poll) turned out to be either a delivery preference that
belongs in `# Operation defaults`, or a condition the persona can watch. The only genuine
date-driven work found (contract renewals) is per-contract date-watching, not a cadence.

This is strong support for directive (b), and it raises the stakes on the gap in §14: the
model can represent "no cadence" but that currently means "never wakes", not "paces itself".

## 22. Seat collisions to resolve before any authoring

- **DB health** sits on DevOps Guardian by the operator's own annotation, while three
  Recipe-flagged files land on a separate **Database owner** seat.
- **Codebase-derived idea generation** arrives on **Harvester** twice: from an invented
  responsibility and from solution-architect's annotation.
- The **Digital Clone** seat also receives support escalation and lead capture from two
  Recipe files, which the restructurer deliberately did not author.

## 23. OPERATOR DECISIONS, 2026-09-04 - all twelve open items resolved

### Model / design
1. **Preset self-model ships EMPTY.** A preset carries only the LAW half (Mandate,
   Boundaries, Operation defaults). Everything in the self-model must be earned by the
   agent through approved diffs. This closes §19's sharpest question: pre-written
   self-model would have been a two-author violation, not a head start.
2. **Preset stance goes in Mandate prose.** No third manifest section, no dials returning.
   "Prefer caution over speed; escalate rather than assume" is a sentence, not a number.
   Resolves §19.2 - and note the dials never reached a prompt after the rebase anyway.
3. **Router STAYS a preset agent.** *Operator override of the recommendation in §20.* The
   analysis said it does not fit (decomposes by source, never self-paced, carries no debt,
   sits under the roster) and the operator kept it anyway. Consequence to design around:
   one roster member will behave unlike the rest, so any UI assuming every persona has
   outcomes, cadence and debt needs an honest exception path rather than an empty state.
4. **Self-pacing gets built NEXT, before any UI.** The three missing pieces: a self-paced
   cadence state, an attention lane that asks a charter whether now is the time, and a
   durable per-charter progress/debt record. 60 of 82 designed responsibilities depend on
   it, so drawing the Responsibilities UI first would design against a capability that
   does not exist.

### Corpus
5. **Delete all 22 held medium/low-confidence templates**, including the six the classifier
   flagged as its weakest calls. Corpus lands near 39 templates / ~100 recipes.
6. **Apply the 82 designed responsibilities to the recipe corpus**, restructure the 5
   survivors, and apply the 8 live recipe merges with their template remaps. Corpus only;
   not seeded into the working database.
7. **Strip `spec.useCaseFlow` AND stop minting it** - `session_prompt.rs` and its gates
   change in the same pass, otherwise the corpus refills with process definitions.
8. **Re-author the 3 team presets against the roster** rather than patching member lists.
   They were composed from templates that no longer exist.

### Roster
9. **Librarian becomes a sixth preset, authored fresh** from its four kinds of work.
   Explicitly NOT based on technical-decision-tracker (a redesign target, not a working
   file).
10. **Artist covers all media** - motion and audio become kinds of work on the Artist seat.
    No Producer seat. Resolves audio-briefing-host and feature-video-creator.
11. **Fix both infrastructure defects now**: write the missing generator for
    `recipeIndex.generated.json` (repairing its 6-character truncated `tags`), and remove
    the `--forceExit` flag that breaks `npm run test`.
12. **Database owner owns DB health**, moving it off DevOps Guardian. Overrides the
    operator's own earlier annotation; three Recipe-flagged files already point there.

### Still open, not asked
- **The adoption questionnaire (§14a)** - generated rather than stored - has no build slot
  yet. It pairs naturally with the self-pacing work as the other half of directive (a)/(b),
  but no decision was taken on when.
