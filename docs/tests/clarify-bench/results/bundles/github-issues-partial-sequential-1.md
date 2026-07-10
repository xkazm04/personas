# clarify-bench judge bundle — github-issues-partial / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **4** · questions asked: **4** · time: 635.08s

## Vague intent the user typed
```
watch my GitHub repo and tell me about important issues
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Watch the acme/backend repo. When a new issue is opened and labelled 'bug' or 'security', post a short summary to our #eng-alerts Slack channel. 'Important' = those two labels. Only new issues, in real time, not a digest.
```

## Expectations
- **must_clarify** (should ASK about each): ['which repo (owner/name)', "what counts as 'important' (labels / keywords / priority)", 'where to deliver the alert (destination)']
- **must_not_assume** (must NOT bake in unasked): ['a specific repo without asking', 'a digest/schedule when the user wants real-time event alerts']
- **expect_questions**: 3  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [behavior_core]** Q: "Watch and tell me about important issues" could mean a few different things — which fits best?  · options: ['A: Scheduled digest — check the repo on a cadence (daily, weekly) and send a ranked summary of open issues, PR activity, and CI status', 'B: Real-time monitor — alert me the moment something important happens (new issue opened, CI fails, PR needs review, security alert)', 'C: Both — periodic digest for the big picture, plus real-time alerts for high-severity events only']
    A (user-sim): B — real-time. When a new issue is opened on acme/backend and it's labelled 'bug' or 'security', I want to know right away, not in a daily roundup.
**R2 [memory]** Q: What should "Real-Time Issue Alert" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each run is independent.
**R3 [human-review]** Q: Should "Real-Time Issue Alert" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Never — auto-publish straight to Slack; alerts are useless if they're sitting waiting on me.
**R4 [triggers]** Q: How should "Real-Time Issue Alert" fire?  · options: ["A: On demand — I'll trigger it manually", 'B: On a schedule (daily/weekly/…)', 'C: When an external event occurs (e.g. new document, inbound message)']
    A (user-sim): C — when a new issue is opened on our acme/backend repo.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Real-Time Issue Alert** — tool_hints=['github_get_issue', 'slack_post_message'] trigger={'config': {'smee_channel_url': None, 'smee_event_filter': 'issues', 'webhook_secret': None}, 'description': 'Fires when a new issue is opened on acme/backend — wire a smee.io channel to acme/backend > Settings > Webhooks after promote, then paste the same URL in Settings > Triggers here', 'trigger_type': 'webhook'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}