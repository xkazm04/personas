# Internationalization (i18n) — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: internationalization-i18n | Group: Platform Foundation
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. Arabic ships as a locale but RTL is never applied — `dir` is dead metadata
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing edge case / RTL
- **File**: src/stores/i18nStore.ts:54-66 (`applyLangAttributes`); src/i18n/locales.manifest.ts:24,34
- **Scenario**: A user picks Arabic in the language picker. `setLanguage('ar')` → `applyLangAttributes('ar')` sets `html[data-lang="ar"]` and `html[lang="ar"]` and injects the Arabic font, but **never sets `document.documentElement.dir`**. The layout renders left-to-right: sidebar on the left, icons/margins/scrollbar unmirrored, text inputs LTR. The only RTL CSS is `.typo-rtl` (src/styles/typography.css:56), which the comment says must be hand-applied per text container and is explicitly "scoped to text content only, not app layout" — so it engages nowhere automatically.
- **Root cause**: The manifest declares `dir: 'rtl'` for Arabic with the doc "RTL locales swap layout mirroring" (locales.manifest.ts:23-24), and exports `getLocaleDescriptor`, but **no code reads `descriptor.dir`** to set the document direction (grep: every `.dir` consumer is unrelated sort/path code). The promised mirroring is never wired up; `dir` is dead metadata.
- **Impact**: App-wide broken layout for a shipped, advertised locale. Global `dir="rtl"` also drives browser defaults (bidi resolution, default text-align, caret/selection, form-control direction, logical CSS props), none of which engage — so Arabic is shipped visibly broken.
- **Fix sketch**: In `applyLangAttributes`, `const d = getLocaleDescriptor(lang)?.dir ?? 'ltr'; html.setAttribute('dir', d);` (and apply in `onRehydrateStorage`). Then switch layout CSS to logical properties / `[dir="rtl"]` mirroring instead of relying on per-container `.typo-rtl`.
- **Value**: impact=8 effort=3

## 2. OAuth-timeout errors map to the generic timeout copy (ordering bug → unreachable entry)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: translated-error bridge / wrong message
- **File**: src/i18n/useTranslatedError.ts:61 (vs :65)
- **Scenario**: An OAuth connect flow times out; Rust emits `"OAuth authorization timed out"`. `resolveErrorTranslated` walks `ERROR_KEY_MAP` first-match-wins. The generic `{ match: 'timed out' }` rule (line 61) matches the substring **before** the specific `{ match: 'OAuth authorization timed out' }` rule (line 65) is ever reached. The user sees `timed_out_message` ("The request took too long to complete.") instead of the dedicated `oauth_timeout_message` ("The authorization window was open too long." / "Try connecting again and complete the sign-in promptly."). The `oauth_timeout_*` keys in en.json (10572-10573) are dead/unreachable.
- **Root cause**: A generic substring pattern precedes its more-specific superset, contradicting the file's own "most specific patterns first" contract (line 56). The team handled this for the weekly-vs-window usage-limit pair but missed the timeout pair.
- **Impact**: Wrong, less-actionable message for every OAuth timeout; also misclassifies category (`recoverable` vs the intended `user_action`), which can change downstream retry/CTA UI. Translated either way (not blank), so Medium.
- **Fix sketch**: Move the `'OAuth authorization timed out'` entry above the generic `'timed out'` entry (mirror the weekly-before-window comment). Add a unit test asserting each `keyPrefix` is reachable for a representative raw string.
- **Value**: impact=5 effort=1

## 3. `interpolate` leaks a literal `{var}` to the UI on a missing variable, with no dev warning
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: interpolation edge case / silent failure
- **File**: src/i18n/useTranslation.ts:300-302
- **Scenario**: A caller passes the wrong/absent var — e.g. `tx(t.monitor.titlebar_attention, {})` where the string is `"Persona Monitor — {count} need attention"`, or a translator renames the placeholder in one of the 14 locales (`{count}` → `{n}`). The replace callback returns the literal token, so the user sees `Persona Monitor — {count} need attention`. The dev `console.warn` at line 295 only fires for a **non-string template**, never for a missing variable, so the leak passes review silently and ships.
- **Root cause**: The missing-variable branch (`: \`{${key}}\``) emits no diagnostic. Placeholder sets are not validated to match across locales, so per-locale placeholder drift is invisible until a user reports raw braces.
- **Impact**: Raw `{placeholder}` rendered in production UI. Broad surface — 100+ interpolated strings (grep of en.json shows many `{count}`/`{service}`/`{goal}`) across 14 locales editable by translators. Not a crash.
- **Fix sketch**: In the replace callback, when `vars[key] === undefined` and `import.meta.env.DEV`, `console.warn('[i18n] interpolate: missing variable {'+key+'} in', template)` before returning the token. Add a `check:i18n` rule asserting every locale string's placeholder set equals en's.
- **Value**: impact=5 effort=2

## 4. Raw machine tokens shown to the user in production — contract violation guarded only by a dev warning
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: token-map fallback / contract violation
- **File**: src/i18n/tokenMaps.ts:50 (`return token`); src/i18n/useTranslatedError.ts:169 (`?? severity`)
- **Scenario**: The Rust backend adds or renames a status token (e.g. `awaiting_review`, `failed_precondition`) before the matching `status_tokens.*` key lands in en.json. `tokenLabel` finds no entry and `return token` — and because the token is absent from **English too**, the deep-merge English fallback can't rescue it. In production (`import.meta.env.DEV` false, so the warn at lines 40-49 never fires) the user sees the raw snake_case machine token as a badge/label. `friendlySeverityTranslated` has the identical `?? severity` leak.
- **Root cause**: The file header states machine tokens "must NEVER be shown to the user directly," yet the fallback returns exactly that to satisfy "never blank." The only guard is a dev-only `console.warn`; there is no CI check that every Rust-emitted token has a map entry. Ambiguity bonus: severity is resolved from two divergent sources — `status_tokens.severity` (tokenMaps) vs `error_registry.severity_*` (useTranslatedError) — with no documented precedence.
- **Impact**: Untranslated machine tokens leak into the UI across all locales whenever the Rust↔en.ts layers drift — the exact failure the contract forbids.
- **Fix sketch**: In production return a generic translated label (`status_tokens.unknown`) instead of the raw token; add a CI check enumerating Rust-emitted tokens against the `*_TOKENS` maps. Unify the two severity sources and document which wins.
- **Value**: impact=5 effort=4

## 5. `getActiveTranslations` warms only `common` and reads synchronously → non-React strings stay English for non-English users
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: lazy-load race / silent fallback
- **File**: src/i18n/useTranslation.ts:315-319
- **Scenario**: A Zustand action or IPC handler builds a user-facing toast via `getActiveTranslations().alerts.x` while `language === 'de'`. The function calls `preloadSections(language, ['common'])` — async, and only warms `common`, **not** the `alerts` section the caller reads — then synchronously `return getBundle(language)` the same tick. The German chunk hasn't resolved (and `alerts` was never requested), so the proxy resolves to English (getResolvedSection, line 217). These non-reactive callers read once and never re-render on the later broadcast, so the toast is English **permanently**, even after the chunk loads.
- **Root cause**: (a) Only `common` is preloaded regardless of which section the caller will read; (b) the synchronous read races the async load with no `await`; (c) non-React readers have no subscription to the `bundleVersion` broadcast. The docstring acknowledges "falls back to English while loading" but understates that for any non-`common` section it is effectively always English.
- **Impact**: Silent English leakage in store/IPC-dispatched user-facing strings for all 13 non-English locales. Not a crash.
- **Fix sketch**: Offer an async warm path (`await preloadSectionsAsync(language, sectionsNeeded)`) for critical non-React strings, or route user-facing localized strings through React components; at minimum document that non-React reads return English for any not-yet-cached section so callers don't assume localization.
- **Value**: impact=4 effort=4
