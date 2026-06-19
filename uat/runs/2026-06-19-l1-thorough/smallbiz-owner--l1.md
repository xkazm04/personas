# Frank DiMarco — Small-Business Owner — L1 report

- **Character:** `smallbiz-owner` (Frank DiMarco — non-technical HVAC owner, 12-person company, Starter tier, EN). Bails at jargon (API/webhook/node/prompt), gives a tool ~5 minutes. Wants to "just make it do the thing" by *talking*, not configuring.
- **Level:** L1 (theoretical, code-grounded). No live app. Read-only on source. Surface model built from the real tree and verified against files on disk.
- **Reachable set (verified):** `SIMPLE_SECTIONS` = home, overview, personas, credentials, design-reviews, settings (`src/lib/utils/platform/platform.ts:92`). NOT reachable: events, teams, cloud, dev-tools, plugins. `DEV_MODE_SECTIONS` = plugins (`platform.ts:102`). So **Dev Tools, Events config, BYOM/Engine/Admin, Teams, the Plugins sidebar are all out of Frank's reach by tier** — good.
- **Stale-map note:** the journeys + `.claude/CLAUDE.md` reference `src/features/simple-mode/**` and a "simple-mode" surface. **No such directory exists** (`Glob src/features/**/simple*/**` → none; the only `simple-mode` hit is a doc `docs/features/interface-modes/simple-mode.md`). "Simple mode" is implemented as the Starter-tier *filter* over existing surfaces, not a distinct surface. Treated accordingly.

---

## Per-journey verdicts

### 1. first-run-onboarding — **L1-fail**
**Rationale.** There is a fully-built, template-first 5-step cold-start flow (`OnboardingOverlay.tsx`: appearance → discover → pick-template → adopt → execute) that would be *excellent* for Frank — it ends in a real first run. **But it is dead code.** The flag that mounts it (`onboardingActive`) is only flipped by `startOnboarding()` / `resumeOnboarding()` / `reopenOnboarding()`, and **none of these is invoked anywhere in `src/`** (verified: grep across `src/**` finds only the definitions in `onboardingSlice.ts`, zero call sites). The onboarding README §"Who fires first" (`src/features/onboarding/README.md:175`) says the trigger is "Simple-mode empty state's CTA → `startOnboarding()`" — but that simple-mode surface/CTA does not exist in the tree. The guided tour also never auto-starts (`startTour` is only called from the user-clicked `TourLauncher` and from `GuidedTour` next-tour advance). So a genuine first-timer, after the consent gate, lands on the **Home Welcome hero**: a "Good Morning, Commander" banner over a grid of module nav-cards (Overview / Personas / Credentials / Templates / Settings) + language cards (`HomeWelcome.tsx`, `WelcomeLayout.tsx`). There is **no "describe a job / get started / first action" CTA on that screen** — it's a directory of modules, addressed to a "Commander." For a non-technical first-timer with a 5-minute fuse, the designed guided path never runs and the fallback is a jargon-flavored launcher with no obvious next step. Structural gap → fail.

### 2. build-persona-from-intent — **L1-conditional**
**Rationale.** The path is structurally whole and reachable for Starter: Personas sidebar "Create" (`AgentsSidebarNav.tsx:226`) or `PersonasPage.tsx:189` → `setIsCreatingPersona(true)` → `UnifiedBuildEntry`. The intent input is genuinely plain-language ("e.g. Summarize my unread emails each morning", `en.json:853`; composer rows labeled Task/When/Output/Tools/Review, brand-name placeholders like "Gmail, Slack, Notion."). After build, the user gets a plain test summary ("All 3 tools passed. Ready to promote.", `useLifecycle.ts:149`). **Majors, not blockers:** (a) the first thing on the build surface is a developer-flavored control strip — a layout toggle reading **"Glyph Full" / "Composer Prototype"** and a mode toggle **"Let AI decide everything" / "One-shot: on"** with hardcoded-English `title` tooltips about "gates" and "safe defaults" (`UnifiedBuildEntry.tsx:753,764,780,742-744`); (b) **grounding is thin** — `startBuildSession` receives only the raw intent string + mode + language (`api/agents/buildSession.ts:33`); the user's role/tools/goal and their connected accounts are *not* passed, so the LLM can ask questions Frank can't answer; (c) there is **no plain-language "here is what it will do" confirmation before promote** — the promote notice is the vague "Your agent has been promoted to production and is ready to use." (`useLifecycle.ts:257`), so Frank's criterion #5 ("understand what it'll do before I let it loose") is only partially met. Completes, but a senior wouldn't love the polish for this persona.

### 3. companion-do-a-job — **L1-conditional**
**Rationale.** This is Frank's natural lane ("tell an assistant what I need"), and it is **real and reachable**. The Athena orb is mounted globally in `App.tsx:335` (`AthenaOrbLayer`), gated only by `companionOrbEnabled` which **defaults `true`** (`companionPluginSlice.ts:261`) — NOT by tier. So Frank gets a floating "talk to me" presence on launch even though the Plugins *sidebar* is dev-gated. The companion is not chat-only: it can build/breed/evolve/run personas, resolve reviews, compose cockpit views, open routes (approval-gated; `commands/companion/approvals.rs`). Grounding is strong — every turn assembles constitution + identity + a live observability digest (the user's personas/executions/reviews/messages/metrics) + recalled memory (`src-tauri/src/companion/prompt.rs:145`). Empty-state copy is conversational and jargon-free ("Talk to Athena", "show me my personas", "what needs my attention"; `CockpitPanel.tsx:225-238`). **Majors:** (a) **discoverability** — there is no welcome-screen affordance pointing a first-timer to the companion; the only on-screen entries are the floating orb (easy to miss/ignore as decoration) and the Cockpit home-tab, which itself isn't surfaced on the Welcome hero (homeTab defaults to `welcome`, `uiSlice.ts:319`); a non-technical user is not told "this orb is how you ask for things." (b) The companion's *name* ("Athena") and the "Commander" framing are persona-flavored, not plainly "your assistant" — minor trust friction for a literal-minded tradesperson. The mechanism is sound; the signposting is the gap.

### 4. adopt-template — **L1-conditional**
**Rationale.** Gallery is reachable for Starter (Templates / `design-reviews` section is in `SIMPLE_SECTIONS`), legible (cards with name + description + connector list + category pills + search/filter; gallery under `src/features/templates/sub_generated/`), and the `AdoptionWizardModal` flow (Pick capabilities → Link credentials → Set preferences → Generate → Review) **auto-matches vault credentials to the template's needs** and blocks "Continue" with a clear "Missing: {names}" / "No {category} credential found in your vault. Add one to continue." when something's unwired — so it won't silently ship a half-configured agent (DoD met). **Majors:** the wizard is steeped in exactly Frank's allergens — step labels "Link credentials", concepts "Connectors", "Use Cases", "Triggers", "Sandbox"/review-policy, "webhook_url", and a cron field (mitigated by Hourly/Daily/Weekly presets). The trigger surface and connector-linking can still strand a non-technical user who has no accounts connected yet. Completes for a determined user; the vocabulary is adoption-killing for Frank specifically.

---

## Findings

### [blocker][completion] broken-flow — Cold-start onboarding overlay is dead code; never triggered
- **expected:** A first-time non-technical user is guided from launch to one working automation (the built 5-step overlay: appearance → discover → pick-template → adopt → execute, which ends in a live first run).
- **got:** `onboardingActive` is the only thing that mounts `OnboardingOverlay`, and nothing flips it. `startOnboarding()`, `resumeOnboarding()`, `reopenOnboarding()` are defined but have **zero call sites** in `src/`. After the consent modal, Frank lands on the module-grid Welcome hero with no first-action CTA. The whole guided "first value" path is unreachable.
- **evidence:** `src/stores/slices/system/onboardingSlice.ts:143` (startOnboarding def), `:157` (resumeOnboarding), `:207` (reopenOnboarding); `src/features/onboarding/components/OnboardingOverlay.tsx:83` (`if (!onboardingActive) return null`); `src/features/onboarding/README.md:175` (claims "Simple-mode empty state's CTA → startOnboarding()").
- **code_check:** confirmed-absent (grep `startOnboarding|resumeOnboarding|reopenOnboarding` over `src/**` returns only the slice definitions; the documented trigger surface `src/features/simple-mode/**` does not exist).
- **reachable:** true (this is Frank's literal first screen path).
- **l2_priority:** P0 — confirm live that a fresh profile (no personas, onboardingCompleted=false) never sees the overlay; confirm the Welcome hero is the actual first interactive screen post-consent.

### [major][clarity] missing-feature — No "describe a job / get started" entry point on the first screen
- **expected:** On the first screen, an obvious "tell us what you want to do" affordance (Frank's whole mental model).
- **got:** The Welcome hero is a greeting ("Good Morning, Commander") + a grid of *module* nav-cards (Overview, Personas, Credentials, Templates, Settings) + language cards. No goal/intent box, no "Get started", no pointer to the companion. The role/tool/goal `SetupCards` stepper (which *does* have a plain "What do you want to automate?" goal box) is NOT rendered by `WelcomeLayout` — it's only consumed by the build bridge and is gated on `setupCompleted` with no on-hero placement.
- **evidence:** `src/features/home/sub_welcome/WelcomeLayout.tsx:45-68` (renders ResumeBanner + HeroHeader + NavigationGrid + LanguageCards only — no SetupCards); `src/features/home/sub_welcome/HomeWelcome.tsx:11-20` (NAV_CARDS are modules); `src/features/home/sub_welcome/SetupCards.tsx:572-625` (SetupCards exists but is not mounted in the welcome tree); `en.json:736` (`automate_title:"What do you want to automate?"` lives only inside the unmounted stepper).
- **code_check:** present-but-missed (SetupCards/goal box is built but not surfaced on the cold-start screen).
- **reachable:** true.
- **l2_priority:** P1 — verify the Welcome hero render and whether any A/B or tier path injects a goal box.

### [major][clarity] confusion — "Commander" / "Athena" framing addresses a Starcraft commander, not a plumber
- **expected:** Talk to Frank like a person running a small trades business.
- **got:** The hero always addresses the user as "Commander" (`displayName = t.commander`), and the assistant is "Athena". For a literal, jargon-averse HVAC owner this reads as fantasy/sci-fi cosplay, not "this will answer my emails."
- **evidence:** `src/features/home/sub_welcome/HomeWelcome.tsx:36-38` (`displayName = t.commander`); `en.json:576` (`"commander":"Commander"`); companion empty-state "Talk to Athena" (`CockpitPanel.tsx:131`).
- **code_check:** by-design (intentional Athena theming).
- **reachable:** true.
- **l2_priority:** P2 — judgment call; flag for tone review, not a functional break.

### [major][effort] confusion — Build surface opens with developer-flavored toggles ("Glyph Full", "Composer Prototype", "Let AI decide everything")
- **expected:** A plain box: "Tell me what you want, in your words."
- **got:** Above the intent box sits a layout toggle reading "Glyph Full" / "Composer Prototype" and a mode pill "Let AI decide everything" / "One-shot: on", with hardcoded-English tooltips referencing "gates" and "the AI will pick safe defaults." These are the first words Frank reads on the create screen.
- **evidence:** `src/features/agents/components/matrix/UnifiedBuildEntry.tsx:753` ("Let AI decide everything"/"One-shot: on"), `:764,:780` ("Glyph Full"/"Composer Prototype" via DebtText), `:742-744` (raw-English `title` tooltips).
- **code_check:** present-broken (works mechanically; the vocabulary is adoption-killing for this persona and the tooltips bypass i18n).
- **reachable:** true (the Create button is in Frank's reachable Personas section).
- **l2_priority:** P1 — confirm the toggles render for Starter and aren't tier-hidden; assess whether a Starter user can be defaulted past them.

### [major][senior-quality] quality-gap — Build grounds on the thin one-line intent, not Frank's real context
- **expected:** The build uses Frank's role/business/connected accounts so the generated agent and its questions fit *his* job, and it doesn't ask things he can't answer.
- **got:** `startBuildSession` is passed only `intent` (raw text) + `mode` + `language`. No role, no goal, no connector/vault snapshot. So the clarifying questions and the resulting prompt are generated from the sentence alone; a question like "which database/connector?" has no grounding and can strand him.
- **evidence:** `src/api/agents/buildSession.ts:33-52` (signature: intent/workflowJson/parserResultJson/language/mode/companionSessionId — no context object); `UnifiedBuildEntry.tsx:578-585` (handleGenerate passes only those); SetupCards goal can pre-*fill* the textarea but only as text, no structured context (`UnifiedBuildEntry.tsx:137-146`).
- **code_check:** confirmed-absent (no user-context grounding wired into the build session start).
- **reachable:** true.
- **l2_priority:** P1 — L2 must judge the *actual* generated prompt quality vs Frank's senior bar (a polite, correct customer follow-up) on a real run.

### [major][completion] missing-feature — No plain-language "here's what it will do" before promote
- **expected:** Before turning it loose, "This will email customers who haven't replied to a quote in 3 days, signed from your business — OK?"
- **got:** End-state feedback is test-pass counts ("All 3 tools passed. Ready to promote.") and a generic promote notice ("Your agent has been promoted to production and is ready to use."). No restated, human summary of the behavior to approve. Directly undercuts Frank's trust criterion #5.
- **evidence:** `src/features/agents/components/matrix/useLifecycle.ts:149-152` (test summary), `:257` (promote notice).
- **code_check:** confirmed-absent (no pre-promote behavior summary surface found).
- **reachable:** true.
- **l2_priority:** P1.

### [major][clarity] confusion — Companion is reachable but never signposted to a first-timer
- **expected:** Frank is told "talk to this assistant to get things done."
- **got:** The companion is genuinely available (orb defaults on, not tier-gated), but the only entries are an easily-ignored floating orb and a Cockpit home-tab that isn't surfaced on the Welcome hero. Nothing on the first screen says "ask the assistant." The Plugins→Companion sidebar entry is dev-gated away from Frank, so the orb is his *only* discoverable handle — and it isn't labeled as a chat.
- **evidence:** `src/App.tsx:335` (orb mounted globally); `src/stores/slices/system/companionPluginSlice.ts:261` (`companionOrbEnabled:true`); `src/features/plugins/companion/orb/AthenaOrbLayer.tsx:162` (shown when `orbEnabled && state==='minimized'`, no tier check); `src/lib/utils/platform/platform.ts:102` (plugins dev-only); `uiSlice.ts:319` (homeTab defaults 'welcome', not 'cockpit').
- **code_check:** present-but-missed (capability present; onboarding/affordance to it absent).
- **reachable:** true (orb), companion-via-Plugins-sidebar `reachable:false` (tier-gated, by design).
- **l2_priority:** P1 — verify the orb actually appears for a fresh Starter profile and that tapping it opens a usable chat without a tier wall.

### [major][effort] quality-gap — Template adoption wizard is dense with Frank's allergen vocabulary
- **expected:** "Pick what it does → connect your accounts → done," in plain words.
- **got:** Wizard steps and copy use "Link credentials", "Connectors", "Use Cases", "Triggers", review-policy/"Sandbox", "webhook_url", and a cron field. Auto-matching + "Missing: {names}" gating is good engineering, but the words will bounce a non-technical user before the safety nets help.
- **evidence:** `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx` (step labels); `en.json` template-adoption keys (`connectors`, `use_cases`, `triggers`, review-policy, `webhook_url`); credential-required gating strings ("No {category} credential found in your vault. Add one to continue.").
- **code_check:** present-broken (functionally complete; vocabulary inappropriate for the target segment).
- **reachable:** true.
- **l2_priority:** P2 — confirm whether a Starter-tier adoption can complete end-to-end with zero pre-connected accounts, or always dead-ends on credential linking.

### [minor][trust] confusion — Consent gate front-loads opaque terms (P2P, foraging, telemetry, MCP) before any value
- **expected:** A short, plain "we keep your stuff on your machine" reassurance.
- **got:** The very first modal (before anything useful) is a multi-section consent disclosure naming P2P, foraging, telemetry, deploy, MCP — pure jargon to Frank, and it eats into his 5-minute budget before he's seen a single benefit.
- **evidence:** `src/App.tsx:304` (`FirstUseConsentModal` gates the app); consent disclosure sections in `src/features/shared/components/overlays/FirstUseConsentModal.tsx`.
- **code_check:** by-design (legal/consent requirement).
- **reachable:** true.
- **l2_priority:** P2 — measure how long the consent gate takes and whether plain-language summaries exist per section.

### [minor][clarity] confusion — Starter onboarding role is literally labeled "Office Rat" / "Non-technical user"
- **expected:** A role Frank recognizes ("Small business / trades", "Office work").
- **got:** In the (currently unmounted) SetupCards stepper, Starter users are funneled to the single role "Office Rat", subtitle "Non-technical user." Even if surfaced, an HVAC owner won't self-identify as an "Office Rat," and the label is faintly demeaning.
- **evidence:** `src/features/home/sub_welcome/SetupCards.tsx:28-33,:109` (Starter filters to `office-rat` only); `en.json:619-620` (`"role_office_rat":"Office Rat"`, `"role_office_rat_hint":"Non-technical user"`).
- **code_check:** present-but-missed (label exists; surface currently unmounted per the onboarding finding).
- **reachable:** true (would be, if SetupCards were surfaced).
- **l2_priority:** P3.

---

## What passed (do not regress these)

- **Tier scoping is correct for Frank.** Starter genuinely hides Events, Teams, Cloud, Dev Tools, and the Plugins sidebar; he is never *forced* into a dev-only surface to do his job. (`platform.ts:92,102`; `NavigationGrid.tsx:90-99` filters cards by tier.) — strength.
- **The companion exists, is grounded, and can actually act.** Not chat-only: approval-gated build/run/resolve/compose, fed a live observability digest of the user's real personas/executions/reviews/memory every turn. (`commands/companion/approvals.rs`; `src-tauri/src/companion/prompt.rs:145`.) — strength.
- **Companion empty-state copy is plain and jargon-free** ("Talk to Athena", "show me my personas", "what needs my attention"). (`CockpitPanel.tsx:225-238`.) — strength.
- **The intent box itself speaks human.** Placeholder "e.g. Summarize my unread emails each morning"; composer rows are Task/When/Output/Tools/Review with concrete brand-name examples, not "connector/trigger/schema." (`en.json:853`; `commandPanelHelpers.ts`.) — strength.
- **Template adoption won't silently ship a broken agent.** It auto-matches vault credentials and hard-blocks Continue with explicit "Missing: {names}" until wired. (`AdoptionWizardModal` + `vaultAdoptionMatcher`.) — strength, directly satisfies the journey DoD.
- **Build gives an honest, readable test result** ("All 3 tools passed. Ready to promote.") and a recoverable error/retry path on cockpit/template/discovery loads. — strength.

---

## Character voice (Frank DiMarco)

"Okay. I open this thing, and first it makes me read a wall about 'P2P' and 'telemetry' and 'foraging' — buddy, I fix furnaces, I don't know what any of that is. I click 'I agree' just to make it go away. Then it says 'Good Morning, Commander.' Commander of what? I run an HVAC shop. And now there's a screen full of tiles — Overview, Events, Credentials — and not one of them says 'tell me what you need.' I'm looking for the part where I type 'chase down the customers who never wrote back on their quote' and it just... does it. There's a little glowing ball floating in the corner but nobody told me it's the help — I figured it was decoration. If I poke around to 'create an agent,' the first thing I see is a button that says 'Glyph Full' and another that says 'Let AI decide everything.' Glyph? Come on. The box where I actually type is fine, finally plain English — but then it never tells me, in words I get, what the dang thing is gonna send to my customers before it sends it. I'm not turning that loose on Mrs. Patterson without seeing it first.

Honest take: the smart assistant under the hood is real and it's grounded in my actual stuff — that's the good part, and the part nobody shows me. But the front door is built for a 'Commander,' the guided setup that's supposed to walk me in is apparently switched off, and every shortcut to value is hidden behind a word I'd never use. Five minutes in, I'd have closed it. If they just put a 'Tell me what you want done' box on the first screen and made that floating ball say 'Ask me,' I'd have stayed."

— Verdict: the machinery to delight Frank is built and grounded, but the on-ramp is missing (cold-start guide is dead code) and the signposting/vocabulary is aimed at a power user, so a 5-minute first-timer bounces before reaching the value.
