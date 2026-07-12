> Context: lib/utils [1/2]
> Total: 9
> Critical: 0  High: 1  Medium: 4  Low: 4

## 1. JSON template variables are silently truncated to 2000 chars, producing malformed JSON
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case / data-corruption
- **File**: src/lib/utils/sanitizers/variableSanitizer.ts:204-207, 288-347
- **Scenario**: A `json`-typed adoption variable holds a 5 KB structured payload (well under its declared `MAX_JSON_VALUE_LENGTH` = 10_000). `validateVariable` runs the generic length gate at line 205 (`trimmed.length > MAX_VALUE_LENGTH` = 2000) BEFORE the `case 'json'` branch, so it is rejected with "Value must be 2000 characters or fewer" — the 10k allowance is unreachable. Worse, on the sanitize path `sanitizeVariableValue` unconditionally does `clean = clean.slice(0, MAX_VALUE_LENGTH)` (line 295) before the switch; the later `case 'json': clean = clean.slice(0, MAX_JSON_VALUE_LENGTH)` (line 328) is a no-op because the value was already cut to 2000. A JSON blob truncated mid-structure is no longer valid JSON.
- **Root cause**: The 2000-char gate/pre-slice was written as a universal cap but never exempted the `json` type it is supposed to override. The two constants (2000 vs 10_000) contradict each other.
- **Impact**: Valid structured variables are rejected in the UI, and any that slip through are silently mangled into invalid JSON before embedding in the AI prompt — data loss + downstream parse failures.
- **Fix sketch**: In `validateVariable`, make the pre-switch length gate type-aware (skip for `json`, or use `MAX_JSON_VALUE_LENGTH` when `requirement.type === 'json'`). In `sanitizeVariableValue`, move the initial `slice(0, MAX_VALUE_LENGTH)` into the non-json branches (or slice with the type's own limit) so the `json` case truncates only at 10k.

## 2. Injection-pattern regex arrays and prompt-escape helpers duplicated across two sanitizers
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/lib/utils/sanitizers/variableSanitizer.ts:38-58,267-277 vs src/lib/utils/sanitizers/workflowSanitizer.ts:35-55,152-160
- **Scenario**: `STRUCTURAL_PATTERNS` (variableSanitizer) and `INJECTION_PATTERNS` (workflowSanitizer) are near-identical lists of the same ~9 prompt-injection regexes (section delimiters, role overrides, "ignore previous instructions", zero-width, ANSI). `escapeForPromptContext` and `escapeForPrompt` are also byte-for-byte the same except one extra `{{...}}` rule. Verified both files are the sole definers via grep.
- **Root cause**: Two parallel sanitizers grew independently against the same threat model instead of sharing a canonical pattern set.
- **Impact**: Maintainability — a new injection bypass has to be patched in two places and they will drift (they already differ by the markdown-heading and `{{}}` rules), so one surface can silently lose coverage.
- **Fix sketch**: Extract a shared `promptInjectionPatterns.ts` (pattern array + `escapeForPrompt` with an opt-in `neutralizeTemplates` flag) and import from both.

## 3. Blocked-hostname SSRF regex duplicated verbatim between two files
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/lib/utils/sanitizers/variableSanitizer.ts:60-62 vs src/lib/utils/sanitizers/sanitizeUrl.ts:14-16
- **Scenario**: `BLOCKED_HOSTNAME_RE` is copied character-for-character; variableSanitizer's own comment says "(mirrors sanitizeUrl.ts)". A security allowlist maintained by copy-paste is exactly the kind that drifts.
- **Root cause**: No shared export for the private-network hostname policy.
- **Impact**: Maintainability / latent security — updating one (e.g. adding IPv6 ULA `fc00::/7`) leaves the other stale.
- **Fix sketch**: Export `BLOCKED_HOSTNAME_RE` from sanitizeUrl.ts and import it in variableSanitizer.ts.

## 4. Unbounded concurrent key refresh during rotation / cold-start in IPC crypto
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/lib/utils/platform/crypto.ts:44-60
- **Scenario**: If several `encryptWithSessionKey` calls fire while `cachedPublicKey` is null (first use) or older than 60s, every one of them independently awaits `getSessionPublicKey()` and re-runs `importPublicKey` (an async `subtle.importKey`) — there is no in-flight dedup. N concurrent credential encrypts do N redundant IPC round-trips + RSA imports.
- **Root cause**: The cache tracks value + timestamp but not an in-flight promise, so the stale window is not serialized.
- **Impact**: Perf / redundant IPC (not corruption — all imports resolve to the same PEM). Bounded and self-healing, hence low.
- **Fix sketch**: Memoize an in-flight `Promise<CryptoKey>` (mirror the `_inflight` pattern already used in staleWhileRevalidate.ts) and clear it in `clearCryptoCache`.

## 5. File-path redaction regex mangles ordinary URLs in error messages
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/utils/sanitizers/maskSensitive.ts:52,75-83
- **Scenario**: `FILE_PATH_RE` = `/\/[\w./-]+|.../g` matches any `/` followed by word/`.`/`-`/`/` chars. In a message like `Failed to reach https://api.example.com/v1/run`, the `//api.example.com/v1/run` portion matches the unix-path branch and is replaced with `[path]`, yielding `Failed to reach https:[path]`. Because `sanitizeErrorMessage` runs FILE_PATH first, the URL is destroyed before EMAIL/host rules see it, and `sanitizeErrorForDisplay` then flags the message as "redacted" (logs it as sensitive) purely because a normal URL was clobbered.
- **Root cause**: The path pattern has no boundary distinguishing a filesystem path from a URL path segment, and it runs before URL-aware passes.
- **Impact**: UX — legitimate, non-sensitive error text (endpoints, docs links) is shredded into `[path]`, degrading the diagnostic value of surfaced errors and inflating "redacted" logging.
- **Fix sketch**: Anchor the unix-path branch to not follow `:` (e.g. require a non-`:`/non-`/` char before the leading slash, or strip URLs' scheme+host first), or run a URL-query/fragment redactor before the file-path pass (crashPersistence.ts already has `URL_QUERY_RE`/`URL_FRAGMENT_RE` — reuse it here).

## 6. Two different `MOTION` exports with incompatible shapes
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication / naming-collision
- **File**: src/lib/utils/designTokens.ts:29-50 vs src/lib/utils/animation/animationPresets.ts:38-51
- **Scenario**: `designTokens.ts` exports `MOTION = { duration, delay }` (raw ms numbers); `animationPresets.ts` exports a completely different `MOTION = { snappy, smooth, gentle }` (framer configs). Both live under `lib/utils/*`. An import of the wrong `MOTION` typechecks differently and silently gives the wrong motion semantics.
- **Root cause**: Two motion registries introduced in separate waves reused the same top-level name.
- **Impact**: Maintainability — high foot-gun on autocomplete/auto-import; the "single source of motion timing" intent is defeated by having two.
- **Fix sketch**: Rename one (e.g. `MOTION_TOKENS` in designTokens or `MOTION_PRESETS` in animationPresets) and have the framer presets derive their ms from the token registry.

## 7. Dead animation transition exports
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/lib/utils/animation/animationPresets.ts:33-34
- **Scenario**: `TRANSITION_INSTANT` and `TRANSITION_FAST` have no importers anywhere (grep across src: only `TRANSITION_NORMAL` → TemplateCardPreview.tsx and `TRANSITION_SLOW` → AutoCredPanel.tsx are used; the identically-named exports in `features/overview/libs/animations.ts` are a separate, unrelated file). The uppercase `CSS_DURATION_CLASS.SNAP/FLOW/EASE` aliases also duplicate the lowercase `snappy/smooth/gentle` entries.
- **Root cause**: Preset set was authored speculatively (full instant→slow ladder) but only two rungs are consumed.
- **Impact**: Maintainability — dead surface area that reads as load-bearing.
- **Fix sketch**: Remove `TRANSITION_INSTANT`/`TRANSITION_FAST`; collapse the duplicate uppercase `CSS_DURATION_CLASS` aliases if their `MOTION_TIMING` counterparts (only `.FLOW` is used) are likewise trimmed.

## 8. Unknown-model cost silently defaults to $0, undercounting spend
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / money
- **File**: src/lib/utils/platform/pricing.ts:79-82
- **Scenario**: For any external model string not in `MODEL_PRICING` and not matching a `FREE_MODEL_PREFIXES` entry (e.g. a new `gpt-5*` or a typo'd id), `estimateCost` returns `totalCost: 0` with only a `logger.warn`. Budget/impact surfaces that sum `totalCost` will show real API spend as free. The `estimated: true` flag is returned but callers must opt in to read it.
- **Root cause**: "Zero to avoid false budget alerts" trades a false-high for a false-zero; a paid-but-unrecognized model is indistinguishable from a genuinely free local model (both return `totalCost: 0`).
- **Impact**: Money — cost dashboards silently undercount for any model added upstream before the pricing table is updated.
- **Fix sketch**: Keep `estimated: true` but surface it in cost aggregation (e.g. render `~$?` / a "pricing unknown" badge when any summed row is `estimated`), or fall back to a conservative default tier for non-`FREE`-prefixed unknowns instead of 0.

## 9. SWR cache grows unbounded (no eviction)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: resource-leak
- **File**: src/lib/utils/staleWhileRevalidate.ts:13,57-64
- **Scenario**: `_cache` is a module-level `Map` that only ever gains entries (on every successful fetch) and is pruned solely by explicit `invalidateSWRCache(key)` / `clearSWRCache()`. If keys are derived from anything variadic (per-persona/per-execution ids), a long-lived desktop session accumulates one retained result object per distinct key forever, with no TTL-based eviction — the TTL only gates freshness, not retention.
- **Root cause**: TTL controls staleness but there is no size cap or expiry sweep, so stale entries are kept as fallback indefinitely.
- **Impact**: Memory — slow unbounded growth over a long-running Tauri session; magnitude depends on key cardinality.
- **Fix sketch**: Add an LRU cap (evict oldest past N entries) or drop entries older than a hard `maxAge` on read; at minimum document that callers must use a bounded key space.
