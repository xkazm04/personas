# clarify-bench judge bundle — standup-mostly-specified / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **3** · questions asked: **3** · time: 625.7s

## Vague intent the user typed
```
Every weekday at 9am, collect yesterday's merged pull requests from our repo and post a standup summary to Slack.
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Exactly that: a weekday 9am standup that lists yesterday's merged PRs from our main repo and posts the summary to our #standup Slack channel. The only thing I didn't say is WHICH repo and WHICH Slack channel.
```

## Expectations
- **must_clarify** (should ASK about each): ['which repository', 'which Slack channel / destination']
- **must_not_assume** (must NOT bake in unasked): ['a specific repo without asking', 'a specific Slack channel without asking']
- **expect_questions**: 2  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [human-review]** Q: Should the digest be posted to Slack automatically, or do you want to approve it first?  · options: ['A: Auto-post — publish every morning without intervention', "B: Always wait — show me the draft and I'll approve before it goes live", 'C: On low confidence — auto-post unless something looks off (missing PRs, fetch errors)']
    A (user-sim): C — auto-post unless something looks off, then check with me first.
**R2 [sample-output]** Q: How should "Slack Standup Poster" format its output? Paste / attach an example, or pick a shape:  · options: ['Markdown — bullet list with short headings', 'Markdown — table or grid layout', 'Prose summary — short paragraphs, no bullets', 'JSON — structured payload', "I'll attach an example"]
    A (user-sim): Markdown — bullet list with short headings, one bullet per merged PR.
**R3 [memory]** Q: What should "Daily PR Collector" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each run is independent, it should just pull yesterday's merged PRs fresh every morning.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **Daily PR Collector** — tool_hints=['github_list_pull_requests', 'data_processing', 'text_analysis'] trigger={'config': {'cron': '0 9 * * 1-5', 'timezone': 'America/New_York'}, 'description': 'Every weekday at 9am', 'trigger_type': 'schedule'}
  - **Slack Standup Poster** — tool_hints=['slack_post_message'] trigger={'config': {'event_type': 'standup.summary.ready'}, 'description': 'Fires whenever uc_daily_pr_collector emits a ready digest', 'trigger_type': 'event'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}