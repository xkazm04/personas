---
layer: technique
subject: build-economics
technique: debug-artifact-economics
status: forged
laws: [creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Debug-artifact economics

After the graph is split and the heavy capabilities are gated, the remaining
build cost hides in *artifact settings* — what the toolchain is asked to emit
and how it is asked to link. Debug information is the canonical case: it can
dominate compile time, multiply link time, and account for the majority of a
build directory's bytes, while the workflows that would consume it are rare.
This technique treats debug info, link strategy, and build-directory placement
as line items with owners, each priced against how often anyone actually
spends them.

## Debug info: pay for the debugging you do

Full debug information exists to support one workflow: stepping through a
binary in an interactive debugger. Price that against how each binary is
actually used:

- **Test binaries** are the striking case. The overwhelming majority of test
  runs end in pass or in a failure diagnosed from the *test's own output* —
  assertion messages, captured logs, backtraces. Interactive debugging of a
  test binary is rare; yet default configurations often build tests with full
  debug info, and test binaries are rebuilt more often than anything else.
  Worse, when each test target statically links the whole application, each
  one emits its own enormous debug artifact, and stale copies are never
  collected — tens of gigabytes of symbol files nobody will ever open is the
  routine end state. Dialing tests down to line-tables-only (readable
  backtraces with file and line, a fraction of the emit cost) or to none is a
  settings change with no code — but **measure which axis the win lands on
  before celebrating**: in measured practice the disk and link-cost win is
  enormous while the peak-*memory* win can be a few percent, far less than
  assumed, because the compiler's peak is dominated by the size of the unit
  it is chewing, not by the debug-info dial. The dial is still worth turning;
  it is just not a substitute for splitting the unit.
- **Third-party dependencies** are compiled once and debugged approximately
  never; they default to minimal or no debug info in dev profiles. Own code
  in the dev profile keeps whatever level the team's real debugging habits
  justify — a team that lives in printouts and backtraces needs line tables,
  not full variable-level info.
- **Release binaries** belong to the release pipeline, with its own answer
  (often: full debug info generated but *split* from the shipped binary and
  archived for symbolication).

As always the win is claimed with a before/after pair — the cost being cut is
concentrated in compile-and-link of the most-rebuilt binaries, so measure
exactly that scenario, not the cold build.

## Link-time choices

The link step is the serial tail of most incremental builds: one process, one
giant working set, at the end of every iteration. Three dials matter:

- **Linker selection.** Faster drop-in linkers routinely cut link time by
  integer factors; for incremental work the link is often *the* iteration
  cost, so this is a high-leverage, low-risk swap where available.
- **Link-time optimization is a release setting.** Whole-program optimization
  at link time buys runtime speed with build memory and wall-clock — the peak
  memory of a fat link step is frequently the single highest point of the
  entire build. It has no place in the daily loop; keep it in the release
  shape.
- **Find who owns the memory peak — do not assume it is the linker.** The
  fat final link is a *candidate* for the peak, but in unit-compilation-heavy
  toolchains the single compiler process chewing the largest unit can dwarf
  the linker by multiples — in which case link-side tuning is effort on a
  non-binding axis. Only a per-process peak with attribution (see
  build-measurement) settles who owns it. The linker has its own distinct
  ceiling worth knowing: debug-artifact *format limits*, where total symbol
  volume overflows what the link can emit at all once the dependency graph
  grows past a threshold — a hard stop that arrives as a baffling error, and
  another reason the debug-info dials above pay twice.

## Build directories under concurrency

A build directory is mutable shared state, and modern workflows — parallel
agent sessions, worktrees, a test run started while a dev build is warm —
make it *concurrently* shared unless someone decides otherwise. The failure
modes are mundane and expensive: two build invocations racing in one
directory serialize on file locks at best; at worst a linker loses a race for
an output file the running application still holds open, or one session's
settings change invalidates the incremental state a sibling was relying on,
and both pay a cold rebuild neither scheduled.

The decisions to make explicitly:

- **Who shares a directory.** Same settings, never concurrent → share and
  enjoy the warm cache. Concurrent or differing settings → separate
  directories, and the disk cost of separation is charged to the cache
  budget (see cache-budgeting) with a pruner that knows about the extra
  copies. An undecided middle — sometimes shared, sometimes raced — delivers
  the worst of both.
- **Post-build steps hold the same locks.** Any step that rewrites an output
  binary after linking (embedding manifests, stamping resources, signing)
  contends for the same files; a running instance of the application holding
  its executable open can fail a rebuild in ways that look like toolchain
  bugs. Sequence such steps into the build, or detect-and-report the lock
  holder, rather than leaving the collision to manifest as a cryptic
  cannot-open-file error.
- **Escalating cleanups, smallest first.** Offer a surgical clean per
  subsystem (minutes to recover) before the nuclear full clean (tens of
  minutes), and label each with its recompile cost — because when the only
  documented recovery from a confused build directory is "delete everything",
  that is what people do, and the team pays a cold build for what a targeted
  invalidation would have fixed.
