# clarify-bench judge bundle — sales-vague / variant=sequential

- terminal phase: **resolving** (ok=False, hung=True)
- rounds: **4** · questions asked: **4** · time: 900.16s

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
**R1 [behavior_core]** Q: What should the sales agent primarily do for your team?  · options: ['A: Lead intelligence — qualify inbound leads, score them, and draft personalized outreach so reps spend time on the right prospects', 'B: Pipeline health monitor — track deal progress, surface stale opportunities, and send reps a daily digest of what needs attention today', 'C: CRM data steward — keep records enriched and accurate, flag missing fields, and auto-log activity so reps never touch data entry', 'D: Meeting & follow-up assistant — capture meeting notes, extract commitments, and draft follow-up emails ready for rep approval']
    A (user-sim): B — but really just the closing part: when a deal hits Closed-Won I want it announced and logged.
**R2 [memory]** Q: What should "Win Logger" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Nothing — each run is independent.
**R3 [human-review]** Q: Should "Win Announcement" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Never — auto-publish. It's just a Slack post and a spreadsheet row; I don't want to approve every closed deal.
**R4 [connectors]** Q: Which spreadsheet connector should "Win Logger" use?
    A (user-sim): Google Sheets — that's where our 'Closed Deals' sheet lives.

## Final resolved persona (source: persona)
- capabilities (0):
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}