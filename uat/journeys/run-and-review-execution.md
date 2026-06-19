---
id: run-and-review-execution
title: Run an agent, read the result, handle a review
promotion: discovery
primary_contexts: [execution-runner, execution-monitoring, overview-analytics, memory-messages, healing-engine]
surfaces: [personas, overview]
relevant_characters: [support-lead, finance-analyst, it-sysadmin, software-developer, hobbyist-power]
---

## Goal (user POV)
"I run it, I see what it did, and when it's unsure it asks me instead of guessing — and learns from my answer."

## Definition of done
- I executed a Persona, found its output without hunting, and could tell success from failure.
- A low-confidence result routed to manual review; my accept/reject was respected and (ideally) remembered.

## What L1 must check
- Execute → output → history → manual-review path; is the output legible and trustworthy?
- Does an accept/reject decision actually feed memory / resume a loop, or dead-end?

## What L2 must confirm (l2_priority)
- The *actual output quality* of a real run against the senior bar.
- Latency reality (30–215s) and whether the UI communicates progress vs. hangs.
- That a manual-review decision visibly closes the loop.
