# clarify-bench judge bundle — sync-two-tools / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **4** · time: 159.95s

## Vague intent the user typed
```
sync my tasks between my two tools
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
When I add or complete a task in Todoist, mirror that change into a Notion 'Tasks' database so my Notion workspace always reflects Todoist. It's one-way, Todoist to Notion — Notion is just the readable mirror.
```

## Expectations
- **must_clarify** (should ASK about each): ['which two tools (neither is named)', 'sync direction (one-way vs two-way, and which is source)', 'what counts as a task change to sync (add / complete / update)']
- **must_not_assume** (must NOT bake in unasked): ['two-way sync when the user wants one-way', 'specific tools without asking which two']
- **expect_questions**: 2  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [connectors]** Q: Which two task management tools do you want to sync?  · options: ['Linear', 'ClickUp', 'Asana', 'Notion', 'Airtable', 'Other']
    A (user-sim): Todoist and Notion — Todoist is where I actually manage my tasks, and I want them mirrored into a Notion database.
**R1 [connectors#2]** Q: Which of these is your second tool (if not already covered above)?  · options: ['Linear', 'ClickUp', 'Asana', 'Notion', 'Airtable', 'Other']
    A (user-sim): Notion — that's where I want my Todoist tasks mirrored to.
**R1 [behavior_core]** Q: Should sync go both ways, or only from one tool into the other?  · options: ['Two-way (changes on either side propagate to the other)', 'One-way only (pick a source of truth below)']
    A (user-sim): One-way only — Todoist is the source of truth, Notion just mirrors it.
**R1 [triggers]** Q: How often should the sync run?  · options: ['In real-time / as changes happen', 'Every 15 minutes', 'Every hour', 'Once a day']
    A (user-sim): Real-time, as changes happen — I want Notion to always reflect Todoist, so the faster the better.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Todoist → Notion Sync** — tool_hints=['notion__query_database', 'notion__create_page', 'notion__update_page', 'notion__retrieve_page'] trigger={'delivery': 'real_time', 'events': ['item:added', 'item:updated', 'item:completed', 'item:deleted'], 'notes': "Todoist fires HTTPS webhook POST to a registered endpoint on every task mutation. The capability must expose a public endpoint and register it in Todoist's Webhooks settings under the user's app integrations.", 'provider': 'todoist', 'type': 'webhook'}
- required_connectors: ['notion']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}