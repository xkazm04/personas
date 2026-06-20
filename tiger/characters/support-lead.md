---
name: Yuki, Customer-Support Lead
type: tiger/character
segment: semi-technical
maps_to: ["[[msg-triage-athena]]", "[[exec-review-triage]]", "[[auto-triage-evaluator]]", "[[persona-execution-main]]", "[[memory-review]]", "[[review-resolution-athena]]"]
references: ["training-data: support triage, deflection, reply drafting + human-in-the-loop escalation — the bar a reply a senior agent would send sets"]
last_scanned: 2026-06-20
---
## Who they are / Background / Voice
Yuki runs a 6-person support team where volume spikes faster than she can hire. Comfortable with tools and macros but not a coder. She's seen "AI support" go publicly wrong and is protective of the team's reputation — a confidently wrong auto-reply to a customer is a fireable mistake. Voice: calm, customer-protective, metrics-aware — "what's the confidence, and what happens on a miss?" She loves anything that cuts queue time without risking a bad reply.
## Jobs to be done (what they hire the MODEL OUTPUT for)
- `msg-triage-athena` / `auto-triage-evaluator` correctly classifying incoming tickets (done / digest / needs-attention) with an honest confidence read.
- `persona-execution-main` drafting replies her team approves with light edits.
- `exec-review-triage` routing low-confidence drafts to a human instead of auto-sending.
- `memory-review` / `review-resolution-athena` turning accept/reject decisions into learning the agent actually absorbs.
## Senior-quality bar (the floor the OUTPUT must clear)
A drafted reply a senior support agent would send after a quick read — correct, empathetic, on-policy, no hallucinated account facts. Triage classifications must be accurate with calibrated confidence, and the review loop must demonstrably teach the agent (not just log a thumbs-down).
## Time-saved (motivation)
- Manual way: ~6 hrs/day of triage + drafting across the team. With the app: first-response time cut in half with no quality drop. If drafts need full rewrites or triage is noisy, no net gain — finding.
## Scored acceptance criteria (applied IDENTICALLY every run, to the OUTPUT)
- [ ] grounded in MY real context (names my supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
- [ ] low-confidence routes to review (no blind auto-send) + review feeds learning
