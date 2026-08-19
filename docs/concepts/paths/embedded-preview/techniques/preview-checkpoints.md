---
layer: technique
subject: embedded-preview
technique: preview-checkpoints
status: forged
laws: [failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Preview checkpoints

The guest exists to be mutated: a model (or a user) edits it turn by
turn, and the preview shows each turn's result. That loop makes "go back
to how it was two turns ago" a first-class affordance — the user is
steering a generator, and steering needs reverse. The general mechanics
of checkpointing are owned by
[undo-history](../../undo-history/undo-history.md), canonically its
[checkpoint-restore](../../undo-history/techniques/checkpoint-restore.md)
technique: capture at boundaries of meaning, append-only timelines,
restore as a forward non-destructive move, retention with pinning. This
technique does not restate that doctrine; it owns what is specific to a
checkpoint whose subject is a **live application, currently served,
currently displayed**.

## The boundary of meaning is the conversation turn

The preview loop has a natural checkpoint boundary and it is not the file
save or the timer — it is the **mutation turn**: one user intent, applied
as one batch of edits, producing one previewable result. Capture fires
when the turn's edits are fully applied and the guest is expected
coherent; never mid-turn, when the tree is a construction site that no
one will ever want to return to. The checkpoint's label is minted from
the turn's own summary — the user's request or the mutator's description
— because the restore surface is a *conversation* timeline ("before you
asked for the dark header") and sha-plus-timestamp is not how the user
remembers the turn ([identity-survives-reuse](../../_laws.md#identity-survives-reuse):
the checkpoint's identity is the turn, and it must survive however many
times the list is re-rendered or the project reopened).

A project whose scaffold already includes version control gets the store
for free — the scaffolder initializes a repository, so every project
carries its own checkpoint substrate, and the checkpoint layer is a thin
ritual over it rather than a bespoke snapshot format. That choice also
buys the append-only, restore-is-forward property outright.

## Capture failure must be loud at capture time

The checkpoint net is consulted at the exact moment the user most needs
it — something just went wrong and they want to go back. That timing
makes silent capture failure the worst defect this technique can host: a
project whose snapshots quietly stopped committing (a lock, a corrupted
store, a missing tool on this machine) looks identical to a fully
protected one until the restore list comes up short at the moment of
need. Capture is therefore verified per turn, and a failed capture is a
*declared* condition — surfaced in the turn's result, not logged and
forgotten ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The product may legitimately decide previews keep working without
checkpoints; it may not decide that silently on the user's behalf.

## Restore while the guest is live

Restoring a checkpoint of a static directory is a file operation.
Restoring a checkpoint of a *running* preview is a three-party
choreography, and skipping any party leaves a lying surface:

1. **the tree** — restore the files (the owned mechanics:
   restore-as-forward, capture-current-state-first, per
   [checkpoint-restore](../../undo-history/techniques/checkpoint-restore.md));
2. **the server** — usually nothing: the dev server watches its own tree
   and rebuilds on change, which is precisely why the registry
   ([dev-server-registry](dev-server-registry.md)) keeps it alive across
   restores instead of bouncing it. The exceptions are the files the
   server reads only at boot — dependency manifests, configuration; a
   restore that touched those needs a server restart, and the checkpoint
   layer must know which restores those are rather than hoping;
3. **the frame and its passengers** — the displayed document may now
   render a route that no longer exists, and the bridge's derived state
   is stale: pending requests answer for the pre-restore document
   (drain them — [cross-frame-protocol](cross-frame-protocol.md)'s
   lifecycle rule), and the discovered route list describes the
   pre-restore tree (rescan —
   [convention-discovery](convention-discovery.md)). The frame reloads,
   the instrumentation handshake reruns, and only then is the restore
   *done*.

"Restore" that only does step 1 is the classic defect: files revert, the
hot-reload loop repaints most of the interface, and the preview looks
restored while the route picker, the agent's capabilities, and any
in-flight bridge requests still describe a project that no longer exists.

## Hot reload is not a checkpoint

The guest's own hot-reload loop gives the preview its liveness between
checkpoints — every saved edit repaints in place. It is worth stating the
non-equivalence out loud, because surfaces blur it: hot reload is
*display* of the current tree; checkpoints are *recoverability* of past
trees. A session that relied on hot reload alone has exactly one state —
now. The turn-boundary capture is what turns the preview from a monitor
into a timeline, and the two mechanisms coexist without coordination
precisely because capture is read-only with respect to the tree the
watcher watches.
