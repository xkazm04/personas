# clarify-bench judge bundle — news-cadence-outside / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **5** · questions asked: **5** · time: 575.91s

## Vague intent the user typed
```
keep me updated on tech news
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Give me a short summary of the biggest AI and startup news twice a week — Monday and Thursday mornings — pulled from the web, delivered as an in-app notification. Just reading, nothing to publish.
```

## Expectations
- **must_clarify** (should ASK about each): ['cadence / how often (no schedule word in the intent, so it must ask)', 'topic focus / which news', 'where to deliver the update']
- **must_not_assume** (must NOT bake in unasked): ["a daily cadence (the intent gives no cadence at all — 'updated' is not 'daily')", 'a specific external publishing destination']
- **expect_questions**: 2  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [behavior_core]** Q: How do you want to stay updated on tech news?  · options: ['A: Scheduled digest — collect headlines daily (or weekly) and deliver a curated summary on a cadence you choose', 'B: Real-time monitor — watch for breaking stories and alert you the moment something significant lands', "C: Interactive advisor — ask me about tech news on demand and I'll research and brief you instantly"]
    A (user-sim): A — a digest twice a week, Monday and Thursday mornings.
**R2 [memory]** Q: What should "Bi-Weekly Tech Digest" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Recurring context — the AI and startup topics and companies I care about, so it doesn't keep repeating the same stories.
**R3 [human-review]** Q: Should "Bi-Weekly Tech Digest" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Never — auto-publish, it's just a summary I read.
**R4 [connectors]** Q: Which storage connector should "Bi-Weekly Tech Digest" use?
    A (user-sim): No storage — just send it to me as an in-app notification.
**R5 [triggers]** Q: How should "Bi-Weekly Tech Digest" fire?  · options: ["A: On demand — I'll trigger it manually", 'B: On a schedule (daily/weekly/…)', 'C: When an external event occurs (e.g. new document, inbound message)']
    A (user-sim): B — on a schedule, twice a week: Monday and Thursday mornings.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Bi-Weekly Tech Digest** — tool_hints=['web_search', 'web_fetch', 'text_analysis'] trigger={'config': {'cron': '0 8 * * 1,4', 'timezone': 'America/New_York'}, 'description': 'Every Monday and Thursday at 8 am Eastern', 'trigger_type': 'schedule'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}