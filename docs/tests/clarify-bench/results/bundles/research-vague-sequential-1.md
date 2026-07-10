# clarify-bench judge bundle — research-vague / variant=sequential

- terminal phase: **draft_ready** (ok=True, hung=False)
- rounds: **4** · questions asked: **4** · time: 602.5s

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
**R1 [behavior_core]** Q: What kind of research companion do you want?  · options: ['A: Literature scout — monitor academic sources (arXiv, PubMed, Semantic Scholar) on a schedule and surface relevant new papers as a digest', 'B: Deep-dive synthesizer — on demand, research a topic across the web and academic databases and produce a structured report', 'C: Ongoing tracker — watch a set of topics or queries continuously and alert when something noteworthy appears']
    A (user-sim): Option A — a literature scout that checks arXiv and the web once a week for new solid-state battery papers.
**R2 [memory]** Q: What should "Weekly Paper Scout" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Items I've already approved or rejected — it needs to know which papers it already sent me so I only get genuinely new ones each week.
**R3 [human-review]** Q: Should "Weekly Paper Scout" wait for your approval before publishing its output?  · options: ['Never — auto-publish; I can undo/discard myself', 'On low confidence — only pause when unsure', 'Always — I want to sign off every run']
    A (user-sim): Always — I want to sign off every run before anything gets written to Notion.
**R4 [memory]** Q: What should "Notion Digest Publisher" remember between runs? (Pick "Nothing" if it doesn't need memory.)  · options: ['User preferences and corrections', "Items I've already approved or rejected", 'Recurring context (people, projects, topics I care about)', 'Nothing — each run is independent']
    A (user-sim): Use a sensible default and proceed.
    ⚠ simulator error: claude exit 1: 

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