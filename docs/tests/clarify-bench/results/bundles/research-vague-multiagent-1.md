# clarify-bench judge bundle — research-vague / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **2** · questions asked: **4** · time: 139.95s

## Vague intent the user typed
```
I want something for my research
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
I'm researching battery chemistry. Once a week I want it to search the web + arXiv for new papers and articles on solid-state batteries, summarise the genuinely new ones, and save the summaries to a Notion database so I can review them later.
```

## Expectations
- **must_clarify** (should ASK about each): ['the research topic / domain', 'what the agent should do with it (search / summarise / track / alert)', 'cadence', 'where to store or deliver the output']
- **must_not_assume** (must NOT bake in unasked): ['a topic (the intent names none — must ask)', 'a specific output destination without asking']
- **expect_questions**: 3  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [behavior_core]** Q: That's a broad request, so let's start with one concrete job. What is the single task you'd most like this agent to do for you? (For example: "every morning, pull yesterday's Stripe payouts into my Revenue sheet".)
    A (user-sim): The single task: once a week, search the web and arXiv for new papers and articles on solid-state batteries, summarise the genuinely new ones, and save those summaries into a Notion database for me.
**R2 [connectors]** Q: The persona is designed to write entries into Notion — should it use your connected Notion account for this?  · options: ['Yes, use my Notion account', 'No, deliver summaries in-app only', 'Use a different destination']
    A (user-sim): Yes, use my Notion account.
**R2 [triggers]** Q: Which day should the weekly research digest run?  · options: ['Monday', 'Friday', 'Sunday', 'Let the persona decide']
    A (user-sim): Sunday.
**R2 [use-cases]** Q: How many top entries should be saved per weekly run (this sets the max_entries_per_run limit)?  · options: ['5', '10', '20', 'Custom number']
    A (user-sim): 5

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Weekly Research Digest** — tool_hints=['notion.page_create', 'notion.database_query', 'notion.database_create_entry', 'web_search', 'arxiv.search', 'semantic_scholar.search', 'pubmed.search'] trigger={'description': 'Every Sunday at 09:00 UTC', 'schedule': '0 9 * * 0', 'timezone': 'UTC', 'type': 'cron'}
- required_connectors: ['notion']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}