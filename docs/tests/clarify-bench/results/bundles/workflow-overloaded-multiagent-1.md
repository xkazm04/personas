# clarify-bench judge bundle — workflow-overloaded / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **4** · time: 182.69s

## Vague intent the user typed
```
manage my whole workflow and make my life easier
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
Honestly I just have one concrete pain: every morning I copy yesterday's Stripe payouts into a Google Sheet by hand. I want that one thing automated — pull yesterday's Stripe payouts and append them to my 'Revenue' sheet each morning. Nothing else.
```

## Expectations
- **must_clarify** (should ASK about each): ['which SPECIFIC job to start with (the intent is unbounded)', 'the trigger / cadence', 'the source and destination systems']
- **must_not_assume** (must NOT bake in unasked): ["inventing a broad multi-capability 'do everything' persona instead of asking to narrow scope", 'any specific tool without asking']
- **expect_questions**: 3  (e.g. a fully-specified control expects ~0)

## Q&A transcript (what the build actually asked, in order)
**R1 [use-cases]** Q: Your intent is broad — let's start with one concrete job. Which would you want this persona to tackle first?  · options: ['Morning briefing: surface what needs my attention across tasks, PRs, and calendar', 'Inbox triage: classify and prioritize emails so I see only what matters', 'Task prioritizer: pull open items from all my tools and rank them by urgency', 'PR watchlist: alert me when reviews are stalled or need my action']
    A (user-sim): Morning briefing sounds closest, but honestly what I really need is simpler — every morning I want yesterday's Stripe payouts pulled and added to my "Revenue" Google Sheet automatically. That's the one job.
**R1 [connectors]** Q: You have both Linear and ClickUp connected. Which do you actually use for tracking your work tasks?  · options: ['Linear only', 'ClickUp only', 'Both — they serve different purposes', 'Neither — I use something else']
    A (user-sim): ClickUp only.
**R1 [connectors#2]** Q: For calendar and meetings, which do you rely on?  · options: ['Google Calendar', 'Cal.com', 'Both', 'Neither']
    A (user-sim): Google Calendar, but honestly that's not really what this is about — my thing is just about Stripe payouts and a spreadsheet, no meetings involved.
**R1 [human-review]** Q: Should this persona ever take actions on your behalf automatically (e.g. reply to an email, post a Discord message, update a task status) — or always prepare a draft for you to approve first?  · options: ["Always prepare a draft — I'll confirm before anything is sent or changed", 'Routine low-risk actions (status updates, task moves) can run automatically; messages need approval', "Full autonomy — act without asking unless it's irreversible"]
    A (user-sim): Always prepare a draft — I'll confirm before anything is sent or changed. Honestly it's just adding rows to my Google Sheet, so nothing risky, but I'd like to check it's doing it right first.

## Final resolved persona (source: build_session+persona)
- capabilities (1):
  - **Daily Stripe Payout Sync** — tool_hints=[] trigger={'description': "Runs every morning at 07:00 to fetch yesterday's payouts before the workday starts", 'schedule': '0 7 * * *', 'timezone': 'user_local', 'type': 'cron'}
- required_connectors: ['stripe', 'google_sheets']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}