# Settings

Settings is a lazy-mounted control surface for account, appearance, notifications, engine diagnostics, custom model routing, data portability, external API keys (inbound MCP/HTTP auth), network exposure, quality gates, and admin diagnostics. (Per-persona **effective config resolution** moved out of Settings to the All-Personas page's **Configuration** tab — see [`docs/features/personas/README.md`](../personas/README.md).)

## Page mechanics

`src/features/settings/components/SettingsPage.tsx` maps the active `settingsTab` from `useSystemStore()` to a lazily loaded tab component. Visited inactive tabs remain mounted briefly, then unmount after 30 seconds of idleness. This keeps heavy diagnostics and network panels from staying live forever while still making quick tab switching cheap.

Tabs are declared by `getSettingsItems(isDev, activeTier)` in `sidebarData.ts`. `devOnly` tabs are hidden outside dev builds; `minTier` gates Data to Team+.

## Tabs

| Tab | Availability | Behavior | Implementation |
| --- | --- | --- | --- |
| Account | Starter+ | Auth/account state, telemetry toggle, radio, software-update controls (see [Software updates](#software-updates)), and — once signed in with Google — the **Cloud dashboard sync** toggle (see [Cloud dashboard sync](#cloud-dashboard-sync)) | `sub_account/components/AccountSettings.tsx`, `CloudSyncCard.tsx` |
| Appearance | Starter+ | **Language** (the same picker as Home/onboarding — added here so users find it where every other preference lives; UAT P10 F-SETTINGS-NO-LANGUAGE), theme, custom theme creator, text size, **density** (Compact / Comfortable / Cozy), timezone, brightness, dim/CVD-safe/high-contrast/reduce-motion toggles, pseudo-locale toggle, translation contributor | `sub_appearance/components/*` |
| Notifications | Starter+ | Notification preferences, weekly health digest, outbound webhook subscriptions (Slack/Discord/Teams/generic JSON). Each severity row has a "Test" button that fires a synthetic healing toast at that severity — useful to preview what an alert looks like without waiting for a real one. | `sub_notifications/components/NotificationSettings.tsx`, `WebhookSubscriptionsPanel.tsx`, `src-tauri/src/notifications.rs`, `src-tauri/src/engine/webhook_notifier.rs` |
| Engine | Dev-only | Runtime capability badges and operation rows | `sub_engine/components/*`, `libs/engineCapabilities.ts` |
| Custom Models | Dev-only | BYOM providers, API keys, routing rules, compliance rules, audit log. Each allowed-provider card shows a live health dot (green/red/amber) driven by `test_provider_connection`; results are cached in a module-scope map for 5 minutes so switching tabs and returning doesn't lose state. The tab auto-tests stale providers on mount, staggered 150ms apart to avoid burst IPC. A per-card "Test connection" button still force-refreshes on demand. | `sub_byom/components/*`, `libs/useByomSettings.ts` |
| Data | Team+ | Export/import and credential portability | `sub_portability/components/*`, `libs/useDataPortability.ts` |
| Limits | Team+ | **Parallel executions** — global cap on how many executions run concurrently across all personas (`app_settings.max_parallel_executions`, default 10, range 1–20). Overflow waits in the engine's priority queue (`ConcurrencyTracker` in `engine/queue.rs`) and is promoted automatically as slots free. The cap **hot-applies** without a restart: `set_app_setting` updates the live `ExecutionEngine` tracker and proactively drains the queue when the cap is raised. Also drives the always-on **FleetActivityStrip** capacity gauge — the strip renders one bar per slot, so a full strip means the fleet is at the limit. **Monthly USD spending ceiling** — Stage 1 is informational: stored in `app_settings.monthly_cost_ceiling_usd`. The Usage section renders a lean **trailing-5-month spend table** (daily cost from `get_metrics_chart_data` bucketed by calendar month), current month highlighted, with each month's bar turning red if it exceeded the ceiling and amber (80%+) / red (over) warnings on the current month. Stage 2 will wire the ceiling into execution dispatch as a hard gate. | `sub_limits/components/LimitsSettings.tsx`, allow-list + bounds in `src-tauri/src/db/settings_keys.rs`, hot-apply in `src-tauri/src/commands/infrastructure/settings.rs` + `engine/mod.rs::set_global_max_concurrent` |
| API Keys | Team+ | Issue, revoke, and delete tokens that 3rd-party MCP/HTTP clients use to authenticate against the local management API (`engine/management_api.rs`, port 9420). Plaintext leaves the backend exactly once on creation; storage is SHA-256 with a `key_prefix` for display. Each row shows the key's relative `Last used` and `Created` timestamps (absolute timestamp on hover); keys created more than 7 days ago that have either never been used or been idle for 30+ days get a "Stale" chip and amber border as a revoke prompt. The internal `system` key is hidden from the list. | `sub_api_keys/components/{ApiKeysSettings,CreateApiKeyDialog,CreatedKeyDialog,McpServerInfoPanel}.tsx`, `src/api/auth/externalApiKeys.ts`, `src-tauri/src/commands/credentials/external_api_keys.rs` |
| Network | Dev-only | Exposure manager and sharing/network controls | `src/features/sharing/components/ExposureManager.tsx` |
| Quality Gates | Dev-only | Validation/test gate settings | `sub_quality_gates/components/QualityGateSettings.tsx` |
| Recent-change chip | All tabs that have audit writers | Tiny header chip that fetches the newest audit entry for the current sub-module's category and renders "Last {action}: {when}". Click jumps to History. Self-hides when the category has no entries yet, so wiring it into a tab whose audit writer is still on a Stage-2 backlog is a no-op until Stage 2 lights it up. Currently wired into API Keys (active), Limits (forward-compat), and Notifications (forward-compat). | `shared/RecentChangeChip.tsx`, polls `list_settings_audit_entries(1, category)` every 30s |
| History | Dev-only | Append-only audit log of settings mutations across every sub-module. Each row records category, setting key, action verb, before/after values (sanitized for secrets), actor surface, and a relative timestamp; details disclose inline on click. Stage 1 only wires API-key create/revoke as write sites — coverage of the other sub-modules rolls in across Stages 2-3. Backed by the `settings_audit_log` SQLite table. | `sub_history/components/SettingsHistoryTab.tsx`, `src-tauri/src/db/repos/resources/settings_audit_log.rs`, `src-tauri/src/db/models/settings_audit_log.rs`, `list_settings_audit_entries` IPC |
| Admin | Dev-only | User-consent reset (re-show the first-use consent modal). The former guided-tour controls were removed. | `sub_admin/components/AdminSettings.tsx` |

## Settings search (command palette)

Settings are reachable from anywhere via the global command palette (`src/features/shared/components/overlays/CommandPalette.tsx`) without first navigating to the Settings section.

**Entry points**

- **Title-bar illustration** — the time-of-day ambient art in the centre of the title bar (`TitleBarAmbient.tsx`) doubles as the search affordance. Hover/focus brightens it (full opacity + glow), shows a pointer cursor, and reveals a magnifier; clicking opens the palette focused on settings (`scope: 'settings'`). When **Time-of-day header art** is turned off in Appearance the affordance is hidden, but Cmd/Ctrl+K still works.
- **Cmd/Ctrl+K** — opens the same palette in the global scope (agents, navigation, settings, …).

Scope only biases the empty state and ordering: opening from the illustration surfaces **Recommended** settings first; typing always searches every source, with settings ranked first in the settings scope. Open-state lives in `src/stores/commandPaletteStore.ts` (`open` + `scope`) so any surface can open the single palette in the right scope.

**Inline toggles vs deep links** — boolean settings (reduce motion, reduce color intensity, high contrast, color-blind safe palette, time-of-day art) render an inline switch and flip in place without leaving the palette. Everything else (theme, text size, brightness, density, time zone, and one entry per visible settings tab) deep-links to the relevant tab.

**Adding searchable "setups" from other areas (reuse).** Search entries are built with the reusable `settingEntry()` helper in `commandPaletteUtils.ts` (which also adds `keywords`, an optional `toggle` binding, and `entryScore()` to `PaletteItem`). The Settings domain's entries live in `src/features/settings/search/useSettingsSearchEntries.tsx` — the reference implementation of the provider pattern. To surface another area's setup in search, add a sibling `use<Domain>SearchEntries()` hook that returns `settingEntry(...)` items and merge it in `CommandPalette` alongside `useSettingsSearchEntries()`; togglable entries get a `toggle` binding, navigational ones get `onNavigate`.

## Density

The Appearance tab's **Density** control (Compact / Comfortable / Cozy) is app-wide, not a per-table affordance. It's persisted in the theme store (`persona-theme`) and applied as `data-density` on `<html>`, which switches a single set of CSS custom properties defined in `globals.css` (`--density-pad`, `--density-pad-sm`, `--density-gap`, `--density-gap-lg`, `--density-row-py`). The shared spacing tokens `CARD_PADDING` and `SECTION_GAP` (in `src/lib/utils/designTokens.ts`) emit arbitrary-value classes bound to those vars (`p-[var(--density-pad)]`, `space-y-[var(--density-gap)]`, …), so any surface built on those tokens reflows coherently when density changes. `comfortable` is the default and resolves to the historical `p-4` / `space-y-4` / `space-y-6` values, so the out-of-the-box appearance is unchanged. Compact also tightens `.typo-body` line-heights; Cozy loosens them. The control also appears in the onboarding Appearance step (`AppearanceStep.tsx`).

## Software updates

The Account tab's **Updates** card is the user-facing surface for the Tauri auto-updater (`tauri-plugin-updater`, configured in `src-tauri/tauri.conf.json` against the GitHub releases endpoint). `useAutoUpdater` (`src/hooks/utility/data/useAutoUpdater.ts`) checks 5 seconds after launch and then every 6 hours; a manual **Check for Updates** button forces a check on demand.

The card shows the current installed version (via `getVersion()`) and a relative "last checked" timestamp so the user can confirm the background poll is running. After a manual check it also shows the result inline (up-to-date / failed) for a few seconds, so the outcome persists past the toast. A **Recent updates** list below the button shows the version-upgrade timeline, recorded in `localStorage` by `src/lib/updateHistory.ts` — `useAutoUpdater` calls `recordVersion()` once per launch, appending an entry the first time the app runs on each new version. A **Clear** control resets the list (`clearUpdateHistory()`). When an update is found, `UpdateBanner` (`src/features/shared/components/feedback/UpdateBanner.tsx`) appears at the top of the app with the release notes, a live download-progress bar during install, and (when personas are mid-execution) a preflight warning before the app restarts. The preflight offers three choices — install anyway, defer until running tasks finish (auto-installs once the running count hits zero), or keep working.

## Data portability

The **Data** tab (`sub_portability/`, backed by `core/data_portability.rs`) exports the workspace to a portable ZIP archive (`manifest.json` inside a `.zip`) and imports it back. Imported entities are always created as **new, disabled** rows with an `(imported)` name suffix — import never overwrites existing data.

The **Export Workspace** button opens a selection modal where you pick exactly what to include across three categories:

- **Personas** — agents plus their triggers, event subscriptions, tool links, test suites, and (unless opted out) memories.
- **Teams** — team canvases plus members, connections, and (unless opted out) team memories (the `team_memories` / `sub_teamMemory` store). On import, team memories are recreated under the new team id as manually-curated entries; run-specific provenance (`run_id` / `member_id` / `persona_id`) is intentionally dropped because it references rows that don't travel with the bundle.
- **Credentials** — non-secret metadata by default. Secrets are only embedded when you set an export passphrase, which AES-256-GCM-encrypts them into the bundle (format version 3).

An **Include memories** toggle (on by default) controls whether persona and team memories ride along. Turning it off exports agents and teams without their accumulated memories — useful for sharing a clean template. The **Workspace Overview** stat cards (including a **Team Memories** count) preview what's in the workspace before exporting.

Credential-only export/import (password-protected `.cred.enc` files) lives in a separate **Credential Vault** section of the same tab and is independent of the workspace bundle.

## Cloud dashboard sync

The Account tab's **Cloud Dashboard Sync** card (`sub_account/components/CloudSyncCard.tsx`) appears only when the user is signed in with Google. It opts the device into pushing a **read-only projection** of local data (personas, executions, events, manual reviews, messages, metrics, tool usage) to the user's own Supabase tenant, so the web dashboard can render it. Isolation is enforced server-side by Supabase Row-Level Security keyed on `auth.uid()`; the desktop authenticates with the public anon key plus the user's own Google-OAuth JWT, so **no privileged secret is embedded in the app**.

The projection is secret-free by construction: the encrypted `model_profile` and the entire credential vault are never read into the sync rows — execution and credentials never leave the device. Default off; opt-in is persisted in `app_settings.cloud_sync_enabled`.

Event payloads sync as a **sanitized projection** (v2): the desktop decrypts the at-rest payload locally, then deep-redacts secret-looking keys (`token`/`secret`/`password`/`authorization`/…) and token-shaped values, drops anything that isn't structured JSON, and size-bounds the result — so the dashboard can show event bodies without a credential ever reaching the cloud (`cloud/sync/rows.rs::project_event_payload`). Persona **deletes propagate** (v2): a `persona_tombstones` row cascades into a delete of that persona's rows across every synced table (mirroring the local `ON DELETE CASCADE`), so removing an agent locally clears it from the dashboard too.

The card is a live status panel: a connection-state pill (Off / Active / Syncing…), a **Sync now** action, the last-synced relative time, a lifetime "records synced" total, the device id, and a collapsible **per-table breakdown** (rows + last-synced per synced table). A failed table shows its error inline with a **Retry**; passes are **fault-isolated** — one table failing (network blip, schema drift) no longer aborts the whole pass or strands the other tables' cursors, so healthy data still lands. The breakdown is driven by the rich `CloudSyncStatus` (per-table `TableSyncStatus[]`, `syncing` flag, `totalRowsSynced`) the backend returns.

Backend: `src-tauri/src/cloud/sync/` (PostgREST upsert client + per-table incremental cursors in `app_settings`, a 45s periodic + CDC-driven sync loop, leader-gated; the pass collects a per-table outcome and advances each healthy cursor independently). Commands `cloud_sync_set_enabled` / `cloud_sync_status` / `cloud_sync_now` (`commands/infrastructure/cloud_sync.rs`; `cloud_sync_now` returns the fresh `CloudSyncStatus`), front-end wrappers in `src/api/cloudSync.ts`. The Supabase schema + RLS live in `personas-web/scripts/setup-sync-db.sql` (applied via `npm run db:migrate:sync`).

**Remote run requests (Phase 2).** When sync is on, the dashboard can *request* a persona run on this device. The request lands in the Supabase `pending_commands` table; `src-tauri/src/cloud/remote_commands.rs` polls it (15s, leader-gated) and surfaces an **explicit approval prompt** (`src/features/cloud/RemoteApprovalPrompt.tsx`, mounted at the app root). Nothing runs until the user approves — on approval the persona runs locally via the normal execution path and the result syncs back; on reject/expiry the request is closed. The web only ever sends a `persona_id` + prompt; execution and credentials never leave the device. Commands: `remote_command_list_pending` / `remote_command_approve` / `remote_command_reject`.

## Ambient context

Settings also contains `AmbientContextPanel.tsx`, backed by `src/api/system/ambientContext.ts`. It controls desktop sensory context, per-persona policies, context rules, context-rule matches, stream stats, and validation screenshot capture. Desktop-only backend state lives behind feature gates in `AppState`.

## State and commands

Most Settings state is stored in `uiSlice.ts`, `setupSlice.ts`, `ambientContextSlice.ts`, `cloudSlice.ts`, and plugin-specific system slices. Backend commands are spread across `commands/infrastructure/settings.rs`, `byom.rs`, `tier_usage.rs`, `network`, `core/import_export.rs`, `commands/credentials/external_api_keys.rs`, and notification helpers.

> **API Keys vs Custom Models** — these tabs solve opposite problems. *Custom Models* (BYOM) configures **outbound** keys Personas uses to call third-party model providers. *API Keys* configures **inbound** tokens external MCP clients (and other HTTP callers) use to authenticate against Personas' own management API on `127.0.0.1:9420`.
