# settings/byom — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: App Shell, Settings & Sharing | Files read: 9 | Missing: 0

## 1. Unhandled promise rejection from the 5s timeout race in handleTestConnection
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/settings/sub_byom/components/ByomProviderList.tsx:194
- **Scenario**: `Promise.race([testProviderConnection(id), timeout])` — whenever the IPC call settles before 5s (the normal case), the losing timeout promise still rejects 5s later with nobody attached. This fires on every auto-test (one per allowed provider on each Providers-tab mount after the 5-min health-cache TTL) and every manual "Test connection" click. The `setTimeout` handle is also never cleared, so it survives component unmount.
- **Root cause**: The timeout promise is constructed with a bare `reject` in `setTimeout` and no `.catch()`, and the timer id is discarded, so the loser of the race is orphaned.
- **Impact**: A steady stream of `unhandledrejection` events — this app ships Sentry, so each one is potential error-noise/quota burn, and each test leaves a live 5s timer behind (including after unmount).
- **Fix sketch**: Keep the timer id and clear it in a `finally` after the race; attach a no-op `.catch(() => {})` to the timeout promise (or better, use `AbortSignal.timeout(5000)`-style handling: `let tid; const timeout = new Promise((_, rej) => { tid = setTimeout(() => rej(new Error(s.test_timed_out)), 5000); }); timeout.catch(() => {}); try { await Promise.race(...) } finally { clearTimeout(tid); }`).

## 2. SEVERITY_STYLES map + worst-severity derivation duplicated verbatim across ByomRoutingRules and ByomComplianceRules
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_byom/components/ByomRoutingRules.tsx:7
- **Scenario**: `SEVERITY_STYLES` (ByomRoutingRules.tsx:7-11 == ByomComplianceRules.tsx:7-11) and the `worstSeverity` some/some/info cascade (ByomRoutingRules.tsx:51-54 == ByomComplianceRules.tsx:51-54) are byte-identical in both components, and the per-warning list renderer (icon + message row, lines 129-144 vs 161-176) is also the same JSX.
- **Root cause**: The compliance panel was cloned from the routing panel; the shared warning-presentation logic never graduated to `libs/byomHelpers.ts` or a shared component.
- **Impact**: Any styling/severity-ordering change must be made twice; the two panels have already started to drift structurally (compliance adds provider-chip tinting), so a future edit to one will silently miss the other.
- **Fix sketch**: Move `SEVERITY_STYLES` and a `worstSeverity(warnings: PolicyWarning[] | undefined): PolicyWarningSeverity | null` helper into `libs/byomHelpers.ts` (it already owns `PolicyWarningSeverity`), and extract a small `RuleWarningList({ warnings })` component used by both panels. Pure presentation move, no behavior change.

## 3. Compliance panel reverse-engineers warned providers by substring-matching labels inside warning messages
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/settings/sub_byom/components/ByomComplianceRules.tsx:57
- **Scenario**: `warnedProviders` is built by checking `w.message.includes(`"${prov.label}"`)` for every warning × every provider. If a warning's message text is ever reworded, localized, or a provider label becomes a substring of another (e.g. "Claude" vs "Claude Code"), the chip tinting silently mis-attributes or loses warnings.
- **Root cause**: `PolicyWarning` (byomHelpers.ts:44-53) carries `ruleType`/`ruleIndex` but not the provider id the warning is about, even though `validateByomPolicy` knows it at emit time — so the UI parses it back out of prose.
- **Impact**: Fragile coupling between validation copy and UI highlighting; blocks message localization; O(warnings × providers) string scans per rule per render (trivially small today, but the pattern is the real hazard).
- **Fix sketch**: Add an optional `provider?: string` field to `PolicyWarning`, set it in each `warnings.push(...)` in `validateByomPolicy`, and build `warnedProviders` from `w.provider` directly. The Rust mirror (`ByomPolicy::validate()`) is unaffected since this validation is client-side.

## 4. useMemo(() => ({...}), [bm]) in ByomSettings is a guaranteed no-op
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/settings/sub_byom/components/ByomSettings.tsx:31
- **Scenario**: `useByomSettings()` returns a fresh object literal every render, so `guardCallbacks = useMemo(..., [bm])` recomputes every render — the memo never hits.
- **Root cause**: Dependency on the whole hook-result object instead of the two stable callbacks it wraps (`bm.handleSave`, `bm.discardChanges`).
- **Impact**: No runtime harm (`useUnsavedGuard` stores callbacks in a ref, verified), but the memo is misleading — it reads as if identity stability matters here and invites cargo-culting. Dead weight.
- **Fix sketch**: Either drop the `useMemo` and pass the object literal inline, or depend on `[bm.handleSave, bm.discardChanges]` if identity stability is genuinely wanted. One-line change.

## 5. ProviderSparkline generates gradient ids with Math.random instead of useId
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_byom/components/ProviderSparkline.tsx:47
- **Scenario**: `gradientId` is `useMemo(() => \`spark-...-${Math.random()...}\`, [color])` — an impure computation inside a memo. Under StrictMode double-render the two invocations produce different ids (harmless but nondeterministic), and if `color` ever changes the id churns, forcing the browser to rebuild the `<defs>` reference.
- **Root cause**: Random-suffix uniqueness was hand-rolled before/instead of React's `useId`, which exists exactly for SSR/StrictMode-safe unique DOM ids.
- **Impact**: Bounded — cosmetic nondeterminism and a lint-worthy impurity; three sparklines per usage card so churn is small.
- **Fix sketch**: `const gradientId = \`spark-${useId()}\`;` (sanitize the `:` React 19 puts in ids for SVG url() refs, e.g. `useId().replace(/:/g, '')`), drop the `Math.random` memo entirely.
