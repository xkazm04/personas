---
layer: golden-path
subject: dead-code
status: forged
techniques:
  - instrument-per-orphan-class
  - deletion-protocols
  - suppression-hygiene
  - quarantine-vs-delete
  - carrying-cost-economics
  - dead-code-detection@codebase-scanning
evidence:
  - scripts/analysis/orphan-modules.mjs          # reachability walker with --delete simulation: transitive closure, still-reachable keeps, tests-are-not-entries
  - scripts/build/unused-commands.mjs            # cross-boundary registration class, measured carrying cost (~11ms/entry per incremental check), candidates-not-verdicts framing
  - scripts/i18n/find-unused-i18n-keys.mjs       # dead catalog keys: prefix-permissive by design (false-dead is destructive, false-live is recoverable), dynamic-lookup escapes declared
  - scripts/i18n/purge-dead-keys.mjs             # destructive tool defaults to dry run; --apply is a decision; keep-prefix quarantine declarations
  - knip.json                                    # off-the-shelf unused-export tier; its ignore roster divides coverage between instruments (each entry names a tree another instrument owns)
  - scripts/census/lib/engine.mjs                # suppression hygiene enforced: exclude reasons mandatory (≥12 chars), an exclude matching no file FAILS the run (stale exemption)
  - src-tauri/src/commands/design/template_adopt.rs   # the verified-inert-before-delete autopsy left at the deletion site (lines 34-72): inert on 100% of adoptions, proven before removal
counter_evidence:
  - scripts/check-unused-bindings.sh             # refcount-shaped guard, enforced in CI — it PROTECTS 26 of the 29 orphaned generated bindings because dead consumers still import them
deviations:
  - w12-dead-code   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-ipc-contract        # the inventory gate for orphaned generated bindings is still unbuilt (29 orphans, 22 live invoke return types) — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz            # ChartEmptyState: 0 render call sites — the zero-render component class has no instrument
  - w10-accessibility      # useRovingTabIndex: ZERO adopters — the zero-adopter primitive class has no instrument
  - w11-p2p-networking     # dead knobs: max_retries is dead code, retry_count never increments, auto_connect read by nothing — the config-read-by-nothing class has no instrument
---

# Dead-code & orphan elimination

Dead code is the one defect class whose remediation is pure subtraction — no design,
no new behavior, nothing to get right except the boundary of what goes. And yet every
codebase carries corpses for years, because both halves of the work are harder than
they look and the hard parts are different. *Finding* dead code is a detection problem
— reachability analysis, the shadow-declaration defeat, the generator that never
deletes — and that discipline is owned by
[codebase-scanning](../codebase-scanning/codebase-scanning.md) as its
[dead-code-detection](../codebase-scanning/techniques/dead-code-detection.md)
technique. This subject owns everything after the candidate list: the roster of
instruments a repo needs because no single detector sees every orphan class, the
protocol that turns a candidate into a shipped deletion without an outage, the hygiene
that keeps suppression from becoming the new dead code, the economics of quarantining
what cannot be proven dead, and the carrying costs that decide which corpses are worth
the funeral.

The subject's founding observation is an inversion: **the tools most repos install to
prevent dead code are the ones that preserve it.** A reference-counting guard asks "is
this imported anywhere?" — and dead code imports other dead code, so the guard
certifies whole dead islands as alive, resident by resident. The measured emblem: a
CI-enforced guard over generated artifacts protected twenty-six of a repo's
twenty-nine orphans *because dead consumers still imported them* — the gate read as
protection and functioned as preservation. Elimination begins where that realization
lands: each orphan class needs the instrument that can actually see it, and a class
with no instrument accumulates corpses at the rate of ordinary refactoring.

## The five load-bearing walls

### 1. One instrument per orphan class

There is no universal dead-code detector — only a family of instruments, each blind
to classes the others see. Unused exports yield to reference scanning; unreachable
modules only to whole-graph reachability from true entry points; cross-boundary
registrations (a handler registered on one side of a wire, invoked by name from the
other) only to joining both sides' inventories; orphaned generated artifacts only to
reconciling what current sources *should* generate against what exists; dead catalog
keys only to walking the consuming code for key references; and the false-affordance
classes — components that render nowhere, primitives with zero adopters, knobs no
behavior reads — only to adoption censuses that count *use*, not *mention*. A repo's
elimination posture is exactly its instrument roster: for every artifact family the
build creates, name the instrument that would notice its corpse. The roster
discipline, the blindness matrix, and the class taxonomy are
[instrument-per-orphan-class](techniques/instrument-per-orphan-class.md).

### 2. Deletion is a protocol, not an act

The remediation *is* deletion, which tempts treating it as trivial — select the
files, remove them, done. Every dead-code outage comes from that shortcut. The
protocol: **simulate before deleting** (the simulation reports what in the candidate
set is still reachable and must be kept or re-pointed, what *additional* code becomes
unreachable because of the deletion, and which tests reference the removed set);
**verify inertness** for anything that reads as load-bearing — a guard, a gate, a
provider — by proving structurally that it can never bind and that no caller branches
on its output, *before* removing it, with the autopsy left at the deletion site;
**delete one island per reviewable unit**, all subtraction plus the minimal
re-pointing edits, each named; and **attribute every downstream movement** — when
gate baselines drop after the deletion, every drop is traced to a deleted file, or
the deletion swept a bystander. The full sequence, including recording what was
deliberately *not* deleted, is [deletion-protocols](techniques/deletion-protocols.md).

### 3. Suppression rots

Every instrument grows a suppression surface — ignore globs, allowlists, keep-lists,
inline pragmas — and suppression is dead code's favorite disguise. An allowlist entry
whose target no longer exists is itself dead code, sitting *inside the instrument
built to find dead code*, and it fails silently in the worst direction: the
exemption outlives its reason and quietly re-matches something new. The hygiene is
mechanical: every suppression carries a reason with enforced substance; a suppression
that matches nothing **fails the run** rather than passing as harmless; every entry
names its reaper — an expiry, a re-review date, or the condition under which it
lapses; and the ignore roster doubles as a published blind-spot inventory, each entry
declaring which orphan class it hides and which *other* instrument covers that class.
The rules are [suppression-hygiene](techniques/suppression-hygiene.md).

### 4. Quarantine versus delete is an economics call

Static instruments cannot see dynamic dispatch — names assembled at runtime,
string-keyed lookups, configuration-driven loading — so some candidates carry
irreducible uncertainty, and the two errors are priced differently: a false delete is
an outage; a false keep is carrying cost. Code with uncertain reachability is
**quarantined loudly, not deleted hopefully**: destructive tools default to dry runs;
known-dynamic subtrees get declared keep-list escapes; genuinely uncertain code gets
a tripwire — left in place, instrumented to report use — because a quarantine that
cannot report use is failure spelled as empty success. And quarantine names its
reaper: an expiry after which recorded silence authorizes the delete. Unexpired
quarantine is a decision pending; expired, unreaped quarantine is the new dead code.
The decision table is [quarantine-vs-delete](techniques/quarantine-vs-delete.md).

### 5. Carrying costs price the backlog

"Dead code is harmless" survives only while nobody measures. The costs are concrete
and mostly per-edit, not one-time: a bloated cross-boundary registry taxes **every**
incremental compile (measured in one repo at roughly eleven milliseconds per entry,
more than half of every check — see
[build-economics](../build-economics/build-economics.md) for the wider ledger); a
dead catalog key is multiplied by every locale that must carry its translation; a
dead exemplar poisons search-driven development, because the next reader — or the
next code-writing agent — finds it, reads it as precedent, and copies it; and a dead
island can be the last thing keeping an entire third-party dependency installed.
Elimination has costs too — review attention, outage risk — so the backlog is ranked
by carrying cost times confidence, and every cost figure travels with its predicate
and its measurement. The pricing discipline is
[carrying-cost-economics](techniques/carrying-cost-economics.md).

## The boundary with detection

The shared technique
([dead-code-detection](../codebase-scanning/techniques/dead-code-detection.md), owned
by [codebase-scanning](../codebase-scanning/codebase-scanning.md)) ends at a verified
candidate list: reachability computed from true roots, the shadow-declaration defeat
dissolved, generated orphans surfaced by inventory reconciliation, dynamic-dispatch
uncertainty honestly flagged. This subject picks up that list and owns the acting:
which instrument roster produced it and what classes the roster still misses, how a
candidate becomes a shipped deletion, what happens to the candidates that cannot be
proven, and which candidates are worth acting on at all. The split matters because
the failure modes differ — detection fails by missing corpses; elimination fails by
burying the living.

## What this subject deliberately excludes

- **The detection analyses themselves.** Reachability computation, entry-point
  rosters, the generator-never-deletes blind spot: the shared technique owns them.
- **Enforcement gates.** Wiring an instrument into a blocking check — and the
  precision bar that blocking demands — is
  [quality-gates](../quality-gates/quality-gates.md); this subject feeds it
  instruments whose verdicts have earned trust.
- **Generator lifecycle.** Why generators add and never delete, and how generated
  trees are owned and regenerated, is [codegen](../codegen/codegen.md); this subject
  consumes its orphans.
- **Landing the change.** The version-control mechanics of shipping a large deletion
  safely alongside concurrent work belong to
  [concurrent-vcs](../concurrent-vcs/concurrent-vcs.md).
- **Product retirement.** Deciding to sunset a *feature* — flags, migrations,
  user-facing deprecation — is entity-lifecycle territory; this subject starts after
  the code is believed unreferenced.

## The techniques

- [instrument-per-orphan-class](techniques/instrument-per-orphan-class.md) — the
  orphan-class taxonomy, the instrument-blindness matrix, the roster rule, adoption
  censuses for false-affordance classes.
- [deletion-protocols](techniques/deletion-protocols.md) — simulate first, verify
  inertness, island-sized reviewable units, downstream attribution, the tombstone
  autopsy, what-was-not-deleted.
- [suppression-hygiene](techniques/suppression-hygiene.md) — mandatory reasons,
  stale suppressions fail, reapers on every entry, the ignore roster as blind-spot
  inventory.
- [quarantine-vs-delete](techniques/quarantine-vs-delete.md) — pricing the two
  errors, dry-run defaults, keep-list declarations, tripwires, quarantine expiry.
- [carrying-cost-economics](techniques/carrying-cost-economics.md) — per-edit build
  tax, catalog multipliers, false affordances, dependency retention, ranking by cost
  × confidence.
- [dead-code-detection](../codebase-scanning/techniques/dead-code-detection.md)
  *(shared, owned by codebase-scanning)* — reachability over refcounts, the
  shadow-declaration defeat, generator-never-deletes, the detection side of the
  deletion handshake.
