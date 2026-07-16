# lib/utils [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Prompt-injection sanitization pipeline duplicated between variableSanitizer and workflowSanitizer — and already drifted
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/utils/sanitizers/variableSanitizer.ts:38 (and src/lib/utils/sanitizers/workflowSanitizer.ts:35)
- **Scenario**: A new injection technique gets patched in one file but not the other, so one prompt-embedding path stays exploitable. This has already happened: `STRUCTURAL_PATTERNS` (variableSanitizer) includes a non-BMP homoglyph defence (`/[\u{10000}-\u{10FFFF}]/gu`) and `escapeForPromptContext` neutralizes `{{...}}` recursive substitution — `INJECTION_PATTERNS`/`escapeForPrompt` (workflowSanitizer) have neither; conversely workflowSanitizer strips markdown-heading keyword injections (`# INJECT|OVERRIDE|...`) that variableSanitizer lacks.
- **Root cause**: Two sanitizers were written independently; ~9 of the regexes, the strip loop (`stripStructuralPatterns` ≡ `stripInjectionPatterns`, byte-identical), and the escape function (heading escape + backtick escape + `---` escape) are copy-pastes that then evolved separately.
- **Impact**: Security-critical logic maintained in two places with silent divergence; every future hardening pass must remember both files or leave a gap. This is the exact drift the files' own comments warn about.
- **Fix sketch**: Extract a shared `promptInjection.ts` module in `sanitizers/` exporting the union of both pattern sets (`INJECTION_PATTERNS`), `stripInjectionPatterns()`, and `escapeForPrompt(text, opts?: { neutralizeTemplateVars?: boolean })`. Both sanitizers import from it; keep only genuinely type-specific logic (JSON length caps, name allowlists) local. Add a test asserting both entry points strip the same canonical payload corpus.

## 2. `new Intl.NumberFormat` constructed on every format call — including per animation frame inside AnimatedCounter
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: allocation-hot-path
- **File**: src/lib/utils/formatters.ts:76 (also :264, :281, :311)
- **Scenario**: `formatCost`, `formatPercent`, `formatCount`, and `formatCompactNumber` each build a fresh `Intl.NumberFormat` per invocation. These are the `formatFn` of `<AnimatedCounter>` (via `formatNumeric` / `<Numeric>`), whose write callback runs the formatter on every rAF tick of the shared engine (AnimatedCounter.tsx:66-68) — so each animating KPI tile constructs a NumberFormat at up to 60fps, and dashboards render dozens of formatted cells per pass (KpiTile, ExecutionListRow, ChainSpanRow, CloudExecutionRow, etc. — 21 call-site files).
- **Root cause**: `Intl.NumberFormat` construction is one of the most expensive stdlib constructors (locale data resolution, options validation); the formatters treat it as free by instantiating inline.
- **Impact**: Measurable GC churn and main-thread time during counter animations and large table renders — dozens of µs per construction × cells × frames, on the app's hottest visual paths.
- **Fix sketch**: Add a module-level memo: `const _fmtCache = new Map<string, Intl.NumberFormat>()` keyed by `` `${locale}|${style}|${min}|${max}|${notation}` ``, with a `getNumberFormat(locale, opts)` helper used by all four formatters. NumberFormat instances are immutable and reusable; the cache is naturally bounded by the handful of distinct (locale, precision) combos the app uses.

## 3. rAF engine writes settled entries every frame while any other entry animates
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-work
- **File**: src/lib/utils/rafAnimationEngine.ts:64
- **Scenario**: A dashboard mounts 8 AnimatedCounters; one value changes. The tick loop iterates all registered entries and calls `entry.write(entry.current)` unconditionally — so the 7 settled counters each run their formatFn (an `Intl.NumberFormat` build, see finding 2) plus a setState-compare on every frame for the full duration of the one active animation.
- **Root cause**: The settle check (lines 56-62) zeroes velocity and snaps `current` to `target`, but the subsequent `entry.write(entry.current)` runs regardless of whether the value changed this frame.
- **Impact**: Per-frame work scales with total registered counters instead of actively animating ones — O(all) formatter calls at 60fps when it should be O(active). Directly multiplies the cost of finding 2.
- **Fix sketch**: Skip the write for entries already at rest: compute `const settled = entry.current === entry.target && entry.velocity === 0` *before* integrating; if settled, `continue` without writing. Ensure `setAnimationTarget` and `snapAnimation` still write once on change (they do — `snapAnimation` writes explicitly, and un-settling an entry makes the next tick write it).

## 4. Blocked-hostname regex and URL safety checks copy-pasted between variableSanitizer and sanitizeUrl
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/utils/sanitizers/variableSanitizer.ts:61 (and src/lib/utils/sanitizers/sanitizeUrl.ts:15)
- **Scenario**: A private-range gap (e.g. IPv6 ULA `fd00::/8`, decimal/octal IPv4 encodings, `169.254.x.x` link-local — none currently blocked) gets fixed in `sanitizeUrl.ts` but not in the variable validator, leaving the template-variable SSRF gate weaker than the icon/shell gate.
- **Root cause**: `BLOCKED_HOSTNAME_RE` is duplicated verbatim — variableSanitizer's copy even carries the comment "(mirrors sanitizeUrl.ts)" — and the surrounding checks (protocol allowlist, embedded-credentials rejection, `new URL` parse guard) are re-implemented in `validateUrl()` rather than reusing the sanitizer.
- **Impact**: Security-relevant allow/deny logic in two places; guaranteed to drift the next time either is hardened (the two files are already inconsistent on unsafe-codepoint checking, which only sanitizeUrl performs).
- **Fix sketch**: Export `BLOCKED_HOSTNAME_RE` (or better, an `isBlockedHostname(host)` + `parseSafeHttpUrl(raw): URL | null` helper) from `sanitizeUrl.ts` and have `validateUrl()` in variableSanitizer delegate to it, keeping only the human-readable error-message mapping local.

## 5. Four overlapping duration→string formatters in formatters.ts
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/utils/formatters.ts:186
- **Scenario**: `formatInterval` (186), `formatCountdown` (197), `formatElapsed` (217), and `formatDuration` (407) all convert seconds/ms into h/m/s strings with independently written floor/modulo cascades. Their outputs differ subtly for the same input (`formatCountdown(3900)` → "1h 5m", `formatElapsed(3900, {unit:'s'})` → "1h 5m", `formatInterval(3900)` → "1 hour 5 minutes", `formatDuration(3_900_000)` → "1h 5m") and each caller picks one ad hoc — TriggerCountdown, CronAgentCard, useRotationTicker, scheduleHelpers, etc. all import different ones.
- **Root cause**: Each formatter was added for a specific surface (interval labels, countdowns, elapsed timers, metric durations) without consolidating the shared h/m/s decomposition.
- **Impact**: ~80 lines of near-duplicate arithmetic in one file; a fix to one cascade (e.g. rounding, zero-padding, i18n) must be replicated three more times; inconsistent duration renderings across adjacent UI.
- **Fix sketch**: Extract one internal `decomposeDuration(totalSeconds): {h, m, s}` and rebuild the four public functions as thin style adapters (`verbose`, `compact`, `clock`) over it. Keep the existing exported names/signatures so no call sites change; consider deprecating `formatCountdown` in favor of `formatElapsed(value, {unit:'s'})` which is already output-identical.

## 6. findDayOfWeekInText re-sorts names and recompiles up to 14 RegExps on every call
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: allocation-hot-path
- **File**: src/lib/utils/dayOfWeek.ts:70
- **Scenario**: The NL trigger parser (`nlTriggerParser.ts`) calls this while interpreting user input; each call does `Object.keys(...).sort()` plus `new RegExp(...)` per day name until a match — all on constant data.
- **Root cause**: The longest-first name ordering and the per-name word-boundary regexes are derived inside the function body instead of once at module scope.
- **Impact**: Bounded waste (14 regex compiles per keystroke-ish invocation) — cheap in absolute terms, but pure constant work that costs nothing to hoist.
- **Fix sketch**: Precompute at module scope: `const DAY_NAME_MATCHERS = Object.entries(DAY_NAME_TO_NUM).sort(([a],[b]) => b.length - a.length).map(([name, num]) => [new RegExp(`\\b${name}s?\\b`), num] as const);` then loop over the frozen array. Alternatively a single alternation regex `\b(sunday|saturday|...)s?\b` with a lookup on the captured group.
