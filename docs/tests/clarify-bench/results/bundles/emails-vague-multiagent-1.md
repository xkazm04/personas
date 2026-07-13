# clarify-bench judge bundle — emails-vague / variant=multiagent

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **1** · questions asked: **3** · time: 173.12s

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
**R1 [use-cases]** Q: What should this bot actually do with your emails? Select all that apply.  · options: ['Triage & prioritize my inbox (surface what matters, flag urgent)', 'Draft replies for me to review and send', 'Send a daily digest of important messages', 'Auto-label or organize emails into folders']
    A (user-sim): Triage & prioritize my inbox, and draft replies for me to review — plus auto-labeling the urgent ones would be great. No daily digest needed.
**R1 [connectors]** Q: Which email provider should it connect to, and which account or inbox — all your mail, or a specific address?  · options: ['Gmail (all mail)', 'Gmail (specific label or inbox only)', 'Outlook / Microsoft 365', 'Other']
    A (user-sim): Gmail — just one specific address, our support inbox. Not my personal mail.
**R1 [human-review]** Q: If it drafts a reply, should it ever send the email on your behalf automatically, or always prepare a draft for you to review first?  · options: ["Always prepare a draft — I'll send it myself", 'Send automatically for routine replies, draft for anything important', 'Send automatically for all replies']
    A (user-sim): Always prepare a draft — I'll send it myself. Nothing goes out without me reviewing it first.

## Final resolved persona (source: build_session+persona)
- capabilities (2):
  - **Inbox Triage & Labeling** — tool_hints=[] trigger={'description': 'Fires when a new message lands in the designated Gmail support inbox via Gmail API push notification (Pub/Sub). Also supports manual trigger by passing a message_id directly for re-triage.', 'event': 'message.received', 'source': 'gmail', 'type': 'event'}
  - **Draft Reply Preparation** — tool_hints=['gmail.drafts.create', 'gmail.threads.get', 'gmail.messages.get'] trigger={'description': 'Fires immediately after uc_inbox_triage classifies and labels an inbound email, receiving the triage card as input.', 'event': 'email.triaged', 'source': 'uc_inbox_triage', 'type': 'event'}
- required_connectors: ['gmail']

## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)
- **asked_before_assuming** (weight 2.0): For EACH dimension in must_clarify, did the build ASK a question targeting it (present in the transcript) rather than silently assuming a value? Score down one step per must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.
- **no_wrong_assumptions** (weight 1.5): Did the final design AVOID baking in any value listed in must_not_assume that the user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.
- **question_quality** (weight 1.5): Were the questions clear, relevant, and well-scoped — offering sensible options or competing directions where useful, non-redundant, and not asking for things already stated in the intent? Penalise vague, duplicate, or leading questions.
- **convergence** (weight 2.0): Does the FINAL resolved persona (capabilities + connectors + triggers) match the hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or invented scope.
- **efficiency_round_cap** (weight 1.5): Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated or exceeded the round cap scores 0-1 here.

Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}