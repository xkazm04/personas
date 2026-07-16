# plugins (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 1 high / 1 medium / 0 low)
> Context group: Plugins & Companion | Files read: 4 | Missing: 0

## 1. PluginAccentLayer.tsx and pluginTheme.ts are dead files (~100 LOC, no consumers)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/PluginAccentLayer.tsx:11 (and src/features/plugins/pluginTheme.ts:56)
- **Scenario**: A repo-wide grep for `PluginAccentLayer`, `getPluginTheme`, `data-plugin-accent`, `--plugin-glow`, and `--plugin-gradient-*` finds zero references outside these two files themselves (only stale hits in `lint-output.json`, `context-map.json`, and a 2026-06-09 audit doc). No plugin page renders the accent layer; no CSS consumes the custom properties it sets.
- **Root cause**: The per-plugin gradient/glow chrome was superseded by the `getBrandTokens` registry (`src/lib/connectors/brandTokens.ts`), which PluginBrowsePage and the plugin panels now use for all accent colouring; the accent-layer wrapper was never deleted. `pluginTheme.ts` also duplicates the per-plugin colour source of truth: its hardcoded RGB triplets (e.g. obsidian-brain `139 92 246`) are a parallel palette that can drift from `BRAND_TOKENS[...].hex` (e.g. `#7C3AED`).
- **Impact**: Two orphaned files invite future edits to a palette nothing renders, and any auditor comparing colours across `pluginTheme.ts` vs `brandTokens.ts` chases phantom inconsistencies. Also carries a `Record<Exclude<PluginTab,'browse'>>` type that must be updated on every new plugin id for zero benefit.
- **Fix sketch**: Delete both files (verification done: no static importers anywhere in src/ or src-tauri/; the component is not registered dynamically). If the accent-layer treatment is still wanted later, reintroduce it deriving from `getBrandTokens(id).hex` so there is a single colour registry. Also update `context-map.json` for this context afterwards.

## 2. PluginBrowsePage rebuilds and re-sorts the PLUGINS list on every render, with a redundant `.slice()`
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/PluginBrowsePage.tsx:28
- **Scenario**: Every render of the Browse page (each `enabledPlugins`/`togglePlugin` store change re-renders it, e.g. every toggle click) reallocates the 5-element `PLUGINS` array, calls `.slice()` on a literal that is already fresh, and re-sorts with `localeCompare`.
- **Root cause**: The array literal plus sort live inside the component body with no memoization; `.slice()` is a defensive copy of an array that was just constructed, so it is pure noise. Only the translated labels (`t`) are actual inputs.
- **Impact**: Bounded cost (5 items), so this is more hygiene than measurable waste — but it re-runs locale collation on every toggle and the stray `.slice()` implies the array is shared when it is not, which misleads readers.
- **Fix sketch**: Wrap in `useMemo(() => [...defs].sort((a, b) => a.label.localeCompare(b.label)), [t])` and drop the `.slice()`. Alternatively hoist the id/icon/translation-key tuples to module scope and only resolve labels + sort inside the memo.
