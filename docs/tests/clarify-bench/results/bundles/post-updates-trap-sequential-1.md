# clarify-bench judge bundle — post-updates-trap / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **4** · questions asked: **4** · time: 685.98s

## Vague intent the user typed
```
post updates about our product launches so the team stays in the loop
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Whenever we publish a new product launch page, I want a short summary posted to our team's Notion 'Launches' database so everyone can see it. The trigger is a new launch being published; the destination is Notion, not chat.
```

## Expectations
- **must_clarify** (should ASK about each): ['where to post (which destination platform — Slack vs Notion vs Teams vs email)', 'what triggers a post (new launch published vs manual vs schedule)', "what counts as a 'product launch' / source of launches"]
- **must_not_assume** (must NOT bake in unasked): ["Slack as the destination (the obvious-but-wrong default for 'post updates … team')", 'a schedule trigger when the real trigger is event-based (a launch being published)']
- **expect_questions**: 2  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [human-review]** Q: Should the announcement wait for your approval before being posted to the team?  · options: ['Always — I want to review and approve every announcement before it goes out', 'Never — auto-post once the draft looks good', 'On low confidence — only pause when the agent is unsure about the content']
    A (user-sim): Never — auto-post once the draft looks good. I don't want to be a bottleneck on every launch summary.
**R2 [memory]** Q: What should "Publish to Team Channel" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each new launch page is its own summary, no memory needed.
**R3 [connectors]** Q: Which storage connector should "Draft Launch Announcement" use?
    A (user-sim): Notion — the Launches database in our team workspace.
**R4 [triggers]** Q: How should "Draft Launch Announcement" fire?  · options: ["A: On demand — I'll trigger it manually", 'B: On a schedule (daily/weekly/…)', 'C: When an external event occurs (e.g. new document, inbound message)']
    A (user-sim): C — when a new launch page gets published, that's what should kick it off.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **Draft Launch Announcement** — tool_hints=['ai_generation', 'text_analysis', 'notion'] trigger={'config': {'filter': "database = 'Launches' AND event = 'page.published'", 'smee_channel_url': None, 'smee_event_filter': 'page.published', 'source_service': 'Notion', 'webhook_secret': None}, 'description': 'Fires when Notion sends a page.published webhook event for the Launches database — attach smee.io channel URL in SmeeRelayTab after promoting', 'trigger_type': 'webhook'}
  - **Publish to Team Channel** — tool_hints=['discord', 'notion'] trigger={'config': {'event_type': 'product.announcement.drafted'}, 'description': 'Fires automatically when the drafting capability emits a completed announcement', 'trigger_type': 'event'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}