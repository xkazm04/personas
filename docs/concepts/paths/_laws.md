# Cross-cutting laws

Nine convergences, each measured ≥3 independent times during the 2026 composition
campaign, reclassified by [`knowledge-hierarchy-plan.md`](../knowledge-hierarchy-plan.md)
§2 from Golden-Path candidates to **laws that Techniques cite**. They are not subjects —
no folder, no techniques of their own. Cite them from a Technique's `laws:` frontmatter
by anchor id. The doctrine's transferable sections migrate here in the closing pass;
until then each law carries its one-paragraph statement.

## <a id="one-authority-per-vocabulary"></a> one-authority-per-vocabulary

Every closed vocabulary (status sets, category enums, mode strings) has exactly one
authoritative definition, and every consumer derives from it. Two hand-maintained copies
of one vocabulary are not redundancy — they are a race with a delay fuse; the copies
drift precisely when someone extends the vocabulary and finds only one of them.

## <a id="gate-sees-target"></a> gate-sees-target

A gate must observe the thing it gates. A check that runs over a proxy (a build log, a
staged subset, a stale index) passes exactly when the proxy diverges from the target —
which is the moment the gate existed for. Before trusting any green result, ask what the
check actually read.

## <a id="failure-not-empty-success"></a> failure-not-empty-success

Failure must be spelled differently from empty success. A scanner that finds nothing and
a scanner that could not run must produce distinguishable outputs; exit 0 with zero
findings is the most expensive lie in automation. Assert the instrument before reporting
the result.

## <a id="identity-survives-reuse"></a> identity-survives-reuse

An entity's identity must survive reordering, reuse, and restart. Index-based keys,
timestamps-as-ids, and name-equality all break under the operations lists actually
undergo (insert, resort, duplicate, resume). Mint identity once, at creation, and carry
it.

## <a id="derivation-names-recomputation"></a> derivation-names-recomputation

Any stored derived value names how it is recomputed. A cached count, a denormalized
rollup, or a materialized summary without a documented, invokable recomputation path is
a future discrepancy with no arbiter.

## <a id="one-validation-door"></a> one-validation-door

Each mutable store has one validation door, and the writers are enumerable. Validation
sprinkled across N call sites is validation minus the site added next quarter; the fix
is structural (one door all writers pass through), not disciplinary (remembering to
validate).

## <a id="count-carries-predicate"></a> count-carries-predicate

A count is meaningless without its predicate. "182 files" is not a finding; "182 files
matching X, measured by Y, cross-checked by Z" is. Any number that travels (into a doc,
a dashboard, a commit message) carries what was counted and how, or it will be reused
for a claim it does not support.

## <a id="deletion-is-not-repair"></a> deletion-is-not-repair

Removing the artifact that exposes a defect is not fixing the defect. Deleting a flaky
test, silencing a warning class, or dropping a failing gate converts a visible problem
into an invisible one at the exact site where visibility existed.

## <a id="creation-names-reaper"></a> creation-names-reaper

Everything created names its reaper. Temp files, background tasks, listeners, worktrees,
caches: the code that creates a resource states what destroys it and when. Unowned
cleanup is deferred leakage — the question "who deletes this?" must have an answer at
creation time, because nobody re-asks it later.
