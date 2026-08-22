---
layer: golden-path
subject: versioning-snapshots
status: forged
techniques:
  - snapshot-scope
  - version-identity
  - restore-semantics
  - lineage-and-variants
  - promotion-lifecycle
  - retention-and-pruning
evidence:
  - src-tauri/db/src/repos/lab/versions.rs                       # monotonic number derived at insert; full-graph INSERT…SELECT snapshot (prompt + tools + config); tag 'experimental' minted at creation; parent_version_id lineage column
  - src-tauri/src/commands/execution/lab.rs                      # declared tag vocabulary (production/experimental/archived); atomic production swap; restore rejects incomplete snapshots instead of COALESCE-ing a hybrid
  - src-tauri/db/src/repos/execution/metrics.rs                  # create_prompt_version_if_changed — dedupe gate at the one capture door
  - src-tauri/src/engine/auto_rollback.rs                        # regression demotion: production tag (not highest number) selects current; 2x error-rate threshold; event carries from/to versions + both rates
  - src-tauri/db/src/repos/lab/ratings.rs                        # version economics pinned to version ids with explicit predicate (attempted / resolved='passed' / cost_per_success)
  - src-tauri/db/src/repos/lab/evolution_proposals.rs            # human-gated promotion proposals; cycles always complete promoted=false, only the approval path flips it
  - src-tauri/db/src/repos/resources/persona_change_log.rs       # the field-log shape of history: per-field diff rows on the caller's transaction, redaction, coalescing window, write-time retention cap
  - docs/concepts/golden-paths/definition-version-history.md     # measured census: three version mechanisms, one live; capture-bypass and constraint gaps counted against real databases
counter_evidence:
  - src-tauri/db/src/migrations/incremental/   # persona_versions DDL: per-entity version_number with NO unique constraint — the sequence is code-enforced only, and the census found 12 such tables
deviations:
  - w9-versioning-snapshots   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Versioning, snapshots & rollback

A version is a **promise about the past**: *the entity as it was at this
moment can be inspected, compared, and returned to — exactly, later, by
someone who was not there.* Everything in this subject is downstream of the
three words that end that sentence. *Exactly* forces the snapshot to capture
the whole graph the behavior depended on, not the fragment that was easy to
copy. *Later* forces durability, minted identity, and retention policy —
the promise outlives the session, the process, and the person who made it.
*Someone who was not there* forces self-description: lineage, labels, and
honest measurement, because the future reader has no access to the context
in which the version was cut.

That promise is what separates this subject from its nearest neighbor.
In-session undo is one editor taking back their own gesture minutes after
making it — ephemeral, private, gesture-grained (the undo-history subject,
whose [checkpoint-restore](../undo-history/techniques/checkpoint-restore.md)
technique sits closest to this border). Versions are the entity's **durable
history**: they survive restarts, they are visible to every collaborator and
every audit, and their unit is not the gesture but the *state worth
returning to*. The boundary is durability and audience — when a restore
point must outlive the session that created it, or serve a reader other
than its author, it has crossed into this subject.

## Where this subject ends

- **In-session reversibility** — the undo stack and working-session
  checkpoints belong to undo-history. The tell: undo answers "take back
  what I just did"; versions answer "what did this look like last week,
  and can we go back to it".
- **The live entity's lifecycle** — whether the current entity is draft,
  active, or archived is the entity-lifecycle subject. A version *record*
  has states of its own (see promotion below), but the entity's aliveness
  is not version history's business; the two state machines must not be
  fused into one column.
- **Schema versioning** — versions of the *shape* of the data are the
  [migrations](../migrations/migrations.md) subject. The two interact
  exactly once, and painfully: a stored snapshot written under schema
  version N must still be restorable after the schema moves to N+1, which
  makes every snapshot a small compatibility contract with future
  migrations (the [snapshot-scope](techniques/snapshot-scope.md) technique
  owns that clause).
- **Judging which version is better** — the measurement machinery belongs
  to the eval-harness subject; its
  [comparison-modes](../eval-harness/techniques/comparison-modes.md)
  technique is the authority on comparing two candidates honestly. This
  subject owns the *bookkeeping* of per-version quality claims — that a
  rating is pinned to the exact version it measured, and says what was
  measured — not the judging itself.

## The snapshot scope is declared, not discovered

The first failure of every naive versioning feature is a snapshot that
captures the entity's *record* but not the entity's *behavior*. An agent is
its prompt **and** its tools **and** its configuration; a document is its
text **and** the assets it embeds; a pipeline is its steps **and** the
parameters each step reads. A version that captured the prompt but not the
tools it referenced does not restore the past — it restores a **chimera**:
yesterday's words wired to today's capabilities, a state that never existed
and was never tested. Chimeric restores are worse than failed ones, because
they succeed quietly and misbehave later, far from the restore that caused
them.

So the snapshot scope is a declared design decision: enumerate the graph of
state the entity's observable behavior depends on, snapshot all of it
atomically, and write down what is deliberately excluded and why (runtime
statistics, foreign credentials, mutable references that are *supposed* to
float). The [snapshot-scope](techniques/snapshot-scope.md) technique carries
the mechanics — embedded copies vs live references, the set-based
full-graph copy inside one transaction, and the exclusion ledger.

There is a second shape of durable history, and the choice between them is
made before any table is designed: **snapshot history** (one row per saved
state; the unit is the whole entity, and the unit of *rollback*) versus a
**field-level change log** (one row per changed field; the unit is the
edit, and the natural answer to "what changed, when, by whom"). The
discriminator is what moves together: when the entity's parts are only
meaningful as a set — a template plus its parameters plus its inputs — the
snapshot is the honest unit, because restoring one field of it produces a
state nobody tested. When the entity is a bag of independently-edited
fields, the field log is the honest unit, because a snapshot per save
cannot answer "what changed" without a diff engine that must itself be
kept honest. A complete field log can reconstruct any snapshot by replay;
snapshots cannot reconstruct the field log. Systems that need both
rollback and "what changed" often carry both — and then each history has
its own capture door, its own retention, and its own reaper.

## Identity is minted at creation and only counts up

Every version carries two identities: a globally unique id (its primary
identity, stable under every operation) and a **per-entity monotonic
number** (its human handle: "v7"). The number is derived at insert time
from the entity's own history — max plus one, computed inside the same
transaction that writes the row — never supplied by a caller, never
recycled after deletion, and gap-tolerant by design: v6 may be pruned, and
v7 stays v7 forever. Reusing a number is identity fraud against every log,
rating, and conversation that ever mentioned it. The
[version-identity](techniques/version-identity.md) technique owns the
concurrency and numbering mechanics.

## The timeline only moves forward

**Restore is non-destructive.** Returning to v3 does not rewind the entity
to v3 — it mints v8 *with v3's content*, lineage pointing at v3, and the
timeline intact. A restore that overwrites the current state in place, or
truncates the versions after the restore point, is an undo mechanism
wearing version clothes — and a broken one, because it destroys exactly the
audit trail and the escape hatch that justified building versions at all.
Forward-only restore makes rollback *safe to try*: restoring, inspecting,
and restoring back loses nothing, which converts version history from an
emergency lever into a browsing surface. The
[restore-semantics](techniques/restore-semantics.md) technique covers the
mechanics, including the reconcile step owed when the live entity changed
after the version being restored was cut.

## History is a graph, and the edges are recorded

Real version histories branch. A variant spun off v4 for an experiment, a
restore that revived v2, two collaborators diverging and one line winning —
a bare sequence number cannot represent any of it. Record **lineage**: each
version names its parent (or parents), restores point at what they revived,
and variants carry the edge to the version they forked from. Lineage is
what makes the history *answerable* — "which line did the good rating land
on?", "what did this variant change relative to its base?" — and it costs
one nullable column at write time versus archaeology forever after (the
[lineage-and-variants](techniques/lineage-and-variants.md) technique).

## Promotion is a lifecycle, not a vibe

Versions are not all equal, and the inequality must be **declared state,
not folklore**. A new version enters as experimental; it becomes the active
one through an explicit promotion act with named criteria (measured better
than the incumbent, approved by someone accountable, survived a trial
period); it retires when superseded. The current/active pointer is a single
authoritative reference the runtime reads — never "the highest number",
which promotion by mere creation would imply. And a lifecycle that can
promote can also demote: the auto-rollback hook — regression detected,
previous version reinstated — is the promotion lifecycle running in
reverse, owned mechanically by the self-healing subject's
[auto-rollback](../self-healing/techniques/auto-rollback.md) technique and
bookkept here. The [promotion-lifecycle](techniques/promotion-lifecycle.md)
technique carries the states, criteria, and hooks.

## Version economics are honest

Per-version measurements — ratings, comparisons, win-rates — are the reason
version history earns its storage: they turn "we changed it" into "we
improved it". Two honesty rules keep them worth having. First, **a
measurement is pinned to the exact version it measured**; a rating that
floats to "the current version" is retroactive fiction. Second, **a stored
score names its predicate** — what was measured, against what baseline,
by which method ([count-carries-predicate](../_laws.md#count-carries-predicate));
the judging methodology itself is the eval-harness subject's ground. And
because versions carry storage and attention costs, the history has a
reaper: retention policy that thins the middle while exempting the pinned,
the promoted, and the milestone (the
[retention-and-pruning](techniques/retention-and-pruning.md) technique).

## The techniques

- [snapshot-scope](techniques/snapshot-scope.md) — the entity graph a
  version must capture: embedded vs referenced dependencies, atomic
  full-graph copies, the exclusion ledger, and the schema-compatibility
  clause.
- [version-identity](techniques/version-identity.md) — the dual identity
  (global id + per-entity monotonic number), derivation at insert,
  concurrent-writer safety, and gap tolerance.
- [restore-semantics](techniques/restore-semantics.md) — forward-only
  restore, restore-as-new-version, reconciling with live state that moved,
  and partial restore.
- [lineage-and-variants](techniques/lineage-and-variants.md) — parent
  edges, branch/variant tracking, and comparison across lineage.
- [promotion-lifecycle](techniques/promotion-lifecycle.md) — declared
  version states, promotion criteria, the single active pointer, and
  demotion/auto-rollback hooks.
- [retention-and-pruning](techniques/retention-and-pruning.md) — bounds,
  thinning, the pinned/milestone exemption, and snapshot storage
  economics.
