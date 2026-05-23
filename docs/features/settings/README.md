# Settings

Settings is a lazy-mounted control surface for account, appearance, notifications, engine diagnostics, custom model routing, data portability, external API keys (inbound MCP/HTTP auth), network exposure, quality gates, config resolution, and admin diagnostics.

## Page mechanics

`src/features/settings/components/SettingsPage.tsx` maps the active `settingsTab` from `useSystemStore()` to a lazily loaded tab component. Visited inactive tabs remain mounted briefly, then unmount after 30 seconds of idleness. This keeps heavy diagnostics and network panels from staying live forever while still making quick tab switching cheap.

Tabs are declared by `getSettingsItems(isDev, activeTier)` in `sidebarData.ts`. `devOnly` tabs are hidden outside dev builds; `minTier` gates Data to Team+.

## Tabs

| Tab | Availability | Behavior | Implementation |
| --- | --- | --- | --- |
| Account | Starter+ | Auth/account state | `sub_account/components/AccountSettings.tsx` |
| Appearance | Starter+ | Theme, custom theme creator, pseudo-locale toggle, translation contributor | `sub_appearance/components/*` |
| Notifications | Starter+ | Notification preferences, weekly health digest, outbound webhook subscriptions (Slack/Discord/Teams/generic JSON). Each severity row has a "Test" button that fires a synthetic healing toast at that severity — useful to preview what an alert looks like without waiting for a real one. | `sub_notifications/components/NotificationSettings.tsx`, `WebhookSubscriptionsPanel.tsx`, `src-tauri/src/notifications.rs`, `src-tauri/src/engine/webhook_notifier.rs` |
| Engine | Dev-only | Runtime capability badges and operation rows | `sub_engine/components/*`, `libs/engineCapabilities.ts` |
| Custom Models | Dev-only | BYOM providers, API keys, routing rules, compliance rules, audit log. Each allowed-provider card shows a live health dot (green/red/amber) driven by `test_provider_connection`; results are cached in a module-scope map for 5 minutes so switching tabs and returning doesn't lose state. The tab auto-tests stale providers on mount, staggered 150ms apart to avoid burst IPC. A per-card "Test connection" button still force-refreshes on demand. | `sub_byom/components/*`, `libs/useByomSettings.ts` |
| Data | Team+ | Export/import and credential portability | `sub_portability/components/*`, `libs/useDataPortability.ts` |
| Limits | Team+ | Monthly USD spending ceiling and progress tracking. Stage 1 is informational — the ceiling is stored in `app_settings.monthly_cost_ceiling_usd` and surfaced as a progress bar against the live sum of `get_all_monthly_spend` with amber (80%+) and red (over) warnings. Stage 2 will wire the ceiling into execution dispatch as a hard gate. | `sub_limits/components/LimitsSettings.tsx`, allow-list entry in `src-tauri/src/db/settings_keys.rs` |
| API Keys | Team+ | Issue, revoke, and delete tokens that 3rd-party MCP/HTTP clients use to authenticate against the local management API (`engine/management_api.rs`, port 9420). Plaintext leaves the backend exactly once on creation; storage is SHA-256 with a `key_prefix` for display. Each row shows the key's relative `Last used` and `Created` timestamps (absolute timestamp on hover); keys created more than 7 days ago that have either never been used or been idle for 30+ days get a "Stale" chip and amber border as a revoke prompt. The internal `system` key is hidden from the list. | `sub_api_keys/components/{ApiKeysSettings,CreateApiKeyDialog,CreatedKeyDialog,McpServerInfoPanel}.tsx`, `src/api/auth/externalApiKeys.ts`, `src-tauri/src/commands/credentials/external_api_keys.rs` |
| Network | Dev-only | Exposure manager and sharing/network controls | `src/features/sharing/components/ExposureManager.tsx` |
| Quality Gates | Dev-only | Validation/test gate settings | `sub_quality_gates/components/QualityGateSettings.tsx` |
| Config Resolution | Dev-only | Per-persona effective config inspector showing which tier (agent / workspace / global) supplies each setting. Includes a name filter and an "Overrides only" toggle so admins can quickly find the personas that have escaped workspace/global defaults. | `sub_config/components/ConfigResolutionPanel.tsx` |
| History | Dev-only | Append-only audit log of settings mutations across every sub-module. Each row records category, setting key, action verb, before/after values (sanitized for secrets), actor surface, and a relative timestamp; details disclose inline on click. Stage 1 only wires API-key create/revoke as write sites — coverage of the other sub-modules rolls in across Stages 2-3. Backed by the `settings_audit_log` SQLite table. | `sub_history/components/SettingsHistoryTab.tsx`, `src-tauri/src/db/repos/resources/settings_audit_log.rs`, `src-tauri/src/db/models/settings_audit_log.rs`, `list_settings_audit_entries` IPC |
| Admin | Dev-only | Administrative diagnostics | `sub_admin/components/AdminSettings.tsx` |

## Ambient context

Settings also contains `AmbientContextPanel.tsx`, backed by `src/api/system/ambientContext.ts`. It controls desktop sensory context, per-persona policies, context rules, context-rule matches, stream stats, and validation screenshot capture. Desktop-only backend state lives behind feature gates in `AppState`.

## State and commands

Most Settings state is stored in `uiSlice.ts`, `setupSlice.ts`, `ambientContextSlice.ts`, `cloudSlice.ts`, and plugin-specific system slices. Backend commands are spread across `commands/infrastructure/settings.rs`, `byom.rs`, `tier_usage.rs`, `network`, `core/import_export.rs`, `commands/credentials/external_api_keys.rs`, and notification helpers.

> **API Keys vs Custom Models** — these tabs solve opposite problems. *Custom Models* (BYOM) configures **outbound** keys Personas uses to call third-party model providers. *API Keys* configures **inbound** tokens external MCP clients (and other HTTP callers) use to authenticate against Personas' own management API on `127.0.0.1:9420`.
