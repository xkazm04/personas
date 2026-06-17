# Test Mastery — Internationalization (i18n)
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Context: the 14-language i18n system — section-locale lazy loading (`useTranslation.ts`), the `t` proxy, route-section mapping (`routeSections.ts`), status-token maps (`tokenMaps.ts`), the English bundle shim (`en.ts`) and the translated-error bridge (`useTranslatedError.ts`).

**Suite state:** There are **zero** `*.test.ts(x)` files anywhere under `src/i18n/` (confirmed by glob + find). 189 test files exist elsewhere in the repo, vitest is configured (`jsdom`, globals, `src/test/setup.ts`), and three CI scripts cover i18n *keyset* health (`check:i18n` keyset parity, `check:error-registry` ERROR_KEY_MAP→en.json key parity, `check:i18n-dead` unused keys). Crucially, **those scripts gate static key existence, not runtime behavior** — none of the actual resolution/matching/merge/interpolation logic is exercised by any test. Every finding below is therefore "current test state: none" unless noted.

---

## 1. Error-to-friendly-message resolution (`resolveErrorTranslated`) has no behavioral test — wrong match = wrong user guidance on revenue/auth/budget errors
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/i18n/useTranslatedError.ts:59-164 (ERROR_KEY_MAP + resolveErrorTranslated)
- **Current test state**: none
- **Scenario**: `ERROR_KEY_MAP` is an **ordered, first-match-wins** list. The ordering is load-bearing and fragile: `weekly usage limit reached` must match before `usage limit reached`; `usage limit reached` before `rate limit exceeded`; the specific `n8n_invalid_shape` before the generic `Validation`; `Budget limit exceeded` vs `budget exceeded` carry *different categories* (`user_action` vs `user_action` — but `usage_limit_weekly` is `user_action` while `usage_limit_window` is `recoverable`, a behavioral difference that drives whether the UI tells the user "runs will keep failing, upgrade" vs "retries automatically, no action needed"). A future alphabetization, dedupe, or reordering of this array silently misclassifies a billing/usage/auth error — the user is told "no action needed" when in fact their schedules are dead until they upgrade, or vice-versa. Nothing catches it: the parity CI script only checks the en.json keys *exist*, not that the right rule fires for a given raw string.
- **Root cause**: All logic lives in a 100+ rule ordered table consumed only at runtime; no test asserts "raw string X → keyPrefix/category Y", and the ordering invariant is enforced only by a code comment ("keep specificity ordering explicit").
- **Impact**: Business-critical error UX regressions ship invisibly — wrong recovery advice on usage caps, budget blocks, expired auth, decryption failures. These are exactly the moments a user decides whether the product is trustworthy.
- **Fix sketch**: Add `useTranslatedError.test.ts`. Build a minimal `Translations`-shaped fixture for `error_registry` (or import the real `en.json` `error_registry` section) and a table-driven test: for each representative raw error (`"weekly usage limit reached: ..."`, `"usage limit reached"`, `"rate limit exceeded"`, `"Budget limit exceeded"`, `"Decryption failed"`, `"... is not a valid n8n workflow export"`, `"Validation: name required"`, an unmatched string) assert the returned `{message, suggestion, category}`. **Invariant to assert: specificity ordering — the more specific substring resolves before the generic one, and category matches the intended UI treatment.** Also assert the unmatched path returns the `generic_message`/`generic_suggestion` fallback (category `unclassified`) and that an empty/null raw returns the fallback without iterating.

## 2. `interpolate` graceful-degradation contract is untested — the exact code that exists to stop a missing translation leaf from blanking a render
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/i18n/useTranslation.ts:288-303
- **Current test state**: none (one *unrelated* test in `formatRelativeTime.test.ts` interpolates `{h}`/`{d}` for its own helper, but does not import or test this `interpolate`)
- **Scenario**: `interpolate` was deliberately hardened: a non-string template (missing/renamed leaf resolving to `undefined` or a nested object) must NOT throw `.replace of undefined` (which "blanks the whole subtree"); it returns `""` for nullish, `String(x)` otherwise. It also leaves unknown `{placeholder}` tokens literal (`{key}`) and only substitutes `\w+` names. A refactor that "simplifies" this back to `template.replace(...)` reintroduces the render-crash this code was written to prevent — and there's no test guarding it.
- **Root cause**: Pure function with several documented edge branches, none asserted.
- **Impact**: A single mistranslated/missing key crashes or blanks an entire panel for non-English users — disproportionate blast radius across 14 locales.
- **Fix sketch**: **llm-generatable** — pure function, ideal batch. Add cases: `interpolate("Hi {name}", {name:"A"})` → `"Hi A"`; missing var → `"{name}"` literal preserved; `interpolate(undefined as any, {})` → `""`; `interpolate({} as any, {})` → stringified, no throw; numeric var coerced to string; multiple + repeated placeholders. **Invariant to assert: never throws on non-string input, and unknown placeholders survive verbatim (so the missing key is visible, not silently dropped).**

## 3. `deepMergeSection` / `getResolvedSection` locale-over-English fallback is untested — the mechanism that makes "missing keys fall back to English" actually work
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/i18n/useTranslation.ts:193-226
- **Current test state**: none
- **Scenario**: The entire i18n strategy (and the CI decision to only *warn* on missing locale keys) rests on the runtime deep-merge: locale value wins, English fills gaps, **arrays are replaced wholesale (not index-merged)**, and `undefined` override values are skipped so a locale's explicit gap doesn't erase the English string. If a refactor makes arrays merge by index, a locale with a shorter array silently corrupts index-addressed content (e.g. ordered onboarding steps, severity ladders). If `undefined`-skip breaks, a partially-translated locale starts rendering blanks instead of English. The merged result is cached by `(lang, section)` for identity stability — a cache-key bug would serve one language's strings under another.
- **Root cause**: `deepMergeSection` is a non-exported pure function with subtle, business-load-bearing rules (array-as-leaf, undefined-skip, nested fill) verified only by prose comments.
- **Impact**: Silent content corruption or blank UI for any of the 13 non-English locales — the failure mode is invisible in English-only dev/CI.
- **Fix sketch**: Export `deepMergeSection` (or test `getResolvedSection` via a seeded `sectionCache`) and add a unit test. **Invariants: (a) deeper English key present + missing in override → English value survives; (b) override array fully replaces base array (assert exact replacement, not concat/index-merge); (c) `override[key] === undefined` keeps base value; (d) `lang === 'en'` returns the English section by identity (no merge work).** Pure-ish → largely **llm-generatable**.

## 4. No gate keeps `ERROR_KEY_MAP.category` in sync with `errorRegistry.ts` — only key *existence* is gated, the category contract is on the honor system
- **Severity**: high
- **Category**: quality-gate
- **File**: src/i18n/useTranslatedError.ts:59-102 vs src/lib/errors/errorRegistry.ts:43-533
- **Current test state**: exists-but-weak (partial gate). `scripts/i18n/check-error-registry-parity.mjs` (CI-wired) asserts every `keyPrefix` has `_message` + `_suggestion` in en.json — but it explicitly extracts only `keyPrefix`, **never the `category`**. The code comment at line 56-58 says "Each entry's `category` mirrors the same field on the corresponding rule in errorRegistry.ts — keep the two in sync" with nothing enforcing it.
- **Scenario**: The two files are independent ordered tables that must agree on both the *match patterns* and the *category* for the same error. Today a translated rule can say `recoverable` while the English-fallback rule says `system` (or the two tables drift in match coverage). Because `resolveErrorTranslated` chains into `resolveError` only for *unmatched* cases, a user can get a different category — hence a different UI treatment (auto-heal vs hard error) — depending purely on whether their locale happened to have the key. The existing key-parity gate gives false confidence that "the registries are in sync."
- **Root cause**: The parity script was scoped to key existence only; category and match-pattern coverage between the two registries are uncovered.
- **Impact**: Inconsistent error severity/treatment across locales and across the translated-vs-legacy paths; drift compounds every time someone edits one table and not the other.
- **Fix sketch**: Either (a) extend `check-error-registry-parity.mjs` to also parse `category` and assert each translated `keyPrefix`'s category equals the category of the correspondingly-named rule in `errorRegistry.ts`; or (b) a vitest that imports both modules and asserts, for a fixed corpus of raw strings, that `resolveErrorTranslated(t, raw).category === resolveError(raw).category` for every string that both tables claim to match. Calibrate as **blocking** (cheap, deterministic, catches a real cross-file contract break).

## 5. Breadcrumb dedup + double-record avoidance in `recordResolveBreadcrumb` is untested and time-dependent
- **Severity**: medium
- **Category**: coverage-gap (with flaky-nondeterministic risk if written naively)
- **File**: src/i18n/useTranslatedError.ts:21-47, 124-163
- **Current test state**: none
- **Scenario**: The resolver records a Sentry breadcrumb with the **raw** error before rewriting (so operators see the real error), with a 1s `Date.now()`-based dedup keyed on `keyPrefix::raw`. Two documented behaviors matter: (a) the matched path records exactly once and the chained `resolveError` fallback path must NOT double-record (line 152-157 relies on `resolveError` recording its own); (b) a *re-classification* (same raw → different prefix) must still surface (dedup key includes prefix). A regression here either floods Sentry (cost/noise) or drops the operator's only signal.
- **Root cause**: Module-level mutable state (`_lastBreadcrumbKey`, `_lastBreadcrumbAt`) + `Date.now()` make this both untested and a determinism trap.
- **Impact**: Lost or duplicated error telemetry — degrades incident triage, not user-facing but operationally real.
- **Fix sketch**: Mock `@sentry/react`'s `addBreadcrumb` (spy) and **`vi.useFakeTimers()` / mock `Date.now`** for determinism. Assert: same `(prefix, raw)` within 1s → one breadcrumb; advance fake clock past 1s → second breadcrumb; different prefix same raw → not deduped; matched-then-fallback path doesn't double-record. **Flag: write with fake timers, not real `setTimeout`/sleeps, to avoid a flaky test.**

## 6. `sectionsForRoute` reference-stability + drift-warn contract untested; `tokenLabel` fallback path untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/i18n/routeSections.ts:37-57 ; src/i18n/tokenMaps.ts:35-51
- **Current test state**: none (one unrelated test in `GoalKanban.test.tsx` *mocks* `tokenLabel` away, so the real resolver is never exercised)
- **Scenario (routeSections)**: `sectionsForRoute` caches per-route so the SAME array *reference* is returned across calls — this is a performance contract (line 33-37: a fresh array literal "invalidates downstream useMemo/useEffect dep arrays on every render… hundreds of components"). It also dedupes BASE+route sections via `Set` and freezes the result. A regression that returns a fresh array each call reintroduces a render storm with no test to catch it. **Scenario (tokenMaps)**: `tokenLabel` resolves a backend machine token (`"queued"`, `"critical"`) to a translated label and falls back to the **raw token** if unmapped (with a dev warn dedup). The contract is "machine tokens must NEVER be shown raw to the user" — yet the fallback *does* show the raw token, so the real defense is having the mapping. No test asserts a known token resolves, or that an unknown token returns the token unchanged exactly once-warned.
- **Root cause**: Both are pure-ish functions whose contracts (reference identity, dedupe, freeze, fallback) are only described in comments.
- **Impact**: routeSections regression = app-wide render perf cliff on every route/render; tokenMaps regression = raw machine tokens leaking into the UI for unmapped statuses.
- **Fix sketch**: routeSections — assert `sectionsForRoute('home') === sectionsForRoute('home')` (same reference, cache hit), result is frozen, contains all BASE_SECTIONS + route sections with no duplicates, and an unmapped section returns just BASE_SECTIONS. tokenMaps — **llm-generatable** with a small `status_tokens` fixture: known token → label; unknown token → returned verbatim. **Invariant: tokenLabel is total (never throws, always returns a string) and never returns a translation belonging to a different category.**

## 7. `en` proxy / `getEnglishSection` parse-and-cache behavior untested (lazy-parse correctness)
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/i18n/en.ts:30-49 ; src/i18n/englishSections.ts:11-31
- **Current test state**: none
- **Scenario**: The `en` export is a `Proxy` that lazy-`JSON.parse`s each section on first access and caches it; `isTranslationSection` guards `has`/`get`/`ownKeys`. The design goal (line 8-12) is "accessing `en.alerts.x` only pays the parse cost for the `alerts` section" and module-init is "nearly free." A regression that eagerly parses all 57 sections, or that returns `undefined`/re-parses on every access (cache miss), is a cold-start perf regression and an identity-stability bug (consumers relying on stable section object identity). Low blast radius because correctness mostly still holds, but it's the foundation the proxy/merge layers assume.
- **Root cause**: Caching + lazy-parse behavior verified only by comments.
- **Impact**: Cold-start slowdown / repeated parse cost; possible identity churn feeding the merge cache.
- **Fix sketch**: Assert `getEnglishSection('common')` returns the same object reference on repeated calls (cached, parsed once — spy on `JSON.parse` to assert called once per section), `isTranslationSection` accepts a real section and rejects garbage, and `en[unknownProp]` is `undefined` / `(prop in en)` is false for non-sections. Keep small; **llm-generatable**.

---

### Cross-cutting recommendation (calibrated gate)
The i18n module is pure-function-heavy and currently has **0% unit coverage** despite being a Platform Foundation dependency every feature renders through. Rather than a blanket threshold backfill, add the 6 focused test files above (≈1 per source file) and a **new-code ratchet**: require any new file under `src/i18n/**` to ship with a colocated test (advisory→blocking once the initial six land). The existing keyset CI scripts (`check:i18n`, `check:error-registry`) should stay as-is — they catch a *different* failure class (static key drift) and are correctly calibrated (extras fail, missing warn); the gap is purely behavioral/runtime, which unit tests own. The single most valuable add is Finding #1 — it guards real user-facing guidance on billing/auth/budget failures.
