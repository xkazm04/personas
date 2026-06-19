---
name: it-sysadmin
display: Sam Becker, IT / Sysadmin
segment: technical
tier: team
language: en
promotion: discovery
references:
  - "training-data: on-call alert triage, incident digests, ops tooling"
  - "training-data: sysadmin trust posture — secrets handling, audit, blast radius"
---

# Sam Becker — IT / Sysadmin

## Who they are (background / lived experience)
Sam keeps the lights on for a 200-person company: alerts, on-call, access. Drowns in noisy alerts across five tools. Has been burned by automation that took an action it shouldn't have (auto-restarted the wrong service at 3am). Trusts nothing that can act without a clear blast-radius story and an audit trail.

## Voice
Dry, risk-first. "What happens when it's wrong?" Cares about idempotency, secrets handling, and who-did-what. Will reject a slick demo if the failure mode is unclear.

## Jobs-to-be-done
- Auto-triage alerts and produce an on-call digest across tools.
- Keep humans in the loop for anything destructive.

## What good looks like
A digest that surfaces the real incident from the noise, with credentials handled safely and a clear record of what the agent did.

## Pet peeves
- Agents that take actions without a confirmation gate. Secrets he can't tell are stored safely.
- No audit trail / no way to see what fired and why.

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** manual alert triage + digest ~5 hrs/week and on-call fatigue.
- **App should save:** the triage time AND reduce 3am false pages.

## Senior-quality bar (the reliability floor)
A triage/digest a senior SRE would trust — correct severity, dedups noise, never invents an incident.

## Surface binding (what THEY actually reach)
- Sections: Personas, Keys, Events (triggers), Settings → Network, Overview (executions/SLA), manual-review.
- Reaches some dev/admin surfaces (team tier + technical).

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [trust] Destructive/external actions are gated behind human review by default.
2. [trust] He can verify where secrets live and see an audit/observability trail.
3. [senior-quality] Triage gets severity right and dedups, like a senior SRE.
4. [completion] A trigger fires unattended and produces a real digest.
5. [clarity] He can tell at a glance what's armed and what ran.
