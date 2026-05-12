# Code-refactor scan — Trigger Studio & Webhooks

> Total: 12 findings (5 high, 5 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: significant — see below

## Path drift

The scope listed several paths that do not exist in the codebase. Actual layout:

- `src/features/triggers/{studio,webhooks,dlq}` → actually `src/features/triggers/sub_studio`, `sub_cloud_webhooks`, `sub_dead_letter`, `sub_smee_relay`, `sub_triggers`, `sub_builder`, `sub_test`, `sub_shared`, `sub_live_stream`, `sub_speed_limits`, plus `hooks/` and `lib/`.
- `src/api/triggers.ts` / `src/api/webhooks.ts` / `src/api/smee.ts` → consolidated into `src/api/pipeline/triggers.ts` (and `src/api/system/cloud.ts` for smee/cloud-webhook helpers).
- `src/lib/triggers` / `src/lib/webhooks` → do not exist; trigger constants live at `src/lib/utils/platform/triggerConstants.ts`.
- `src/stores/slices/triggerSlice.ts` → actually `src/stores/slices/pipeline/triggerSlice.ts`. No `webhookSlice.ts` exists.
- `src-tauri/src/commands/triggers.rs` → `src-tauri/src/commands/tools/triggers.rs`. `webhooks.rs` does not exist (HTTP server lives in `src-tauri/src/engine/webhook.rs`; cloud-webhook helpers under tools triggers + `src/engine/cloud_webhook_relay.rs`; smee in `src-tauri/src/engine/smee_relay.rs`). No `commands/smee_relay.rs`.
- `src-tauri/src/db/models/{trigger,webhook,dlq}.rs` → only `trigger.rs`, `webhook_log.rs`, `smee_relay.rs` exist; no DLQ model file.
- `src-tauri/src/db/repos/{triggers,webhooks,dlq}/` (folders) → flattened files: `db/repos/resources/{triggers.rs,webhook_log.rs,cloud_webhook_watermarks.rs}` and `db/repos/communication/smee_relays.rs`.
- DLQ logic lives in `src-tauri/src/commands/communication/events.rs` and `src/api/overview/events.ts`, not in any "dlq" path.

## 1. Entire `sub_triggers/` UI tree is orphaned (~3,790 LOC dead)

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/triggers/sub_triggers/` (28 files)
- **Scenario**: `TriggerConfig.tsx` (the root of this tree, an "old persona-detail trigger editor") is exported but never imported anywhere in the codebase. Every component reachable only from it — `TriggerListItem`, `TriggerRow`, `TriggerStatusSummary`, `TriggerList`, `TriggerDetailDrawer`, `TriggerExecutionHistory`, `TriggerHealthSparkline`, `TriggerConfigSection`, `TriggerCountdown`, `WebhookRequestInspector`, `CompositePartialMatchIndicator`, `TriggerAddForm`, `TriggerCategorySelector`, `TriggerTypeSelector`, `TriggerQuickTemplates`, `NlTriggerInput`, `nlTriggerParser` (+ test), `DryRunResultView`, `RateLimitControls`, `ActiveHoursSection`, `RadialCountdownRing`, `HealthDot`, `TriggerScheduleConfig`, `TriggerSchedulePreview`, the 9 files under `configs/`, plus `triggerListTypes.ts` — is reachable only from this orphan root.
- **Root cause**: A 2024-era persona-detail trigger editor was superseded by the unified routing view (`sub_builder/layouts/UnifiedRoutingView`) and the new `sub_studio/` canvas, but the old module was never deleted. Verified by grep: `grep -r "sub_triggers" src` returns exactly one external import — `FrequencyEditor.tsx:7` which pulls `TimezoneSelect`. No other file (incl. `__tests__/`, `i18n/`, lazy imports) references `TriggerConfig`, `TriggerListItem`, `TriggerRow`, `TriggerDetailDrawer`, `TriggerAddForm`, etc.
- **Impact**: ~3,790 LOC of UI code (and the entire `nlTriggerParser` engine with its test) shipped in every bundle, drives the i18n bundle's `triggers.*` keyspace far larger than the live UI needs, and confuses code-search results when chasing "trigger form" bugs. Future contributors paste fixes into the dead form.
- **Fix sketch**: Move `TimezoneSelect.tsx` (76 LOC) and `getDetectedTimezone()` to a neutral home (e.g. `src/lib/utils/platform/timezone.ts` or `src/features/schedules/components/`). Delete the rest of `sub_triggers/` and `src/features/triggers/lib/triggerError.ts` (also orphaned with this tree — see finding #4). Audit `i18n` for `triggers.tpl_*`, `triggers.type_*`, `triggers.category_*` keys that become unused.

## 2. Triple-registered trigger-type taxonomy across 3 files

- **Severity**: high
- **Category**: duplication
- **File**: `src/lib/utils/platform/triggerConstants.ts:13`, `src/lib/utils/platform/triggerConstants.ts:102`, `src/features/triggers/sub_studio/libs/triggerStudioConstants.ts:33`
- **Scenario**: The same 10 trigger types (`schedule`, `polling`, `webhook`, `manual`, `chain`, `event_listener`, `file_watcher`, `clipboard`, `app_focus`, `composite`) are enumerated three times with overlapping fields: `TRIGGER_TYPE_META` (icon+color, 10 entries), `TRIGGER_TYPE_OPTIONS` (type+label+description, 10 entries), and `TRIGGER_BLOCK_TEMPLATES` (id+triggerType+label+description+icon+color, 9 entries — missing `manual`). The studio's `TRIGGER_BLOCK_TEMPLATES` *redefines* its own icons (e.g. `Clock` for schedule, `Globe` for polling) instead of importing from `TRIGGER_TYPE_META`; e.g. `triggerStudioConstants.ts:35` uses `Globe` for polling while `triggerConstants.ts:15` uses `RefreshCw`. Same for `polling` color: `text-teal-400` in both, but `file_watcher` differs: `text-cyan-400` (studio) vs `text-orange-400` (meta). Drift is already observable.
- **Root cause**: Each surface (form selector / studio palette / status badge) was implemented independently, and no one consolidated the registries. There's even a fourth list — the Rust `VALID_TRIGGER_TYPES` constant in `src-tauri/src/validation/trigger.rs:3`.
- **Impact**: When a new trigger type is added, contributors must touch 3 frontend files + 1 Rust file or risk a partial rollout (e.g. type appears in the form but renders with the default `Zap` icon in the studio). Already happened: `composite` exists in studio templates (`triggerStudioConstants.ts:42`) but `file_watcher` is mis-colored.
- **Fix sketch**: Collapse to a single `TRIGGER_TYPE_REGISTRY` keyed by trigger_type with `{ icon, color, label, description, category }`. Have `TRIGGER_TYPE_OPTIONS`, `TRIGGER_TYPE_META`, and `TRIGGER_BLOCK_TEMPLATES` derived from it via simple selectors. Bonus: emit `VALID_TRIGGER_TYPES` to a generated Rust constant via `ts-rs` (already used elsewhere) so the validator stays in sync.

## 3. `commands/tools/triggers.rs` god-file (1,801 LOC, 27 commands)

- **Severity**: high
- **Category**: structure
- **File**: `src-tauri/src/commands/tools/triggers.rs:1`
- **Scenario**: Single file contains 27 `#[tauri::command]` entry points covering CRUD, validation, dry-run, cron preview/range, event-handler patching, event-type renaming, cleanup sweeps, persona-event linking/unlinking, cron-to-human formatting, and webhook request log replay. Functions like `cron_to_human` / `format_time_from_cron` / `format_dow` / `format_dom` (lines 865-990) are pure presentation helpers buried in the commands file. The 1,801-LOC file mixes auth, validation, business logic, transactional repo calls, and HTTP client construction (`reqwest::Client::builder()` for SSRF-checked polling-URL validation, lines 362-369).
- **Root cause**: Organic growth — each feature added more commands without rehoming related helpers. Compare to `db/repos/resources/triggers.rs` (3,012 LOC, 34 functions) which has the same problem on the repo side.
- **Impact**: Compile times balloon (any change recompiles 1,800 lines and downstream `mod`), test isolation is poor, and the auth/validation contract (every command starts with `require_auth_sync` then `validate_…`) is repeated 27× with no shared wrapper. The owner-check `if existing.persona_id != persona_id { return Err(…) }` is duplicated verbatim in `update_trigger` (lines 107-113) and `delete_trigger` (lines 148-154).
- **Fix sketch**: Split into modules: `commands/triggers/crud.rs`, `commands/triggers/validation.rs` (move `validate_trigger`, the HTTP/cron helpers), `commands/triggers/cron_format.rs` (move `cron_to_human` + descendants), `commands/triggers/event_linking.rs`, `commands/triggers/webhook_logs.rs`. Extract `assert_trigger_owned_by(state, &id, &persona_id) -> Result<PersonaTrigger>` to dedupe the ownership check.

## 4. `lib/triggerError.ts` + the `validation` discriminant only ever serve dead callers

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/triggers/lib/triggerError.ts:14`, `src/stores/slices/pipeline/triggerSlice.ts:37`
- **Scenario**: `useRenderTriggerError` and `triggerErrorPresentation` are imported by exactly one file: `sub_triggers/TriggerConfig.tsx` — which is itself orphaned (finding #1). The slice still defines a three-arm discriminant `TriggerErrorKind = 'crud' | 'fetch' | 'validation'` with elaborate JSDoc, but `validation` is never produced anywhere in the codebase: `grep -rn "kind: 'validation'"` returns zero hits. Only `'crud'` (3 sites in `triggerSlice.ts`) and `'fetch'` (1 site) are ever set.
- **Root cause**: The dispatch helper was authored alongside the old TriggerConfig form and never wired into the new builder/studio/dry-run surfaces; the `validation` arm was speculative.
- **Impact**: ~60 LOC of dead helper + a misleading invariant in the slice's JSDoc that suggests every surface routes errors through this layer when none do. Future contributors believe there's a centralized error renderer and look for it; there isn't.
- **Fix sketch**: Delete `src/features/triggers/lib/triggerError.ts`. Drop `'validation'` from `TriggerErrorKind` in `triggerSlice.ts:37`. If the centralized presentation is desired, re-introduce on real callers (CloudWebhooksTab, SmeeRelayTab, builder UI) — but that's a separate ticket.

## 5. Duplicated event-encrypt-and-insert helper in two engine files

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/webhook.rs:532` and `src-tauri/src/engine/cloud_webhook_relay.rs:358`
- **Scenario**: `mark_triggered_and_publish` (webhook.rs:532-595) and `publish_and_upsert_watermark` (cloud_webhook_relay.rs:358-414) duplicate the entire "encrypt payload at rest if present" branch (`crypto::encrypt_for_db(plaintext)`, fall back to plaintext on error, derive `project_id` default) and the `INSERT INTO persona_events (...) VALUES (?1...?10)` statement column-for-column. The only meaningful difference is what *else* happens in the transaction (UPDATE persona_triggers version vs UPSERT cloud_webhook_watermarks).
- **Root cause**: Two webhook subsystems (local HTTP server + cloud relay) were built at different times by different waves; each grew its own transactional helper.
- **Impact**: Bug fixes (e.g. the encryption-fallback warning, the `'default'` project_id fallback) must be made in both places or one ingestion path silently diverges. Schema changes to `persona_events` columns (payload_iv was added later) require touching both INSERTs.
- **Fix sketch**: Extract `engine/event_publish.rs::insert_event_in_tx(tx, &input, id, now) -> Result<()>` that takes an existing `&Transaction` and encapsulates the encryption + INSERT. Have both callers wrap it with their specific UPDATE/UPSERT statement. Reduces ~30 duplicated LOC per call site to ~3.

## 6. Two near-identical status-banner+create-form layouts in webhook tabs

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:152` and `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:146`
- **Scenario**: Both tabs render the same shell: aggregate status banner (status dot + count + last-event time + refresh button), header row with title + add-button toggle, expandable create-form panel with inline validation, loading spinner, empty state, animated list of items with status pill + actions (toggle/delete/copy), and a "confirm delete" 2-step UX. Status-dot pattern `<div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />` literally appears 3× across these two files (CloudWebhooksTab.tsx:155, SmeeRelayTab.tsx:154, SmeeRelayTab.tsx:379).
- **Root cause**: Independent implementation of two webhook-style tabs. No shared "ResourceManagerTab" abstraction.
- **Impact**: Visual/behavioral drift already exists (CloudWebhooksTab uses `bg-blue-500/5` accent, SmeeRelayTab `bg-purple-500/5`; SmeeRelayTab has touched-fields inline validation, CloudWebhooksTab doesn't; SmeeRelayTab uses framer-motion `AnimatePresence`, CloudWebhooksTab does not). Future a11y or focus-visible work must touch both.
- **Fix sketch**: Extract `StatusBanner`, `StatusDot`, and `ResourceListShell` shared components into `src/features/triggers/sub_shared/` (the dir already exists). Parametrize accent color + i18n strings. CloudWebhooksTab and SmeeRelayTab become thin orchestrators around fetch + the shared shell.

## 7. Dead exports in `triggerStudioConstants.ts` (~50 LOC)

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/triggers/sub_studio/libs/triggerStudioConstants.ts:45,98,108-119`
- **Scenario**: Several exports are declared but have zero callers:
  - `findTriggerTemplate()` (line 45) — `grep` finds zero imports.
  - `CHAIN_EDGE_STYLES` (line 98) — declared but `ChainEdge.tsx:26` hardcodes its own `#6366f1` / `#f59e0b` / `#10b981` strokes rather than consuming this constant.
  - `PALETTE_CATEGORIES` and `StudioPaletteCategory` (lines 108-119) — `TriggerStudioPalette.tsx` instead hardcodes its three sections (`Trigger Sources`, `Persona Steps`, `Logic Gates`) with inline icons.
- **Root cause**: Helpers authored speculatively during the studio MVP, never wired up; ChainEdge then duplicated the colors anyway.
- **Impact**: ~50 LOC dead + an aggravating dual-source-of-truth (the styles in `CHAIN_EDGE_STYLES` and the literal hex codes in `ChainEdge.tsx` are *not* in sync — `default` color is `#6366f1` in both but `parallel` is unused).
- **Fix sketch**: Delete `findTriggerTemplate`, `PALETTE_CATEGORIES`, `StudioPaletteCategory`. Either delete `CHAIN_EDGE_STYLES` or, better, have `ChainEdge.tsx:26-36` consume it via `CHAIN_EDGE_STYLES[styleKey].stroke` (preferred — single source of truth).

## 8. Dead exports in `eventCanvasConstants.ts` (~40 LOC)

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/triggers/sub_builder/libs/eventCanvasConstants.ts:94,95,102,103,109,110,111,112,118,126`
- **Scenario**: A whole suite of ReactFlow-related constants is exported but never imported anywhere:
  - `DEFAULT_SOURCE_ICON`, `DEFAULT_SOURCE_COLOR` (lines 94-95) — zero importers.
  - `LAYOUT_STORAGE_KEY = 'event_canvas_layout'` (line 102), `LAYOUT_VERSION = 2` (line 103) — zero importers (a *different* `LAYOUT_STORAGE_KEY` exists at `features/agents/components/matrix/UnifiedBuildEntry.tsx:40` but it's its own const).
  - `NODE_TYPE_EVENT_SOURCE`, `NODE_TYPE_PERSONA_CONSUMER`, `NODE_TYPE_STICKY_NOTE`, `EDGE_TYPE_EVENT` (lines 109-112) — zero importers.
  - `EdgeConditionStyle` interface + `EVENT_EDGE_TYPES` map (lines 118-130) — zero importers.
- **Root cause**: Originally the builder used a ReactFlow canvas (matching `TriggerStudioCanvas`'s pattern); it was rewritten as the flatter `UnifiedRoutingView` but the node-type and layout-persistence constants were never deleted.
- **Impact**: ~40 LOC dead; readers think the builder has node-based canvas semantics it doesn't have.
- **Fix sketch**: Delete the 10 unused exports. Keep only `EVENT_SOURCE_CATEGORIES`, `findTemplateByEventType`, `EventSourceTemplate`, `EventSourceCategory`, and the `GRID_SIZE` re-export which are actually consumed.

## 9. Duplicated validation-failure stringification in `useTriggerOperations`

- **Severity**: low
- **Category**: duplication
- **File**: `src/features/triggers/hooks/useTriggerOperations.ts:99-102` and `:121-124`
- **Scenario**: The `validate` and `testFire` operations both compute `validation.checks.filter((c) => !c.passed).map((c) => "${c.label}: ${c.message}").join("; ")` verbatim. If the join separator or label format ever needs to change (e.g. for i18n), two places must be updated.
- **Root cause**: Both methods grew from a single legacy `runValidation()` and the snippet was copy-pasted.
- **Impact**: Small (8 LOC), but the formatting is also what's user-facing in the resolved error message, so a divergence would be visible to users.
- **Fix sketch**: Extract `formatValidationFailures(validation: TriggerValidationResult): string` at the module bottom (next to `errStr`). Have both call sites use it.

## 10. Duplicated `60` magic-number in cron/interval validation (Rust)

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/tools/triggers.rs:291` and `:316`
- **Scenario**: The `validate_trigger` command hardcodes the min interval `if interval >= 60` and the message `"{interval}s is below minimum of 60s"` at both line 291 (schedule branch) and 316 (polling branch). The canonical constant `MIN_INTERVAL_SECONDS: i64 = 60` already exists at `validation/trigger.rs:15` and is used by `validate_config` for the same purpose.
- **Root cause**: Direct hardcoding when the validation command was written, predating the constant.
- **Impact**: Future change to the minimum (e.g. to 30s for high-frequency polling) requires three edits and three matching message updates.
- **Fix sketch**: Replace both `>= 60` with `>= crate::validation::trigger::MIN_INTERVAL_SECONDS` and `"60s"` with `format!("{}s", MIN_INTERVAL_SECONDS)`.

## 11. `db/repos/resources/triggers.rs` god-file (3,012 LOC, 34 functions)

- **Severity**: high
- **Category**: structure
- **File**: `src-tauri/src/db/repos/resources/triggers.rs:1`
- **Scenario**: One repo file owns: trigger CRUD, event-listener auto-pairing (`build_auto_listener_config`, `insert_auto_listener_in_tx`, `delete_auto_listeners_for`, `backfill_auto_listeners`), persona event-handler patching inside `structured_prompt` JSON (`patch_persona_event_handler_in_tx`, `remove_persona_event_handler_in_tx`, `default_handler_text`, `update_persona_event_handler`, `initialize_event_handlers_for_persona`), chain-link lookups, composite-fire bookkeeping (`load_composite_fires`, `upsert_composite_fire`, `cleanup_composite_fires`), event-type renaming across 6 stores (`rename_event_type`, 184 LOC), schedule advancement, hash dedup, and a health-map aggregation. The `rename_event_type` function alone touches `persona_events`, `persona_event_subscriptions`, `persona_triggers.config` (event_type / listen_event_type / _handler_key), and `personas.structured_prompt.eventHandlers` in one transaction.
- **Root cause**: Every event-routing or trigger-lifecycle feature added new helpers to the same file because they all needed access to `persona_triggers` and `persona_events` joins.
- **Impact**: 3,012 LOC means slow rust-analyzer indexing, painful merge conflicts, and an unclear separation of "trigger repo" vs "event-routing repo." The `patch_persona_event_handler_in_tx` family (lines 383-518) is genuinely persona-side logic that doesn't belong with trigger persistence.
- **Fix sketch**: Split into `triggers/crud.rs` (get/get_by_id/create/update/delete + ownership), `triggers/auto_listener.rs` (the build/insert/delete/backfill quartet), `triggers/schedule.rs` (get_due/advance_schedule/mark_triggered_with_hash), `triggers/composite_fires.rs`, and move the persona-event-handler JSON patching to `repos/resources/personas/event_handlers.rs`. Keep `rename_event_type` as the orchestrator that calls into each module. Re-export the public API surface from `mod.rs` to preserve callers.

## 12. Unused tab in `EventBusTab` enum / props-only-extra prop in TriggersPage

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/triggers/TriggersPage.tsx:85`
- **Scenario**: Page state `const [_busHealth, setBusHealth] = useState<BusHealth>(null)` is computed (lines 102-105: scans health map and sets `'failing'` / `'degraded'` / `'healthy'`) but the returned `_busHealth` is never read anywhere in the component's render — the underscore prefix is the only place the value lives. The companion `setBusHealth` mutates it for nothing.
- **Root cause**: A status indicator was prototyped, the call site was removed during a UI cleanup, and the state hook + computation was left behind.
- **Impact**: Small (~6 LOC), but the `getTriggerHealthMap()` IPC call on line 98 runs on every persona change purely to feed the dead state.
- **Fix sketch**: Either drop `_busHealth` + `setBusHealth` and the `healthValues` block (lines 102-105) and remove the `getTriggerHealthMap()` from the `Promise.all`, or actually surface the bus-health pill in the header. Recommend the former — the per-trigger badges already convey health.
