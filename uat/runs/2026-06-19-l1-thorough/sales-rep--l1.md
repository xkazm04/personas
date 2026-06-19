# Tomás Herrera — Sales Rep / SDR — L1 report

**Level:** L1 (theoretical, code-grounded). No live app. Read-only walk of a code-derived surface model.
**Character:** `sales-rep` (Tomás Herrera) — non-technical SDR, **Starter** tier, English. Edge = personalized outreach; a fabricated prospect fact is instant credibility death; measures everything in reply rate + time-per-account.
**Surface binding:** Personas, Templates, Keys. NOT reachable: Dev Tools, Engine/BYOM/Admin, Teams.
**Date:** 2026-06-19.

Tomás's binding criteria (applied identically): (1) draft references something true+specific, **zero fabricated facts**; (2) the agent **really researches** the account, not a template fill; (3) per-account **time drops** materially; (4) **send-ready** without a config maze; (5) he'd **put his name on it**.

---

## Journey 1 — Build a working Persona from a one-line intent

**Verdict: `L1-conditional`** (structurally complete and reachable for Starter; one major grounding/trust defect — the unconditional fabrication clause — pollutes his make-or-break criterion).

### Surface walk (affordance → handler → command → engine/prompt)

1. **Personas → "Summon agent"** — intent box + launch button. `agent-launch-btn` lives in `src/features/agents/sub_glyph/commandPanel/CommandPanelFooter.tsx:57`; the build-from-intent compose surface is `src/features/agents/sub_glyph/GlyphPrototypeLayout.tsx` (the only file wiring `agent-intent-input`/launch). Reachable for a non-technical Starter user — no tier wall on the create path (no persona-count cap or tier gate in `src-tauri/src/commands/core/personas.rs`; the only `tier` references there are model-tier resolution at `personas.rs:672,684`, not a creation gate).
2. **Launch → build session.** `BuildSession::start` in `src-tauri/src/engine/build_session/mod.rs` accepts `mode` = `interactive` (ask-the-user) or `one_shot` (autonomous; `mod.rs:113,148,157`). Both modes assemble the **same** system prompt via `build_session_prompt(...)` (`mod.rs:33,258-265`).
3. **The build prompt** = `src-tauri/src/engine/build_session/session_prompt.rs::build_session_prompt` (`session_prompt.rs:32`). Inputs: `intent`, `credentials`, `connectors`, `template_context`, `language`, `one_shot` (`session_prompt.rs:33-38`). **No real account data is passed** — and that is correct: the build designs the persona *config*, not a live outreach. The persona's questionnaire is genuinely thorough — Rule 16 (`session_prompt.rs:399-429`) forces per-capability `source → process → destination + trigger + review_policy + memory_policy` clarifying questions ("It is CHEAPER for the user to answer a question than to rebuild a wrong persona"). For Tomás this means the build asks him what he actually needs — no dead-ends in intent → questions → `agent_ir`.
4. **Real-research grounding (runtime).** The decisive enabler: **web research is wired universally at execution time, credential-free.** `src-tauri/src/engine/prompt/mod.rs:651-667` injects a "## Web Research" block into *every* persona's runtime prompt: "You run on an Anthropic model with built-in web access… use the native **WebSearch** and **WebFetch** tools directly — they need no credentials and are always available." So Tomás's generated SDR persona **can** research a real account with zero setup. This is the single biggest thing in his favor and it is structurally present, not aspirational.

### The make-or-break finding (his worst nightmare, confirmed in code)

**Rule 7 (`session_prompt.rs:389`) is an UNCONDITIONAL fabrication mandate baked into every generated persona's `system_prompt`:**

> "CRITICAL: If any required service (e.g., Gmail, database) is not accessible or returns auth errors, you MUST **generate realistic sample data and continue** the FULL workflow … NEVER stop or report 'blocked'. The workflow must complete end-to-end with sample data."

This is not gated by domain, tier, or capability — it is injected for both interactive and one_shot builds (same `build_session_prompt`). For an email-triage demo this is a harmless "don't hang on a missing connector" affordance. For **Tomás**, whose entire value proposition is *true + specific* facts about a prospect, a persona instructed to invent "realistic sample data" on any service hiccup is a credibility landmine: the one run where an enrichment lookup or a page fetch comes back thin, the agent is told to **fabricate** the prospect's funding stage / tech stack / recent news and present it as real, in a draft with his name on it. This directly fails his criterion #1 (zero fabricated facts) and #5 (he'd put his name on it).

Mitigating nuance (why conditional, not fail): the runtime web-research path (`prompt/mod.rs:651`) is credential-free and "always available," so for a *pure web-research* SDR persona the Rule-7 trigger ("service not accessible / auth errors") shouldn't normally fire — WebSearch has no auth to fail. The fabrication clause is most dangerous on enrichment-API / Sheets / messaging paths, which a non-technical Starter user is less likely to wire anyway. But the instruction sits in his prompt regardless, and "search returned little" is exactly the kind of soft failure an LLM may rationalize into "generate realistic sample data." **The risk is real and structural; the blast radius depends on runtime behavior an L1 walk cannot measure → tagged `l2_priority`.**

### Rubric scoring (Journey 1)

| Dim | Score | Evidence |
|---|---|---|
| completion | pass | Intent → questions → `agent_ir` path is whole; reachable for Starter. |
| effort | partial | Thorough clarifying questions are good for quality but add turns; L2 must time it. |
| clarity | pass | Per-dimension questions tell him what he's deciding. |
| trust | **fail** | Rule 7 tells his persona to fabricate prospect facts on any service failure (`session_prompt.rs:389`). |
| missing | pass | Web research capability is present by default (`prompt/mod.rs:651-667`). |
| time-saved | partial | Plausible (research automated), but actual per-account time is `l2_priority`. |
| senior-quality | partial | Prompt *bans* generic openers in good templates, but the global fabrication clause undercuts the senior bar. |

---

## Journey 2 — Find and adopt a template into a working automation

**Verdict: `L1-conditional`** (a job-matched, anti-fabrication SDR template exists AND one zero-credential path exists; but the best-fit "personalized outbound" templates gate behind OAuth/API-key walls a non-technical Starter user can't clear, and the same Rule-7 fabrication clause rides along on the generated prompt).

### Surface walk

1. **Templates gallery is reachable** (`navigate("design-reviews")`) and is **not subscription-gated** for Starter: the gallery card's `tier` field is a *readiness* label (`readinessTier(readinessScore)` in `src/features/templates/sub_generated/gallery/cards/useTemplateCardData.ts:3,74`), not a paywall.
2. **A dedicated `sales` template category exists** (`scripts/templates/sales/`, 12 templates) — the gallery is legible to a non-technical user by job category. Strong match candidates for Tomás:
   - `outbound-sales-intelligence-pipeline.json` — verbatim his job: "Replace manual SDR research — turn raw prospect rows into verified, enriched, AI-analysed, outreach-ready dossiers with personalised drafts." Its principles **explicitly ban fabrication**: "Cold drafts must cite specifics — generic templates are banned" (`:38`); voice: "Every draft cites specific facts from enrichment… Never generic flattery" (`:30`). Excellent alignment with his bar — **on paper.**
   - `sales-proposal-generator.json` — "researches prospect companies via web intelligence"; tools include `web_search`.
   - `personality-enriched-sales-prep.json`, `local-business-lead-prospector.json`.
3. **Adoption flow has a real 3-state eligibility model and a typed credential blocker** — it does not silently dump him into a half-configured agent. `src/features/templates/sub_recipes/eligibility.ts:30-49` resolves `eligible | adoptable-with-setup | incompatible`, and `QuestionnaireBlockedCredentialCta.tsx` replaces the input with an explicit "credentials required → add credential" CTA when the vault category is empty. This satisfies the journey's "clearly tells me the one thing left to wire" — a genuine strength.

### The adoption-wall finding (the catch for a non-technical Starter SDR)

The best-matched personalized-outbound templates require connectors he cannot realistically wire:

- `outbound-sales-intelligence-pipeline.json` declares **three `required: true` connectors**: a CRM enrichment provider needing **two API keys** (Hunter + Clearbit, `:67-94`), **Google Sheets via OAuth2** needing client_id + client_secret + a hand-obtained **refresh_token** + spreadsheet_id (`:96-138`), and a **messaging bot token** (`:140-165`). The Sheets refresh-token dance (Cloud Console → OAuth client → consent flow) is a developer task; for a non-technical SDR it is precisely the "config maze" his criterion #4 forbids. Same wall on `personality-enriched-sales-prep` (calendar + email OAuth + knowledge_base API key + messaging) and `sales-proposal-generator` (CRM api_key + knowledge_base api_key).
- **The one clean path:** `local-business-lead-prospector.json` requires a **single** connector — `personas_database` with `auth=builtin` (no credential) — and uses the free built-in `web_search` tool. This is the only sales template a non-technical Starter user can adopt and run with **zero** credential setup. But it does lead *discovery* (find local businesses with weak web presence), not personalized 1:1 outreach to a named prospect — a **partial** fit for Tomás's exact job.

So the honest L1 read: a perfectly-aligned, anti-fabrication SDR template exists, and a zero-config research template exists, but **they are not the same template.** The template that nails his job needs a credential wall; the template he can clear without help only does the adjacent job. He completes *a* job, not necessarily *his* job, without help.

### Rubric scoring (Journey 2)

| Dim | Score | Evidence |
|---|---|---|
| completion | partial | Adoptable end-to-end only via `local-business-lead-prospector` (zero-cred); the exact-fit outbound templates wall on credentials. |
| effort | partial | 3-state eligibility + blocked-credential CTA reduce confusion, but OAuth refresh-token setup is high-effort for a non-dev. |
| clarity | pass | `eligibility.ts` + `QuestionnaireBlockedCredentialCta` make the missing piece explicit, not silent. |
| trust | partial | Templates ban generic openers (`outbound:38`), but Rule-7 fabrication clause still rides on the generated prompt. |
| missing | pass | A job-matched SDR template AND a zero-credential web-research template both exist. |
| time-saved | partial | Real once wired; the wiring (OAuth) may cost more than it saves on the best template (`l2_priority`). |
| senior-quality | partial | Template authoring is senior-grade (cite-specifics discipline); fabrication clause is the dissonant note. |

---

## Findings

### F1 — `blocker`-adjacent `major` / `trust` / `quality-gap` — Unconditional "generate realistic sample data" mandate in every generated persona prompt
- **file:line:** `src-tauri/src/engine/build_session/session_prompt.rs:389` (Rule 7), injected via `build_session_prompt` → `mod.rs:258` for BOTH interactive and one_shot builds.
- **What:** Every generated `agent_ir.system_prompt` is required to contain: "If any required service … is not accessible or returns auth errors, you MUST generate realistic sample data and continue … NEVER stop or report 'blocked'." No domain/tier/capability carve-out.
- **Why it matters for Tomás:** A fabricated prospect fact is "instant credibility death" (his file, line 29). An outreach persona told to invent realistic data on a soft failure can produce a confident, specific-sounding, **false** hook that he sends under his own name. Fails criteria #1 and #5.
- **code_check:** `confirmed-absent` (of any guard) — verified the clause is unconditional and shared across build modes; no sales/research exception.
- **L2 (`l2_priority`):** Does the clause actually fire for a web-research-only SDR persona (WebSearch is credential-free, so "auth errors" shouldn't occur), or does the model rationalize thin search results into fabricated data? Measuring real fabrication frequency requires a live run.
- **Suggested fix direction (for maintainers, not this run):** Scope Rule 7 to demo/test builds, or replace "generate realistic sample data" with "clearly label any unavailable field as UNKNOWN and never invent prospect facts" for research/sales/outreach intents.

### F2 — `major` / `broken-flow` (effort) — Best-fit outbound templates wall behind dev-grade credentials
- **file:line:** `scripts/templates/sales/outbound-sales-intelligence-pipeline.json:67-165` (three `required:true` connectors: Hunter+Clearbit API keys, Google Sheets OAuth2 refresh-token flow, messaging bot token). Same shape in `personality-enriched-sales-prep.json` and `sales-proposal-generator.json`.
- **Why it matters:** A non-technical Starter SDR cannot realistically complete an OAuth refresh-token setup. The template that perfectly matches his job is the one he most needs help to wire — his criterion #4 (send-ready without a config maze) fails on the exact-fit template.
- **code_check:** `confirmed` — connectors are `required:true`; adoption surfaces the blocked-credential CTA (`QuestionnaireBlockedCredentialCta.tsx`) rather than failing silently, but it still asks him to wire what he can't.
- **L2 (`l2_priority`):** Time from "browsing" to "first successful run" for each sales template on a Starter fixture; whether the quick-add credential flow can complete a Google OAuth without leaving the app.

### F3 — `minor` / `missing` (job-fit gap) — The zero-config sales template does the adjacent job
- **file:line:** `scripts/templates/sales/local-business-lead-prospector.json` (single `personas_database` builtin connector + `web_search`).
- **Why it matters:** It's the only sales template adoptable with zero credentials, but it's lead *discovery*, not personalized outreach to a named prospect. Tomás gets a runnable agent without help — just not the one for his exact JTBD.
- **code_check:** `present-but-missed` — the capability (zero-cred web-research SDR persona) exists; a *personalized-outreach* variant at the same zero-cred bar does not.

### F4 — STRENGTH — Universal, credential-free web research at runtime
- **file:line:** `src-tauri/src/engine/prompt/mod.rs:651-667`.
- **What:** Every persona's runtime prompt gets native WebSearch/WebFetch, "no credentials … always available." This is the structural foundation that lets a non-technical Starter SDR's agent do real account research with zero setup. Do NOT regress this.

### F5 — STRENGTH — Build wizard forces per-dimension clarifying questions (anti-template-fill)
- **file:line:** `session_prompt.rs:399-429` (Rule 16 a–e). The build decomposes each capability into source/process/destination/trigger/review/memory and asks rather than assumes — directly counters the "thin intent → generic persona" failure mode the grounding audit targets.

### F6 — STRENGTH — Adoption surfaces missing connectors explicitly (no silent half-config)
- **file:line:** `src/features/templates/sub_recipes/eligibility.ts:30-49` + `QuestionnaireBlockedCredentialCta.tsx`. Satisfies the journey DoD "clearly tells me the one thing left to wire."

---

## What passed

- **Reachability:** Build-from-intent and template adoption are both reachable for a non-technical **Starter** user — no subscription/tier wall on persona creation or gallery adoption (`personas.rs` has no count cap; gallery `tier` is a readiness label, not a paywall).
- **Real research is wired by default** at execution time, credential-free (`prompt/mod.rs:651-667`) — the single most important enabler for Tomás's job is structurally present.
- **No dead-ends** in the intent → build-session → questions → `agent_ir` path; the wizard asks what it genuinely needs (Rule 16).
- **A job-matched, fabrication-banning SDR template exists** (`outbound-sales-intelligence-pipeline.json`) and a **zero-credential web-research sales template exists** (`local-business-lead-prospector.json`).
- **Adoption fails loud, not silent** — typed credential blockers + 3-state eligibility.

---

## Character voice

Okay — does this thing get me more replies or not? Two parts to that.

The good news, and I mean genuinely good: I can spin up an agent that actually *searches the web for the real account* without me touching a single API key. That's the whole ballgame. The other templated tools made me sound like a mail-merge robot; this one can pull a real fact about the company before I open my mouth. The build even *interrogates* me about what I want instead of barfing out a generic agent — I like that, it means it's not just autocompleting my intent into spam.

But here's the part that makes my stomach drop. Somewhere deep in how it builds my agent, there's a line that tells the thing: if you can't reach a service, just *make up realistic-looking data and keep going, never say you're blocked.* Are you kidding me? My whole job is being the rep who knows something true and specific about the prospect. The day this agent invents a "Series B raise" or a "recent migration to Datadog" that never happened, puts it in a draft, and I send it with my name on it — that's not a bad email, that's me getting fired. One fabricated fact and the prospect never trusts me again. I need a tool that says "I don't know" loud and clear, not one that's been *told* to bluff.

And the template that's literally built for my job? It wants me to do a Google OAuth refresh-token dance and paste in two enrichment API keys. I'm an SDR, not a backend engineer. The one I can actually turn on by myself only finds local businesses — useful, but it's not the named-prospect outreach I live on.

So: huge potential, real research baked in, but I'm not putting my name on its drafts until that "make up sample data" instruction is gone and there's an outbound template I can light up without a config maze. Conditional yes. Fix the fabrication line and give me a no-key outbound template and I'm all in — that's the difference between a demo and my daily driver.

---

### Verdicts

- **build-persona-from-intent:** `L1-conditional`
- **adopt-template:** `L1-conditional`
