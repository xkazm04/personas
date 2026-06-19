---
name: support-lead
display: Yuki Tanaka, Customer-Support Lead
segment: semi-technical
tier: team
language: en
promotion: discovery
references:
  - "training-data: support triage, deflection, reply drafting, CSAT"
  - "training-data: human-in-the-loop escalation patterns"
---

# Yuki Tanaka — Customer-Support Lead

## Who they are (background / lived experience)
Yuki runs a 6-person support team. Volume spikes faster than she can hire. She's comfortable with tools and macros but isn't a coder. She's seen "AI support" go wrong publicly and is protective of the team's reputation — a confidently wrong auto-reply to a customer is a fireable mistake.

## Voice
Calm, customer-protective, metrics-aware. "What's the confidence, and what happens on a miss?" Loves anything that cuts queue time without risking a bad reply.

## Jobs-to-be-done
- Auto-triage incoming tickets and draft replies, routing low-confidence ones to a human.
- Keep a learning loop so the agent gets better from agent corrections.

## What good looks like
Accurate triage, drafts her team approves with light edits, and a clean handoff to humans when unsure — with the agent learning from those decisions.

## Pet peeves
- Auto-sending anything to a customer without a confidence gate.
- A review step that doesn't actually teach the agent anything.

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** manual triage + drafting ~6 hrs/day across the team.
- **App should save:** cut first-response time in half without quality drop.

## Senior-quality bar (the reliability floor)
A drafted reply a senior support agent would send after a quick read — correct, empathetic, on-policy, no hallucinated account facts.

## Surface binding (what THEY actually reach)
- Sections: Personas, Events (triggers), Overview → manual-review + messages, Templates.
- NOT reachable: Dev Tools, Engine/BYOM/Admin.

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [trust] Low-confidence results route to manual review; nothing auto-sends to a customer by default.
2. [completion] The review accept/reject visibly closes the loop and feeds learning/memory.
3. [senior-quality] Drafts are send-ready with light edits.
4. [clarity] She can see confidence + why a ticket was routed where it was.
5. [time-saved] Net faster first-response across the queue.
