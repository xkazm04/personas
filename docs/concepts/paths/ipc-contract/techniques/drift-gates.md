---
layer: technique
subject: ipc-contract
technique: drift-gates
status: forged
laws: [gate-sees-target, failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Drift gates

A committed generated contract adds an invariant — "the committed artifacts
equal what the generator would produce right now" — and an invariant without a
gate is a hope. This technique is the gate: generate-then-diff as the spine,
and then, more importantly, the three blind spots that let a diff-shaped gate
glow green while the contract rots. Each blind spot is an instance of one law:
**a gate must observe the thing it gates**
([gate-sees-target](../../_laws.md#gate-sees-target)).

## The spine: generate-then-diff

In the automated pipeline, from a clean checkout: run the exact regeneration
command, then compare the working tree's contract directory against what was
committed. Any difference fails the build with the diff in the log. This
catches the everyday case — an authored shape changed, the author forgot to
regenerate — and it catches it at the offending commit, with an error message
that is its own fix instruction ("run the command, commit the result").

Two implementation rules:

- **Same command, both places.** The gate runs the identical regeneration
  command the contribution docs give humans. A gate with its own private
  invocation will eventually diverge from the documented one, and then one of
  them is lying.
- **The gate diffs the whole contract directory**, not a file list somebody
  curated. Curated lists are a proxy, and proxies are where gates go blind.

## Blind spot 1: the untracked new file

A brand-new authored shape generates a brand-new artifact — which is
**untracked**, and "diff against the committed state, tracked files only" has
nothing to say about untracked files. Exit clean. The gate that exists
precisely to catch missing contract commits is structurally blind to the
*first* commit of every new shape — the diff sees modifications to what
version control already knows, and a new artifact is by definition not yet
known.

The fix is one more check with different mechanics: after regeneration, list
untracked files under the contract directory; any hit fails. Cheap, dumb, and
it closes the exact hole. The general lesson: **ask what the diff primitive
actually reads** before trusting the green — "no diff" and "nothing new" are
different assertions, and most diff tools make only the first.

## Blind spot 2: orphans — the generator never deletes

Generators are additive: delete the authored source of a shape and the next
regeneration simply *does not mention it*. The committed artifact remains —
unchanged, tracked, producing **no diff and no untracked file**. Invisible to
the entire diff-shaped family of gates *by construction*, forever.

Orphans are not clutter; they are **standing claims with no witness**. The
worst case is an orphan still referenced by live code: a call site declaring
"this operation returns this shape" while nothing on the far side produces
that shape anymore. The consumer's compiler is satisfied — by a ghost. And a
reference-based cleanup pass ("delete unused files") will *keep* exactly these
worst-case orphans, because they are used; usage is evidence of danger here,
not of health.

Detection therefore cannot be diff-shaped. It must be an **inventory
comparison**: enumerate the shapes the authored source *currently* exports,
enumerate the committed artifacts, and set-subtract. Artifacts minus source =
orphans; each is then triaged by whether the consuming world still references
it (dangerous — the claim is live) or not (deletable). Underneath sits an
ownership failure: the source's author was the artifact's implicit reaper and
nothing recorded that duty
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — the
inventory gate is the standing substitute for the reaper nobody names.

Two refinements from the field:

- **A reference check can be satisfied by the shadow of the thing it checks.**
  A naive "is this artifact's name mentioned anywhere" scan is answered *yes*
  by a hand-written duplicate declaration of the same name — the exact defect
  the artifact's existence was supposed to prevent now vouches for the
  artifact's health. Reference detection must distinguish an *import of the
  artifact* from a *redeclaration of its name*, or the two states the gate
  most needs to separate are identical to it.
- **Emission granularity trades one blind spot for another.** A generator that
  rewrites one monolithic output file is orphan-immune by construction (a
  wholesale rewrite cannot contain a stale entry) but gains a *staleness*
  blind spot the moment any hop of its chain runs ungated — all names present,
  no orphans, and every one of them describing last month's shapes. Per-item
  emission with a regenerate-and-diff gate catches staleness and is blind to
  deletion. Neither shape is strictly better; know which blind spot your
  emission shape has, gate **every hop** of a multi-hop generation chain, and
  point the inventory check at the hole your shape leaves open.

## Blind spot 3: the generator that silently did nothing

The regeneration command invoked with a wrong flag, a missing feature switch,
or a mis-scoped target frequently does not fail — it succeeds over an empty
set. Zero artifacts written, exit clean, tree unchanged. Inside a
generate-then-diff gate this is catastrophic in a special way: **no diff is
the gate's *pass* condition**, so a generator that produced nothing makes the
gate pass *because* the instrument was broken
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

The fix: assert the instrument before trusting the result. The gate demands a
positive signal — the generator's own count of artifacts written or verified,
or a floor assertion ("at least N artifacts exist after regeneration", with N
maintained honestly) — and treats zero-or-missing as a failed *run*, distinct
from a failed *diff*. The two failures even want different messages: "the
contract drifted" versus "the checker could not check".

## Composition

The three checks are one gate with three assertions, in order: (1) the
generator ran and touched a plausible number of artifacts; (2) nothing
tracked changed and nothing untracked appeared; (3) the artifact inventory
matches the source inventory in both directions. Skipping any one of the
three re-opens the specific hole it covers, and the holes do not overlap —
which is exactly why each tends to be discovered separately, the hard way,
one incident apart.
