# Moonshots — Home Dashboard

## 1. The Morning Director — a self-composing, action-taking command cockpit

- **Tier**: 1 (10x category-defining)
- **Category**: intelligence
- **Impact**: The Home tab stops being a dashboard you read and becomes the place the fleet is *run from* — every session opens with an Athena-composed, prioritized briefing whose widgets carry one-click actions (approve, rerun, pause, escalate), so a solo operator governs a whole agent fleet in the first five minutes of the day.
- **Feasibility**: high
- **Time-horizon**: months

- **Why it's a moonshot**: Everything needed already exists in fragments that never met: the cockpit renders ~30 widget kinds from an Athena-composed spec (`compose_cockpit`), the Welcome tab computes a "Since You Left" delta and fleet-health score, and the companion has a decision audit trail — but the spec is a *singleton composed on request*, the briefing is three count-lines, and every cockpit widget is read-only. The moonshot fuses them: on session open (and on schedule), Athena recomposes the cockpit *unprompted* from the since-left delta, alert history, pending approvals, and her own decision log — and the widgets become actuators, not displays. That flips the product's center of gravity: Personas today is "an app with an AI companion in the footer"; after this it is "an AI chief-of-staff whose desk you sit down at." No agent platform on the market opens with an autonomous, narrated, *actionable* operational briefing. It also compounds: every new widget kind or connector automatically enlarges what the Morning Director can show and do.

- **What exists today**:
  - `src/features/home/sub_cockpit/CockpitPanel.tsx` — spec fetch, contextual overlays, compose_cockpit Tauri event reload, deterministic default cockpit.
  - `src/features/home/sub_cockpit/widgetRegistry.ts` — 30 registered widget kinds incl. verdict, issue_list, stat_grid, decisions_panel; all currently display-only.
  - `src/features/home/sub_welcome/lib/sinceLeftBriefing.ts` — last-seen anchor, pure delta computation (runs/failed, alerts, approvals) with zero new IPC.
  - `src/features/home/sub_welcome/lib/fleetHealth.ts` + `useNavCardStatus.ts` — fleet health scoring already derived client-side.
  - `src-tauri/src/companion/brain/cockpit.rs`, `companion/dispatcher.rs`, `companion/templates/constitution.md` — the compose_cockpit op, its doctrine, and the `companion_cockpit` singleton store.
  - `src/features/home/components/HomePage.tsx` — keep-alive tab shell + `usePausableInterval`/prefetch utilities, the natural host for a session-open trigger.
  - `src/features/onboarding/components/useTourNarration.ts` — TTS pipeline reusable for a spoken 60-second briefing.

- **Path to implementation**:
  1. Add an `actions` field to `CompanionCockpitWidget` and wire 3 real actions into existing widgets (issue_list → "rerun failed", verdict → "approve/decline" resolving a pending approval, persona_overview → "pause persona") via IPC that already exists elsewhere in the app. Pure frontend + config plumbing; doable now.
  2. Promote the since-left computation into a serializable "session delta" document and pass it to a new backend `compose_briefing` entry that invokes the existing cockpit-composition brain with a briefing doctrine (prioritize: broken > waiting-on-you > drifting > wins).
  3. Trigger composition on app open when the delta is non-trivial (reuse the `LAST_SEEN_KEY` anchor + `COMPANION_COMPOSE_COCKPIT_EVENT` reload path); render as a dated briefing overlay above the persistent cockpit, using the existing `contextualCockpit` overlay mechanism.
  4. Add narration: pipe the briefing's headline through `useTourNarration`'s synth path so Athena *speaks* the morning summary.
  5. Close the loop: every action taken from a briefing widget is written to `companion_decisions`, so the decisions_panel widget shows "what you did about it" — the audit trail becomes bidirectional.
  6. Scheduled recomposition (evening wrap-up, post-incident) via the existing scheduler/trigger system.

- **Dependencies**: companion brain (LLM call budget per session-open), overview store spine (homeRunsSample, alertHistory, pendingReviewCount), execution/trigger IPC for actions, TTS pipeline (optional).
- **Risks**: (1) An LLM composition on every app open costs money and latency — needs the delta-gate ("only compose when something happened") and a deterministic fallback, which `composeDefaultCockpit` already models. (2) Action-carrying widgets composed by an LLM are a safety surface — actions must be an enum validated against a registry, never free-form. (3) If the briefing is wrong or noisy twice, the user stops trusting the whole surface; needs the honest empty state ("quiet night, nothing needs you").
- **What changes if we ship it**: The Home tab becomes the product's identity — the first and last screen of every session, where the fleet reports to you and you dispatch back. Personas graduates from "agent builder" to "agent operations HQ."

## 2. Generative Tours — Athena authors spotlight walkthroughs at runtime

- **Tier**: 1 (10x category-defining)
- **Category**: interface
- **Impact**: "Show me how to do X" — for *any* X, including workflows Athena has never been hard-coded to teach — produces a live, narrated, spotlight-guided tour of the real app in seconds, turning the tour engine from 5 static onboarding tours into an infinite, self-updating teaching layer.
- **Feasibility**: medium
- **Time-horizon**: months

- **Why it's a moonshot**: The guided-tour engine is already remarkably complete machinery — a state-machine driver that routes the app per step, an SVG spotlight that tracks live DOM nodes by `data-testid` with graceful `highlightMissing` degradation, per-step TTS narration, sub-step checklists, and honest-completion probes — but it can only ever play the handful of tours hand-written into `TOUR_REGISTRY`. Meanwhile Athena already *offers* walkthroughs (`walkthrough_offer` widget) but can only point at that same static list. The moonshot makes the tour spec a runtime artifact Athena composes: she knows the app's surface (constitution doctrine), the user's actual state (which credentials, personas, triggers exist), and can validate every generated step against a machine-readable anchor manifest before playback. No desktop product has an AI that can *walk you through itself* — arbitrarily, in your own data, out loud. And it generalizes past onboarding: "teach my teammate how our release persona works" makes tours the app's knowledge-transfer and distribution format.

- **What exists today**:
  - `src/stores/slices/system/tourSlice.ts` — `TourStepDef` (nav target, testid highlight, sub-steps, narration string, panelWidth) + static `TOUR_REGISTRY` of ~5 tours; the spec shape is already 90% of a generatable schema.
  - `src/features/onboarding/components/GuidedTour.tsx` — the driver: `navigateToStep` routes sidebar/tabs, fires side effects, guards stale timeouts.
  - `src/features/onboarding/components/TourSpotlight.tsx` — testid-tracked cut-out with MutationObserver re-measurement and `highlightMissing` fallback (exactly the degradation a generated tour needs).
  - `src/features/onboarding/components/useTourNarration.ts` — per-step TTS, cached, never blocks advancement.
  - `src/stores/slices/system/__tests__/tourAnchors.test.ts` — anchors are already contract-tested, i.e. the seed of a build-time anchor manifest.
  - `src/features/home/sub_cockpit/widgets/WalkthroughOfferWidget.tsx` + `show_walkthrough_offer` op — Athena's existing "Show me / Just tell me" entry point.
  - `src/features/home/sub_learning/powerMoves/registry.ts` — `detect()` honest-completion probes and `launchPowerMove.ts`/`flashSpotlight.ts` navigation, the model for verifying a generated tour actually taught something.
  - `src/features/home/sub_learning/HomeLearning.tsx` — the timeline that would list generated tours beside built-in ones.

- **Path to implementation**:
  1. Extract a build-time **anchor manifest**: a script that scans the codebase for stable `data-testid` route-level anchors + the nav enums (`SidebarSection`, tab types) and emits JSON (the tourAnchors test already proves the extraction is tractable). Doable now, pure tooling.
  2. Define `DynamicTourDef` = the existing `TourStepDef` shape minus i18n keys (inline strings), stored in a new `companion_tours` table; add `getTourById`/`getActiveTourSteps` resolution for dynamic ids so `GuidedTour.tsx` plays them unchanged.
  3. Add a `compose_tour` companion op (sibling of `compose_cockpit` in `src-tauri/src/companion/`): Athena receives the anchor manifest + the user's intent + live state (personas, credentials, triggers) and emits a validated step list; reject any step whose testid/nav target isn't in the manifest.
  4. Wire `WalkthroughOfferWidget`'s "Show me" to `compose_tour` when no static tour matches, with a ghost "composing your walkthrough…" state; narration comes free via the existing hook.
  5. Add generated tours to the Learning timeline with a "composed by Athena" badge and re-validation on app upgrade (manifest diff marks stale tours instead of letting them break — `highlightMissing` already covers runtime drift).
  6. Amplify: completion probes generated alongside the tour (compose_tour also emits a `detect` spec drawn from the Power Moves probe vocabulary), and one-click "share tour" export for team distribution.

- **Dependencies**: companion brain + doctrine templates, anchor-manifest build script, tourSlice/systemStore, i18n bypass for inline-string tours, `companion_tours` persistence.
- **Risks**: (1) UI drift — generated tours rot as the app evolves; the manifest-revalidation step and `highlightMissing` degradation are the mitigation, but stale narration text can still mislead. (2) LLM-authored navigation is only as good as the manifest's coverage — thin testid coverage in some sections means tours that spotlight nothing; needs a coverage report. (3) Scope creep toward "AI drives the app for you," which is a different (riskier) product — this must stay strictly *teach*, never *act*.
- **What changes if we ship it**: Every question that today ends in a chat paragraph can end in the app physically showing you, in your own data, with Athena's voice — onboarding, feature discovery, and team knowledge-transfer collapse into one generative surface, and the static tour library becomes merely the seed corpus.
