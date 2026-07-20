# UAT L2 — Empirical (2026-07-20, live app via :17320)

Targeted L2 driven by the L1 handoff (`uat/runs/2026-07-20-l1/`). Serial, single instance, real model calls. Focus: the `refine-in-lab` blockers, which L1 flagged as the worst journey in the sweep.

**Real work performed:** 1 version-scoped Arena run on `Web Summarizer` (`0cdfed77`), haiku only, 5 scenarios × real CLI model calls, ~5m15s wall clock, ~$0.15.

**Test residue (disclosed):** to compare two versions I had to create one — persona `0cdfed77` (one of seven duplicate "Web Summarizer" test personas) gained **v2** via a one-line prompt refinement, plus arena run `27f9b401`. The persona's behaviour is unchanged apart from that added instruction. Nothing else was mutated.

---

## HEADLINE — a new blocker L1 could not have found

### **Every Arena measurement is invisible in the Versions & Ratings table.**

`get_version_ratings` filters `r.status = 'completed'` across all three result tables (`ratings.rs:155-170`). But arena *results* are stamped by `verdict_status()` with `passed | failed | inconclusive` — `"completed"` is the **run** status (`test_runner.rs:2047`), not the result status. The filter applies the run vocabulary to the result column.

**Live proof:**

| Check | Value |
|---|---|
| `lab_arena_results` rows for this persona | **13** (7 failed, 1 inconclusive, 5 passed) |
| Rows matching the ratings filter `status='completed'` | **0** |
| What the live table renders | `v2 · Sonnet 4.6 · — · — · — · — · Active` / `v1 · — · — · — · — · — · **Not measured**` |

Persisted across a full navigate-away-and-back refetch. The Lab's primary surface — RATING, BASELINE, COST, TOKENS — is **structurally always empty for the only measurement path the UI exposes**, and v1 is actively mislabelled "Not measured" while holding 8 real measurements.

This subsumes and outranks the L1 Lab findings: users cannot reach the Δ-soundness bug because they can never see a rating at all. **One-line fix, highest value in the report.**

---

## L1 blockers — confirmed / refuted / sharpened

### SDL-01 (Δ compares two different exams) — **CONFIRMED, and worse than L1 described**

L1 proved the mechanism statically. L2 proved the practical harm with a **modest, realistic refinement** — one added line: *"Format every source URL as a markdown link with the page title as the anchor text, not a bare URL."* (+276 chars on an 8,383-char prompt).

Scenario sets generated for each version:

| v1 (exam A, 4 scenarios) | v2 (exam B, 5 scenarios) |
|---|---|
| UC1 — Successful URL Summary | UC1 — Summarize a live news article |
| UC1 — Paywall / Non-HTML Content | UC2 — Answer a current-events question from multiple sources |
| UC2 — Multi-Source Web Answer with Conflicting Sources | UC3 — Daily digest with new and already-seen items |
| UC3 — Daily Digest with New and Previously Seen Items | UC3 — Digest when all results are already seen |
| | UC1 — WebFetch hard failure triggers blocker protocol |

**Overlap: 0 of 4.** Not one scenario survived a one-line edit. v2 was additionally graded on a failure-mode test (`WebFetch hard failure`) that v1 was never asked to sit.

**It is a double confound, not a single one.** L1 caught the changing exam; L2 found the composite formula also changes between the two runs:

- v1 cells: `tool_accuracy = 0` (scored, counted at weight 0.4)
- v2 cells: `tool_accuracy = NULL` (sandbox → **excluded**, composite renormalised to ~67% output_quality / 33% protocol — exactly as FA-LAB-03 predicted)

Computed with the shipped weights (`eval.rs:367`):

```
v1 composite (haiku, exam A, n=4): 31.4
v2 composite (haiku, exam B, n=5): 86.1
Δ the UI would render:            +54.7 pts
```

**A one-line formatting tweak scores as a +54.7-point improvement.** Different questions, different marking scheme, presented as one number under a doc comment reading "apples-to-apples". (Currently masked by the status-filter bug above — fix that first and this becomes immediately user-visible.)

### FA-LAB-03 (sandbox renormalisation) — **CONFIRMED live**
All 5 v2 cells stored `tool_accuracy = NULL`. The displayed composite is ~2/3 output_quality — prose quality — with the dimension nearest "did it do the right operation" silently dropped.

### SL-LAB-04 / FA-LAB-04 (economics structurally empty) — **CONFIRMED live**
`lab_eval_results` = **0 rows**. The panel renders: *"No eval results yet — run the Lab to populate."* **Running the Lab is Arena, which never writes `lab_eval_results`.** The empty-state instructs an action that cannot resolve it. The guided tour advertises this panel (`tourSlice.ts:351`).

### "No latency column" — **CONFIRMED live**
Live header set: `VERSION · MODEL · RATING · BASELINE · COST · TOKENS · STATUS · ACTIONS`. Real measured `duration_ms` in this run ranged **10,262–43,904 ms** with no surface at all.

### SDL-04 (system_prompt edits never version) — **CONFIRMED (code, decisive)**
`create_prompt_version_if_changed` diffs only `structured_prompt` (`metrics.rs:177`); `system_prompt` is accepted and never compared. A system-prompt-only edit silently produces no version.

### FA-AGY-LAB-05 (changelog carries no rationale) — **CONFIRMED live**
The version created by my edit was written with `change_summary: "Auto-saved"`. A ten-version history reads as ten identical rows.

### Tier reachability — **CONFIRMED**
The Lab tab opened on this profile (Team+/dev), and the sidebar renders Events + Studio. Consistent with L1: Starter is gated out of both Lab and Events entirely.

---

## Not settled live (and why)

- **`long_text` single-line input (CM-AT-01):** not driven — I could not surface the Content Cascade adoption modal through Explore within a reasonable number of steps. **Not needed:** the claim is a decisive static fact I verified directly — `long_text` appears nowhere in `src/` or `src-tauri/src/`, and the renderer's only multi-line branch is `'textarea'`, everything else falling through to `<input type="text">`.
- **Review-policy inversion (SL-TRIG-02):** deferred; requires a recipe adoption + a real execution to observe auto-resolution. The code path is unambiguous (`recipeAdapter.ts:194` → `useAdoption.ts:187` → `dispatch.rs:1140` precedence → `dispatch.rs:638` auto-resolve). Worth an L2 pass after the fix, to confirm the fix rather than the bug.
- **Generated-output quality against the senior bar:** the 5 v2 outputs scored 78–92 on output_quality by the LLM judge, all `passed`, `eval_method: llm` (no heuristic fallback this run). Not independently judged in-character — the arena's own outputs weren't captured for character review.

---

## Scorecard update

| Journey | L1 | L2 outcome |
|---|---|---|
| `refine-in-lab` | L1-fail (4 of 5 characters) | **L2-fail** — blockers confirmed *and* a new, more fundamental one found (ratings never render) |
| `build-persona-from-intent` | L1-conditional | not driven this pass |
| `adopt-template` | L1-fail (2 of 3) | not driven (nav friction; core claim settled statically) |
| `run-and-review-execution` | L1-conditional | not driven this pass |
| `set-trigger-automate` | L1-fail (2 of 3) | not driven this pass |

## Revised fix priority (L2-informed)

The status-filter bug reorders everything. Corrected order for the Lab:

1. **`ratings.rs` status filter** — arena results never match `'completed'`. One line. Makes the entire Versions & Ratings table functional for the first time.
2. **Scenario-set stability** — pin the generated scenario set per persona (or per version-family) so Δ compares like with like; or wire the already-correct `run_ab_test` comparator and retire the Δ column.
3. **Composite comparability** — do not compare a `tool_accuracy = 0` cell against a `tool_accuracy = NULL` cell without disclosure.
4. **Economics** — point `get_version_economics` at the same UNION, or stop advertising the panel.
5. **Latency column** — data is measured and thrown away at the view layer.
