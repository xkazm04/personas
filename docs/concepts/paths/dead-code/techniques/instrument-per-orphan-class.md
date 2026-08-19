---
layer: technique
subject: dead-code
technique: instrument-per-orphan-class
status: forged
laws:
  - gate-sees-target
  - count-carries-predicate
  - failure-not-empty-success
---

# One instrument per orphan class

The question "is this code dead?" has no single answer procedure, because "dead"
means a different absence for each artifact class — unimported, unreachable,
uninvoked, unregenerated, unread, unadopted — and each absence is visible to a
different instrument. A repo that installs one dead-code tool and considers the
problem handled has covered one class and granted the others an alibi: the tool runs,
reports little, and the green output is read as "no dead code" when it means "no dead
code *of the one kind this instrument can see*"
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## The elimination-facing class taxonomy

The detection technique's four kinds (unused exports, orphan modules, unreferenced
cross-boundary registrations, orphaned generated artifacts) are where the taxonomy
starts, not where it ends. Elimination work keeps meeting classes that pass every
reference-shaped check while being fully dead:

- **Dead catalog keys** — entries in a translation catalog, an error registry, a
  token map, that no consuming code references. The catalog is loaded wholesale, so
  nothing fails; the key just rides along, multiplied by every locale or mirror that
  must carry it.
- **Zero-render components** — declared, exported, even *catalogued* in the shared
  component index, with zero render call sites. Documentation citing a component
  keeps it alive to any mention-counting instrument while it renders nowhere.
- **Zero-adopter primitives** — a hook, utility, or pattern shipped as "the
  standard" that nothing adopted. This is the most camouflaged class: it has tests,
  documentation, and a name people recognize — a standard with no witness.
- **Dead knobs** — configuration fields that parse, validate, persist, and are read
  by no behavior. The schema keeps them alive; the settings surface renders them;
  users set them; nothing branches. A dead knob is worse than dead code because it
  is a *live lie to the user*.

## The blindness matrix

Each instrument family sees some classes and is structurally blind to others:

- **Reference counting** ("is this name mentioned anywhere?") catches unused exports
  and nothing deeper. Its signature failure is the shadow-declaration defeat the
  shared detection technique dissects: dead code references other dead code, so
  refcounts certify dead islands as alive. The measured emblem — a CI-enforced
  refcount guard over generated artifacts that *protected* twenty-six of
  twenty-nine orphans because dead consumers still imported them — is what a
  refcount instrument does at its best: it gates, and the gate does not see its
  target ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **Reachability walking** (transitive closure from declared entry points) catches
  orphan modules and dead islands whole. Its blindness: everything on the far side
  of a serialization or generation boundary, and everything summoned dynamically.
  Its two roster rules: entry points are an owned vocabulary, and **tests are not
  entries** — a module kept alive only by its own test is an orphan with a test,
  which is precisely what the instrument must surface, not excuse.
- **Inventory reconciliation** (enumerate what *should* exist from current sources;
  diff against what does) is the only instrument that sees orphaned generated
  artifacts and unregistered/never-invoked cross-boundary registrations — the
  classes that produce no diff and no missing reference by construction. Both
  directions of the diff matter: presence-without-source is an orphan;
  source-without-presence is a missed generation.
- **Consumer-side key walking** (scan the consuming code for every key it can
  reference; subtract from the catalog) sees dead catalog keys. Its design tension
  is asymmetric error cost: claiming a live key dead is destructive, claiming a
  dead key live is recoverable — so the scan is deliberately permissive (any
  reference to a prefix marks the subtree live; declared escapes for dynamic
  lookups) and says so, rather than tuning for an impressive body count.
- **Adoption censuses** (count *uses*, not mentions: render call sites, hook
  callers, knob reads) are the only instrument for the false-affordance classes.
  Mentions lie — catalogs, comments, and re-exports all mention — so the census
  counts the one thing that constitutes life for that class: a render, a call, a
  branch on the value.

## The roster rule

For every artifact family the build creates — modules, exported symbols,
cross-boundary registrations, generated files, catalog keys, shared primitives,
configuration fields — **name the instrument that would notice its corpse.** A
family with no named instrument accumulates orphans at the rate of ordinary
refactoring, because refactoring updates callers and forgets artifacts, and nothing
is watching the artifact side. The roster is a maintained document, not a vibe:
class → instrument → cadence → where its findings land. Unassigned classes are
listed as unassigned — an honest gap outperforms an assumed coverage
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

Two corollaries. First, instruments cross-check each other where classes overlap:
when the refcount guard and the reconciliation inventory disagree about a generated
artifact, the disagreement is the finding — one of them is measuring the wrong
thing. Second, every instrument's output is framed as *candidates with a predicate*,
never verdicts: "47 modules unreachable from the declared entries" travels intact;
"47 dead files" gets reused for a claim no instrument made.
