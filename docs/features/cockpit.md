# Cockpit

The Cockpit is the **Home → Cockpit** 2nd-level surface. Its content is not statically authored — it is **composed by Athena (the companion plugin) via the `compose_cockpit` op**, mirroring the way the Dashboard tab is composed via `compose_dashboard`.

This file documents the moving parts so a future developer can extend it, debug it, or repurpose the pattern for another surface.

## Origin

The Cockpit replaced the legacy "Simple mode" feature (deleted 2026-05-11). Simple mode shipped three hardcoded variants (Mosaic, Console, Inbox) under `src/features/simple-mode/`; the Cockpit is a single canvas Athena writes to, so any layout/widget combination is possible without a code change.

## Lifecycle

```
user chat → Athena emits an OP envelope:
  OP: {"op": "propose_action", "action": "compose_cockpit",
       "params": {"title": "...", "widgets": [...]}, "rationale": "..."}
  ↓
src-tauri/src/companion/dispatcher.rs: match arm validates widgets,
  builds a spec JSON, queues it on Dispatched.cockpits
  ↓
src-tauri/src/companion/session.rs: Phase F loop persists each spec
  via brain::cockpit::save_cockpit(...) and emits COMPOSE_COCKPIT_EVENT
  ↓
src/features/plugins/companion/CompanionPanel.tsx: listener fires,
  calls setSidebarSection('home') + setHomeTab('cockpit')
  ↓
src/features/home/components/HomePage.tsx: routes to CockpitPanel
  ↓
CockpitPanel calls companionGetCockpit(), parses spec_json,
  renders widgets in a 12-col CSS grid
```

## Backend

| File | Role |
| --- | --- |
| `src-tauri/src/companion/brain/cockpit.rs` | Singleton storage. `companion_node` row (`kind='cockpit'`, `id='cockpit'`) + on-disk file `~/.personas/companion-brain/cockpit.md`. `save_cockpit` / `load_cockpit` pair. |
| `src-tauri/src/companion/dispatcher.rs` | `Dispatched.cockpits: Vec<String>` + `compose_cockpit` match arm. |
| `src-tauri/src/companion/session.rs` | `COMPOSE_COCKPIT_EVENT` constant + Phase F persist+emit loop. |
| `src-tauri/src/commands/companion/consolidate.rs` | `companion_get_cockpit` Tauri command. Returns `CockpitSpec { spec_json, updated_at }` or `null`. |
| `src-tauri/src/companion/templates/constitution.md` | Athena's doctrine. Documents the op grammar, the widget kinds available, and *when* to use the cockpit vs the dashboard vs prose. |

## Frontend

| File | Role |
| --- | --- |
| `src/features/home/sub_cockpit/CockpitPanel.tsx` | Reads spec, parses JSON, renders widgets in 12-col grid. Auto-reloads on window focus. Empty state renders the Athena portrait (`/athena/athena_baseline.jpg`) as an atmospheric background; its "Talk to Athena" CTA presets a "compose a persona-overview cockpit" prompt with `autoSend: true` and opens the chat panel (same `setPendingPrompt` pattern as `MessageDetailModal`). |
| `src/features/home/sub_cockpit/widgetRegistry.ts` | Map from widget `kind` string → React component. |
| `src/features/home/sub_cockpit/widgets/PersonaOverviewWidget.tsx` | Illustrated persona card grid. Click → Agents → that persona. Config: `{limit, filter}`. |
| `src/features/home/sub_cockpit/widgets/ConnectedServicesWidget.tsx` | Credentials + per-cred persona usage counts + health pill. Click → Connections page. Config: `{limit}`. |
| `src/features/home/sub_cockpit/widgets/DecisionsPanelWidget.tsx` | Flat list of `UnifiedInboxItem`s (approvals + messages + healing + outputs). Click row → opens `DecisionDrawer`. Config: `{limit}`. |
| `src/features/home/sub_cockpit/widgets/DecisionDrawer.tsx` | Modal drawer with full body + per-kind action buttons (approve/reject/resolve/mark-read). Uses `useInboxActions` from the companion inbox lib. |
| `src/api/companion.ts` | `CompanionCockpitSpec`, `CompanionCockpitWidget`, `companionGetCockpit()`, `COMPANION_COMPOSE_COCKPIT_EVENT`. |

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

The legacy `simple_mode` translation section was renamed to `cockpit` in Phase 5 of the migration. Only the keys still consumed survive:

- `cockpit.unknown_assistant` — fallback persona name
- `cockpit.inbox.relative_just_now`, `relative_minutes_{one,other}`, `relative_hours_{one,other}`, `relative_days_{one,other}` — relative-time labels used by `formatRelativeTime`.

All user-visible widget labels in `CockpitPanel`, `PersonaOverviewWidget`, `ConnectedServicesWidget`, `DecisionsPanelWidget`, and `DecisionDrawer` are currently English placeholders awaiting i18n extraction (per the fix-as-you-touch policy).

## Adding a new widget kind

1. Implement a React component in `src/features/home/sub_cockpit/widgets/` accepting `CockpitWidgetProps` (`title`, `config`).
2. Register it in `widgetRegistry.ts` under a stable string key.
3. Document the kind + its config schema in `constitution.md`'s "Cockpit composition" section so Athena knows it exists.
4. Optionally allow it as an inline chat card by mapping a new `show_*` action to the kind in `dispatcher.rs`'s show-card match arm.

## Why not just hardcode the cockpit?

The same reason the Dashboard isn't hardcoded — letting Athena compose it lets the user say "show me my email assistants and what's pending" or "I'm launching a new project, give me the overview" and get a tailored canvas without anyone shipping a new screen. The 3 widgets we ship are starting points; Athena chooses which subset, at what span, with what config, per request.
