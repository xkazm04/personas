# Settings

Settings is a lazy-mounted control surface for account, appearance, notifications, engine diagnostics, custom model routing, data portability, network exposure, quality gates, config resolution, and admin diagnostics.

## Page mechanics

`src/features/settings/components/SettingsPage.tsx` maps the active `settingsTab` from `useSystemStore()` to a lazily loaded tab component. Visited inactive tabs remain mounted briefly, then unmount after 30 seconds of idleness. This keeps heavy diagnostics and network panels from staying live forever while still making quick tab switching cheap.

Tabs are declared by `getSettingsItems(isDev, activeTier)` in `sidebarData.ts`. `devOnly` tabs are hidden outside dev builds; `minTier` gates Data to Team+.

## Tabs

| Tab | Availability | Behavior | Implementation |
| --- | --- | --- | --- |
| Account | Starter+ | Auth/account state | `sub_account/components/AccountSettings.tsx` |
| Appearance | Starter+ | Theme, custom theme creator, pseudo-locale toggle, translation contributor | `sub_appearance/components/*` |
| Notifications | Starter+ | Notification preferences and delivery tests | `sub_notifications/components/NotificationSettings.tsx`, `src-tauri/src/notifications.rs` |
| Engine | Dev-only | Runtime capability badges and operation rows | `sub_engine/components/*`, `libs/engineCapabilities.ts` |
| Custom Models | Dev-only | BYOM providers, API keys, routing rules, compliance rules, audit log | `sub_byom/components/*`, `libs/useByomSettings.ts` |
| Data | Team+ | Export/import and credential portability | `sub_portability/components/*`, `libs/useDataPortability.ts` |
| Network | Dev-only | Exposure manager and sharing/network controls | `src/features/sharing/components/ExposureManager.tsx` |
| Quality Gates | Dev-only | Validation/test gate settings | `sub_quality_gates/components/QualityGateSettings.tsx` |
| Config Resolution | Dev-only | Effective config inspection | `sub_config/components/ConfigResolutionPanel.tsx` |
| Admin | Dev-only | Administrative diagnostics | `sub_admin/components/AdminSettings.tsx` |

## Ambient context

Settings also contains `AmbientContextPanel.tsx`, backed by `src/api/system/ambientContext.ts`. It controls desktop sensory context, per-persona policies, context rules, context-rule matches, stream stats, and validation screenshot capture. Desktop-only backend state lives behind feature gates in `AppState`.

## State and commands

Most Settings state is stored in `uiSlice.ts`, `setupSlice.ts`, `ambientContextSlice.ts`, `cloudSlice.ts`, and plugin-specific system slices. Backend commands are spread across `commands/infrastructure/settings.rs`, `byom.rs`, `tier_usage.rs`, `network`, `core/import_export.rs`, and notification helpers.
