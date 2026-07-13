# clarify-bench judge bundle — sales-vague / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **2** · questions asked: **4** · time: 171.95s

## Vague intent the user typed
```
build an agent for my sales team
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
When a deal is marked Closed-Won in our CRM, I want a celebration message posted to the #wins Slack channel and a row appended to our 'Closed Deals' spreadsheet with the deal name, amount, and owner. That's the whole job.
```

## Expectations
- **must_clarify** (should ASK about each): ['what the agent should DO (the job is unstated)', 'the trigger (what event / when)', 'the source system (CRM) and which one', 'the output destination(s)']
- **must_not_assume** (must NOT bake in unasked): ["a generic 'sales assistant' scope instead of the specific closed-won workflow", 'a specific CRM or chat tool without asking']
- **expect_questions**: 3  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [behavior_core]** Q: That's a broad request, so let's start with one concrete job. What is the single task you'd most like this agent to do for you? (For example: "every morning, pull yesterday's Stripe payouts into my Revenue sheet".)
    A (user-sim): *"When a deal closes as won in our CRM, post a celebration message in our #wins Slack channel and add the deal to our Closed Deals spreadsheet."*
**R2 [connectors]** Q: Which CRM should the agent watch for closed-won deals?  · options: ['Attio', 'HubSpot', 'Pipedrive', 'ClickUp']
    A (user-sim): Attio.
**R2 [connectors#2]** Q: Where should win celebrations be posted? (You have Discord connected; Slack is also available but not yet in your vault.)  · options: ['Discord', 'Slack']
    A (user-sim): Slack, please — that's where the team hangs out. The wins should go to our #wins channel there.
**R2 [connectors#3]** Q: Where should closed deals be logged as spreadsheet rows?  · options: ['Airtable', 'Google Sheets', 'Notion']
    A (user-sim): #wins for Slack was the plan — and for the spreadsheet, Google Sheets. That's what we use.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **Win Celebration Post** — tool_hints=[] trigger={'description': 'Fires when Attio emits a stage-change event and the new stage is closed-won. Attio webhooks deliver the full record payload, so no secondary CRM fetch is required for basic fields.', 'event': 'deal.stage_changed', 'filter': {'stage': 'closed-won'}, 'source': 'attio', 'type': 'webhook'}
  - **Closed Deal Logger** — tool_hints=[] trigger={'description': 'Fires whenever an Attio deal record is updated and its stage transitions to closed-won.', 'event': 'record.updated', 'filter': {'field': 'stage', 'object': 'deals', 'to_value': 'closed-won'}, 'source': 'attio', 'type': 'webhook'}
- required_connectors: ['attio', 'slack']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}