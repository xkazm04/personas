---
layer: application
subject: eval-harness
technique: scenario-design
stack: rust
---

# The lab's scenario cache — a deliberately-scoped key, with the incident that shaped it

The Agent Lab generates test scenarios with an LLM (expensive: a headless
CLI spawn per generation) and caches them in
`src-tauri/engine/src/test_runner.rs`:

- `SCENARIO_CACHE` (`:14-20`) — an in-memory `HashMap<u64, (Instant,
  Vec<TestScenario>)>` behind a mutex, TTL `SCENARIO_CACHE_TTL_SECS = 600`.
- `scenario_cache_key()` (`:57-91`) — hashes `(persona.id, tool names +
  descriptions, use_case_filter)`. **The prompt text is deliberately
  excluded**, and the doc-comment carries both the reason and the incident.

## The incident the key encodes

The Lab's "Versions & Ratings" Δ column compares two *prompt versions* of
one persona. If the prompt were in the cache key, v1 and v2 would each
generate — and be graded on — a different LLM-invented exam. UAT 2026-07-20
proved it live: a one-line prompt tweak produced a scenario set with 0-of-4
overlap and a **+54.7-point "improvement" that was pure exam drift**. Every
individual score was honestly computed; the delta was fiction. The fix was
narrowing the key so every version faces the same questions.

The technique's tradeoff paragraph is written in the same doc-comment: a
materially rewritten persona keeps a pre-rewrite exam for up to the TTL
(bounded, visible staleness), `fixture_inputs` runs bypass the cache
entirely (captured-reality inputs are never cached as generated ones), and
the comment ends with the guard rail — *"Do NOT re-add the prompt here
without also making the Δ column scenario-set-aware."*

## The empty-generation guard

`:412-415`: a generation that returns zero scenarios is **not cached** —
caching it would poison the key for 10 minutes, converting one transient
CLI failure into "this persona has no exam" for every subsequent run.
Failure spelled differently from empty success, at cache granularity.

## Fixture identity beyond the cache

Scenarios carry ids into `LabEvalResult` rows, and the grid in
`src/features/agents/sub_lab/libs/evalAggregation.ts` aggregates per
`(versionId, modelId)` cell — scores attach to identities, not positions,
so re-runs and added models extend the grid instead of reshuffling it.

## Observed drift worth knowing about

The file-top comment (`:14-16`) still describes the key as a hash of
"(persona_id, system_prompt, tools, use_case_filter)" — contradicting both
the implementation and the load-bearing doc-comment on
`scenario_cache_key()` itself (`:57-74`). The function-level comment is the
authoritative one; the header predates the incident fix. A reader who
stops at the header learns the exact opposite of the invariant.
