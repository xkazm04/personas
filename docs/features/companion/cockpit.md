# Cockpit

The Cockpit is the **Home → Cockpit** 2nd-level surface. Its content is not statically authored — it is **composed by Athena (the companion plugin) via the `compose_cockpit` op**.

This file documents the moving parts so a future developer can extend it, debug it, or repurpose the pattern for another surface.

> **Status (verified 2026-09-06).** The surface is live and has grown well past what the body below describes. What changed since this file was last accurate:
>
> - **The dedicated Dashboard tab was retired. Cockpit IS the dynamic dashboard surface**. `compose_dashboard` now navigates to Home → Cockpit like `compose_cockpit` does (`src/features/plugins/companion/chat/athenaChatNavigation.ts:150-155`). `HomeTab` is `welcome | cockpit | roadmap | system-check | learning` (`src/lib/types/types.ts:412`), and three of those five are DEV-only (`HomePage.tsx:70-95`).
> - **`companion/dispatcher.rs` and `companion/session.rs` are now DIRECTORIES.** The `compose_cockpit` match arm is `src-tauri/src/companion/dispatcher/dispatch.rs:959`; the persist+emit loop is `src-tauri/src/companion/session/turn.rs:798-816`; `COMPOSE_COCKPIT_EVENT` is declared in `src-tauri/src/companion/session/events.rs:50`.
> - **There is no `CompanionPanel.tsx`.** The chat panel was split into `src/features/plugins/companion/chat/`; the compose listener is `athenaChatNavigation.ts:161` and the `explain_in_cockpit` listener is `athenaChatShell.ts:54`.
> - **Pin-to-cockpit shipped.** See the new section below.
> - **A deterministic default board shipped** (`src/features/home/sub_cockpit/defaultCockpit.ts`), so the "renders nothing until Athena has composed" gap is closed for any install that has at least one persona.
> - **A morning-briefing overlay shipped** (`src/features/home/sub_cockpit/briefing/`, sanitizer in `src-tauri/src/companion/brain/briefing.rs`).
> - **The registry is 29 widget kinds**, not the 3 + 6 the tables below list (`src/features/home/sub_cockpit/widgetRegistry.ts`).
> - **Widget labels ARE localized now**: 87 keys under `overview.cockpit.*` in `src/i18n/locales/en.json`. The `cockpit.*` section noted at the bottom of this file is only the two legacy families.
>
> Still true as written: there is no telemetry anywhere in `sub_cockpit/`; `companionUnpinWidgetFromCockpit` (`src/api/companion.ts:1812`) still has no caller; `useCockpitSummary` still has no production consumer (only `inbox/hooks/useCockpitSummary.test.ts`); and the persistent `compose_cockpit` path still validates only that `widgets` is a non-empty array (`dispatch.rs:960-967`) while `explain_in_cockpit` validates kinds against a 9-kind allow-list (`dispatch.rs:986-996`).

> **Status (2026-08-04): the Cockpit is unchanged and still works, but its *ability* now has a second, better-validated home.** A design pass over "why did the free plate never earn its keep" found six independent reasons, all in the code rather than in taste: the constitution actively steers Athena toward inline chat cards and treats composing a board as the fallback branch; the default board is four widgets and renders nothing at all until at least one persona exists (`CockpitPanel.tsx:185` gates on `personas?.length > 0`; the four widgets are computed from live fleet state, not static, `defaultCockpit.ts:68-146`); the widget registry's real consumer is the chat transcript, since `InlineChatCard` renders from the same registry and the persona-design family is only ever emitted as chat cards; the one flow that reliably opens the tab is an *overlay* (`explain_in_cockpit`, the morning briefing) which deliberately skips fetching the persistent board; there is no telemetry anywhere in the surface; and two of its own affordances are dead (`companionUnpinWidgetFromCockpit` has no caller, `useCockpitSummary` has no production consumer).
>
> Two validation asymmetries are worth knowing before extending anything here. `explain_in_cockpit` validates widget kinds against a 9-kind allow-list and drops the rest; the **persistent** `compose_cockpit` path validates only that `widgets` is a non-empty array, so a hallucinated kind is written to disk and renders a red error box on every open, with no reset path. The strongest validation in the feature (kind allow-list, caps, and a per-widget-kind action cross-check) lives in the morning-briefing sanitizer (`sanitize_briefing_spec`, `src-tauri/src/companion/brain/briefing.rs:232`), outside the dispatcher entirely.
>
> **Where the ability went.** [`SurfaceRenderer`](../../../src/features/shared/components/surface/) — zod schema, salvage-instead-of-reject parsing, clamping, a frozen block catalog and consent-gated actions — is the newer engine, and it is what now renders Athena's composed panels on the [Mastermind canvas](../plugins/dev%20tools/mastermind.md). Those panels persist per project, carry a spec version, drop an unreadable spec rather than retaining it, and have a per-project reset — the specific failure this surface still has.
>
> Nothing here was deleted: the decision was to prove the replacement before touching the original. If you are adding a new dynamic surface, start from `SurfaceRenderer`, not from `cockpitWidgetRegistry`. Note also that widget kind strings are currently duplicated across five places with no shared source of truth (registry, dispatcher allow-list, briefing sanitizer, `InlineChatCard`, and the constitution), so adding a widget means editing all five.

## Origin

The Cockpit replaced the legacy "Simple mode" feature (deleted 2026-05-11). Simple mode shipped three hardcoded variants (Mosaic, Console, Inbox) under `src/features/simple-mode/`; the Cockpit is a single canvas Athena writes to, so any layout/widget combination is possible without a code change.

## Lifecycle

```
user chat → Athena emits an OP envelope:
  OP: {"op": "propose_action", "action": "compose_cockpit",
       "params": {"title": "...", "widgets": [...]}, "rationale": "..."}
  ↓
src-tauri/src/companion/dispatcher/dispatch.rs:959, match arm checks
  `widgets` is a non-empty array, builds a spec JSON, queues it on
  Dispatched.cockpits
  ↓
src-tauri/src/companion/session/turn.rs:798, auto-fire loop persists each
  spec via brain::cockpit::save_cockpit_preserving_pinned(...) and emits
  COMPOSE_COCKPIT_EVENT
  ↓
src/features/plugins/companion/chat/athenaChatNavigation.ts:161, listener
  fires goToCockpit(true): setSidebarSection('home') + setHomeTab('cockpit')
  ↓
src/features/home/components/HomePage.tsx: routes to CockpitPanel
  ↓
CockpitPanel calls companionGetCockpit(), parses spec_json,
  renders widgets in a 12-col CSS grid
```

## Backend

| File | Role |
| --- | --- |
| `src-tauri/src/companion/brain/cockpit.rs` | Singleton storage. `companion_node` row (`kind='cockpit'`, `id='cockpit'`) + on-disk file `~/.personas/companion-brain/cockpit.md`. `save_cockpit` / `load_cockpit` pair, plus `save_cockpit_preserving_pinned` (the compose path) and a `COCKPIT_WRITE_LOCK` serializing the load-modify-save cycle the pin flow shares. |
| `src-tauri/src/companion/dispatcher/dispatch.rs` | `compose_cockpit` match arm (`:959`) and `explain_in_cockpit` (`:980`). `Dispatched.cockpits: Vec<String>` is declared in `dispatcher/types.rs:32`. |
| `src-tauri/src/companion/session/turn.rs` | The persist+emit auto-fire loops (`:798` cockpit, `:853` explain). `COMPOSE_COCKPIT_EVENT` / `EXPLAIN_COCKPIT_EVENT` live in `session/events.rs:50`. |
| `src-tauri/src/commands/companion/consolidate.rs` | `companion_get_cockpit` (`:336`), `companion_pin_widget_to_cockpit` (`:355`), `companion_unpin_widget_from_cockpit` (`:451`). |
| `src-tauri/src/companion/brain/briefing.rs` | Morning-briefing composition + `sanitize_briefing_spec` (`:232`), which holds the kind allow-list, widget cap, and per-kind action cross-check. Emits a cockpit-spec body rendered as an overlay, never persisted. |
| `src-tauri/src/companion/templates/constitution.md` | Athena's doctrine. Documents the op grammar, the widget kinds available, and *when* to use the cockpit vs the dashboard vs prose. |

## Frontend

| File | Role |
| --- | --- |
| `src/features/home/sub_cockpit/CockpitPanel.tsx` | Reads spec, parses JSON, renders widgets in 12-col grid. Auto-reloads on window focus. Empty state renders the Athena portrait (`/athena/athena_baseline.jpg`) as an atmospheric background; its "Talk to Athena" CTA presets a "compose a persona-overview cockpit" prompt with `autoSend: true` and opens the chat panel (same `setPendingPrompt` pattern as `ReportDetailModal`, `CockpitPanel.tsx:87-96`; `MessageDetailModal` was renamed in the Messages-to-Reports rebrand). |
| `src/features/home/sub_cockpit/defaultCockpit.ts` | `composeDefaultCockpit(personas, metrics, labels)` builds the deterministic starter board (orientation callout · fleet vitals stat grid · persona roster · needs-attention issue list), composed in TS with **no LLM call** from data already client-side. Athena's persisted spec always wins; this fills the never-composed gap, and only when at least one persona exists. Pure and framework-free (labels are injected already-localized) so it unit-tests. |
| `src/features/home/sub_cockpit/briefing/` | Morning Director overlay: `useMorningBriefing` (once per app session, delta-gated so no LLM call when nothing happened; called from `HomePage.tsx:34`), `actions.ts` / `actionTypes.ts` (the `WidgetActionBar` action grammar), `sessionDelta.ts`. |
| `src/features/home/sub_cockpit/widgetRegistry.ts` | Map from widget `kind` string → React component. **29 kinds** as of 2026-09-06. |
| `src/features/home/sub_cockpit/widgets/PersonaOverviewWidget.tsx` | Illustrated persona card grid. Click → Agents → that persona. Config: `{limit, filter}`. |
| `src/features/home/sub_cockpit/widgets/ConnectedServicesWidget.tsx` | Credentials + per-cred persona usage counts + health pill. Click → Connections page. Config: `{limit}`. |
| `src/features/home/sub_cockpit/widgets/DecisionsPanelWidget.tsx` | Flat list of `UnifiedInboxItem`s (approvals + messages + healing + outputs). Click row → opens `DecisionDrawer`. Config: `{limit}`. |
| `src/features/home/sub_cockpit/widgets/DecisionDrawer.tsx` | Modal drawer with full body + per-kind action buttons (approve/reject/resolve/mark-read). Uses `useInboxActions` from the companion inbox lib. |
| `src/api/companion.ts` | `CompanionCockpitSpec`, `CompanionCockpitWidget`, `companionGetCockpit()` (`:1782`), `companionPinWidgetToCockpit()` (`:1791`), `companionUnpinWidgetFromCockpit()` (`:1812`), `COMPANION_COMPOSE_COCKPIT_EVENT`, `COMPANION_EXPLAIN_COCKPIT_EVENT`. |

The 29 registered kinds fall into six families: the three data-fetching originals (`persona_overview`, `connected_services`, `decisions_panel`); four contextual ones composed programmatically by other surfaces rather than by Athena (`message_summary`, `execution_facts`, `linked_decisions`, `linked_memories`); three generic ones (`metric_spark`, `issue_list`, `text_callout`); the six explainers below; the eleven persona-design cards (`persona_walkthrough`, `template_suggestions`, `use_case_set`, `trigger_set`, `model_tier_choice`, `observability_plan`, `decision_log`, `persona_ready`, `design_capabilities`, `persona_creation_offer`, `walkthrough_offer`); and `browser_test_report` / `recent_decisions`.

## Explainer widgets + `explain_in_cockpit` (2026-06-10)

Six generic, animated widgets exist for Athena to *explain* a situation
visually instead of in prose. They're populated entirely from her reasoning
(no per-widget fetch), registered in the same `widgetRegistry.ts`, and valid
in both `compose_cockpit` and the dedicated `explain_in_cockpit` op:

| Kind | Renders | Notable config |
| --- | --- | --- |
| `verdict` | The answer card: headline recommendation + reasoning + caveat. Renders the pending orb decision's own option chips (live, via `runDecisionOption`) so the user can resolve it from the Cockpit. | `headline`, `reasoning`, `confidence`, `intent`, `recommended_option`, `caveat` |
| `flow_steps` | Causal/sequence chain with status nodes + draw-in connector rail. | `steps[{label, detail?, status}]` |
| `comparison_cards` | Options side-by-side with pros/cons + recommended badge. | `options[{label, summary?, pros?, cons?, recommended?, intent?}]` |
| `timeline` | Chronological events with intent dots + relative timestamps. | `events[{label, detail?, timestamp?, intent?}]` |
| `stat_grid` | 2-4 column tile grid of labeled figures with deltas. | `stats[...]`, `columns` |
| `log_excerpt` | Monospace evidence block with highlighted lines + caption. | `lines`, `highlight_lines`, `highlight_intent`, `caption`, `source` |

**`explain_in_cockpit` — the orb decision `0` flow.** When the user presses
`0` (Explain) on the orb decision bubble, `resolveDecision.ts` fires a
synthetic `decision-explain` turn (`companion_send_message` with
`systemSource`) carrying the decision's full context (prompt, options,
prior recommendation, and the underlying approval/incident/review payload).
Athena replies with one `explain_in_cockpit` op. Unlike `compose_cockpit`,
the spec **rides in the event payload (`EXPLAIN_COCKPIT_EVENT`) and is never
persisted** — the CompanionPanel listener sets it as the `contextualCockpit`
overlay (source kind `'explain'`), navigates Home → Cockpit, and dismissal
restores the user's persistent board untouched. The dispatcher validates
widget kinds against the explainer set (plus `text_callout` / `metric_spark`
/ `issue_list`) and drops unknown kinds with a warning.

Latency UX while the turn runs: the orb plays the `composing` clip
(`athena_shows_loop.mp4`, new `AthenaState`), the bubble shows a processing
row and disables `0`; on failure the bubble falls back to a quiet line —
the pre-baked static recommendation is always the floor. QA bridge methods
`injectAdhocDecision` / `getExplainState` (test-automation builds) drive the
flow synthetically.

## Pin to cockpit

A widget rendered as an inline chat card can be **pinned** onto the persistent board. `InlineChatCard.tsx:119` calls `companionPinWidgetToCockpit({...})` for the six kinds in its `PINNABLE_KINDS` set (`persona_overview`, `connected_services`, `decisions_panel`, `metric_spark`, `issue_list`, `text_callout`: dashboard-shaped surfaces only; advisory one-shots are deliberately not pinnable, `InlineChatCard.tsx:39-46`); the command (`consolidate.rs:355`) loads the spec, stamps the widget with a top-level `"pinned": true`, and saves it back.

The compose path then has to respect that. `session/turn.rs:806` calls **`save_cockpit_preserving_pinned`** rather than `save_cockpit`, which extracts pinned widgets from the previous spec and **appends** them after Athena's freshly-composed ones (deduped on same `kind` + same `config`), so Athena's layout reads first and the user's pins follow as a tail section. Without it a pin would vanish the next time Athena composed anything (`brain/cockpit.rs:64-93`).

Both flows do load-modify-save over one JSON blob with no DB transaction or version check, so they share `COCKPIT_WRITE_LOCK` (`brain/cockpit.rs:32`) for the whole critical section.

`companion_unpin_widget_from_cockpit` exists, is registered (`src-tauri/src/lib.rs:1371`) and is wrapped in `src/api/companion.ts:1812`, but **nothing in the UI calls it**. There is no way to remove a pin from inside the app.

## Inline chat cards (related but separate)

Athena can also surface the same widgets *inside* the chat transcript without composing a full cockpit. Three additional ops (`show_persona_overview`, `show_connected_services`, `show_decisions`) auto-fire (no approval) per turn and emit `COMPANION_CHAT_CARDS_EVENT` carrying a `ChatCard[]` payload. The `InlineChatCard` component (`src/features/plugins/companion/InlineChatCard.tsx`) renders each card by looking up the kind in the cockpit widget registry — same component, compact size. One-shot: cleared on the next send.

Use inline cards when a UI snippet beats prose for *this turn*; compose the cockpit when the user is landing on the app or wants a persistent overview.

## Data layer: `companion/inbox/`

The unified-inbox abstraction (`useUnifiedInbox`, `useInboxActions`, four adapters, illustration resolver, relative-time formatter) lives under `src/features/plugins/companion/inbox/`. Consumed by the Cockpit's `DecisionsPanelWidget`, the inline `DecisionsCard`, and any future chat-card or cockpit widget that wants the same data shape.

| Hook | Purpose |
| --- | --- |
| `useUnifiedInbox()` | Merges manualReviews + messages + healingIssues across personas into a sorted, capped `UnifiedInboxItem[]`. |
| `useCockpitSummary()` | Header counters (runs today, active personas, connected creds, needs-me count). |
| `useIllustration(persona)` | Deterministic 4-tier resolver mapping a Persona to one of 12 watercolor PNGs under `public/illustrations/personas/`. |
| `useInboxActions(item)` | Per-kind action triple (primary / secondary / tertiary) that calls into the overview store. |

## i18n

The legacy `simple_mode` translation section was renamed to `cockpit` in Phase 5 of the migration. Only two key families survive in that top-level `cockpit` section:

- `cockpit.unknown_assistant` — fallback persona name
- `cockpit.inbox.relative_just_now`, `relative_minutes_{one,other}`, `relative_hours_{one,other}`, `relative_days_{one,other}` — relative-time labels used by `formatRelativeTime`.

**The extraction has since happened.** The Cockpit's own user-visible strings live under **`overview.cockpit.*`**: 87 keys in `src/i18n/locales/en.json` covering the panel chrome (`title_default`, `subtitle_*`, `error_*`, `empty_*`, `unknown_widget`), the explainer widgets (`verdict_*`, `flow_title`, `timeline_title`, `log_title`, `comparison_recommended`), the default board (`default_*`, consumed via `DefaultCockpitLabels` at `CockpitPanel.tsx:162-183`), and the morning briefing (`briefing_*`, `action_*`).

## Adding a new widget kind

1. Implement a React component in `src/features/home/sub_cockpit/widgets/` accepting `CockpitWidgetProps` (`title`, `config`).
2. Register it in `widgetRegistry.ts` under a stable string key.
3. Document the kind + its config schema in `constitution.md`'s "Cockpit composition" section so Athena knows it exists.
4. Optionally allow it as an inline chat card by mapping a new `show_*` action to the kind in `dispatcher/dispatch.rs`'s show-card match arms.
5. If it is dashboard-shaped, add it to `PINNABLE_KINDS` in `InlineChatCard.tsx:39`.

(There is still no shared source of truth for kind strings: the registry, the `explain_in_cockpit` allow-list in `dispatch.rs:980`, the briefing sanitizer in `brain/briefing.rs`, `InlineChatCard`'s two sets, and the constitution each carry their own copy.)

## Why not just hardcode the cockpit?

Letting Athena compose it lets the user say "show me my email assistants and what's pending" or "I'm launching a new project, give me the overview" and get a tailored canvas without anyone shipping a new screen. The 29 registered kinds are the vocabulary; Athena chooses which subset, at what span, with what config, per request.
