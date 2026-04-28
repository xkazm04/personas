# Ambiguity Audit — Fix Wave 6: Sanitization & cross-boundary contracts

> 3 commits, 3 critical findings closed (Theme F). 1 already-fixed in tree (`escapeSqlStringLiteral`, prior commit).
> Baseline preserved (modulo the same pre-existing `useMatrixBuild.test.ts` failure carried over from Wave 4).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | (already-fixed) | `vault-data-sources-dependencies.md` #1 (`escapeSqlStringLiteral` regex) | critical | (no commit — was fixed in `03d360fb`) |
| 2 | `5cae48fc` | `vault-data-sources-dependencies.md` #2 (Redis SCAN injection) | critical | `features/vault/sub_databases/introspectionQueries.ts` |
| 3 | `a5ee5265` | `connector-catalog.md` #1 (`ROLE_PRESETS` no contract) | critical | `features/vault/sub_catalog/components/picker/catalogRolePresets.ts`, `usePickerFilters.ts` |
| 4 | `d72386f2` | `connector-catalog.md` #2 (`auth_variants` cast) | critical | `features/vault/sub_catalog/components/forms/CredentialTemplateForm.tsx` |

## What was fixed (grouped by sub-pattern)

1. **`escapeSqlStringLiteral` regex (already-fixed in tree).** The audit reported `value.replace(/[ -]/g, '')` — a corrupted character class that strips space-through-hyphen punctuation while letting actual control characters pass — but the live tree already contains the correct `[\x00-\x1F\x7F]` range plus a DEL inclusion (commit `03d360fb`, "fix(vault): readable regex + DEL coverage in introspection escape helpers"). The audit captured stale state; recorded as already-existed.

2. **Redis SCAN MATCH prefix interpolated without escaping.** `getSelectAllQuery`'s Redis branch returned `SCAN 0 MATCH ${tableName}* COUNT 100` while the Postgres / MySQL / SQLite / Convex branches all defensively escape their identifier input. A Redis key like `cache[v1]` was interpreted as a glob char class instead of a literal substring; keys with leading `*` or `?` matched far more than expected; trailing-space prefixes failed entirely. Added `escapeRedisGlob()` paralleling the SQL identifier helpers — backslash-escapes `\ * ? [ ]` so the supplied prefix is treated as literal data. The trailing `*` in the SCAN pattern remains the prefix-match wildcard (intentional, post-escape). Documented the choice (literal vs. glob input) in a comment.

3. **`ROLE_PRESETS` hardcoded category strings with no contract against the Rust catalog.** The categories `'devops'`, `'cloud'`, `'project_management'`, etc. must match `connector-categories.json` keys, with a comment to that effect but no codegen, runtime guard, or test enforcing the contract. A Rust-side rename silently emptied the role filter — 0 connectors with no error, no test failure, no telemetry. Added `assertRolePresetCategoriesValid(liveCategories)` returning the offenders and `console.warn`ing in dev mode; wired into the picker via `useEffect([connectors])` in `usePickerFilters` so any mismatch surfaces the moment the live catalog loads. Production keeps the existing silent-zero-results behaviour to avoid blowing up the UI on a transient catalog skew, but dev / E2E now catches the contract break loudly.

4. **`metadata.auth_variants` cast to `AuthVariant[]` after only `Array.isArray`.** Downstream code assumed every element had `.fields` (string[]), `.auth_type_label`, `.id`, `.label` — but the runtime check accepted `[42, "foo", null]` just fine. A malformed variant from connector JSON (Rust-side or AI-driven negotiation) crashed the picker's `useMemo` or, worse, silently misfiltered visible fields, potentially exposing or hiding sensitive inputs. Added a hand-written `parseAuthVariants()` that walks each entry and verifies the four fields' types; rejects malformed input by returning `null`; the `useMemo` catches that and falls back to the no-variant render path with a `silentCatch` breadcrumb naming the offending connector.

## Verification table (before / after)

| Counter | Before Wave 6 | After Wave 6 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (broad set, modulo pre-existing useMatrixBuild failure) | 447 / 448 | 447 / 448 |
| Identifier-interpolation paths without escape helpers | 1 (Redis SCAN) | 0 |
| Cross-boundary string vocabularies with no contract enforcement | 1 (ROLE_PRESETS) | 0 (now dev-mode asserted) |
| Opaque-blob casts with no runtime shape guard | 1 (auth_variants) | 0 (parseAuthVariants validates) |
| Already-existed catches (audit captured stale state) | 1 (escapeSqlStringLiteral) | — (recorded) |

## Cumulative status (waves 1-6 of the ambiguity audit)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 |
| 2 | Silent failure / lying state | 6 critical (+1 already-fixed) | 6 + 1 docs | +114 / -342 |
| 3 | Cross-entity scoping | 4 critical | 4 | +109 / -20 |
| 4 | Validation / security gates | 6 critical | 6 | +154 / -36 |
| 5 | State / cache invalidation | 4 critical | 4 | +143 / -27 |
| 6 | Sanitization & cross-boundary contracts | 3 critical (+1 already-fixed) | 3 | +110 / -3 |
| **Total** | | **26 critical** (+ 2 already-fixed) | **26 fixes + 6 wave summaries + 1 INDEX scope** | |

That covers the full critical surface from the audit's themes A through F. Of 29 critical findings catalogued in INDEX.md, 26 received explicit code or doc fixes this session, 2 were already-fixed in the live tree (sticky-throttle, escapeSqlStringLiteral), and the remaining outliers — `recipes-pipelines.md` #10 (pipeline events dropped on team-id mismatch) and `deployment-sharing-plugins.md` #2 — were either deferred during Wave 2 capacity or have been transformed by interim merges; the per-context reports remain authoritative.

## Patterns established (additions to the catalogue, items 22-24)

22. **Identifier interpolation needs a per-dialect escape helper, even for the "less-used" branches** — when a function dispatches to N database flavours and N-1 of them have escape helpers, the missing one is almost certainly an injection bug. Apply escape consistently; the trade-off between "literal prefix" and "glob syntax" must be DECIDED and DOCUMENTED, not left ambiguous. Choose literal-by-default; the trailing wildcard, if any, lives in the caller post-escape.

23. **Cross-boundary string vocabularies need a contract** — when a TS file hardcodes string keys that must match values from another language (Rust JSON, OpenAPI spec, GraphQL schema), the contract must be machine-checkable. Codegen is the durable answer; a dev-mode `console.warn` against the live data is the lightweight backstop. Without one or the other, a unilateral rename on either side fails silently.

24. **Opaque-blob casts at trust boundaries must have a runtime shape guard** — when crossing a JSON-from-elsewhere boundary (config files, IPC payloads, OAuth metadata), `as Foo[]` after `Array.isArray` is not validation. Walk each entry, type-check each field, reject the whole if any element fails — and choose the failure mode (null fallback vs. throw) based on how much of the UI depends on the value.

## What remains (after Wave 6)

The original Wave 1-3 plan + the Wave 4-6 expansion has now closed the audit's critical surface end-to-end (themes A-F). Outstanding work documented in the per-context reports for future sessions:

- **Theme G — magic-number sweep** (~35 findings): polish, mostly low/medium severity. Postpone unless the user explicitly requests a clean sweep.
- **Two specific theme-B criticals** that remain open from Wave 2's prioritisation:
  - `recipes-pipelines.md` #10 (pipeline events silently dropped on team-id mismatch — re-triggers possible)
  - `deployment-sharing-plugins.md` #2 (`dangerConfirmed` shared across danger paths — partially addressed by Wave 4 dangerKind work but the deploy/sharing diff still has its own variant)
- **All 66 high-severity findings + 89 mediums + 18 lows** documented in the per-context reports.

Resume in a future session by reading `INDEX.md`, picking a theme or specific finding ids, and following the same per-fix loop documented in the vibeman skill: read the source finding, read the target code, apply the fix, run tsc + targeted tests, atomic commit with `Refs:` line.
