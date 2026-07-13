# clarify-bench judge bundle — hn-digest-control / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **0** · questions asked: **0** · time: 58.62s

## Vague intent the user typed
```
Every day at 9am, fetch the top 5 Hacker News stories and show them to me as a digest in the app titlebar. No need to publish anywhere else.
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Exactly what I said: a daily 9am digest of the top 5 Hacker News stories, delivered to the in-app titlebar. Nothing more — no external publishing, no review step needed, it's just an informational read.
```

## Expectations
- **must_clarify** (should ASK about each): []
- **must_not_assume** (must NOT bake in unasked): []
- **expect_questions**: 0  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
_(no clarifying questions were asked)_

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Daily HN Digest** — tool_hints=[] trigger={'description': "Runs once daily at 9 AM in the user's local timezone", 'schedule': '0 9 * * *', 'timezone_input': 'user_configured', 'type': 'cron'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}