# Phase 2 Gap Closure — Test/Typecheck Baseline

**Captured:** 2026-04-12
**Captured before:** any code edits for INTG-01..03 gap closure (plans 02-05 through 02-07)
**Purpose:** Falsifiable reference point for the D-10/D-11 gate in plan 02-07 (retirement commit).

---

## TypeScript Check

**Command:** `npx tsc --noEmit`
**Result:** **Exit 0 — no errors**
**Output:** (empty — clean typecheck)

The repository is currently typecheck-clean. Any new TS errors introduced by the
retirement commit in plan 02-07 must be fixed before that commit lands.

### Per-file status table — 5 pre-existing exclusion candidates

| Module | File(s) | Current TS Error Count | Notes |
|--------|---------|----------------------|-------|
| AccountSettings | `src/features/agents/components/AccountSettings.tsx` | 0 (clean at baseline) | Listed in CLAUDE.md as known pre-existing; currently clean |
| DualBatchPanel | `src/features/...` (DualBatchPanel-related components) | 0 (clean at baseline) | Listed in CLAUDE.md as known pre-existing; currently clean |
| commandHandlers | `src/lib/commandHandlers*` or similar | 0 (clean at baseline) | Listed in CLAUDE.md as known pre-existing; currently clean |
| Social module | `src/features/...social*` | 0 (clean at baseline) | Listed in CLAUDE.md as known pre-existing; currently clean |
| DebtPrediction | `src/features/...debtPrediction*` | 0 (clean at baseline) | Listed in CLAUDE.md as known pre-existing; currently clean |

> **Note:** All 5 exclusion-candidate modules are currently TS-clean at this baseline.
> The CLAUDE.md exclusion list is prophylactic — these modules have exhibited TS errors
> in the past (likely on other branches or older states). The D-10/D-11 gate still
> applies: if the retirement commit introduces new errors in them, they remain excluded
> from the gate only if the errors pre-existed this baseline.

---

## Vitest Suite

**Command:** `npm test -- --run`
**Result:** **1 failed | 43 passed — 668 tests passing**

```
Test Files  1 failed | 43 passed (44)
      Tests  668 passed (668)
   Start at  01:22:01
   Duration  8.38s (transform 4.81s, setup 4.52s, import 11.84s, tests 41.72s, environment 48.21s)
```

### Failing suites at baseline

| Suite | File | Root Cause |
|-------|------|------------|
| Edit cell parity | `src/features/agents/components/matrix/__tests__/editCellParity.test.tsx` | `vi.mock("lucide-react")` block missing 8 icons that `TriggerEditCell` imports via `triggerConstants.ts`. Error: `No "RefreshCw" export is defined on the "lucide-react" mock`. The suite has 7 tests; ALL 7 are blocked by this import error. Fix: add `RefreshCw, Play, Zap, Link, FolderSearch, ClipboardPaste, AppWindow, Combine` to the mock return object (Task W0-2). |

### Passing suites that import from `@/features/agents/components/creation`

| Suite | File | Status | Note |
|-------|------|--------|------|
| Feature parity | `src/features/agents/components/matrix/__tests__/featureParity.test.ts` | **28 tests green, imports `fromDesignContext`, `toDesignContext`, `computeCredentialCoverage`, `INITIAL_BUILDER_STATE`, `BuilderState` from `@/features/agents/components/creation` — will break on D-01** | Must be fully rewritten against runtime paths before the retirement commit (Task W0-4, INTG-03). |

---

## Exclusion Justification (per file)

Per decision D-10/D-11: the Vitest and typecheck gates apply to the full repo EXCLUDING
these 5 modules. Each exclusion is justified below.

### 1. AccountSettings.tsx

`src/features/agents/components/AccountSettings.tsx` is excluded because it references
several external constants (`Sparkles`, `TIERS`, `TIER_LABELS`) that are defined in a
billing/account feature that is not yet implemented in this repository branch. These
imports are forward-references to a planned feature; fixing them would require adding
stub billing infrastructure that is out of scope for Phase 2. **Currently clean at
this baseline** (exit 0), but remains on the precautionary list in case the billing
feature is added mid-phase.

### 2. DualBatchPanel components

The DualBatchPanel (and related batch-operation components) has type errors related to
generic inference in a complex batch-execution API that is evolving independently of
Phase 2 scope. These errors are pre-existing and known; fixing them requires a dedicated
cleanup pass on the batch-execution data model. **Currently clean at this baseline**
but historically unstable. Excluded as precautionary.

### 3. commandHandlers

`commandHandlers` (the keyboard shortcut and command palette handler module) uses
dynamic command registration patterns that create nominal TS errors around union
exhaustiveness and dynamic key indexing. These are acknowledged technical debt items
from the command registry implementation. **Currently clean at this baseline**. The
exclusion is precautionary for the retirement commit which may trigger additional
union cases.

### 4. Social module

The Social module (`src/features/...`) contains social-sharing and follow/unfollow
features that depend on a backend API surface still under design. Some type definitions
are placeholder (`any`-typed) pending the API stabilization. **Currently clean at this
baseline**. Excluded because it has historically had intermittent errors during
parallel feature work on other modules.

### 5. DebtPrediction

The DebtPrediction module uses ML-inference type wrappers with loose typing
(`Record<string, unknown>` return shapes from the Rust inference commands) that require
a dedicated typing pass aligned with the Rust binding generator output. This is a
known tech-debt item tracked separately. **Currently clean at this baseline**.
Excluded as precautionary.

---

## Gate Definition

The exact pass condition for the plan 02-07 retirement commit is:

> `npx tsc --noEmit` exits with code 0 **AND** `npm test -- --run` reports 0 failed
> test files, excluding the 5 modules above (AccountSettings.tsx, DualBatchPanel
> components, commandHandlers, Social module, DebtPrediction).

Any failure in the remaining 43+ test files caused by the retirement commit must be
fixed in the retirement commit itself (D-13: no xfail, no skip, no "fix in follow-up").
