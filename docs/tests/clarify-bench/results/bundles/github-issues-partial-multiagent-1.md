# clarify-bench judge bundle — github-issues-partial / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **4** · time: 167.05s

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
**R1 [connectors]** Q: Which GitHub repository should this persona watch? Please provide the full repo path (e.g. owner/repo-name).
    A (user-sim): acme/backend
**R1 [triggers]** Q: How often should the persona check for important issues — or should it alert you immediately when a qualifying issue appears?  · options: ['Real-time / as soon as detected', 'Hourly digest', 'Daily digest', 'Weekly digest']
    A (user-sim): Real-time — post to Slack as soon as a qualifying issue appears, no digests.
**R1 [use-cases]** Q: What makes an issue 'important' to you? This defines the core filter.  · options: ['Bug reports (especially with error logs or stack traces)', 'Issues labeled critical/high-priority by collaborators', 'Issues with no response after a set time', 'Issues from specific contributors or teams', 'All of the above']
    A (user-sim): *chuckles* You've got a decoy list in front of me, but my answer's simple:

Issues labeled 'bug' or 'security' — those two labels are what "important" means for me.
**R1 [connectors#2]** Q: Where should important issue alerts be delivered?  · options: ['Discord (you have a bot token)', 'Gmail (you have OAuth)', 'In-app only (no external delivery)', 'Notion']
    A (user-sim): #eng-alerts on Slack — that's where the team already watches for this stuff. None of those four options work for us.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Issue Alert** — tool_hints=[] trigger={'description': "Fire immediately when a new issue is opened on acme/backend carrying the label 'bug' or 'security' (exact string match). If both labels are present, fire once.", 'event': 'issues', 'filters': {'action': 'opened', 'labels': {'match': 'exact', 'values': ['bug', 'security']}, 'repository': 'acme/backend'}, 'source': 'github', 'type': 'webhook'}
- required_connectors: ['github']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}