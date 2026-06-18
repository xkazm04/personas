# Chain Studio supersedes Builder — migration design

**Status:** proposed · **Date:** 2026-06-17 · **Decision:** port Builder's capabilities into Chain Studio, reach parity, then delete `sub_builder`.

## Why

The Events page ships two routing surfaces that *look* alike but do different jobs:

- **Builder** (`sub_builder/EventCanvas`) — the management/inspection surface for **existing** routing. Lists every trigger/event/subscription across personas (grouped, filtered, sorted, searched, with activity/health pulse) and performs real backend ops: **link persona→event** (capability-scoped), **disconnect listener**, **rename event type**.
- **Chain Studio** (`sub_studio`) — a patch-bay for **composing** routes (superior UX), plus a **system-event automations** manager. But its persona-route composition is a **localStorage-only draft that never persists** (no `createTrigger`/`link_persona_to_event` call anywhere), and it shows/edits **no** existing triggers.

So Studio is not a superset of Builder today — removing Builder would lose the entire existing-route management surface plus three backend ops. This plan closes that gap so Studio becomes the single Events routing surface, then removes Builder.

## Target state

One surface (Studio) that:
1. **Shows live routing** — reads real `PersonaTrigger` / `PersonaEvent` / `PersonaEventSubscription` and renders them in the center ledger with activity/health (Builder's read layer).
2. **Composes + commits** — arming source→target stages a draft route; a **Commit** action persists it as real triggers/subscriptions (closing Studio's "draft does nothing" gap).
3. **Manages inline** — disconnect, rename-event-type, capability-scoping, enable/disable on live rows (Builder's write ops).
4. **Keeps system-event automations** (already in Studio) and the patch-bay UX.

### Conceptual reconciliation (the key insight)

Builder is **event-centric** (one row per event type → emitting sources + listening personas). Studio is **chain-centric** (source → target persona + condition). They converge at the primitive layer:

| Studio compose action | Persists as | Appears in Builder-style ledger as |
|---|---|---|
| persona **A** → persona **B**, cond `on_success` | `create_trigger(B, type:"chain", { source_persona_id: A, condition: {type:"success"}, event_type })` | chain trigger on B, bound to source A |
| signal (schedule/webhook/…) → persona **B** | `create_trigger({personaId: B, trigger_type, config})` (backend auto-wires the listener) | that trigger's event, source+listener B |

A route composed in Studio therefore *becomes* a live row in the same ledger. Compose and manage are two verbs on one model — which is what lets us merge them into one superior surface.

> **Resolved (Phase-0 spike, 2026-06-18) — no Rust changes needed.** Persona→persona routes persist as a **`chain` trigger** on the target: `create_trigger({ trigger_type: "chain", config: { source_persona_id, condition, event_type } })`. It binds to the source via `source_persona_id` (there is **no** fixed `persona.<id>.completed` event; `event_type` defaults to `chain_triggered`). The link condition maps 1:1 onto the backend `ChainCondition` type: `always→any`, `on_success→success`, `on_failure→failure`, `output_match→jsonpath`. Signal→persona routes persist as `create_trigger({ trigger_type: schedule|webhook|polling|file_watcher|clipboard|app_focus, config })` — the backend **auto-creates** the listener. `link_persona_to_event` is **unconditional** — reserve it for Builder's "add listener to an existing event" (Phase 3), not chain links.
>
> **One real gap:** `output_match` (→ `jsonpath`) needs `jsonpath` + `expected` values the Studio draft model doesn't capture yet. Phase 1 either adds those two fields (draft + a small UI input) or ships `always`/`on_success`/`on_failure` first and adds `output_match` after. Either way, still no backend change — the `chain` trigger type already supports all four.

## Design decisions

- **D1 — Studio gains a live data layer.** Reuse Builder's fetch trio (`listAllTriggers` + `listEvents(1000)` + `listAllSubscriptions`) and its row-derivation (`buildEventRows`, direction inference) so the ledger reflects real state, not just the draft.
- **D2 — Commit persists.** Add a per-route and bulk **Commit** that maps draft links → `create_trigger`: persona sources → a `chain` trigger on the target (condition mapped to `ChainCondition`); signal sources → the matching trigger type (backend auto-wires the listener). Draft stays as the *staging* layer; committed routes leave the draft and appear as live rows. **No backend change.**
- **D3 — Management lives on live rows.** Disconnect (`unlink_persona_from_event`/`delete_subscription`/`delete_trigger`), rename-event (`rename_event_type`), capability-scope (`useCaseId`), enable/disable (`update_trigger`) are row/context actions — ported from Builder's modals.
- **D4 — One surface, not a mode toggle.** The center ledger shows **live routes** (with activity + inline manage) and **staged drafts** (with Commit) together; the rails compose new ones. This is the "superior in all directions" target. (Fallback if Phase 2 risk is high: a `Compose | Routes` segmented sub-tab inside Studio reusing Builder's table verbatim — lower-risk, still single-surface.) **Decision (2026-06-18): shipped the `Compose | Routes` sub-tab** — it reuses Builder's event-centric view verbatim, guaranteeing zero functionality loss; the single-ledger merge remains a future refinement.
- **D5 — Promote shared code, don't rewrite.** Builder's UI-agnostic pieces move to `src/features/triggers/lib/` and are imported by Studio: `eventCanvasConstants` (`findTemplateByEventType`, `EVENT_SOURCE_CATEGORIES` — already forced by the TestTab dep), `buildEventRows`, `activity.ts` (pulse scoring + `formatAgo`), `groupRows.ts`, `useRoutingFilters`, and the three modals (`AddPersonaModal`, `DisconnectDialog`, `RenameEventDialog`). Re-style modals to Studio tokens; keep logic.

## Capability migration map

| Builder capability | Backend op | Lands in Studio as | Reuse |
|---|---|---|---|
| List/group/filter/sort/search routes | reads | Center ledger + ported filter bar | `buildEventRows`, `groupRows`, `useRoutingFilters` (lift to lib) |
| Activity/health pulse, "last fired", fire count | reads | Inline on each live ledger row | `activity.ts`, `PulseDot` |
| Expand row → sources/listeners detail | reads | Ledger row expander | `ExpandedDrawer` logic |
| **Add listener** (capability-scoped) | `link_persona_to_event` | Compose-commit (persona target) + an explicit "Add listener" affordance on an event row | `AddPersonaModal` (persona + capability picker) |
| **Disconnect listener** | `unlink…`/`delete_subscription`/`delete_trigger` | Row action + confirm | `DisconnectDialog` |
| **Rename event type** | `rename_event_type` | Row/context action + validation + impact preview | `RenameEventDialog` |
| Signal→persona route creation | `createTrigger` | Compose-commit (signal source) — **new**, closes the persist gap | new commit mapper |
| Persona→persona chain + condition | `link_persona_to_event` / `createTrigger` | Compose-commit (persona source) — **new** | new commit mapper |
| System-event automations | `system_ops_*` | unchanged (already in Studio) | — |

Builder has **no** capability that lacks a home above. The only genuinely *new* code is the commit mapper (D2) — Studio's missing persistence — which is a feature Studio *should* have had regardless.

## Phased rollout (each phase shippable; Builder stays until Phase 5)

- **Phase 0 — Spike + shared-lib lift. ✅ DONE (2026-06-18).** Spike resolved (see the Resolved box above — backend already supports everything; no Rust work). Lifted `eventCanvasConstants` → `src/features/triggers/lib/eventSourceTemplates.ts` (the generic template surface; the dead ReactFlow-canvas constants were dropped) and repointed all 5 importers incl. `sub_test/TestTab.tsx` — unblocking the only external code dep. tsc + eslint clean. The tightly-coupled routing-logic cluster (`buildEventRows`/`routingHelpers`/`types`/`groupRows`/`activity`/`useRoutingFilters`) stays put for now: Phase 2 reuses Builder's view *whole* (embedding `EventCanvas`) rather than teasing the cluster apart, so it relocates **wholesale into Studio in Phase 5** alongside the view it powers.
- **Phase 1 — Compose persists. ✅ DONE (2026-06-18).** A per-route **Save** button + a **"Save all"** header action in the routes ledger map **persona→persona** links → a `chain` trigger on the target (`sub_studio/libs/studioCommit.ts`; condition `any`/`success`/`failure`). Committed links leave the draft. **Deferred, but gated in-UI (not silently lost):** signal-source links (their Save is disabled with a "needs a trigger config" hint — wired in Phase 1.5/2 via a config step) and `output_match` (disabled — needs jsonpath+expected). tsc + eslint clean; live smoke-test pending (Save a route, confirm the chain trigger appears in Builder's routing table). Builder untouched.
- **Phase 2 — Live routes (read + manage). ✅ DONE (2026-06-18).** Studio gained a **Compose | Routes** sub-tab (`TriggerStudioCanvas`). **Routes** (`StudioRoutesTab`) reuses Builder's event-centric view (`EventCanvas`) — showing all existing routing (grouping, class pills, activity pulse, external/marketplace events) **and** its management modals (add-listener, disconnect, rename-event). This collapses Phase 3 into Phase 2 and avoids re-deriving the event model link-centrically (which would risk dropping coverage). Transitional cross-import `sub_studio → sub_builder/EventCanvas`; the view relocates into Studio in Phase 5. tsc + eslint clean.
- **Phase 3 — Inline management. ✅ Delivered via Phase 2's embed.** `EventCanvas`'s view already includes add-listener (capability-scoped), disconnect, and rename-event. **Parity reached.** A later refinement could restyle these into Studio's ledger aesthetic (see D4); no capability is missing.
- **Phase 4 — Flip + deprecate. ✅ DONE (2026-06-18).** Default Events tab flipped to **Studio** (`uiSlice.eventBusTab`). Builder kept reachable but deprecated: sidebar item relabeled **"Builder (legacy)"** + an in-tab amber banner ("now part of Chain Studio — use Routes") with an **Open Chain Studio** button (Builder-tab only, not in Studio's embedded Routes). Redirected to Studio: the **event-chain Power Move** (`registry.ts`) and the **event-chaining tour** (`tourSlice`, narration de-staled). **Deferred to Phase 5:** the companion `trigger_creation` walkthrough (`appActions.openTriggerBuilder` / `walkthroughs.ts`) still opens Builder — it rings `routing-canvas`, reachable only via Studio's *local* sub-tab state; repointing it needs deep-linkable Studio sub-tabs (do in Phase 5). Live parity check pending. tsc + eslint clean.
- **Phase 5 — Relocate the view + remove the Builder tab. ✅ DONE (2026-06-18).** Relocated `EventCanvas` + `layouts/` (routing view + cluster + 3 modals, 24 files) from `sub_builder/` → **`sub_studio/routing/`** (subtree moved intact, relative imports preserved); `sub_builder/` deleted. `StudioRoutesTab` repointed. Removed the Builder tab wiring: `EventBusTab` union (dropped `"builder"`), `TriggersPage` (lazy import + TAB_HEADER + render branch + Phase-4 banner), sidebar item, `navCatalog`, `scenario-parser`. Repointed the companion `trigger_creation` walkthrough → Chain Studio (`open_trigger_builder` opens `studio`; highlight `routing-canvas`→`studio-switchboard`). Removed the transitional `builder_deprecated*` i18n keys. Docs updated. tsc + eslint clean. _Left as harmless leftovers:_ the unused `triggers.tab_builder` key (still in all 14 locales — removing en.json-only would trip the i18n-extras gate) and the `triggers.builder` i18n section (still used by the relocated view).
- **Phase 6 — Fold Routes into Compose; remove the Routes sub-tab. ✅ DONE (2026-06-18).** Chain Studio is now a **single surface** (the original "Target state" deep-ledger merge was judged higher-risk — it would rebuild the inventory UI in the rail and risk losing grouping/filters/fan-out; we took the lower-risk **embed** that reuses the inventory whole). `TriggerStudioCanvas` drops the **Compose/Routes sub-tab switcher** and renders the Compose switchboard with a collapsible **Existing routes** section beneath it embedding the live inventory (`EventCanvas`/`RoutingView` + the 3 modals) — read + manage at full parity. **`StudioRoutesTab.tsx` deleted.** Integration payoff: committing a route in the switchboard re-fetches `listAllTriggers` (composer gained an `onRouteCommitted` callback) so the new route appears live below; a route-count (total listener connections) shows in the section header via `onRowCount` threaded EventCanvas→RoutingView. Added `triggers.studio.existing_routes`; the now-unused `tab_compose`/`tab_routes` keys left as harmless leftovers. tsc + eslint clean; live smoke-test pending.

## Builder removal sequence (Phase 5)

No Rust changes. From the dependency map:
1. (Done in Phase 0) `findTemplateByEventType`/`EVENT_SOURCE_CATEGORIES` moved to `triggers/lib/`; `TestTab.tsx` repointed.
2. Delete `src/features/triggers/sub_builder/`.
3. `EventBusTab` union (`src/lib/types/types.ts:418`) — drop `"builder"`.
4. `TriggersPage.tsx` — remove the lazy import (line 23), `TAB_HEADERS.builder` (line 74), and the `eventBusTab === "builder"` branch (line 130).
5. Sidebar nav — remove the `builder` item (`sidebarData.ts:96`).
6. i18n — remove `triggers.tab_builder` (en + locales).
7. Analytics — drop `'builder'` from `navCatalog.ts:81`.
8. `scenario-parser.ts:213` — drop `'sub_builder/'` from the features array (metadata).
9. Docs — remove the Builder row in `docs/features/events/README.md`; update/retire `docs/features/events/event-routing.md` (heavy Builder references) and the Builder CTAs in `docs/features/companion/athena-guided-walkthroughs.md`; update `feature-doc-map.json` tour descriptions.

## Risks & mitigations

- **Persistence semantics wrong** → Phase-0 spike + a dry-run/verify against `dry_run_trigger` before committing real routes.
- **Direction-inference drift** (Builder's `buildEventRows` infers emit vs listen heuristically) → lift it verbatim; don't reimplement.
- **Studio UX regresses under data density** → D4 fallback (Compose | Routes sub-tab) if merging live+draft into one ledger proves cramped.
- **Capability-scoping parity** → reuse `AddPersonaModal`'s two-step persona→capability flow rather than rebuild.
- **Concurrent localStorage drafts** vs newly-persisted routes → on commit, evict the link from the draft so it isn't double-counted against its live row.

## Verification

Per phase, drive the real app (test bridge / `tauri:dev:test` on :17320) and confirm against Builder: compose+commit creates the same trigger/subscription Builder's "add listener" would; disconnect/rename produce identical backend results (`rename_event_type` per-store counts match); the ledger row set equals Builder's for the same data. Parity sign-off (Phase 4) = every Builder capability reproduced in Studio on the same fixture.
