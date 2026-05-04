# Settings

Settings controls account, appearance, notifications, engine/debug options, data portability, network, quality gates, config resolution, and admin-only diagnostics.

## Tabs

| Tab | Availability | Implementation notes |
| --- | --- | --- |
| Account | Starter+ | Account and auth state |
| Appearance | Starter+ | `src/features/settings/sub_appearance` |
| Notifications | Starter+ | `src-tauri/src/notifications.rs` |
| Engine | Dev-only | Runtime/model diagnostics |
| Custom Models | Dev-only | BYOM settings |
| Data | Team+ | Portability/import/export |
| Network | Dev-only | P2P/network settings |
| Quality Gates | Dev-only | Validation and test gates |
| Config Resolution | Dev-only | Effective config inspection |
| Admin | Dev-only | Administrative diagnostics |

Tabs are produced by `getSettingsItems()` in `sidebarData.ts`.

