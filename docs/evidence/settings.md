---
subject: settings
evidence:
  - src-tauri/db/src/settings_keys.rs                 # the registry: key constants + paired _DEFAULT constants, exact-key allowlist + governed prefix families, per-key typed value validation (JSON blobs against the consumer's own struct), audit categories, audit-excluded bookkeeping keys, deprecated-key quarantine
  - src-tauri/db/src/repos/core/settings.rs           # the one validation door at the repo layer (internal callers cannot bypass); audit emitted here so ALL writers are audited; before-value capture, no-op suppression, best-effort audit; idempotent delete contract
  - src/api/system/settings.ts                        # bulk read collapsing mount-time fan-out (~1-5ms per invoke motivates it); idempotent-delete caller contract; category-scoped audit listing
  - src/hooks/utility/data/useSettings.ts             # microtask coalescer — same-tick single-key reads flush as ONE bulk call; key-only settings-changed event refreshes other mounted readers
  - src/hooks/utility/data/useAppSetting.ts           # per-key accessor hook: load-on-mount via the coalescer, validate-else-default, save-with-feedback, empty-write = delete (reset restores the default)
  - src/features/settings/sub_history/components/SettingsHistoryTab.tsx   # the history surface: category filter, before→after rows, warm module cache
  - src/features/settings/shared/RecentChangeChip.tsx # recent-change visibility at the scene — last audit entry per category, deep-links to history
  - src/features/settings/search/useSettingsSearchEntries.tsx  # settings search: toggles flip inline, everything else deep-links to its owning tab
  - src/lib/appearanceMirror.ts                       # debounced write-through mirror — the durable settings row backs the fast local copy after a profile clear wiped user choices
counter_evidence:
  - src-tauri/db/src/settings_keys.rs                 # the SAME registry file carries the fail-open convention: MONTHLY_COST_CEILING_USD / CHAIN_MAX_COST_USD default 0.0 documented as "no ceiling" — the unconfigured state is the most permissive state (registered at w2-hitl-approval); contrast CHAIN_MAX_LINKS, whose UNSET falls back to an always-on cap and only an explicit "0" disables
deviations:
  - w9-settings   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval   # dollar ceilings fail open (0/None = unlimited) while switches fail closed — registered on the gating subject; cited here as the fail-direction evidence, not re-registered
---

# Settings - evidence

How this codebase measures against the [`settings`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
