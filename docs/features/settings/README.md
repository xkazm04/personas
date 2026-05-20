# Settings

Settings is a lazy-mounted control surface for account, appearance, notifications, engine diagnostics, custom model routing, data portability, external API keys (inbound MCP/HTTP auth), network exposure, quality gates, config resolution, and admin diagnostics.

## Page mechanics

`src/features/settings/components/SettingsPage.tsx` maps the active `settingsTab` from `useSystemStore()` to a lazily loaded tab component. Visited inactive tabs remain mounted briefly, then unmount after 30 seconds of idleness. This keeps heavy diagnostics and network panels from staying live forever while still making quick tab switching cheap.

Tabs are declared by `getSettingsItems(isDev, activeTier)` in `sidebarData.ts`. `devOnly` tabs are hidden outside dev builds; `minTier` gates Data to Team+.

## Tabs

| Tab | Availability | Behavior | Implementation |
| --- | --- | --- | --- |
| Account | Starter+ | Auth/account state, telemetry toggle, radio, and software-update controls (see [Software updates](#software-updates)) | `sub_account/components/AccountSettings.tsx` |
| Appearance | Starter+ | Theme, custom theme creator, pseudo-locale toggle, translation contributor | `sub_appearance/components/*` |
| Notifications | Starter+ | Notification preferences, weekly health digest, outbound webhook subscriptions (Slack/Discord/Teams/generic JSON) | `sub_notifications/components/NotificationSettings.tsx`, `WebhookSubscriptionsPanel.tsx`, `src-tauri/src/notifications.rs`, `src-tauri/src/engine/webhook_notifier.rs` |
| Engine | Dev-only | Runtime capability badges and operation rows | `sub_engine/components/*`, `libs/engineCapabilities.ts` |
| Custom Models | Dev-only | BYOM providers, API keys, routing rules, compliance rules, audit log | `sub_byom/components/*`, `libs/useByomSettings.ts` |
| Data | Team+ | Export/import and credential portability | `sub_portability/components/*`, `libs/useDataPortability.ts` |
| API Keys | Team+ | Issue, revoke, and delete tokens that 3rd-party MCP/HTTP clients use to authenticate against the local management API (`engine/management_api.rs`, port 9420). Plaintext leaves the backend exactly once on creation; storage is SHA-256 with a `key_prefix` for display. The internal `system` key is hidden from the list. | `sub_api_keys/components/{ApiKeysSettings,CreateApiKeyDialog,CreatedKeyDialog,McpServerInfoPanel}.tsx`, `src/api/auth/externalApiKeys.ts`, `src-tauri/src/commands/credentials/external_api_keys.rs` |
| Network | Dev-only | Exposure manager and sharing/network controls | `src/features/sharing/components/ExposureManager.tsx` |
| Quality Gates | Dev-only | Validation/test gate settings | `sub_quality_gates/components/QualityGateSettings.tsx` |
| Config Resolution | Dev-only | Effective config inspection | `sub_config/components/ConfigResolutionPanel.tsx` |
| Admin | Dev-only | Administrative diagnostics | `sub_admin/components/AdminSettings.tsx` |

## Software updates

The Account tab's **Updates** card is the user-facing surface for the Tauri auto-updater (`tauri-plugin-updater`, configured in `src-tauri/tauri.conf.json` against the GitHub releases endpoint). `useAutoUpdater` (`src/hooks/utility/data/useAutoUpdater.ts`) checks 5 seconds after launch and then every 6 hours; a manual **Check for Updates** button forces a check on demand.

The card shows the current installed version (via `getVersion()`) and a relative "last checked" timestamp so the user can confirm the background poll is running. After a manual check it also shows the result inline (up-to-date / failed) for a few seconds, so the outcome persists past the toast. A **Recent updates** list below the button shows the version-upgrade timeline, recorded in `localStorage` by `src/lib/updateHistory.ts` — `useAutoUpdater` calls `recordVersion()` once per launch, appending an entry the first time the app runs on each new version. A **Clear** control resets the list (`clearUpdateHistory()`). When an update is found, `UpdateBanner` (`src/features/shared/components/feedback/UpdateBanner.tsx`) appears at the top of the app with the release notes, a live download-progress bar during install, and (when personas are mid-execution) a preflight warning before the app restarts. The preflight offers three choices — install anyway, defer until running tasks finish (auto-installs once the running count hits zero), or keep working.

## Ambient context

Settings also contains `AmbientContextPanel.tsx`, backed by `src/api/system/ambientContext.ts`. It controls desktop sensory context, per-persona policies, context rules, context-rule matches, stream stats, and validation screenshot capture. Desktop-only backend state lives behind feature gates in `AppState`.

## State and commands

Most Settings state is stored in `uiSlice.ts`, `setupSlice.ts`, `ambientContextSlice.ts`, `cloudSlice.ts`, and plugin-specific system slices. Backend commands are spread across `commands/infrastructure/settings.rs`, `byom.rs`, `tier_usage.rs`, `network`, `core/import_export.rs`, `commands/credentials/external_api_keys.rs`, and notification helpers.

> **API Keys vs Custom Models** — these tabs solve opposite problems. *Custom Models* (BYOM) configures **outbound** keys Personas uses to call third-party model providers. *API Keys* configures **inbound** tokens external MCP clients (and other HTTP callers) use to authenticate against Personas' own management API on `127.0.0.1:9420`.
