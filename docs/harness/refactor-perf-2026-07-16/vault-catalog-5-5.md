# vault/catalog [5/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 1 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 7 | Missing: 0

## 1. `useAutoScrollRef` is one of ~15 hand-rolled auto-scroll-to-bottom copies, and it lives in a config file
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/autoCredErrorConfig.ts:17
- **Scenario**: `autoCredErrorConfig.ts` is nominally a display-config module (ERROR_KIND_CONFIG), yet it also exports a generic React hook. Meanwhile the identical `el.scrollTop = el.scrollHeight`-in-useEffect pattern is inlined in ~15 other components across the repo — including `AutoCredBrowser.tsx` in the same autoCred feature two directories away (line 50), which re-implements the exact 3 lines instead of importing this hook.
- **Root cause**: The hook was extracted only far enough to serve `AutoCredBrowserError.tsx` and was parked in the nearest file rather than a shared location, so no one else can find or reuse it.
- **Impact**: Ongoing copy-paste drift (the companion panel's `useChatScroll.ts` already had to fix a UX bug the naive version causes — force-scrolling while the user reads scrollback — and none of the other copies benefit). Also mildly misleading module structure: importing a hook from `...ErrorConfig`.
- **Fix sketch**: Move `useAutoScrollRef` to a shared hooks location (e.g. `src/hooks/useAutoScrollRef.ts` or `features/shared`), re-export or update the two autoCred call sites, and switch `AutoCredBrowser.tsx`'s inline copy to it. Migrating the other ~13 inline copies can be a follow-up sweep (some may want the "stick only when at bottom" behavior from `useChatScroll`).

## 2. `catalogRolePresets.ts` is a deprecated shim duplicating the `Audience` union it tells you to use instead
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts:13
- **Scenario**: The file's own docblock says the presets map was retired and new code should use `Audience` from `@/lib/credentials/connectorAudiences` — which is the byte-identical union `'developer' | 'support' | 'manager'`. Only two files still import `RolePreset` (`usePickerFilters.ts`, `CredentialPickerFilters.tsx`), both type-only.
- **Root cause**: The shim was kept "so existing imports keep compiling" but the two remaining importers were never retargeted, leaving a duplicate type definition that can silently drift from `Audience`.
- **Impact**: Two sources of truth for the same domain union; if an audience is added to `connectorAudiences.ts` the picker filter types won't error, they'll just diverge. Small but pure debt — the file carries no runtime code.
- **Fix sketch**: Replace the two `import type { RolePreset } from './catalogRolePresets'` sites with `import type { Audience } from '@/lib/credentials/connectorAudiences'` (or `type RolePreset = Audience` locally if the name matters), then delete `catalogRolePresets.ts`. Type-only change, zero runtime risk; verify with tsc.

## Perf lens
No perf findings worth reporting. `PickerGrid` memoizes `Date.now()` once per mount, renders a keyed flat list with O(1) `Set`/`Map` lookups per card, and the connector catalog is a bounded dataset; the remaining files are static config/type modules with no runtime cost.
