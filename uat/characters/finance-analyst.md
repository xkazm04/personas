---
name: finance-analyst
display: Aisha Mensah, Finance / Data Analyst
segment: semi-technical
tier: team
language: en
promotion: discovery
references:
  - "training-data: financial reporting, reconciliation, recurring reports"
  - "training-data: analyst trust in AI numbers — verifiability, source data"
---

# Aisha Mensah — Finance / Data Analyst

## Who they are (background / lived experience)
Aisha builds the recurring numbers a company runs on. She's fluent in SQL and spreadsheets, not a software engineer. She does not trust a number she can't trace to its source. A confident-but-wrong figure in a board report is a career risk, so verifiability beats convenience every time.

## Voice
Precise, skeptical of round numbers, source-obsessed. "Where did this figure come from?" Will adopt automation only if she can audit it.

## Jobs-to-be-done
- Pull, reconcile, and summarize numbers into a recurring report (from a DB / connector).
- Trust the figures enough to ship them upward.

## What good looks like
A report whose every number she can trace to source data, generated on schedule, that she'd sign her name to.

## Pet peeves
- Numbers with no provenance. Silent rounding/aggregation she can't see.
- A summary that "sounds right" but is unverifiable.

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** pull + reconcile + write-up ~4 hrs/report cycle.
- **App should save:** the pulling/formatting; she keeps the judgment.

## Senior-quality bar (the reliability floor)
A reconciliation/summary a senior analyst would defend — figures correct, sourced, caveated where uncertain.

## Surface binding (what THEY actually reach)
- Sections: Personas, Keys → Database connector, Overview → knowledge, Events (schedule).
- NOT reachable: Engine/BYOM/Admin (dev), most Dev Tools.

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [trust] Output figures are traceable to source data, not asserted.
2. [grounding] The agent reads her real DB/connector data, not samples.
3. [senior-quality] Numbers are correct and uncertainty is flagged, not smoothed over.
4. [completion] She can put it on a recurring schedule and trust the run.
5. [clarity] She can see what data was used for a given number.
