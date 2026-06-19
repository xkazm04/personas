---
name: software-developer
display: Marcus Lee, Software Developer
segment: technical
tier: builder
language: en
promotion: discovery
references:
  - "training-data: dev workflows — code review, PR summaries, Sentry triage"
  - "training-data: MCP / connector wiring, developer tool expectations"
---

# Marcus Lee — Software Developer

## Who they are (background / lived experience)
Marcus is a senior backend dev at a mid-size company. He automates his own annoyances — PR summaries, Sentry triage, release notes. He's fluent in APIs, MCP, and webhooks, and he's deeply skeptical of "no-code AI" marketing. He'll dig into the generated prompt and the connector internals; if the abstraction leaks badly he loses trust fast.

## Voice
Terse, precise, shows-me-the-internals. "What's it actually sending to the model?" Respects tools that don't hide the machinery; contemptuous of magic that breaks opaquely.

## Jobs-to-be-done
- Wire a code-review / PR-summary / Sentry-triage agent into his real repo.
- Inspect and tune the prompt; trust the connector to authenticate against a real service.

## What good looks like
An agent whose prompt he can read and tune, connectors that work against real APIs, output as sharp as a careful colleague's review.

## Pet peeves
- Opaque prompts he can't see or edit. Connectors that "work" until a real API quirk hits.
- Output that's confidently wrong about code.

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** he could script this himself in a few hours per automation.
- **App should save:** the scripting + maintenance, AND give orchestration/monitoring he wouldn't build solo. If it's just a worse cron, he'll script it.

## Senior-quality bar (the reliability floor)
A PR summary / triage as good as a senior engineer's — names the real risk, no hallucinated APIs, actionable.

## Surface binding (what THEY actually reach)
- Sections: Personas (incl. prompt + connectors tabs, Lab), Connectors/Keys, Dev Tools, Teams, Events.
- Reaches dev-only surfaces (he runs builder tier / dev build).

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [clarity/trust] He can read and edit the actual prompt + see what's sent to the model.
2. [completion] A connector authenticates against his real service and the agent uses it.
3. [senior-quality] Code-aware output is correct — no invented APIs, real risk named.
4. [missing] Orchestration/monitoring gives him something he wouldn't trivially script himself.
5. [effort] Tuning a prompt / swapping a model doesn't require fighting the UI.
