# plugins/companion [4/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 1 medium / 2 low)
> Context group: Plugins & Companion | Files read: 4 | Missing: 0

## 1. Three unrelated types named `PersonaSummary` coexist in the frontend
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/inbox/hooks/adapters/types.ts:8
- **Scenario**: A developer importing `PersonaSummary` gets three incompatible candidates: this adapters projection (`{ personaName, personaIcon, personaColor }`), the composer UI shape (`{ id, name, color }` in src/features/agents/sub_glyph/commandPanel/composer/ComposerEventPersonaList.tsx:7), and the Rust-generated binding (`{ personaId, enabledTriggerCount, lastRunAt, health }` in src/lib/bindings/PersonaSummary.ts, re-exported from the bindings barrel). Auto-import picks the wrong one silently until fields fail to typecheck — or worse, structurally overlap.
- **Root cause**: Each surface coined its own "summary of a persona" type with a generic name; none references the others, and the shapes have zero fields in common.
- **Impact**: Real maintenance hazard: wrong auto-imports, confusing grep results, and the illusion that these are one concept. The Rust binding name is fixed by codegen, so the two hand-written ones are the collision to resolve.
- **Fix sketch**: Rename the two hand-written types to say what they are: this one to `InboxPersonaBadge` (or `PersonaBadgeFields` — it is the name/icon/color projection stamped onto every UnifiedInboxItem) and the composer one to `ComposerPersonaOption`. Both are locally consumed (adapters + useUnifiedInbox; composer list/modal/template-list), so the rename is a mechanical 8-file change with no behavior risk. Leave the ts-rs binding untouched.

## 2. `firstGrapheme` does not do what its doc contract claims (codepoints, not graphemes)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: misleading-contract
- **File**: src/features/plugins/companion/inbox/_shared/grapheme.ts:8
- **Scenario**: A persona icon that is a ZWJ sequence ('👨‍💻') renders as just '👨', and a flag emoji ('🇨🇿') renders as a lone regional-indicator glyph — the helper's docstring says it is "Safe for emoji ZWJ sequences" while `Array.from(s)[0]` only splits by codepoint, not grapheme cluster.
- **Root cause**: `Array.from` iterates Unicode codepoints; extracting a full grapheme cluster needs `Intl.Segmenter` (available in the Tauri webview and every target runtime).
- **Impact**: Bounded visual glitch on multi-codepoint emoji icons plus a doc that actively misleads the next caller into trusting grapheme safety. The doc even contradicts itself ("returns '👨' as the first codepoint").
- **Fix sketch**: Implement with `Intl.Segmenter`: `const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); return seg.segment(s)[Symbol.iterator]().next().value?.segment ?? '';` (construct the segmenter once at module scope). Then the docstring becomes true. Alternatively, correct the doc to "first codepoint" and rename to `firstCodepoint` — but the Segmenter fix is ~3 lines and matches the stated intent.

## 3. Cross-feature reach into `companion/inbox/_shared` from the home cockpit
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/plugins/companion/inbox/_shared/grapheme.ts:1
- **Scenario**: `src/features/home/sub_cockpit/widgets/PersonaOverviewWidget.tsx:27` imports `firstGrapheme` from deep inside another feature's `_shared` folder (`@/features/plugins/companion/inbox/_shared/grapheme`). The `_shared` convention signals "shared within this feature", and that boundary is already broken.
- **Root cause**: The helper started as an inbox-local utility and grew a second consumer in a different feature without being promoted to a common location.
- **Impact**: Feature-boundary erosion: deleting or reorganizing the companion inbox now silently breaks the home cockpit, and the next generic string helper has precedent to land in the wrong place. Cost is bounded (one import, one 5-line function).
- **Fix sketch**: Move the function to a repo-level utility (e.g. `src/lib/text/grapheme.ts` or an existing string-utils module) and update the two import sites (inbox consumers + PersonaOverviewWidget). Pairs naturally with the `Intl.Segmenter` fix in finding 2 so the promotion ships a correct implementation.
