---
id: build-persona-from-intent
title: Build a working Persona from a one-line intent
promotion: discovery
primary_contexts: [agent-design-wizard, persona-management, agent-editor, build-test-tooling]
surfaces: [personas]
relevant_characters: [solo-founder, content-marketer, software-developer, smallbiz-owner, sales-rep, non-english-user]
---

## Goal (user POV)
"I describe what I want in plain language and get a working agent that actually does it — without learning the tool first."

## Definition of done (the user's, not the code's)
- I typed an intent, the build asked me only what it genuinely needed, and I ended with a Persona I'd actually trust to run.
- The generated prompt/config reads like something a competent person made for *my* job — not a generic template.
- I understand what it will do before I let it loose.

## What L1 must check
- The intent → build-session → questions → finalized-persona path has no dead-ends.
- Grounding audit: does the build prompt receive my real context, or generate from the thin intent alone?
- Reachability: is this the same for a Starter-tier / non-dev user?

## What L2 must confirm (l2_priority)
- The *actual quality* of the generated prompt + use-cases against the Character's senior bar.
- How many questions, how long the build takes (time-saved), and whether an early timeout bites.
- For a non-English Character: is the build experience localized?
