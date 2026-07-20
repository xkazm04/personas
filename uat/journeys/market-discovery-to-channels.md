---
id: market-discovery-to-channels
title: Find no-cost places to market my SaaS, and set them up as channels I can manage
promotion: discovery
primary_contexts: [prompt-assembly, persona-authoring, twin-channels, research-lab, credential-vault]
surfaces: [personas, plugins/twin, plugins/research-lab, keys]
relevant_characters: [solo-founder, content-marketer, sales-rep, freelance-agency, smallbiz-owner, prospect-buyer, researcher, hobbyist-power, it-sysadmin, software-developer, support-lead, non-english-user]
---

## Goal (user POV)
"I have a SaaS product and no ad budget. I want the app to go find the free places where my people actually hang out — communities, forums, subreddits, directories, newsletters, Slack/Discord groups — tell me which are worth my time and what the rules are, and then let me set those up as channels I actually manage from here."

## Grounding note (surfaces that exist today)
This journey is scoped to what ships **now**, not to a hypothetical Marketing module:
- **Discovery** must run through a **Persona** using the native **WebSearch/WebFetch** capability injected into every persona system prompt (`src-tauri/src/engine/prompt/mod.rs:715-731`). There is no marketing/channel-discovery feature, and no Brave/Tavily/SerpAPI connector.
- **Research Lab** (`Plugins → Research Lab`, **dev-only**) is the only "structured research" surface — but it is an arXiv/Crossref bibliography manager and **never fetches page content** (`useIngestSource.ts:8-12`).
- **Management** must land in **Twin → Channels** (`twin_channels`), the only place in the app that models "a channel I speak in".

## Definition of done
- I ended up with a concrete, credible list of specific named places to market in — not generic advice ("post on Reddit") but named venues with a reason, an audience-fit judgement, and their promo rules.
- The recommendations are grounded in *my* product, not a template answer.
- I could then persist/manage those venues somewhere in the app as channels — and the thing I set up is real, not a decorative row.
- I know which venues cost nothing and which need reputation/karma/an invite before I can post.

## What L1 must check
- **Can discovery happen at all, in-character?** Trace: can this Character author/run a Persona that does open web research, without hitting a dev-only or tier wall? Cite the prompt-assembly path and the persona-build path.
- **Is the research grounded in the user's product?** What context does the persona prompt actually receive about *my* SaaS (positioning, ICP, category)? Or does the user have to paste it all in every time? Grounding audit.
- **The handoff gap.** Discovery output is chat/execution text. Is there ANY path from "the agent found 12 venues" to a persisted, structured, manageable list? Or does the user re-type it? Cite what exists.
- **Twin → Channels reality check.** `twin_channels` supports discord/slack/email/telegram/sms/teams/whatsapp only (`shared/channels.ts:57-65`). Most discovered marketing venues (a subreddit, a directory, a newsletter, Indie Hackers) have **no representable channel kind**. Is that a blocker for this journey?
- **Is a channel row real?** Verify whether creating a channel does anything beyond a DB row — the pollers (`discord_poller.rs`, `slack_poller.rs`) have zero `twin_channels` awareness.
- **Reachability** per Character tier/dev-flag: Research Lab is `devOnly: true` (`PluginsSidebarNav.tsx:97`). Twin is ungated.

## What L2 must confirm (l2_priority)
- **Actual output quality of a real discovery run.** Drive a persona with a real SaaS description and a real ICP; assert the live output names *specific, real, currently-existing* venues (not hallucinated communities), states promo rules, and reflects the supplied product. Judge against the Character's senior-quality bar: is this better than 30 minutes of their own googling?
- **Hallucination check** — do the named communities actually exist? This is the single highest-value L2 assertion in this journey.
- Real latency of a multi-search research turn vs. the Character's patience budget.
- Whether a discovered venue can be round-tripped into a Twin channel at all, live.
