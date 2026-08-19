---
layer: technique
subject: web-scraping
technique: dry-run-preview
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Dry-run preview

The commit gate of rule editing: **no rule change persists without a preview
extraction against the live page.** A rule is a claim about a page; the only
way to evaluate the claim is to run the experiment, and the cheapest time to
run it is before the broken version is saved — not on tonight's schedule,
into the dataset, discovered next week as a column of nulls.

## What a dry run is

Fetch the target page now, execute the *edited* (unsaved) rule set against
it through the *production* extraction engine, render the results, write
**nothing**. Four properties, each load-bearing:

- **Live page.** Previewing against a cached copy validates rules against
  the past. Cache is a legitimate accelerant *inside* an editing session
  (iterating on rules against one fetch is fine and kind to the target —
  politeness applies to preview fetches too), but the fetch that *arms the
  save* is fresh, or clearly labeled with its age.
- **Edited rules.** The preview runs what the form currently says, not what
  storage holds — the whole point is to test the unsaved delta. This is
  where the flat editable form earns its keep: the previewer executes it
  directly, no save-then-test round trip.
- **Production engine.** The same parser, the same locator evaluation, the
  same post-processing and failure semantics that the scheduled harvest
  will use. A preview through a simplified "editor-side" evaluator is a
  gate watching a proxy: rules pass preview and fail production exactly
  where the two evaluators differ, which is exactly where you needed the
  gate. If the harvest engine lives across a process boundary, the preview
  crosses the boundary too.
- **No writes.** A dry run never touches the dataset, never advances
  scrape bookkeeping (last-run stamps, schedule state, baselines), and its
  fetch is marked as authoring traffic in whatever politeness accounting
  the fetcher keeps. A "preview" with side effects is a run.

## What the preview shows

The reader of a preview is deciding one question — *are these rules right?* —
so the rendering is organized around per-rule verdicts, not a bare blob of
output:

- **Per rule:** matched or missed; match count against declared cardinality
  (a rule expecting one value that matched 14 is a defect the record output
  may hide); a sample of extracted values *after* post-processing; on a
  miss, the failure semantics that would apply — "missed (optional, field
  empty)" reads very differently from "missed (required — record fails)".
- **Assembled records:** the first several records as the dataset would
  receive them, so field-level truth and record-level shape are both
  inspectable. Zero assembled records renders as a warning state, never as
  a calm empty table — at preview time, "no records" almost always means
  "wrong rules", and the rendering should presume so.
- **The delta, when editing an existing set:** what the saved rules extract
  versus what the edited rules extract, at least at the summary level
  (fields gained, lost, changed on the sampled records). "My edit fixed the
  price field" and "my edit fixed the price field *and silently emptied the
  title field*" must not look alike at the moment of saving.

## The gate is structural, not advisory

"Preview before save" as a norm decays into "save and see"; the gate holds
only if the *save affordance itself* is disabled until a dry run of the
current edit state has succeeded — and re-disarms when the rules change
after the last preview. Every path out of the editor passes the same gate:
a multi-step editing flow that gates its forward button but leaves a
sidebar, a shortcut, or a direct navigation able to persist state has a
gate-shaped decoration, not a gate. Enumerate the exits; gate the ones that
persist; make the rest discard-with-confirmation.

Two honest escape hatches, both explicit:

- **Save-as-disabled.** Work-in-progress rules may be persisted in a state
  the scheduler will not run — clearly marked unverified. The gate protects
  *armed* rules, not drafts.
- **The page is down.** When the target cannot be fetched, the author may
  consciously save-disabled (and verify when it returns) — but an
  *unreachable page never auto-passes the gate*. A gate that fails open
  under exactly the conditions that produce bad rules is spelled "success"
  when it should be spelled "could not verify" — the failure-not-empty-
  success law applied to the gate itself.

## Preview is the shared verification surface

This same machinery serves the whole subject: it renders verification for
model-proposed rules ([llm-assisted-rule-authoring](llm-assisted-rule-authoring.md)
mandates it before adoption), and its per-rule hit counts against the
authoring page are the day-one **baseline** that
[shape-change-detection](shape-change-detection.md) later compares harvests
against. Build one previewer, well; three surfaces lean on it.
