---
layer: golden-path
subject: draft-editing
status: forged
techniques:
  - draft-model
  - dirty-tracking
  - debounced-save-groups
  - navigation-guards
  - field-defaults-and-bounds
  - completeness-derivation
evidence:
  - src/features/agents/sub_editor/libs/PersonaDraft.ts               # draft type + key groups + compile-time group-map exhaustiveness + incident-documented timeout default
  - src/features/agents/sub_editor/hooks/useEditorDraft.ts            # construction, patch door, identity-guarded reseed, corrupt-source save suppression
  - src/features/agents/sub_editor/libs/useEditorSave.ts              # per-group derived dirty + per-group baseline advance on confirmed success
  - src/features/agents/sub_editor/libs/useDebouncedSaveGroup.ts      # in-flight lock + sent-payload snapshot comparison (race 2)
  - src/features/agents/sub_editor/libs/EditorDocument.tsx            # region registry: dirty aggregate, saveAll stop-on-first-failure, dirty-tab-without-save throws
  - src/hooks/utility/interaction/useUnsavedGuard.ts                  # the exit interceptor (nav + window close, save/discard/stay)
  - src/features/agents/sub_editor/libs/usePersonaReadiness.ts        # single readiness resolver: reasons + badge derived from one place
  - src/api/agents/personas.ts                                        # operation union + buildUpdateInput — apply as intent-derived diff, never call-site payloads
  - docs/concepts/golden-paths/entity-draft-editing.md                # legacy census: 55 reseeds, 17 dirty mechanisms, replay-proven diff-not-record result
  - docs/concepts/golden-paths/debounced-autosave.md                  # legacy census: 13 debounced write sites, executed teardown scenarios, zero window-close drains
counter_evidence:
  - src/lib/ui/BaseModal.tsx                                          # escape/backdrop close unconditionally — a draft in a modal cannot join the interceptor
deviations:
  - w7-draft-editing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Draft & dirty-state editing

Draft editing is the shape you reach for when the user's job is **sustained
revision of a persisted entity**: an editor, a configuration workspace, a
document with many regions, worked on across minutes or sessions, where the
system of record must not absorb keystrokes. The defining property is the
**buffer** — an in-memory working copy, distinct from the persisted entity,
that the user mutates freely and the system commits deliberately. Everything
else in this standard (dirtiness, grouped saves, guards, readiness) is a
consequence of taking that separation seriously.

The neighboring shapes, and where the boundary runs:

- **A [form](../form/form.md)** is the one-shot cousin: compose a valid
  mutation, submit it once, leave. Its submit lifecycle, field-level
  validation timing, and error aggregation are owned there and reused here
  unchanged — a draft editor is, among other things, a form that never
  closes. What changes at this altitude is *lifecycle*: the draft outlives
  any single submit, saves happen continuously and partially, and "done" is
  a publish gate rather than a submit button.
- **A [wizard](../wizard-flows/wizard-flows.md)** chunks a draft into
  sequenced commitments with stage dependencies. If later regions depend on
  earlier answers being *committed*, that is a wizard; a draft editor's
  regions are peers, editable in any order, committed on the user's schedule.
- **[Client state](../client-state/client-state.md)** owns the store
  mechanics underneath — slicing, subscription, persistence plumbing, async
  race guards. This standard says what the draft *is* and how it behaves;
  which store technology holds it is deliberately out of scope.
- **Undo history** (a sibling standard) owns multi-step reversal over the
  same buffer. The draft model here is what makes an undo stack attachable —
  a single patch door is a single capture point — but the stack itself, its
  granularity and its scope, live there.

When *not* to build a draft layer: a single value with a cheap undo is an
inline edit — click, change, committed, no buffer. Independent low-risk
settings can commit per control. Building draft chrome (explicit save,
dirty badges, guards) around edits that carry no composition risk taxes
every interaction to insure against nothing.

## The draft is an object, not a pile of local states

The first structural decision decides everything downstream: the draft is
**one object with one mutation door**, constructed from the persisted entity
at open, compared against a retained baseline, and committed through an
explicit mapping back to storage shape. The failing alternative appears in
every codebase that grew an editor organically — each field holds its own
local state, initialized from the entity ad hoc, saved by whichever handler
was written last. That pile cannot answer "is anything unsaved", cannot be
guarded on exit, cannot host an undo stack, and cannot be saved atomically,
because there is no *it*.

The single mutation door — a patch interface every edit flows through — is
the load-bearing element. Dirtiness derivation, save scheduling, undo
capture, and telemetry all attach at that one point once, instead of at N
call sites forever ([one-validation-door](../_laws.md#one-validation-door)
applied to mutation). And the buffer earns its keep a second time at the
exit: **what goes on the wire is the diff against the baseline, never the
whole record** — a client that never recorded what the user touched has
only two ways to build a payload, filling blanks or echoing stale reads,
and both lose data. The [draft-model](techniques/draft-model.md) technique
owns the construction, patch, apply, and discard semantics.

## Dirtiness is derived, and it has a resolution

*Dirty* is a comparison — draft versus baseline — never a stored bit. A
stored flag is set by the code that remembered to set it and cleared by the
code that remembered to clear it, and it lies in both directions within a
week. Derived dirtiness is also what makes "type a character, delete it,
clean again" come out right, which users notice more than almost anything
else about an editor.

And it has a **resolution**: a draft with many regions derives dirtiness
*per region*, from a declared mapping of fields to regions. A single
whole-document boolean makes every tab shout when one field changed — the
badge that cried wolf — and makes partial save impossible to express. The
[dirty-tracking](techniques/dirty-tracking.md) technique owns the grouping,
the comparison semantics, and the honesty rules for badges.

## Saves are grouped, debounced, and loud about failure

A long-lived draft saves continuously, and the save architecture has three
commitments:

1. **Grouped** — the unit of save is the region, not the keystroke and not
   the whole document. Per-keystroke saves are a request storm with
   interleaving hazards; whole-document saves widen every conflict window
   and make one region's failure poison another's success.
2. **Debounced with explicit flush** — bursts coalesce, but tab switches,
   guards, explicit save gestures, and closes flush pending work. The
   debounce is a courtesy to the transport, never the only door.
3. **Loud about failure** — a debounced save that fails silently is **data
   loss on a timer**: the user kept working under a persistence promise the
   system already broke. Failure surfaces where the user can see it, keeps
   the region dirty, and offers retry
   ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

The [debounced-save-groups](techniques/debounced-save-groups.md) technique
owns the scheduling, in-flight overlap, baseline advancement, and failure
surfacing.

## Exits are guarded, and the draft survives what it can

Navigation away from unsaved work is data loss with one keystroke of warning
available. The guard intercepts every exit path the surface owns — region
switch, route change, surface close, window close — through one interceptor,
and it observes the *real* state: derived dirtiness **plus pending and
in-flight saves**, because work sitting in a debounce timer is exactly as
unsaved as work never scheduled
([gate-sees-target](../_laws.md#gate-sees-target)).

Guarding is the last resort, not the strategy. The stronger posture is
survival in layers: the draft survives remount (kept above the surface's
lifetime), ideally survives reload (persisted locally, keyed by entity
identity), and only where survival runs out does the guard ask its question.
The [navigation-guards](techniques/navigation-guards.md) technique owns the
interception, the offer, and the survival layers.

## Field semantics live beside the fields

A draft editor is where an entity's fields acquire their operational
meaning: defaults, bounds, units, clamps. That knowledge lives **in the
field's definition**, colocated and stated once — not scattered across the
control, the mutation handler, and the persistence mapping. And because **a
default is a decision** — often one with an incident behind it — the
definition carries the rationale, so the next engineer reading an oddly
specific value knows it is a scar, not noise. The
[field-defaults-and-bounds](techniques/field-defaults-and-bounds.md)
technique owns this discipline.

Field-level *validation* — timing, feedback placement, error aggregation —
is owned wholesale by the [form](../form/form.md) standard and applies here
unchanged. This standard adds only the draft-specific rule: invalid values
may live in the draft (that is what a draft is for), but they must be
visible as invalid and must not silently pass the save door.

## Completeness is computed, and it gates publishing — not saving

Long-lived drafts usually feed a promotion gate: publish, activate, deploy.
Readiness for that gate is **derived from the draft on demand** — an
enumerable set of named requirements, each pointing at the region that
satisfies it — never a stored "complete" flag
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
Two rules keep it honest: an incomplete draft **must still be saveable**
(drafts exist precisely to hold unfinished work), and a completeness figure
travels with its requirement set — "80% ready" names the checklist it is 80%
of ([count-carries-predicate](../_laws.md#count-carries-predicate)). The
[completeness-derivation](techniques/completeness-derivation.md) technique
owns the requirement model.

## The techniques

- [draft-model](techniques/draft-model.md) — the buffer: construction from
  the entity, the single patch door, baseline retention, apply and discard,
  staleness against external change.
- [dirty-tracking](techniques/dirty-tracking.md) — per-region derivation
  from a declared field-to-region map, comparison semantics, truthful
  badges.
- [debounced-save-groups](techniques/debounced-save-groups.md) — per-group
  debounce and coalescing, flush triggers, in-flight overlap, per-group
  baseline advance, failure surfacing and retry.
- [navigation-guards](techniques/navigation-guards.md) — one interceptor
  over all exit paths, the save/discard/stay offer, and the draft-survival
  layers that make the question rarer.
- [field-defaults-and-bounds](techniques/field-defaults-and-bounds.md) —
  defaults with rationale, clamps at the patch door, units, and the
  absent-versus-default distinction.
- [completeness-derivation](techniques/completeness-derivation.md) —
  readiness as a derived checklist of named requirements gating promotion,
  never persistence.
