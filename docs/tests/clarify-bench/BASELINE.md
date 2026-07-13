# clarify-bench baseline — interactive sequential build vs vague intent

**Date:** 2026-07-09 · **Variant:** `sequential`, `mode=interactive` · **n=1 per fixture, 10 fixtures**
**Judging:** Claude-Code-as-judge, 4 independent judges grouped by vagueness band.
Raw scores: [`results/verdicts/baseline-sequential-2026-07-09.json`](./results/verdicts/baseline-sequential-2026-07-09.json)

## Verdict

> **The new design does not yet solve "assumed too much" — and on genuinely vague
> input, the case onboarding actually faces, it collapses.**

It *does* ask a lot of questions. But it asks the **wrong** ones: it interrogates
axes that have obvious safe defaults (memory, human-review, output format, storage)
while staying silent on the load-bearing ambiguities (which repo, which channel,
which provider, which topic, what counts as "important"). It then **still bakes in
unconfirmed values**. And every question costs a full LLM turn because it asks
**serially**, one per round — so vague intent runs out of budget before it converges.

## Results

| fixture | band | outcome | rounds/qs | time | caps | total |
|---|---|---|---|---|---|---|
| `news-cadence-outside` | medium | draft_ready | 5 / 5 | 576s | 1 | **0.75** |
| `hn-digest-control` | none (expect **0 qs**) | draft_ready | 4 / 4 | 399s | 1 | 0.71 |
| `sync-two-tools` | medium | draft_ready | 5 / 5 | 761s | 1 | 0.67 |
| `github-issues-partial` | medium | draft_ready | 4 / 4 | 635s | 1 | 0.59 |
| `standup-mostly-specified` | low | draft_ready | 3 / 3 | 626s | 2 | 0.53 |
| `post-updates-trap` | medium | draft_ready | 4 / 4 | 686s | 2 | **0.41** ⚠ |
| `sales-vague` | high | **timeout 900s** | 4 / 4 | 900s | **0** | 0.37 |
| `research-vague` | high | **draft_ready, EMPTY** | 4 / 4 | 602s | **0** | 0.29 |
| `emails-vague` | high | draft_ready | 5 / 5 | 900s | 2 | **0.27** ⚠ |
| `workflow-overloaded` | extreme | **failed 34s, 0 questions** | 0 / 0 | 34s | **0** | 0.21 |

**Mean 0.48.** By band: controls **0.62** · medium **0.605** · **high/extreme 0.285**.

## The four failures

**1. It asks the wrong questions.**
`standup-mostly-specified` specified everything except *which repo* and *which Slack
channel* — it asked neither, and spent 3 serial rounds on auto-post, format, and
memory instead. `github-issues-partial` targeted **none** of its three ambiguities.
`research-vague` asked the *same* memory template question twice while never asking
the topic, cadence, or destination.

**2. It still assumes.** Two hard fails (`no_wrong_assumptions` = 0):
- `emails-vague` baked `gmail_search` into both capabilities **without ever asking the
  provider** (right by luck — the hidden intent was Gmail).
- `post-updates-trap` elicited Notion, then **invented a "Publish to Team Channel"
  capability hinting `discord`** — a chat destination the user never confirmed. It
  fell into the trap; Discord merely stood in for Slack.

**3. It over-asks where defaults are obvious.** The fully-specified control
(`hn-digest-control`, which the design's Rule 26 fast-path says should draw **zero**
questions) drew **four** — format, memory, review, storage. `efficiency_round_cap`
scored **0 or 1 on all ten fixtures**; not once did a build stay within the
≤2-round cap.

**4. Vague input collapses.** Serial asking means each round is a full LLM turn, so
the cost compounds exactly where intent is thinnest:
- `sales-vague` — burned the 900s budget on 4 serial rounds, still needed a 5th → **0 capabilities**.
- `research-vague` — reached `draft_ready` with **no `agent_ir`** → an **empty persona**.
- `workflow-overloaded` — **hard-failed in 34s, asked nothing, resolved nothing, emitted no error**, on the intent that most needed a narrowing question.

**3 of the 4 high/extreme fixtures produced zero capabilities.**

## Read the numbers pessimistically, not optimistically

- The user-simulator answered **verbosely**, volunteering repo names, topics, and
  destinations the build never asked for. That **masks** under-asking — a terse real
  user would score worse. These are an *upper bound*.
- `no_wrong_assumptions = 3` is **vacuous** for `sales-vague`, `research-vague`, and
  `workflow-overloaded`: they passed only by producing nothing. Their totals are
  inflated by a hollow pass. Of the 7 builds that produced any persona, **2 hard-failed
  on unconfirmed assumptions.**

## What a fix must do

1. **Select questions by information value, not by template.** Ask the axes the intent
   leaves genuinely unresolved (identifiers, destinations, providers, scope); resolve
   memory / review / format / storage from safe defaults unless the intent implies
   otherwise. The `gates.rs` defaults (review/memory/output → always ask) and the Rule 26
   fast-path currently pull in opposite directions, and the template side wins.
2. **Batch into one round.** Rule 25 already mandates ≤1 mission round + ≤1 batched round
   of ≤4. The model treats it as advisory. Enforce it in Rust rather than in the prompt —
   emit all unresolved-gate questions as a single `awaiting_input` payload.
3. **Never bind an unconfirmed destination or provider.** Discord and Gmail were both
   invented. A connector/provider should be bindable only from an answer or an explicit
   mention in the intent.
4. **Fail loudly, never emit an empty persona.** `research-vague` reached `draft_ready`
   with no `agent_ir`; `workflow-overloaded` failed with no error message.

Together these are what **clarify-then-fan-out** should deliver: one batched, well-chosen
clarifying round → parallel capability resolution → Rust-assembled IR. That converts the
current 3–5 serial LLM turns into ~1, which is the whole "faster iterations on vague
input" thesis.
