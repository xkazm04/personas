# Bug Hunter — Internationalization (i18n)

> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)
> Context: internationalization-i18n | Group: Platform Foundation

## 1. `interpolate()` crashes on a missing/undefined translation leaf
- **Severity**: High
- **Category**: 🕳️ Edge case / 💀 Silent-turned-loud failure
- **File**: `src/i18n/useTranslation.ts:288`
- **Scenario**: A consumer calls `tx(t.section.some_key, { ... })` where `some_key` does not exist in any locale (typo, renamed key, or a key only present in a stale translation file but dropped from `en.json`). The `getBundle` Proxy resolves sections, but a *leaf* miss returns plain `undefined` (the merged section object simply has no such property). `interpolate(template, vars)` then calls `template.replace(...)` on `undefined` → `TypeError: Cannot read properties of undefined (reading 'replace')`.
- **Root cause**: `interpolate` has no guard for a non-string `template`; it assumes the caller always passes a real string. Bundle access is a Proxy that only validates the *top-level section* name (`isTranslationSection`), never the nested leaf path, so a missing leaf is indistinguishable from a present one at the type/runtime level. There is no key-existence coverage gate for the *English source itself* — `check-coverage.mjs` only compares other locales against `en.json`, never the call sites against `en.json`.
- **Impact**: A single mistyped/renamed key throws at render and is caught by the nearest React error boundary, blanking an entire panel (or the app) rather than degrading one label. Worse, it's locale-dependent if a key exists in `en` but a stale extra key in another locale masks the regression during dev. This is the highest-blast-radius failure for a FOUNDATIONAL context used everywhere.
- **Fix sketch**: Make `interpolate` defensive: `if (typeof template !== 'string') return import.meta.env.DEV ? '⟨missing-i18n⟩' : '';` (or return the key path if available). Add a build-time gate that statically extracts `t.<section>.<key>` access paths and asserts each exists in `en.json`, analogous to `check-error-registry-parity.mjs`.

## 2. Manual plural ternary breaks for non-binary plural languages (ru/ar/cs/etc.)
- **Severity**: High
- **Category**: 🕳️ Pluralization boundary / 🔮 latent
- **File**: `src/i18n/useTranslation.ts:288` (interpolate) + call sites, e.g. `src/features/shared/components/layout/quick-answer/QuickAnswerQuestionGroup.tsx:84`, `src/features/vault/sub_dependencies/NodeChip.tsx:38`
- **Scenario**: Every plural is selected at the call site with `count !== 1 ? t.x._other : t.x._one`. The shipped locales include Russian, Arabic, Czech, Polish-family rules where plural form depends on more than "is it 1?" (e.g. ru needs *one* / *few* / *many*; ar has *zero/one/two/few/many/other*). For `count = 2` or `count = 22` in Russian, the binary ternary always picks the `_other` string, which is grammatically wrong in those languages. There is no `Intl.PluralRules` selection anywhere.
- **Root cause**: Pluralization is hand-rolled as a JS ternary per call site instead of routed through `Intl.PluralRules(language).select(count)`. The key schema only models two CLDR categories (`_one`/`_other`), so even a correct selector has nowhere to store `_few`/`_many`. Translators for ru/ar/cs literally cannot express correct grammar.
- **Impact**: Systematically incorrect grammar in 4+ of the 14 shipped locales for any counted noun (agents, events, triggers, messages…). Invisible to English-speaking reviewers and to the coverage gate.
- **Fix sketch**: Centralize a `plural(key, count, vars)` helper backed by `Intl.PluralRules(language)` returning the CLDR category, and extend the key schema/codegen to allow `_zero/_few/_many` suffixes. Migrate the ad-hoc ternaries.

## 3. `tx()` interpolation feeds `dangerouslySetInnerHTML` — translator-controlled XSS surface
- **Severity**: Medium
- **Category**: ⚡ Trust boundary / 🔮 latent
- **File**: `src/features/vault/sub_dependencies/SimulationPanel.tsx:64`
- **Scenario**: `tx(dep.sim_high, { credentialName, personas, personaPlural })` is injected via `dangerouslySetInnerHTML`. The *current* code escapes `credentialName` (`escapeHtml`) and wraps it in trusted literal `<strong>` markup, and `personas` is a number — so today it's safe. But the safety is purely conventional: the **translated string `sim_high` itself is rendered as raw HTML**, and it comes from per-locale JSON edited by translators. A translator (or a compromised/poisoned translation contribution) can put `<img src=x onerror=...>` directly into `sim_high`/`sim_medium`, and it executes. Likewise a future maintainer adding an *unescaped* interpolated var (e.g. a free-text reason) would silently introduce stored XSS, because nothing at the i18n layer enforces escaping for HTML-rendered strings.
- **Root cause**: The interpolation helper has no notion of an HTML-output context; it returns a plain string and trusts every caller to pre-escape and to trust the template. There is no lint/gate forbidding `dangerouslySetInnerHTML={{ __html: tx(...) }}` or requiring sanitization at that boundary.
- **Impact**: Stored XSS reachable through the translation pipeline or one careless edit; in a Tauri webview, XSS can bridge to IPC and is high-consequence. Latent rather than active, hence Medium.
- **Fix sketch**: Run the interpolated result through the existing `sanitizeHtml`/DOMPurify before `__html`, or replace `dangerouslySetInnerHTML` with a tokenized component (`<Trans>`-style) that renders the `<strong>` as a real React node and auto-escapes interpolated values. Add an ESLint rule banning `tx(...)`/`t.*` inside `__html`.

## 4. Error/token resolvers swallow the real error and silently downgrade the message
- **Severity**: Medium
- **Category**: 💀 Silent failure / 🔮 latent
- **File**: `src/i18n/useTranslatedError.ts:137` and `src/i18n/tokenMaps.ts:39`
- **Scenario**: In `resolveErrorTranslated`, when a rule matches but the paired `error_registry` keys are absent, it returns `getRegistryString(registry, '<prefix>_message') ?? raw` and `... _suggestion') ?? ''`. So the user can be shown the **raw Rust error string** (e.g. `Failed to build HTTP client: connect: certificate verify failed`) with an **empty suggestion** — exactly the leakage the four-layer contract exists to prevent. The `?? raw` fallback masks a key gap as "working." `friendlySeverityTranslated` and `tokenLabel` similarly fall back to the raw machine token (`severity` / `status`) on a miss. The parity gate (`check-error-registry-parity.mjs`) checks `en.json` only — it does **not** verify the runtime `category` field on each `ERROR_KEY_MAP` rule stays in sync with `errorRegistry.ts` (a comment at line 57–58 admits the two must be kept in sync by hand), nor does it cover `severity_*` keys.
- **Root cause**: Defensive `?? raw` / `?? token` fallbacks chosen to "never blank," but they degrade silently to developer-facing strings and empty suggestions instead of a guaranteed generic friendly message. No CI coverage for severity keys or for `category` drift between the i18n map and the canonical registry.
- **Impact**: Untranslated/leaky error copy reaches end users (incl. non-English users seeing English/Rust internals), and category drift can route an error to the wrong UI treatment (e.g. a `recoverable` shown as `user_action`). The raw-string leak can expose internal hostnames/paths from Rust error messages.
- **Fix sketch**: On a key miss, fall back to the generic translated `generic_message`/`generic_suggestion` (not `raw`) and emit a dev warning + Sentry breadcrumb. Extend the parity gate to also assert `severity_<low|medium|high|critical>` exist and to diff each rule's `category` against the matching `errorRegistry.ts` rule.

## 5. Route-section map drift silently denies translations to a route
- **Severity**: Low
- **Category**: 🔮 Latent / route section mismatch
- **File**: `src/i18n/routeSections.ts:20`
- **Scenario**: `ROUTE_SECTIONS` hand-maps each `SidebarSection` to the translation sections that route needs to preload. If a component on, say, the `teams` route renders strings from a section not listed (`teams` only preloads `plugins`, `pipeline`), then for a **non-English** locale the section is never lazy-loaded for that route. The Proxy getter deliberately does NOT trigger a load (comment at lines 239–246), so `getResolvedSection` returns the **English** section as the "temporary" fallback — permanently, because nothing ever requests the localized chunk for that route. The user silently sees English strings inside an otherwise-translated screen.
- **Root cause**: The route→section mapping is a manually maintained allowlist with no compile-time link to which sections each route's components actually consume. Adding a new section reference to an existing route's components doesn't fail any gate; it just silently falls back to English on non-English locales.
- **Impact**: Partial, hard-to-notice English bleed-through on non-English locales — only on routes whose section list drifted from actual usage. Low because English fallback is functional and the bug is cosmetic, but it erodes trust in the localization for affected locales.
- **Fix sketch**: Generate `ROUTE_SECTIONS` (or validate it) from static analysis of which `t.<section>.*` paths each route subtree references, failing CI on a reference to a non-preloaded section. As a runtime safety net (dev only), have the Proxy getter log when a section is accessed that the active route didn't preload.
