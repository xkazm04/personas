# Moonshots — Plugin Ecosystem

## 1. The Practice Refinery — a self-compounding skill compiler across the whole portfolio
- **Tier**: 1 (10x category-defining)
- **Category**: ecosystem
- **Impact**: Every lesson any agent learns in any of the owner's ~20 repos is automatically distilled into a versioned, installable, MCP-addressable skill — so the marginal cost of "the fleet getting smarter" drops to zero and capability compounds across projects instead of evaporating in transcripts.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: Today the app has all four organs of a capability economy but no circulatory system: knowledge harvest mines transcripts into `workspace_knowledge`, the practice library governs adopt/reject, the skills manager tracks a workspace skill library (`~/.claude/skills`) with transcript-mined usage and per-context coverage, and the MCP server exposes persona tools externally. Each loop terminates in a human reading a card. The moonshot is closing the loop: **practice → compiled skill → fleet-wide dispatch → measured coverage → re-harvest**, running as a standing refinery. That turns Personas from a desktop cockpit into the owner's private, compounding capability platform — the moat is the accumulated skill corpus itself, which no fresh Claude session can replicate.
- **What exists today**:
  - Harvest engine with coverage-ledger wave selection (won't re-plow old ground): `src/features/overview/sub_patterns/harvestWave.ts`, `ExtractionMenu.tsx`, `useHarvestAutoIngest.ts`
  - Practice governance + the crucial "port a thing into another codebase" dispatch prompt (with reasoned-refusal protocol): `src/features/overview/sub_patterns/adoptPracticePrompt.ts` (`buildAdoptPrompt`, Fleet dedup keys), `PracticeRolloutModal.tsx`
  - Skills manager data spine — workspace vs project libraries, transcript-mined usage (`getSkillUsageOverview`), memory-ledger coverage, SKILL.md frontmatter patching: `src/features/plugins/dev-tools/sub_skills/skillsManagerData.ts`, `SkillsManagerPage.tsx`, `UseSkillDialog.tsx` (dispatch to Fleet)
  - Skills analytics (coverage pipelines, scoreboards): `src/features/plugins/dev-tools/sub_skills/analytics/useSkillsAnalytics.ts`
  - MCP server with real tools (`personas_execute`, `knowledge_search`, `context_*`, drive sandbox): `src-tauri/src/mcp_server/tools.rs`, `mod.rs`, `install.rs`
- **Path to implementation**:
  1. **Compile step (doable now)**: add a "Compile to Skill" action on an adopted practice — a Fleet session takes `WorkspaceKnowledge.statement + detail_md` plus its evidence transcripts and emits a SKILL.md + supporting files into `~/.claude/skills/<slug>/`, reusing the exact prompt shape of `buildAdoptPrompt` (survey → judge fit → adapt → verify → report). The skills manager already lists and frontmatter-patches this directory.
  2. Stamp provenance frontmatter (source practice id, source repos, harvest wave, version) so `skillsManagerData` can render lineage and diff versions.
  3. Auto-rollout: when a compiled skill lands, enqueue `buildAdoptPrompt`-style install dispatches to every workspace member repo via the existing Fleet dedup keys; DECLINED verdicts feed back as practice annotations.
  4. Close the measurement loop: join skill usage (`getSkillUsageOverview`) and memory-ledger coverage against the source practice, so the analytics tab shows "practice X became skill Y, used N times across M repos, moved coverage Z%". Dead skills auto-flag for deprecation via the existing practice-library deprecate flow.
  5. Expose the library over MCP: add `skills_list` / `skills_fetch` tools in `mcp_server/tools.rs` so any external Claude/agent host can pull the refined corpus — the workspace library becomes an addressable capability registry, not a folder.
  6. Standing cadence: a scheduler-triggered "refinery tick" that runs one harvest wave + one compile + one rollout per day, throttled by the coverage ledger.
- **Dependencies**: Fleet Dev-runner sessions (exists), `workspace_knowledge` + `skill_usage`/`skill_coverage` tables (exist), MCP server binary (exists), Claude CLI on host.
- **Risks**: (1) Skill sprawl — auto-compilation without a quality gate produces a junk-drawer library; the practice-governance approve step must stay the gate. (2) Cross-repo rollouts consume real LLM budget; needs the wave-throttling discipline the harvest engine already has. (3) Provenance/version drift if users hand-edit SKILL.md — the frontmatter patcher already tolerates this but lineage claims must degrade gracefully.
- **What changes if we ship it**: The owner stops being the messenger between repos. A lesson learned Tuesday in pumper is an installed, measured skill in lighttrack by Wednesday — and any external agent can invoke the whole refined corpus through one MCP endpoint.

## 2. Twin Goes Live — the autonomous representative with a trust ladder
- **Tier**: 1 (10x category-defining)
- **Category**: automation
- **Impact**: The Digital Twin graduates from a reply *simulator* (nothing is ever sent) to an actually-operating representative that reads real channels, answers within earned per-contact/per-channel trust budgets, and cryptographically signs everything it sends — 10x the owner's communication throughput without surrendering control.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The twin surface is a complete brain with no body. `ReplyOutbox.tsx` states it outright: "Nothing is sent over any real channel — the human stays in control." Yet the engine *already runs real transports*: `src-tauri/src/engine/slack_poller.rs` and `discord_poller.rs` poll inbound messages, execute a persona, and reply — for personas, not twins. Meanwhile the twin has tones per channel, a memory-approval inbox, training sessions, distilled facts, contacts, and a readiness score. The moonshot is fusing these: the twin becomes the first consumer-grade *governed* autonomous identity — autonomy earned per contact and per channel through an explicit trust ladder, with every outbound message Ed25519-signed using the signing infrastructure that already exists in Drive. No product on the market ships "your AI answers your Slack, and here's the audit trail proving which words were yours."
- **What exists today**:
  - Draft-and-approve pipeline (`twin_draft_reply`, `twin_record_interaction`, steer chips, tone resolution): `src/features/plugins/twin/sub_channels/ReplyOutbox.tsx`, `SentReplies.tsx`, `src/api/twin/twin.ts`
  - Real inbound/outbound channel machinery, leader-elected, cursor-tracked: `src-tauri/src/engine/slack_poller.rs`, `src-tauri/src/engine/discord_poller.rs`
  - Trust raw material: readiness scoring (`src/features/plugins/twin/useTwinReadiness.ts`), memory approval/rejection with reasons (`sub_knowledge/`), rejection-pattern analysis (`sub_brain/RejectionPatternsPanel.tsx`), per-channel tones (`sub_tone/`), contacts (`twin_contacts`)
  - Signing identity: Ed25519 keygen + sign/verify commands: `src/features/plugins/drive/signing/useSigning.ts` (`generate_signing_key`, `sign_document`)
  - Channel bindings with credential linking already modeled: `src/features/plugins/twin/sub_channels/ChannelsAtelier.tsx`, `twin_channels` table
- **Path to implementation**:
  1. **Bridge inbound (doable now)**: extend the slack/discord poller channel-config matching to recognize twin-bound channels and route inbound messages into `twin_pending_memories` + auto-draft via the existing `twin_draft_reply` — the outbox fills itself instead of requiring paste.
  2. Add real send: an approve action that actually posts via the poller's reply path (the Slack reply plumbing exists), still 100% human-approved. Record to `twin_communications` as today.
  3. Introduce the trust ladder per (contact × channel): `draft-only → batch-approve → auto-send with N-minute recall window → full auto`. Promotion is earned from the owner's own approval history (approvals without edits raise trust; edits/rejections lower it — the rejection-patterns panel already computes the raw signal).
  4. Sign every auto-sent message: attach an Ed25519 signature + append-only local ledger reusing `sign_document`, and render a per-message "who wrote this" provenance badge in `SentReplies`.
  5. Close the learning loop: every edit the owner makes to a draft diffs into a distilled-fact/tone adjustment proposal in the memory inbox, so autonomy quality compounds from real corrections, not training interviews alone.
  6. Extend to email/Telegram via the credential vault's existing connector credentials, one transport at a time.
- **Dependencies**: slack/discord poller engine, credential vault, `twin_*` tables, Ed25519 signing commands, systemStore twin slices.
- **Risks**: (1) Reputational blast radius — one bad auto-sent message costs more than a hundred good ones save; the recall-window tier and conservative default ladder are load-bearing, not optional. (2) Channel ToS/auth friction (Slack user-token vs bot-token identity; email sending deliverability). (3) Trust scoring on sparse data — early auto-promotion from a handful of approvals would be statistically bogus; needs floors and per-contact minimum sample sizes.
- **What changes if we ship it**: The twin stops being a portfolio piece and becomes staff. Routine channel traffic is answered in the owner's voice within minutes, the owner reviews a morning digest instead of an inbox, and every message carries a verifiable signature of whether the human or the twin wrote it.
