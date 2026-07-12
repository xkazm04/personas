# clarify-bench judge bundle — sync-two-tools / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **5** · questions asked: **5** · time: 760.69s

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
**R1 [behavior_core]** Q: Which two task tools should be synced, and how should the sync flow?  · options: ['A: ClickUp ↔ Linear — two-way real-time sync (changes in either propagate instantly)', 'B: Asana ↔ Linear — two-way real-time sync', 'C: ClickUp ↔ Asana — two-way real-time sync', 'D: One tool is the master, the other mirrors it on a schedule (pick tools + direction next)', 'E: Different pair — tell me which two']
    A (user-sim): E: Todoist and Notion — Todoist is the source of truth and Notion just mirrors it, one-way.
**R2 [memory]** Q: What should "Todoist → Notion Mirror Sync" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each run is independent. It just needs to push whatever changed in Todoist over to Notion.
**R3 [human-review]** Q: Should "Todoist → Notion Mirror Sync" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Never — auto-publish. It's just mirroring my Todoist into Notion, so I don't need to approve every sync.
**R4 [connectors]** Q: Which storage connector should "Todoist → Notion Mirror Sync" use?
    A (user-sim): Notion — that's where the mirrored Tasks database lives.
**R5 [triggers]** Q: How should "Todoist → Notion Mirror Sync" fire?  · options: ["A: On demand — I'll trigger it manually", 'B: On a schedule (daily/weekly/…)', 'C: When an external event occurs (e.g. new document, inbound message)']
    A (user-sim): C — when something changes in Todoist (a task added or completed), it should fire then.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Todoist → Notion Mirror Sync** — tool_hints=['web_fetch', 'execute_sql'] trigger={'config': {'interval_seconds': 300}, 'description': 'Poll Todoist every 5 minutes — approximates event-driven firing since Todoist has no native push connector', 'trigger_type': 'polling'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}