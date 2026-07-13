# clarify-bench judge bundle — emails-vague / variant=sequential

- terminal phase: **draft_ready** (ok=False, hung=True)
- rounds: **5** · questions asked: **5** · time: 900.58s

## Vague intent the user typed
```
make me a bot that helps with my emails
```

## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)
```
I run customer support out of a Gmail inbox. I want it to read incoming support emails, summarise each one, label the urgent ones, and draft a reply for the top few — but I always want to review before anything is sent. Nothing auto-sends. I don't want it touching my personal email, just the support address.
```

## Expectations
- **must_clarify** (should ASK about each): ['which email provider / account (Gmail vs Outlook vs other)', 'what kind of help (summarise / triage / draft replies / auto-send)', 'whether replies auto-send or need human review', 'which inbox / scope (support vs personal)']
- **must_not_assume** (must NOT bake in unasked): ['auto-sending replies without review', 'a specific provider (e.g. assuming Gmail) without asking', 'touching all inboxes rather than a scoped one']

## Q&A transcript (what the build actually asked, in order)
**R1 [behavior_core]** Q: What kind of email companion do you want?  · options: ['A: Daily briefing — scan my inbox once a day and surface what matters in a ranked digest', 'B: Real-time triage — watch for new messages and alert me the moment something urgent arrives', 'C: Interactive assistant — I ask it questions about my inbox on demand (search, summarize threads, draft replies)']
    A (user-sim): A daily briefing â€” one scan a day over the support inbox is enough for me.
**R2 [memory]** Q: What should "Thread Deep-Dive" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Recurring context â€” the people and topics that keep coming up, so it recognises repeat customers and ongoing issues.
**R3 [human-review]** Q: Should "Daily Support Digest" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Always â€” I want to sign off every run. Nothing goes out without me reading it first.
**R4 [connectors]** Q: Which storage connector should "Daily Support Digest" use?
    A (user-sim): Google Drive â€” the digest should land as a doc in the same Drive folder as our support notes.
**R5 [triggers]** Q: How should "Daily Support Digest" fire?  · options: ["A: On demand — I'll trigger it manually", 'B: On a schedule (daily/weekly/…)', 'C: When an external event occurs (e.g. new document, inbound message)']
    A (user-sim): B â€” on a schedule, once every weekday morning so I can go through the digest with my coffee.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **Daily Support Digest** — tool_hints=['gmail_search', 'google_drive_write', 'text_analysis', 'ai_generation'] trigger={'config': {'cron': '0 {{param.digest_hour}} * * 1-5', 'timezone': 'America/New_York'}, 'description': 'Every weekday (Mon–Fri) at {{param.digest_hour}}:00 local time', 'trigger_type': 'schedule'}
  - **Thread Deep-Dive** — tool_hints=['gmail_search', 'text_analysis'] trigger={'config': {}, 'description': 'On demand — user supplies a thread identifier or subject keyword and requests a summary.', 'trigger_type': 'manual'}
- required_connectors: []

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}