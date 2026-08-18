---
layer: technique
subject: draft-editing
technique: dirty-tracking
status: forged
laws: [derivation-names-recomputation, gate-sees-target]
shared_with: []
---

# Dirty tracking

Dirty is a **derived comparison** — draft versus baseline — with a declared
**resolution** — the region. Both halves are load-bearing: derivation is
what keeps the flag honest, and resolution is what keeps it useful.

## Derived, not stored

A stored dirty bit has two failure modes and exhibits both within weeks: set
by a path that later turns out to be a no-op (touched, then reverted — the
editor nags about changes that no longer exist), and missed by a path that
forgot to set it (a new control mutates state and the guard waves the user
out with unsaved work). Derivation — recompute equality of draft against
baseline — cannot drift, because there is nothing to forget
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):
the recomputation *is* the value).

The comparison is **structural equality over canonical values**:

- reference identity is useless (the draft is by construction a different
  object);
- compare parsed, normalized values, not presentation strings — trailing
  whitespace or reformatting a number must not read as a change unless the
  canonical value changed;
- collections compare element-wise; order matters only where order is
  meaningful to the entity.

The reward users actually notice: type a character, delete it, and the
editor is clean again. Touched-bit implementations cannot produce this.

## The region map: declared once, covering everything

Fields are assigned to regions (tabs, panels, sections) by **one declared
map** — the same map that drives save grouping. Per-region dirtiness is then
the same comparison scoped to the region's field set.

The map's completeness is a gate that must see its target
([gate-sees-target](../../_laws.md#gate-sees-target)): **a field outside
every region is invisible to dirtiness** — editable, mutating the draft,
and never dirtying anything, which means never saved by group scheduling
and never guarded on exit. When a field is added to the entity, adding it
to the map is part of the same change; the strong form makes the map
mechanically checkable against the draft's shape so an unmapped field fails
loudly instead of vanishing quietly.

## Why resolution matters

A whole-document boolean produces the badge that cried wolf: one field
changed on one tab, and every tab's indicator lights up, so users learn the
indicator means nothing. Per-region dirtiness makes three behaviors honest:

- **the badge on a tab means *this tab*** has unsaved work;
- **partial save is expressible** — save the region that is dirty, leave
  the others alone;
- **partial discard is expressible** — revert this tab to baseline.

The aggregate (is *anything* dirty) is the disjunction over regions, used by
the exit guard and the global save affordance. Derive it; never maintain it
separately from the per-region values, or the two answers will disagree at
the worst moment.

## Honesty rules for indicators

- An indicator lights only for user-attributable change. Derived fields
  recomputed by the system, construction-time normalization, and migration
  fills are part of the *baseline*, not edits — normalize before retaining
  the baseline, or the editor opens already dirty and the first lesson it
  teaches is to ignore the indicator.
- Pending and in-flight saves are their own state, not "dirty" and not
  "clean" — a region whose save is in flight shows saving, and reverts to
  dirty (loudly) on failure. Collapsing the three states into two makes
  either the guard or the badge lie.
- Clean means *provably equal to baseline*, so a successful save must
  advance the baseline (per group), or the editor stays dirty forever after
  the first save.

## Cost discipline

Structural comparison on every keystroke is affordable **because the patch
door names what changed**: recompute only the touched region's comparison,
cache per-region results, and derive the aggregate from the cache. A naive
whole-document deep-compare on each keystroke is the usual reason teams
retreat to stored bits — the fix is scoping the comparison, not abandoning
derivation.

## Prohibitions

1. No stored dirty flag where a comparison can be derived.
2. No comparison over presentation strings.
3. No field outside the region map.
4. No document-level indicator when the surface has regions.
5. No aggregate maintained separately from the per-region derivations.
6. No baseline that includes unsaved edits, and no baseline that excludes
   construction-time normalization.
