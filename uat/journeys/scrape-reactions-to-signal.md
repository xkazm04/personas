---
id: scrape-reactions-to-signal
title: Watch the places I posted for reactions, and have an agent react when something lands
promotion: discovery
primary_contexts: [scraper-engine, event-bus, chain-studio-signals, persona-triggers]
surfaces: [plugins/scraper, triggers, personas]
relevant_characters: [hobbyist-power, software-developer, it-sysadmin, support-lead, content-marketer, solo-founder, researcher, freelance-agency, sales-rep, smallbiz-owner, prospect-buyer, non-english-user]
---

## Goal (user POV)
"I posted about my product in a few communities. I want to know when people react — new comments, replies, mentions — without me refreshing tabs all day. And when something lands (especially something negative or a sales-shaped question), I want an agent to pick it up and do something about it."

## Grounding note (surfaces that exist today)
- **Pumper is genuinely embedded**: `pumper-core` git dep at `src-tauri/Cargo.toml:87` (`rev = 7e13f31`, `default-features = false`), behind the `scraper` cargo feature, wrapped in Personas' SSRF-safe HTTP client (`engine/scraper.rs:33-74`).
- **HTTP tier ONLY.** `DisabledBrowser::render()` and `DisabledResearcher::research()` are hard-error stubs (`engine/scraper.rs:76-98`) — **no JS rendering**. No auth/login, no cookies, no pagination, no per-request rate limiting.
- **The LLM step is authoring-time only** — `LlmRuleBuilder.tsx:22-43` → `scraper_generate_rules` writes CSS/regex rules once. Scrape runs apply static rules with **no LLM call**.
- **The Signal chain is fully wired**, verified end to end: `config_run` → `emit_run_signal` → `shared:scrape.<id>.changed` on the real event bus → `shared_event_catalog` (category `scraper`) auto-subscribed → Chain Studio Signals "Scraper" group (`StudioRails.tsx:69-73,123-134`) → `event_listener` `PersonaTrigger` → persona run; data read back via the `query_dataset` MCP tool (`mcp_server/tools.rs:1116-1131,1169`).
- **Scraper is `devOnly: true`** (`PluginsSidebarNav.tsx:98`) — invisible in a shipped build.

## Definition of done
- I'm watching the specific places I actually posted, and I get told when something new appears there.
- What I get told is the *reaction itself* (the comment text, who, when) — not just "something changed".
- An agent can act on it automatically, and I can see what it did.
- I trust it's not missing things silently.

## What L1 must check
- **The reachability blocker first.** Scraper is dev-only. For each Character, resolve: can they even see this plugin in a shipped build? If not, the finding is the *gating*, and job-impact defers to L2. Do not attribute a UX finding to a Character who cannot open the surface.
- **Can it actually scrape the venues this Character would post in?** Walk concrete targets: modern Reddit (JS-hydrated), old.reddit.com (server-rendered), Hacker News (server-rendered), Discord (auth + WS), Slack (auth), Indie Hackers, Product Hunt, LinkedIn, X/Twitter. Classify each **scrapeable / not-scrapeable / needs-auth** against the HTTP-only + no-auth constraints. This is the decisive technical check for this journey — be concrete, not hand-wavy.
- **"Reactions" vs "changes".** The payload is `{ pipelineId, name, dataset, new, changed, unchanged, sampleKeys[], status }` (≤64KB). Does the Character actually learn *what someone said*, or only that a count moved? Trace whether the reacting persona can retrieve the comment body via `query_dataset`.
- **Authoring cost.** Walk `ScrapeEditorWizard` → `LlmRuleBuilder` in-character. Can a non-technical Character author a working CSS-rule pipeline for a comment thread? What happens when the site changes its markup — is there any breakage signal, or does it silently return zero rows forever? (Check whether "0 new" is distinguishable from "selector broke".)
- **Silent-failure audit** (a top pet-peeve across this roster): `.error` emits on failure — but is a *rule that silently stops matching* an error, or a quiet no-op? Cite the emit condition.
- **Politeness/ToS/trust**: no rate limiting exists. Would this Character be comfortable pointing this at a community they want goodwill in? Does anything warn them?

## What L2 must confirm (l2_priority)
- **Drive a real pipeline against a real server-rendered comment thread** (e.g. an HN item page or old.reddit.com) and assert real reaction rows land in the dataset with actual comment text.
- Confirm the Signal genuinely fires and a subscribed persona genuinely runs — end-to-end, in the DB, not just in the UI.
- Confirm what a persona can actually READ back via `query_dataset` at runtime.
- Break a selector deliberately and observe what the user is told (the silent-failure question).
- Judge the LLM rule-builder's live output on a real messy comment page against the senior bar.
