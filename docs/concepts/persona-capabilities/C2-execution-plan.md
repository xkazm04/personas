# C2 — Execution Plan: Redesign + Test

> Ties together [C2-template-audit.md](C2-template-audit.md) (structural) and
> [C2-content-review.md](C2-content-review.md) (quality) into an executable
> sequence: redesign the questionnaire mechanism, restructure the catalog,
> execute the cleaning pass, and run live adoption tests on every template.
>
> **In-session scope:** mechanism design + pilot redesigns on flagship
> templates + live-harness test framework + automated sweep across the full
> catalog. Bulk per-template hand-rewrites (the ~58h manual pass) are
> out-of-session; the harness surfaces which templates need them and how
> badly.

---

## Part 1 — Questionnaire mechanism redesign

### Problem recap

From [C2-content-review.md §3](C2-content-review.md):
- 85% of questionnaires lump persona-level and capability-level questions
  with no scope indicator.
- Questions asking runtime data (watchlists, URLs) live in one-shot adoption.
- No way to say "this question configures capability X" vs. "this question
  tunes the whole persona".
- ~45% of templates miss capability-specific config questions entirely.

### Proposed schema — `AdoptionQuestion` v2

Add **two** optional fields to the existing adoption-question shape. Fully
additive; omitted = `persona` scope, same behaviour as today.

```jsonc
{
  "id": "aq_watchlist",
  "question": "What tickers should the weekly analysis track?",
  "type": "text",
  "default": "NVDA,AAPL,MSFT",
  "context": "...",

  // --- NEW in v2 ---
  "scope": "capability",              // "persona" | "capability" | "connector"
  "use_case_id": "uc_weekly_analysis" // required when scope == "capability"
}
```

Rules:

| scope | `use_case_id` | `connector_names` | Meaning |
|---|---|---|---|
| `persona` | — | — | Identity/voice/shared-memory config (default) |
| `capability` | **required** | — | Configures one specific capability |
| `connector` | — | required (array) | Collects connector-specific config |

The UI groups questions by scope and surfaces them in sensible order:
identity first, then per-capability sections, then connector config.

### Proposed UI — `QuestionnaireFormGrid`

Current layout: one flat list of questions.

New layout: **sectioned accordion**, one section per scope:

```
┌─ Persona setup ──────────────────────────────────────────┐
│   (all scope="persona" questions)                        │
│                                                          │
├─ Capability: Weekly Analysis ────────────────────────────┤
│   (all scope="capability" with use_case_id=uc_weekly)    │
│                                                          │
├─ Capability: Backtester ─────────────────────────────────┤
│   (all scope="capability" with use_case_id=uc_backtester)│
│                                                          │
├─ Connector: Slack ───────────────────────────────────────┤
│   (scope="connector" with connector_names=["slack"])     │
└──────────────────────────────────────────────────────────┘
```

Each section is collapsible; per-capability sections inherit the
capability's title and `capability_summary` as a subtitle. Under-configured
capabilities (no questions) show a "No config needed" placeholder so authors
see the gap.

**Scope inference fallback:** if `scope` is absent, infer from existing
hints:
- `connector_names` set → `connector`
- `use_case_ids` set (array of one) → `capability` with that `use_case_id`
- else → `persona`

This makes v2 a gradual upgrade — templates without `scope` still work.

### Implementation steps

1. Add `scope` + `use_case_id` fields to `AdoptionQuestion` TS type
2. Add scope inference helper `inferQuestionScope(q, template)`
3. Update `QuestionnaireFormGrid.tsx` to group by scope
4. Add capability headings with summary subtitle
5. Add section collapse/expand state to `useAdoptReducer`
6. Add a **lint** step at template-load time that warns when a capability
   has no questions but has config surface (polling cron, notification
   channel)

### Runtime-leak rule

Add to template authoring guide: **any value that can change between runs
is NOT an adoption question.** It belongs in:
- `persona.core_memories` if it's a user-wide preference
- `use_cases[i].input_schema` if it's per-run input
- `use_cases[i].sample_input` if it's an example/default

Runtime leaks in existing templates get converted during the cleaning pass.

---

## Part 2 — Catalog restructure policy

### Decision framework

Under the new model, a template should exist as a standalone persona
archetype **only if**:
1. It has a distinct voice/identity (not just a different scheduled job)
2. Its capabilities share shared memory/tools meaningfully
3. A user adopting it would not immediately want to add capabilities from
   another template

Templates that fail (1) or (3) are merge candidates. Templates that fail
(2) may belong as capabilities elsewhere.

### Planned consolidations (from C2-content-review.md §6.2)

| New persona archetype | Merges (templates) | Expected capabilities |
|---|---|---|
| **Email Assistant** | email-morning-digest, email-follow-up-tracker, email-task-extractor, email/intake-processor, productivity/digital-clone | digest, follow-ups, task extraction, intake routing, cross-channel triage |
| **Sales Operations** | contact-enrichment-agent, contact-sync-manager, crm-data-quality-auditor, sales-pipeline-autopilot, sales-deal-tracker | enrichment, CRM sync, data quality audit, pipeline monitoring, deal alerts |
| **Codebase Guardian** | qa-guardian, devops-guardian, documentation-freshness-guardian, codebase-health-scanner | test freshness, deploy health, docs drift, repo metrics |

### Execution policy

- **Do not delete** the individual templates in this pass — they remain
  discoverable so users can adopt a single capability without the archetype
  overhead.
- **Do add** the archetype templates as additional entries with the merged
  capabilities pre-enabled.
- The `is_published` flag on individual templates gets set to `false` once
  the archetypes prove useful (post-C2 decision; requires usage data).
- **Retire candidates** (duplicates): `sales/website-conversion-auditor`
  vs. `marketing/website-conversion-audit` → keep one, disable the other.

### Catalog restructure — deferred to post-C2

The archetype creation is a second wave once the mechanical migration is
green. We don't do it in-session because:
- Requires fresh authoring of merged `identity` prose
- Needs per-archetype review of tool pools and capability boundaries
- The 5 individual templates they replace are still valuable standalone

---

## Part 3 — Cleaning-pass sequencing

### Prioritization (from C2-content-review.md §7)

**Tier 1 (in-session pilots, 2-3 templates):**

- `productivity/email-morning-digest` — simple Tier A; validates scope
  mechanism with minimal surface
- `finance/financial-stocks-signaller` — deep Tier C; validates the
  capability-split pattern on the hardest case
- `hr/onboarding-tracker` — exemplary Tier A; validates that well-built
  templates need almost no changes

**Tier 2 (post-session, per-category):**

7 flagships × ~85 min ≈ 10h.

**Tier 3 (bulk remainder):**

72 templates × ~17 min ≈ 20h.

### What each pass does

For every template:

1. **Structural (mechanical script, out-of-session):**
   - Convert `use_case_flows[]` → `use_cases[]` with v2 fields
   - Tag triggers with `use_case_id` (positional fallback when ambiguous)
   - Nest subscriptions/channels per capability
   - Seed `capability_summary` empty with `# TODO` marker

2. **Content (hand pass):**
   - Rewrite `identity` to be voice-first, not capability-list
   - Fill `voice`, `principles`, `constraints`, `decision_principles`
   - Write `capability_summary` per use case (one line)
   - Split flat questions into `scope: "persona"` vs `scope: "capability"`
     with `use_case_id`
   - Remove runtime-leak questions; convert to `sample_input`
   - Add missing capability-config questions (e.g. Jira project keys)
   - Parameterise over-specified crons via adoption answers

3. **Validation (harness):**
   - Live adoption → assert `design_context.useCases` populated
   - Assert triggers have `use_case_id` attribution
   - Assert questionnaire answers propagated to `design_context.useCases[i].sample_input`
   - Assert Test Agent button works and produces output

---

## Part 4 — Live adoption test framework

### Replace the static playbook

The current `docs/guide-adoption-test-framework.md` describes a **static**
evaluation (read template JSON + app code, score). This is fine for code
review but cannot catch:
- Runtime state shape mismatches
- Adoption-flow crashes on real templates
- Whether questionnaire answers actually reach `design_context`
- Whether the generated persona is usable in-app

**New approach:** integrate with `docs/guide-test-automation.md`'s live
harness. Drive the real UI adoption wizard for every template and assert
on observable runtime state.

### Test per-template rubric

For each template, the harness must verify:

| Check | Assertion |
|---|---|
| **Gallery** | Template appears in `template-row-*` and is clickable |
| **Adoption opens** | `/open-matrix-adoption` returns `success: true` |
| **Questionnaire renders** | Question count > 0 (or template has 0 questions — flag) |
| **Scope grouping** | Questions grouped by scope in UI (v2 templates only) |
| **Answer submission** | Submit All → `buildPhase` transitions to `draft_ready` |
| **Persona metadata** | After adoption, `persona.design_context.useCases[]` present + populated |
| **Use case IDs** | Each `useCases[i].id` matches `id` field in template (v2) |
| **Capability summary** | Each `useCases[i].capability_summary` non-empty (v2) |
| **Triggers attributed** | Each trigger row has `use_case_id` matching a capability |
| **Test Agent** | "Test Agent" button clickable → produces `buildTestOutputLines > 0` |
| **Prompt assembly** | `assemble_prompt(persona, ...)` contains `## Active Capabilities` section |
| **No console errors** | No exceptions thrown during the whole flow |

### Fail-fast policy

The harness does not stop on failures. It logs every failure per template
and continues so we get a full catalog picture. **Bugs get fixed inline**
when:
- The failure repeats across multiple templates (systemic bug)
- The failure reveals a critical adoption-flow regression
- The fix is scoped (type/UI/handler) — not an architecture change

Architecture-level issues get logged as follow-ups, not fixed inline.

### Runner

Extend `tools/test-mcp/e2e_template_adoption.py` (already covers 23
wave-2 templates) into a full-catalog runner:

- Read every template from `scripts/templates/**/*.json`
- Classify: has available connectors? → run. Missing connectors? → skip
  with reason.
- Per template: execute the 12 checks above.
- Output: JSON report at `tools/test-mcp/reports/c2-sweep-{ts}.json`.

### Connector gap handling

Templates using connectors without a builtin definition (e.g. Salesforce)
are recorded as **skipped with reason**. They don't count as failures.
This is C2 audit §1's "not runnable" set.

---

## Part 5 — Inline bug-fix policy

During the sweep, when a bug surfaces:

| Surface | Fix inline? | How |
|---|---|---|
| Template JSON (missing default, bad question type) | **Yes** | Edit + git add |
| Wizard step crashes on a specific template shape | **Yes** | Add guard in step component |
| `AdoptState` missing a field for this template | **Yes** | Add to state + initial state |
| Connector role not in `connectorRoles.ts` | **Yes** | Add role with members |
| Variable type not handled in `TuneStep` | **Yes** | Add input type case |
| Rust IR deserialization fails on v2 shape | **Yes** | Agent_ir.rs (already partially done in Step 1) |
| Prompt assembly logic (C1 territory) | **No** | Log for C1 terminal |
| Architecture-level change | **No** | Log to deferred-backlog |

All inline fixes get committed with a prefix `fix(c2-sweep):` so the PR
reviewer can trace what the sweep uncovered.

---

## Part 6 — Sequencing (execution order this session)

1. Write this plan document. ✓
2. Pilot: redesign `email-morning-digest` under v2 (questionnaire scope,
   capability_summary). Commit. Validate schema.
3. Pilot: redesign `financial-stocks-signaller` with capability split
   (5 capabilities). Commit.
4. Add `scope` / `use_case_id` to `AdoptionQuestion` TS type.
5. Update `QuestionnaireFormGrid.tsx` to render by scope with inference
   fallback.
6. Rewrite `guide-adoption-test-framework.md` for live-harness approach.
7. Extend `e2e_template_adoption.py` → `e2e_c2_sweep.py` covering all 107.
8. Start dev app in background (`npx tauri dev --features test-automation`).
9. Wait for `/health` OK; run the sweep.
10. Collect report; triage failures; fix systemic bugs inline; re-run.
11. Final summary: grades per template, systemic bugs fixed, outstanding
    follow-ups.

### Success criteria for this session

- Plan doc + updated framework doc committed
- ≥2 pilot templates redesigned under v2
- Questionnaire scope mechanism (types + UI) merged
- Sweep runner produces a full-catalog JSON report
- ≥1 inline bug fix applied from real failures observed
- Explicit follow-up list with counts for the out-of-session hand pass

### Explicit non-goals this session

- Redesigning all 107 templates by hand (that's ~100h)
- Creating the archetype consolidations (post-C2)
- Running Claude CLI build sessions end-to-end (requires billed LLM calls;
  the harness uses adoption, not fresh CLI build)
- Fixing C1 territory bugs (other terminal owns those files)

---

## Appendix — Files touched in this session

| File | Change | Committed |
|---|---|---|
| `docs/concepts/persona-capabilities/C2-execution-plan.md` | New plan doc | tbd |
| `docs/guide-adoption-test-framework.md` | Rewrite for live harness | tbd |
| `src/lib/types/designTypes.ts` (or adjacent) | Add `scope`, `use_case_id` to AdoptionQuestion | tbd |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx` | Group by scope | tbd |
| `scripts/templates/productivity/email-morning-digest.json` | v2 pilot | tbd |
| `scripts/templates/finance/financial-stocks-signaller.json` | v2 pilot (capability split) | tbd |
| `tools/test-mcp/e2e_c2_sweep.py` | New full-catalog runner | tbd |
| `tools/test-mcp/reports/c2-sweep-*.json` | Sweep output | n/a |

Plus inline fixes surfaced during the sweep.
