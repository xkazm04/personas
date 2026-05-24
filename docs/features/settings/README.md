# Settings

Settings is a lazy-mounted control surface for account, appearance, notifications, engine diagnostics, custom model routing, data portability, external API keys (inbound MCP/HTTP auth), network exposure, quality gates, config resolution, and admin diagnostics.

## Page mechanics

`src/features/settings/components/SettingsPage.tsx` maps the active `settingsTab` from `useSystemStore()` to a lazily loaded tab component. Visited inactive tabs remain mounted briefly, then unmount after 30 seconds of idleness. This keeps heavy diagnostics and network panels from staying live forever while still making quick tab switching cheap.

Tabs are declared by `getSettingsItems(isDev, activeTier)` in `sidebarData.ts`. `devOnly` tabs are hidden outside dev builds; `minTier` gates Data to Team+.

## Tabs

| Tab | Availability | Behavior | Implementation |
| --- | --- | --- | --- |
| Account | Starter+ | Auth/account state, telemetry toggle, radio, and software-update controls (see [Software updates](#software-updates)) | `sub_account/components/AccountSettings.tsx` |
| Appearance | Starter+ | Theme, custom theme creator, text size, **density** (Compact / Comfortable / Cozy), timezone, brightness, dim/CVD-safe/high-contrast/reduce-motion toggles, pseudo-locale toggle, translation contributor | `sub_appearance/components/*` |
| Notifications | Starter+ | Notification preferences, weekly health digest, outbound webhook subscriptions (Slack/Discord/Teams/generic JSON). Each severity row has a "Test" button that fires a synthetic healing toast at that severity — useful to preview what an alert looks like without waiting for a real one. | `sub_notifications/components/NotificationSettings.tsx`, `WebhookSubscriptionsPanel.tsx`, `src-tauri/src/notifications.rs`, `src-tauri/src/engine/webhook_notifier.rs` |
| Engine | Dev-only | Runtime capability badges and operation rows | `sub_engine/components/*`, `libs/engineCapabilities.ts` |
| Custom Models | Dev-only | BYOM providers, API keys, routing rules, compliance rules, audit log. Each allowed-provider card shows a live health dot (green/red/amber) driven by `test_provider_connection`; results are cached in a module-scope map for 5 minutes so switching tabs and returning doesn't lose state. The tab auto-tests stale providers on mount, staggered 150ms apart to avoid burst IPC. A per-card "Test connection" button still force-refreshes on demand. | `sub_byom/components/*`, `libs/useByomSettings.ts` |
| Data | Team+ | Export/import and credential portability | `sub_portability/components/*`, `libs/useDataPortability.ts` |
| Limits | Team+ | Monthly USD spending ceiling and progress tracking. Stage 1 is informational — the ceiling is stored in `app_settings.monthly_cost_ceiling_usd` and surfaced as a progress bar against the live sum of `get_all_monthly_spend` with amber (80%+) and red (over) warnings. Stage 2 will wire the ceiling into execution dispatch as a hard gate. | `sub_limits/components/LimitsSettings.tsx`, allow-list entry in `src-tauri/src/db/settings_keys.rs` |
| API Keys | Team+ | Issue, revoke, and delete tokens that 3rd-party MCP/HTTP clients use to authenticate against the local management API (`engine/management_api.rs`, port 9420). Plaintext leaves the backend exactly once on creation; storage is SHA-256 with a `key_prefix` for display. Each row shows the key's relative `Last used` and `Created` timestamps (absolute timestamp on hover); keys created more than 7 days ago that have either never been used or been idle for 30+ days get a "Stale" chip and amber border as a revoke prompt. The internal `system` key is hidden from the list. | `sub_api_keys/components/{ApiKeysSettings,CreateApiKeyDialog,CreatedKeyDialog,McpServerInfoPanel}.tsx`, `src/api/auth/externalApiKeys.ts`, `src-tauri/src/commands/credentials/external_api_keys.rs` |
| Network | Dev-only | Exposure manager and sharing/network controls | `src/features/sharing/components/ExposureManager.tsx` |
| Quality Gates | Dev-only | Validation/test gate settings | `sub_quality_gates/components/QualityGateSettings.tsx` |
| Config Resolution | Dev-only | Per-persona effective config inspector showing which tier (agent / workspace / global) supplies each setting. Includes a name filter and an "Overrides only" toggle so admins can quickly find the personas that have escaped workspace/global defaults. | `sub_config/components/ConfigResolutionPanel.tsx` |
| Recent-change chip | All tabs that have audit writers | Tiny header chip that fetches the newest audit entry for the current sub-module's category and renders "Last {action}: {when}". Click jumps to History. Self-hides when the category has no entries yet, so wiring it into a tab whose audit writer is still on a Stage-2 backlog is a no-op until Stage 2 lights it up. Currently wired into API Keys (active), Limits (forward-compat), and Notifications (forward-compat). | `shared/RecentChangeChip.tsx`, polls `list_settings_audit_entries(1, category)` every 30s |
| History | Dev-only | Append-only audit log of settings mutations across every sub-module. Each row records category, setting key, action verb, before/after values (sanitized for secrets), actor surface, and a relative timestamp; details disclose inline on click. Stage 1 only wires API-key create/revoke as write sites — coverage of the other sub-modules rolls in across Stages 2-3. Backed by the `settings_audit_log` SQLite table. | `sub_history/components/SettingsHistoryTab.tsx`, `src-tauri/src/db/repos/resources/settings_audit_log.rs`, `src-tauri/src/db/models/settings_audit_log.rs`, `list_settings_audit_entries` IPC |
| Admin | Dev-only | Administrative diagnostics | `sub_admin/components/AdminSettings.tsx` |

## Density

The Appearance tab's **Density** control (Compact / Comfortable / Cozy) is app-wide, not a per-table affordance. It's persisted in the theme store (`persona-theme`) and applied as `data-density` on `<html>`, which switches a single set of CSS custom properties defined in `globals.css` (`--density-pad`, `--density-pad-sm`, `--density-gap`, `--density-gap-lg`, `--density-row-py`). The shared spacing tokens `CARD_PADDING` and `SECTION_GAP` (in `src/lib/utils/designTokens.ts`) emit arbitrary-value classes bound to those vars (`p-[var(--density-pad)]`, `space-y-[var(--density-gap)]`, …), so any surface built on those tokens reflows coherently when density changes. `comfortable` is the default and resolves to the historical `p-4` / `space-y-4` / `space-y-6` values, so the out-of-the-box appearance is unchanged. Compact also tightens `.typo-body` line-heights; Cozy loosens them. The control also appears in the onboarding Appearance step (`AppearanceStep.tsx`).

## Software updates

The Account tab's **Updates** card is the user-facing surface for the Tauri auto-updater (`tauri-plugin-updater`, configured in `src-tauri/tauri.conf.json` against the GitHub releases endpoint). `useAutoUpdater` (`src/hooks/utility/data/useAutoUpdater.ts`) checks 5 seconds after launch and then every 6 hours; a manual **Check for Updates** button forces a check on demand.

The card shows the current installed version (via `getVersion()`) and a relative "last checked" timestamp so the user can confirm the background poll is running. After a manual check it also shows the result inline (up-to-date / failed) for a few seconds, so the outcome persists past the toast. A **Recent updates** list below the button shows the version-upgrade timeline, recorded in `localStorage` by `src/lib/updateHistory.ts` — `useAutoUpdater` calls `recordVersion()` once per launch, appending an entry the first time the app runs on each new version. A **Clear** control resets the list (`clearUpdateHistory()`). When an update is found, `UpdateBanner` (`src/features/shared/components/feedback/UpdateBanner.tsx`) appears at the top of the app with the release notes, a live download-progress bar during install, and (when personas are mid-execution) a preflight warning before the app restarts. The preflight offers three choices — install anyway, defer until running tasks finish (auto-installs once the running count hits zero), or keep working.

## Ambient context

Settings also contains `AmbientContextPanel.tsx`, backed by `src/api/system/ambientContext.ts`. It controls desktop sensory context, per-persona policies, context rules, context-rule matches, stream stats, and validation screenshot capture. Desktop-only backend state lives behind feature gates in `AppState`.

## State and commands

Most Settings state is stored in `uiSlice.ts`, `setupSlice.ts`, `ambientContextSlice.ts`, `cloudSlice.ts`, and plugin-specific system slices. Backend commands are spread across `commands/infrastructure/settings.rs`, `byom.rs`, `tier_usage.rs`, `network`, `core/import_export.rs`, `commands/credentials/external_api_keys.rs`, and notification helpers.

> **API Keys vs Custom Models** — these tabs solve opposite problems. *Custom Models* (BYOM) configures **outbound** keys Personas uses to call third-party model providers. *API Keys* configures **inbound** tokens external MCP clients (and other HTTP callers) use to authenticate against Personas' own management API on `127.0.0.1:9420`.
