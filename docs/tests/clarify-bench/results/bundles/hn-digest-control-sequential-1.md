# clarify-bench judge bundle — hn-digest-control / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **4** · questions asked: **4** · time: 399.41s

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
**R1 [sample-output]** Q: How should "Daily HN Digest" format its output? Paste / attach an example, or pick a shape:  · options: ['Markdown — bullet list with short headings', 'Markdown — table or grid layout', 'Prose summary — short paragraphs, no bullets', 'JSON — structured payload', "I'll attach an example"]
    A (user-sim): Markdown — bullet list with short headings, one line per story.
**R2 [memory]** Q: What should "Daily HN Digest" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each run is independent, it just pulls the current top 5 stories each morning.
**R3 [human-review]** Q: Should "Daily HN Digest" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Never — auto-publish; it's just a read-only digest, I can ignore it if it's junk.
**R4 [connectors]** Q: Which storage connector should "Daily HN Digest" use?
    A (user-sim): No storage — it just posts the digest to the in-app titlebar each morning.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Daily HN Digest** — tool_hints=['web_fetch'] trigger={'config': {'cron': '0 9 * * *', 'timezone': 'local'}, 'description': 'Every day at 9am local time', 'trigger_type': 'schedule'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}