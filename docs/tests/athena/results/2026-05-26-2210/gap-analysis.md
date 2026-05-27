# Athena Quality Suite — First Run Gap Analysis

**Run:** `docs/tests/athena/results/2026-05-26-2210/`
**Overall:** FAIL — 5 scenarios, 23 turns, 8 PASS / 5 WARN / 10 FAIL

This is the **first regression run** of the suite. Gaps are expected. The
purpose of this doc is to triage them into "fix Athena", "fix the suite",
and "tighten the rubric" — so the next run isolates real regressions
instead of relitigating known issues.

---

## Findings, ranked by leverage

### 1. ⚠️ HIGHEST — Constitution op-grammar bug for `enqueue_dev_job`

**Scenario:** `scan-vs-build` t1 (and t2 has the same root cause)

Athena emits this in her reply text:
```
OP: {"op":"propose_action", "action":"use_connector",
     "params":{"connector_name":"dev_tools", "capability":"enqueue_dev_job",
               "args":{"kind":"scan_codebase", "project_id":"proj_..."}}}
```

But `enqueue_dev_job` is a **top-level approval-gated action**, not a
capability of a `dev_tools` connector. The correct shape per the
dispatcher is:
```
{"op":"propose_action", "action":"enqueue_dev_job",
 "params":{"kind":"scan_codebase", "project_id":"proj_..."}}
```

The dispatcher silently rejects the malformed op. User sees a reply
saying "kicking off a re-scan" — but no approval card, no scan, no
result.

**Fix:**
- `src-tauri/src/companion/templates/constitution.md` — distinguish
  `enqueue_dev_job` as its own approval-gated action (already documented
  but apparently not clear enough); add an explicit example.
- Consider: also accept `use_connector{connector_name:"dev_tools",
  capability:"enqueue_dev_job"}` as an alias and emit a normalization
  warning, so this fails closed less often.

**Impact:** This is the most user-visible failure in the run. "Athena
said she'd scan, then nothing happened."

---

### 2. 🔍 Doctrine recall is invisible across the entire run

**Scenarios:** all 5 — every single turn has `recall.doctrineTitles: []`

Even on turns that clearly used doctrine (design-family use_cases /
model_tier / observability, memory-doctrine t3 use-case scoping
question), the recall preview event reports zero doctrine consulted.

Either:
- (a) the doctrine retrieval isn't firing when it should, **OR**
- (b) the `companion://recall-preview` event isn't reporting the
  doctrine titles even when retrieval did fire

This is critical because:
- The universal anti-pattern check `"quoted text not in any consulted
  doctrine"` becomes unenforceable.
- We can't tell whether Athena is reciting doctrine substance from
  prompt-bake-in vs. fresh retrieval.

**Where to investigate:**
- `src-tauri/src/companion/brain/doctrine.rs` — is the retrieval call
  actually firing for these intents?
- `src-tauri/src/companion/prompt.rs::recall_addendum` — is the preview
  event being built with the consulted titles?
- `src-tauri/src/commands/companion/...` — the event-emit path

A quick way to disambiguate: write a temporary log line at retrieval
that prints the consulted titles, run any scenario, and check whether
the log fires.

**Impact:** Until this is fixed, `grounded` axis verdicts have a known
blind spot. The judge can score `grounded = ok` only when the reply
substance matches doctrine the judge knows, not from preview
verification.

---

### 3. `design_capabilities` card not emitted on "what can you do?"

**Scenarios:** `memory-doctrine` t1, `design-family` t1 (partial)

Athena enumerates capabilities in **prose** instead of emitting the
`show_design_capabilities` card with hardcoded vocabulary. The card
exists specifically so the capability list can't drift via
prose-hallucination. When Athena prose-enumerates instead, the
anti-hallucination protection bypasses.

**Fix:** `prompt.rs` or constitution — strengthen rule: *"on intents
matching 'what can you do' / 'help me get started' / 'where do I begin',
emit `show_design_capabilities` as the primary surface; reserve prose
for the intro line only."*

---

### 4. `template_suggestions` bypassed for clear gallery matches

**Scenarios:** `template-vs-build` t1 (cascading into t3), `design-family` t1

For "Sentry watcher → Slack" (textbook gallery match) and
"help me design a triage persona" (template-or-design choice), Athena
went straight to `prefill_persona_create` or `template_suggestions`
without the **gallery-first** check.

**Fix:** Constitution addendum — *"Before emitting
`prefill_persona_create` or `build_oneshot` for an intent with a clear
named-service shape (Sentry, Gmail, GitHub, Slack, Jira), invoke
`show_template_suggestions { intent }` first. The gallery match runs
synchronously — if empty, pivot to build; if matches exist, let the user
adopt."*

---

### 5. Non-wired connector treated as viable

**Scenario:** `memory-doctrine` t4 (Notion)

User: "Can you watch my Notion workspace?" Athena: "Yes — that's a
clean persona shape. Before I prefill the build wizard, three things to
nail down…" Then asks design questions, mentions in the **last
paragraph** that she doesn't see a Notion connector in her digest.

The user could reasonably proceed thinking Notion is connectable.

**Fix:** Constitution / prompt — *"For any persona-design ask
mentioning a third-party service, the FIRST sentence of the reply
should be the connector-availability check. Wired connectors today:
Sentry, GitHub, Slack, Gmail. Anything else: 'X isn't wired — you'd
need to add a custom connector via the vault first.' Only proceed with
design after that's clear."*

---

### 6. No off-ramp chip on confident-autonomy `build_oneshot`

**Scenario:** `build-oneshot-vs-interactive` t1

User: "Just build it, decide everything yourself." Athena fires
`build_oneshot` correctly, but with zero QR chips. The scenario
prescribes a "Make it interactive instead" chip as the off-ramp.

**Fix:** Prompt addendum — *"Whenever `build_oneshot` fires, always
include at minimum one QR chip 'Make it interactive instead' so the
user can change their mind before approval."*

---

### 7. `build_oneshot` recommended in recap despite unsettled design

**Scenario:** `design-family` t6 (recap)

The conversation left the inbox source unresolved (Gmail / Outlook /
Zendesk — referenced by chips on t1, t3, and t6). Yet the recap's
`persona_ready.recommended_action` is `build_oneshot`.

**Fix:** Constitution rule — *"If any earlier design turn left a
decision unsettled (visible from the chips Athena offered but the user
didn't pick), `recommended_action` in `show_persona_ready` should be
`interactive`, not `build_oneshot`."*

---

### 8. ⚙️ Runner false-fail — nested config matcher

**Scenario:** `design-family` t5 (observability)

The fixture had `success_metric_kind_in: [...]` but the actual config
path is `success_metric.kind`. The matcher didn't navigate dots.

**Status:** **Already fixed** in the matcher (`_resolve_path`) and
fixture (`success_metric.kind_in`). The next run will re-validate.

---

### 9. Scenario expectation may be too strict

**Scenario:** `scan-vs-build` t2 (euphemistic scan)

User: "Can you look through my codebase and tell me what's broken?"
Athena gave an excellent operational-state diagnosis + handoff offer
("Want me to hand the context scan to SDLC Code Reviewer?") **without
immediately firing `enqueue_dev_job`**. The fixture wanted the approval
to auto-fire; Athena waited for confirmation.

**Two ways to resolve:**
- (a) Adjust the fixture to accept either auto-fire OR
  question-with-chip path.
- (b) Tighten Athena's prompt to always fire the scan approval when the
  user phrases anything as a scan/look-through request.

(a) is the cheaper fix and arguably more user-friendly. (b) is the
stricter contract.

---

## Suggested fix order

1. **#2 (doctrine recall visibility)** — blocks future grounding
   judgments; investigate first.
2. **#1 (enqueue_dev_job op grammar)** — most user-visible silent
   failure.
3. **#3 + #4 + #5 (card-first surfaces)** — three related fixes about
   "use the structured surface instead of prose".
4. **#6 + #7 (build_oneshot off-ramp + unsettled-design pivot)** — both
   about commit-discipline on build ops.
5. **#8 (already fixed)** — re-run validates.
6. **#9 (scenario tuning)** — decide policy then update fixture.

---

## What's working well

Worth naming so we don't regress what's already good:

- **Empty-state honesty** (`memory-doctrine` t2, t5): Athena's
  "I don't have memories yet — what I have is situational" framing is
  exemplary. Universal anti-pattern check is clean.
- **Operational diagnosis from live state** (`scan-vs-build` t2):
  Athena correctly identifies a CHECK-constraint regression hitting two
  unrelated agents = persistence-path bug, not agent-level. That kind of
  inference from observable signals is what the rubric rewards.
- **Cross-turn context awareness** (`scan-vs-build` t3-t4,
  `build-oneshot-vs-interactive` t3-t4): Athena references in-flight
  builds ("the Daily PR Reviewer is still in motion") and prior-turn
  decisions ("complements your Important Emails agent rather than
  fighting it") rather than treating each turn independently.
- **Doctrine substance** (even with the recall-visibility gap): on
  `model_tier_choice`, `use_case_set`, `trigger_set`, the substance
  matches `persona-design-best-practices.md`. The framework is internalized
  even if the retrieval event doesn't show it.

---

## Next steps for the suite itself

After Athena fixes land:

1. **Re-run the full suite** with the matcher + fixture patches:
   ```bash
   python tools/test-mcp/athena_quality_suite.py
   ```
2. **Compare runs** — the report.json structure lets us diff
   pre/post-fix verdicts axis-by-axis.
3. **Tighten the rubric** based on what's still WARN — likely candidates
   for relaxation: usefulness wording (false fails on terse-but-correct
   replies), op_correctness on cases where the scenario fixture is
   stricter than what the user actually wants.
4. **Promote to regular regression cadence** once the run is at-or-near
   green — likely weekly trigger on Athena prompt / constitution / doctrine
   changes.

The suite is **not** ready to flag as a CI gate yet — the
runner-side and rubric-side noise needs another pass. But the framework
works end-to-end: drive turns, capture state, hard-assert, judge, report.
The findings above are the kind of regression catches the suite was
designed to surface.
