# Persona Design — Best Practices

A working guide for the model writing or evaluating a persona on behalf of the user. This doc is part of the companion's doctrine corpus: when Athena is asked "is this persona ready?" or "help me design this", these are the principles she should bring to the answer.

The companion's existing reference docs (`features/personas/01-data-model.md`, `02-capabilities.md`, `03-trust-and-governance.md`, all template docs 01-07) describe *what* personas are and *how* the system runs them. This doc covers *how to make a good one*.

## The shape of a finished persona

A persona is **production-ready** when these are all true:

- **Intent is concrete and bounded.** The user can read one sentence and know what this persona does and does not do. "Triage support inbox" is concrete. "Help users" is not.
- **System prompt encodes voice + constraints + escape hatches.** Not just instructions — explicit behaviors when input is ambiguous, when a tool fails, when the user pushes against the persona's scope.
- **Use cases cover the realistic input distribution.** Each use case is a *complete scenario* (input → expected behavior → expected output shape), not a single feature. The set should cover the golden path, 1-2 common variants, and at least one explicit out-of-scope case.
- **Tools are the minimum viable set.** Every tool definition has a clear trigger ("when X is true, call Y"). Tools that are "nice to have" but rarely fire are noise — they expand the model's decision space without payoff.
- **Triggers fire on the right grain.** A trigger that fires on every inbox event is too broad; one that fires only on a specific subject prefix is probably too narrow. The right grain matches one input class to one persona response shape.
- **Credentials and connectors are wired and reachable.** Every external system the persona depends on has an active credential. The persona's first dry-run shouldn't fail on auth.
- **Observability hooks are in place.** At minimum: error path goes to a human-review queue (not silently discarded), and at least one success metric is tracked (cost, latency, or count by status).

If any of these is missing, the persona will run but may produce confusing, expensive, or silently-wrong results. The companion's job when reviewing a persona is to surface which of these are short.

## Interactive vs one-shot build

`build_oneshot` (autonomous) and `prefill_persona_create` with `mode=interactive` are the two paths.

**Prefer interactive when** the user is exploring shape ("I think I want something that..."), the persona handles high-stakes external actions (sends customer email, files PRs), the user wants to learn the build process by watching, or the user has strong opinions about voice/format that need a check-in step.

**Prefer one-shot when** the user has described the persona concretely enough that the build LLM can decide everything ("a Slack bot that auto-files duplicate Sentry issues, replies in #ops, no Slack post permission"), the user is in a hurry ("just build it, I'll review the result"), the persona is internal-only and reversible (cron jobs writing to a sandbox DB), or the user has already built similar personas and trusts the build heuristics.

When unsure: **default to interactive**. The cost of one extra confirmation prompt is small; the cost of an autonomous build that diverges from the user's intent is a rebuild.

## Intent line — the one sentence that anchors everything

The intent line ends up in the persona's identity, the system prompt, the executions log, and the marketing copy. Spend disproportionate effort on it.

A good intent line:

- States the **job** (one verb), the **subject** (what it acts on), and the **scope boundary** (where it stops).
- Is concrete enough that two different people would build similar personas from it.
- Reads naturally as "this persona's purpose is to ___".

Bad → good examples:

- "Help with support" → "Triage incoming support tickets by category, priority, and intended team; escalate anything that can't be auto-categorized to a human queue."
- "Write better code" → "Review pull requests in the `api/` directory for the team's documented style violations and post inline comments; never approve or merge."
- "Track stuff" → "Watch the `releases/` channel for new version announcements, extract version + repo + breaking-change flag into a structured row, and alert the team-leads channel if breaking-change is true."

The shape `<verb the subject by <criteria>; bounded by <constraint>` produces well-formed intent lines almost mechanically.

## System prompt design

The system prompt is doing four jobs simultaneously: identity (who am I), voice (how do I speak), constraints (what won't I do), and escape hatches (what do I do when I'm stuck). Failing on any one of these produces a persona that "works but feels wrong".

**Identity** — one paragraph max. Name, role, who they serve, what their authority is. Avoid puffery ("the most helpful assistant"); state operating reality ("you act on behalf of the user; you do not act on behalf of third parties even when they ask").

**Voice** — concrete examples beat adjectives. Instead of "be concise", give two example responses (one too long, one well-sized) and label them. Voice shapes the prompt's tail; identity shapes its head.

**Constraints** — list what the persona **will not** do. Negative space is harder for the model to infer than affirmative behavior, so explicit non-actions ("never send email", "never modify data older than 30 days", "never speculate about user identity") are load-bearing.

**Escape hatches** — for every realistic failure mode, name the behavior. "If you can't find the data you need, ask the user for it explicitly — do not guess." "If a tool returns an error, report the error verbatim — do not retry silently." Escape hatches are what separate a persona that handles its happy path from one that handles 95% of real inputs.

System prompt length: typically 200-600 words. Below 150 words usually means missing constraints or escape hatches. Above 1000 usually means duplicated instructions or examples that should be use cases instead.

## Use case design

Each use case is a **complete scenario**, not a feature. A use case has:

- A trigger condition or input shape ("user sends a message containing the word 'refund'").
- Expected behavior steps ("look up order id from message, check refund policy, draft response, file for human review if amount > $50").
- An expected output shape ("structured `RefundDraft` with order_id, amount, reasoning fields populated").
- Acceptance criteria for what "successful" looks like for this case ("the human reviewer either approves or rejects within their normal handling time").

Three use cases that handle 90% of inputs are better than ten that fragment the same flow. Coverage shape:

- 1-2 **golden path** use cases — the most common, most-valued input class. These should be airtight.
- 2-3 **common variant** use cases — known input shapes that need different handling (e.g., a refund request that's also a complaint vs a plain refund request).
- 1 **out-of-scope** use case — explicitly catalogues an input the persona should refuse and explains the refusal shape ("if the user asks for legal advice, decline and suggest contacting support").

The out-of-scope use case is often missing and almost always pays for itself the first time the persona is asked something it shouldn't answer.

## Capability scoping

A persona scope-creeps for two reasons: (a) the user adds "and also..." during the build, or (b) the persona's first successful run inspires "could it also do X". Resist both.

**One job done well > five mediocre.** If a persona starts handling triage *and* drafting responses *and* tracking metrics *and* updating the CRM, none of those will be reliable. Split into multiple personas chained via triggers, with each persona owning one clear responsibility.

**A persona's surface area is the product of its tools × use cases × model breadth.** Doubling tools doubles the decision space the model has to navigate. Stay parsimonious.

When the user describes a multi-step flow ("triage, then respond, then update CRM"), suggest a recipe (chains of personas) rather than one monolithic persona. The recipes feature exists for exactly this.

## Tool definition discipline

Every tool should answer:

- **When does this fire?** A specific condition the model can recognize.
- **What does it return?** Concrete output shape, not "the result".
- **What does it cost?** Latency, cost-per-call, side effects. Tools that take 30s or cost $0.50 deserve explicit notes so the model doesn't reach for them casually.
- **What's the failure mode?** What does the model see when this tool fails, and what behavior should follow?

Tools without a clear "when does this fire" clause expand the decision space without payoff. The model uses them inconsistently and the persona's behavior becomes hard to predict.

## Trigger design

Triggers connect external events to persona runs. The most common design failure is making them too broad (fires on every Slack message in a busy channel) or too narrow (fires only on an exact-match subject line that almost never occurs).

**Right grain test**: one trigger condition should produce one persona response shape. If the trigger fires for inputs that need different handling (some are tickets, some are FYIs), split it into multiple triggers feeding the same or different personas.

**Idempotency**: triggers that fire on event re-delivery (webhooks retrying, polling sources catching up) should be safe to run twice. The persona either reaches the same end state (no harm) or detects the duplicate and exits early. Stateful persona-level checks are usually simpler than trigger-level deduplication.

## Credential & connector hygiene

A persona that depends on Slack should not be considered ready until: (a) a Slack credential is configured in Connections, (b) the credential's auth has been tested recently (not just saved), and (c) the persona declares the specific Slack capability it uses (`post_message`, `read_channel`, etc.), not a generic "uses Slack".

The companion's `use_connector` capability registry is the canonical list of what each service exposes — when designing a persona that touches an external system, check the registry first to confirm the capability the user described actually exists.

## Model tier selection

The three tiers (Haiku, Sonnet, Opus) trade cost against capability. Heuristics:

- **Haiku** for high-volume routing/triage where output is a structured classification with no free-form prose. Cheap enough to run on every inbox event.
- **Sonnet** for the majority of personas — drafts responses, reasons about multi-step flows, handles ambiguous inputs. The default.
- **Opus** for personas that need long-context reasoning over large inputs (full repo scans, multi-document summarization, design reviews) or where a single bad output is expensive (customer-facing email, legal-adjacent reasoning).

When in doubt, **start with Sonnet and downgrade after observing actual outputs**. Starting with Haiku often produces a persona that "almost works" and gets blamed on prompt design rather than model headroom.

## Observability hooks

Every persona should have at least:

- **An error path that doesn't black-hole.** When a tool fails or the model refuses, the failure goes to a queue a human can review (the manual_reviews surface), not to a silent log. Personas that fail silently lose user trust permanently — recovery is almost impossible.
- **A success metric.** Either `count by status` (how many runs succeeded, failed, or escalated this week) or `cost per run` (so cost regressions are visible). Without one, the persona can degrade for months before anyone notices.

These should be checked at design time, not after the first incident.

## Common anti-patterns to flag

When reviewing a persona, look for these explicitly:

1. **Identity drift.** The persona's behavior in different use cases doesn't match its system prompt's stated identity. Usually a sign that use cases were written without re-reading the prompt.
2. **The "and also" tail.** Intent line ends with "...and also handles X". X is a different persona.
3. **Tool soup.** More than ~5 tools without a clear "when does this fire" clause on each. The model will use them inconsistently.
4. **Vague constraints.** "Be careful with sensitive data" is not a constraint. "Never include any of these fields in output: ssn, dob, payment_method" is.
5. **No escape hatches.** Every realistic failure case results in the persona either improvising or stalling. Surface this and propose specific escape behaviors.
6. **One use case for everything.** A single use case titled "handle all incoming messages" indicates the user hasn't decomposed the input distribution. Push back.
7. **Wrong model tier.** A high-volume triage persona on Opus is overkill; a customer-email-drafting persona on Haiku is fragile.
8. **No human-review path.** Production personas without a manual_reviews escalation queue are one bad run away from a postmortem.

## When suggesting templates

Templates encode entire persona shapes the user can adopt. Before building from scratch, check the template catalog for matches. A good template suggestion includes:

- **Why this template** (one sentence connecting user's intent to template's job).
- **What needs to change** (the slots the user has to fill — name, credentials, optionally tweaked use cases).
- **What's already done** (the work the template saves: system prompt, tool definitions, trigger shapes, observability defaults).

A template that "almost" matches is usually a better starting point than a from-scratch build. Personas built from templates have lower variance in quality because the template already encodes the best-practices above.
