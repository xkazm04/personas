---
layer: technique
subject: packaging
technique: os-arch-matrix
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# The OS × architecture matrix

A support claim is a promise about machines you do not own. This technique
turns the promise into an enumeration: every operating-system family ×
processor architecture × packaging format you ship is a **cell**, written
down in one place, and every cell either has an automated acceptance job or
carries an explicit, dated note saying how it is verified instead. There is
no third state. "We support that platform" without a job or a note is a
hope wearing a claim's clothes, and the gap always surfaces on the cell
with the fewest developers dogfooding it — which today usually means the
newer processor architecture of an otherwise well-tested operating system.

## The matrix is the predicate

Every packaging statement that travels — "the release is tested", "installs
verified", "all platforms green" — must carry which cells it covers
([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
enumerated matrix is that predicate, maintained as data the automation
consumes: adding a cell adds a job, retiring a cell retires it visibly.
The asymmetry to design for: matrix rot is silent in one direction only.
A job for a dead cell fails loudly; a *missing* job for a live cell fails
never — so the review question on every support change is "which cell did
this add, and where is its job?"

Cells also fail **independently, and the automation must let them**: a
runner outage or infrastructure failure on one cell must not cancel or mask
its siblings' verdicts. The rarer cell's runners are usually the flakier
ones, and a matrix wired to abort on first failure converts every outage on
the rare cell into lost evidence about the common one — and vice versa.

## Never trust an architecture label

Architecture names travel as strings — in filenames, directory names,
archive metadata, dependency-registry labels — and strings are claims, not
facts. The observed failure class that anchors this technique: **an
upstream archive labeled for one architecture containing binaries compiled
for another**. Everything downstream of the label is then consistent and
wrong — the build selects it by name, the cache stores it by name, the
linker fails (best case) or the packaged application ships a binary the
target hardware cannot execute (worst case, discovered by a user).

The countermeasure is mechanical: **executable formats carry their machine
type in their headers, and the header is readable in a few bytes.** Sniff
it — do not infer it:

- **At dependency ingestion**: any prebuilt native artifact entering the
  build (downloaded library, cached toolchain payload) has its real machine
  type read and compared against the architecture the build is targeting,
  *before* it is linked or bundled. A cache is the highest-value place to
  sniff, because a cache launders a one-time mislabel into a permanent
  local truth that survives clean builds.
- **At packaging**: the binaries inside the produced artifact are sniffed
  against the cell's declared architecture before the artifact is labeled.
  The label on the artifact you publish must be *derived from* the bytes,
  never merely copied from the build configuration.

Both are [gate-sees-target](../../_laws.md#gate-sees-target) in its purest
form: the target is the machine code; the label is the proxy; the gate
reads the machine code. Note what the sniff catches that digest
verification cannot: a mislabeled upstream artifact **hashes correctly** —
the bytes match the publisher's manifest exactly; they are simply the wrong
bytes for the label. Integrity checking proves the download is what the
publisher shipped; only the machine-type sniff proves it is what the label
claims.

A sniff gate is also **self-healing by design** — when it finds a mismatch
in a cache it can evict and replace from a source of known provenance,
converting a class of unreproducible build failures into a logged,
automatic repair. Two disciplines on the repair path: the replacement is
itself digest-verified against pinned known values (an automatic
downloader that swaps binaries into the link path is a supply-chain door
and must be treated like one), and the repair records a sentinel so the
check is idempotent — re-verified cheaply, re-applied only when the cache
actually changed.

## Cross-compilation traps

Building cell B on hardware of cell A is routine and treacherous. The traps
recur:

- **Host leakage.** Build scripts, code-generation steps, and test runners
  execute on the *host* architecture; anything they probe — pointer width,
  endianness, available instruction sets, the host's installed libraries —
  describes the host, not the target. Every probe result that flows into
  the target build is a potential wrong-architecture assumption.
- **Mixed dependency trees.** A build that compiles most dependencies for
  the target but picks up one prebuilt host-architecture library — from a
  cache keyed without the architecture, or a path shared between host and
  target builds — produces a link error if lucky. Cache keys include the
  target architecture, always.
- **The host cannot run the result.** On a cross-build, the launch rung of
  [installed-tree-acceptance](installed-tree-acceptance.md) needs target
  hardware or emulation; a cross-compiled artifact that only ever ran its
  *build* on automation has never actually executed. The matrix note for
  such a cell says so explicitly.
- **Toolchain drift between host flavors.** When developer machines span
  architectures, a cache or configuration written by one flavor poisons the
  other. The build detects host drift at start — comparing the recorded
  host fingerprint against the current one — rather than letting the linker
  discover it mid-build with an inscrutable machine-type conflict.

## Emulated cells are marked

Emulation (running one architecture's binaries on another's hardware)
makes an unavailable cell testable, and the standard accepts it — with the
verdict labeled *verified-under-emulation*. Emulation faithfully exercises
logic and packaging layout; it does not exercise the native performance
envelope, certain instruction-set edges, or platform driver behavior. A
matrix that silently equates emulated and native verification is
overstating its own evidence; the label keeps the claim honest.
