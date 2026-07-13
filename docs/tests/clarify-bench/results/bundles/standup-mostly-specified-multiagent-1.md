# clarify-bench judge bundle — standup-mostly-specified / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **2** · time: 138.34s

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
**R1 [connectors]** Q: Which GitHub repository should it pull merged PRs from? Please provide the owner and repo name (e.g. acme-corp/backend).
    A (user-sim): acme-corp/backend — that's our main repo.
**R1 [connectors#2]** Q: Which Slack channel should the standup summary be posted to?
    A (user-sim): #standup — it's the channel we already use for our morning standups.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **PR Collection & Summarization** — tool_hints=[] trigger={'description': "Every weekday at 9:00 AM — fires before the team's standup window", 'schedule': '0 9 * * 1-5', 'timezone': 'America/New_York', 'type': 'cron'}
  - **Slack Standup Publisher** — tool_hints=['slack_post_message'] trigger={'description': 'Fires immediately after uc_collect_prs emits a completed event carrying the formatted digest. Falls back to a scheduled trigger at 09:00 local team time if the upstream event is unavailable.', 'event': 'uc_collect_prs.completed', 'type': 'event'}
- required_connectors: ['github']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}