# clarify-bench judge bundle — news-cadence-outside / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **3** · time: 143.56s

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
**R1 [connectors]** Q: Where should your tech news digest be delivered?  · options: ['Gmail (email)', 'Discord', 'Notion', 'In-app only']
    A (user-sim): In-app only — I just want to read it, not have it land in my inbox.
**R1 [triggers]** Q: How often do you want to receive updates?  · options: ['Once daily (morning)', 'Twice daily (morning + evening)', 'Breaking news only (as it happens)', 'Weekly roundup']
    A (user-sim): Twice a week is enough — Monday and Thursday mornings.
**R1 [use-cases]** Q: Which tech topics matter most to you? (pick all that apply)  · options: ['AI / ML', 'Developer tools', 'Big Tech (Apple, Google, Meta, Microsoft)', 'Startups & funding', 'Policy & regulation', 'Infrastructure & cloud']
    A (user-sim): AI / ML and Startups & funding — those two.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Twice-Weekly Tech Digest** — tool_hints=['web_search', 'text_generation'] trigger={'cron': '0 8 * * 1,4', 'description': 'Every Monday and Thursday at 08:00 local time', 'timezone': 'user_local', 'type': 'schedule'}
- required_connectors: ['personas_messages']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}