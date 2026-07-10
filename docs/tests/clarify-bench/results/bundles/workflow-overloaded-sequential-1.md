# clarify-bench judge bundle — workflow-overloaded / variant=sequential

- terminal phase: **failed** (ok=False, hung=False)
- rounds: **0** · questions asked: **0** · time: 34.55s

## Vague intent the user typed
```
manage my whole workflow and make my life easier
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Honestly I just have one concrete pain: every morning I copy yesterday's Stripe payouts into a Google Sheet by hand. I want that one thing automated — pull yesterday's Stripe payouts and append them to my 'Revenue' sheet each morning. Nothing else.
```

## Expectations
- **must_clarify** (should ASK about each): ['which SPECIFIC job to start with (the intent is unbounded)', 'the trigger / cadence', 'the source and destination systems']
- **must_not_assume** (must NOT bake in unasked): ["inventing a broad multi-capability 'do everything' persona instead of asking to narrow scope", 'any specific tool without asking']
- **expect_questions**: 3  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
_(no clarifying questions were asked)_

## Final resolved persona (source: persona)
- capabilities (0):
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}