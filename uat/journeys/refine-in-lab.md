---
id: refine-in-lab
title: Improve a persona in the Lab until it hits the business case precisely and efficiently
promotion: discovery
primary_contexts: [agents/lab, agent-editor, execution-runner, model-config]
surfaces: [personas]
relevant_characters: [software-developer, support-lead, finance-analyst, freelance-agency, content-marketer]
---

## Goal (user POV)

"My agent works, but not well enough. I want to make it *better* — more accurate on the cases I actually care about, and cheaper/faster to run — and I want evidence that the new version is genuinely better than the old one before I switch to it."

This is the third leg of the core product loop: **create → run → refine.** Creation and execution both have well-trodden journeys; this one asks whether the loop actually *closes* — whether a user who has run their persona against real work can feed what they learned back into a measurably better version.

## Why this journey exists

Every automation platform's real value shows up on the second iteration, not the first. n8n users tune a workflow after it misfires; Zapier users add filters after a bad run. The equivalent question here is: **when my persona gets something wrong, what do I do about it, and can I prove I fixed it?**

## Definition of done (user POV)

The user should be able to, without leaving the app or asking an engineer:

1. **See how the current version actually performs** — on their real job, not on an abstraction.
2. **Understand *why* it underperforms** — which behaviour, on which kind of input, and in what way.
3. **Produce a candidate improvement** informed by that diagnosis — not by re-typing their problem from scratch.
4. **Compare candidate vs. current on a like-for-like basis** and see a defensible difference, with some signal about how much to trust the comparison (sample size, judge confidence, coverage).
5. **See the efficiency dimension** — cost and latency per version/model, so "better" can mean "same quality, cheaper/faster," not only "higher score."
6. **Switch to the better version** and get back if it turns out worse.

## Judgement anchors

- **Precision.** Does refinement engage with the user's *real* work — their actual executions, their actual failure cases, their own data — or only with material the system generated about itself? A loop that grades a prompt against scenarios invented from that same prompt is close to grading it against itself.
- **Efficiency.** "More efficiently" is half the ask. Cost and latency must be visible per version/model, not just quality.
- **Diagnosis→action continuity.** If the system computes *why* a version scored badly, does that reasoning reach the thing that produces the next version — or does the user have to re-transcribe it by hand?
- **Reversibility.** Switching production behaviour is a scary action. Is it undoable, and does the user know that before clicking?
- **Honest confidence.** Is the user able to distinguish a well-evidenced verdict from a thin one before betting on it?

## Reachability note (resolve before judging)

The Lab tab is **tier-gated at Team** (`EditorTabBar.tsx:18`, `minTier: TIERS.TEAM`), and a Starter user who navigates to it is redirected to `use-cases` (`EditorBody.tsx:114`). It is *not* dev-only. So:

- **Starter characters cannot reach this surface at all.** For them the finding is not about the Lab's contents but about whether *any* refinement path exists at their tier — and what happens to their job when their agent underperforms.
- Team/Builder characters judge the Lab itself.

## Out of scope (record as `scope_note`, not defects)

- Arena run wall-clock: real model calls, 30–215s each, are expected cost — judge whether the *wait is worth it*, not that it exists.
- Ollama/local-model cost showing "not tracked" rather than `$0.000` — deliberate honesty.
