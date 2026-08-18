---
layer: technique
subject: build-economics
technique: compilation-unit-splitting
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Compilation-unit splitting

One large compilation unit is three costs wearing one name: it serializes the
build (a unit is the atom of build parallelism — one unit means one worker, no
matter how many cores idle), it maximizes the invalidation frontier (any edit
anywhere rebuilds everything), and it owns the memory peak (the compiler's
footprint scales with the unit it is chewing, so the largest unit decides
whether the build fits on the median machine). Splitting the unit into a
workspace of smaller ones attacks all three at once, which is why it is the
structural move of build economics rather than a tuning knob.

## What the split buys

- **Parallelism.** Independent units compile concurrently. The ceiling is the
  longest dependency chain, so the goal of a split is not "many units" but a
  *wide, shallow* graph: leaves that depend on a small stable core, not a
  ladder where each unit waits on the last.
- **Invalidation locality.** After a split, an edit rebuilds its own unit plus
  the downstream cone — and nothing else. The practical win is proportional to
  how well the cut isolates *frequently edited* code from *rarely edited*
  code: hot application logic in leaves, stable contracts in roots.
- **A lower memory peak.** Peak footprint tracks the largest single unit and
  the widest link step, not the total volume of code. Splitting a monolith can
  cut peak memory by a third while total work is unchanged — the same code,
  chewed in smaller bites. For memory-bound teams this is often the entire
  motivation, and it is measurable.

## Where to cut

A cut line is good when it is **stable, directional, and aligned with change
frequency**:

- **Stable**: the interface across the cut changes rarely. Every interface
  change recompiles both sides plus the downstream cone, so a cut through a
  churning boundary buys nothing — the frontier follows the churn.
- **Directional**: dependencies cross the cut one way. If two candidate units
  would need each other, they are one unit; discovering this early is the
  split's first gift, because a cycle in the design was there before the
  split made it visible.
- **Frequency-aligned**: the code that changes daily should sit downstream of
  the code that changes monthly. The classic cuts — pure domain types first;
  storage behind them; heavy subsystem machinery in its own unit; thin
  procedural macro or codegen helpers isolated (they often bottleneck the
  chain because everything waits on them) — all follow this gradient.

The forcing function is real and welcome: a split makes implicit coupling
explicit, because everything the leaf reached into casually must now be an
exported interface. Teams routinely find the split's hardest step is admitting
what the dependency graph actually was.

In a mature codebase the module graph is usually *cyclic at the surface*, so
candidate cuts cannot be chosen by inspection — a single stray reference from
a small module into a huge one drags the whole thing across the boundary. The
working method is a **closure probe**: a script that parses cross-module
references and answers "which modules must travel together for this cut to be
acyclic", with the ability to exclude the units you intend to keep out so the
report becomes the exact list of references that must be severed — that list
*is* the work plan for the step. The probe is a textual approximation, not
the compiler; treat a clean closure as "worth attempting", and let the real
build be the gate.

## Migration shims hide the boundary they enable

The cheap way to execute a split is a compatibility shim: the old namespace
re-exports the extracted unit, so thousands of call sites keep compiling
unchanged. This is often the right call — it converts a repo-wide edit into a
handful of files — but it has a standing cost that must be named: **call
sites never see the boundary.** Authors keep writing against the old unified
namespace, cannot tell which unit a symbol lives in, and the architectural
forcing function above silently stops accruing — new code grows fresh
coupling across a cut nobody can see. A shim is a bridge, not a destination:
budget the follow-up that migrates call sites to the real names, or accept in
writing that the split bought build economics only, not architecture.

## What the split costs

- **Boundary maintenance.** Interfaces across cuts must be versioned in the
  loosest sense: changed deliberately, with the recompile cone in mind.
- **Lost cross-unit optimization.** The compiler inlines and specializes
  freely within a unit, less freely across. For dev builds this is
  irrelevant; for release builds, cross-unit optimization at link time can
  recover it — a setting that belongs to the release pipeline, not the daily
  loop.
- **Duplicated generic expansion.** Generic-heavy code instantiated in many
  units is compiled in many units. If the same expansions dominate several
  units' compile time, the fix is a dedicated unit that pre-instantiates the
  common cases.
- **The bottom layer gates everyone's verification.** Toolchains typically
  build and test units in dependency order and stop at the first failure — so
  after a split, a defect in the foundation unit leaves every unit above it
  *unverified*, not just unbuilt. That is a property of layering, not of any
  particular pipeline; plan for it (fix-forward discipline on the foundation,
  or a pipeline that reports all units rather than halting at the first).

## Proving the win

A split is a claimed optimization and owes numbers under the standard
before/after discipline (see the measurement technique). The predicate matters
— "faster" without a scenario is not a finding:

- **Peak memory**, cold build, same machine, same variant, before vs after.
  This is usually the headline.
- **Cold wall-clock** — may *worsen slightly* (more units, more boundary
  overhead); acceptable if it bought the peak down.
- **Incremental frontier**: touch one representative hot file, count units
  rebuilt and seconds elapsed, before vs after. This is the number developers
  feel daily; it is the one to publish.

A dependency-graph probe belongs in the toolbox next to the stopwatch: a
script that renders which units depend on which, and therefore what a given
edit invalidates. Splits decay — someone adds a convenience dependency from
the stable core to a hot leaf, and the frontier quietly doubles — and only a
probe that is cheap to run gets run when the decay happens.
