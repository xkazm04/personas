---
layer: technique
subject: concurrent-vcs
technique: isolated-index-commits
status: forged
laws: [gate-sees-target, creation-names-reaper]
shared_with: []
---

# Isolated-index commits

When a session must commit from a checkout it shares with live siblings —
because the work was single-file and skipped a worktree, or because the
integration step itself lands on the shared copy — the shared staging index
is the surface where commits get corrupted. This technique is the commit
ritual that takes the shared index out of the picture entirely: build the
commit in a **private index file**, seeded from the commit being extended,
populated only with your paths, and used for exactly one commit.

## Why the obvious defenses fail

The failure modes below are mechanical facts about how staging and
committing interact, not exotic races:

- **Plain stage-then-commit** is a read-modify-write on a shared file. A
  sibling staging between your add and your commit rides into your commit;
  a sibling *committing* in that window consumes your staged files into its
  commit and leaves yours a silent no-op.
- **Pathspec-scoped commits do not commit the index at all.** A commit
  restricted to named paths takes those paths *from the working tree*. The
  file set is scoped correctly — and a sibling's unstaged edit to any file
  inside your pathspec is captured at commit time, under your message. The
  staging step you performed was inspected by nothing; the act read a
  different source than the gate
  ([the gate must see its target](../../_laws.md#gate-sees-target)). This
  holds with no hooks, no concurrency, and no second session — it is how
  the operation is defined.
- **"Commit only these staged paths" variants** inherit the same
  working-tree semantics and additionally no-op silently when a sibling's
  commit has already consumed the staged entries — printing a
  nothing-to-commit notice that reads like a mild success.

## The ritual

1. **Create a temporary index file** with a session-unique name, outside
   the shared checkout's control directory.
2. **Seed it from the commit you are building on** — read the current head
   commit's tree into the private index. This is the load-bearing step; see
   the seeding rule below.
3. **Add your paths, and only your paths, into the private index** by
   pointing the version-control tool's index-file override at it for each
   add. Per-path adds; never add-everything. When a file you must commit
   *also* carries a sibling's unstaged edits, whole-file adding would adopt
   them — stage only your hunks, patch-wise, into the private index; it is
   the only honest way to commit a co-mingled file, and it has held in the
   field where whole-file pathspec forms swept.
4. **Commit with the same index override.** The commit's tree is the head's
   tree plus exactly your additions — built from *staged content*, immune
   to sibling working-tree edits and sibling index activity alike.
5. **Delete the temporary index.** The ritual that created it reaps it
   ([creation names its reaper](../../_laws.md#creation-names-reaper)).
6. **Verify by readback** — the private index protects the commit's
   *content*; it does not prove the commit landed where you think, so the
   readback from commit-verification still applies.

## The seeding rule: from the head, never by copy

Two wrong seedings look almost identical to the right one and fail
differently:

- **Copying the shared index** inherits everything wrong with it at the
  moment of copy: siblings' staged files (which your commit then adopts),
  and — subtler — *staleness*. The shared index maps every tracked file to
  a recorded state; entries for files your session never touches still
  participate in the commit's tree. If the copy is stale relative to the
  head you are committing on, your commit silently **reverts** the
  difference — files nobody meant to touch come out changed, backward.
- **Reusing your own private index across successive commits** is the same
  staleness trap self-inflicted: after your first commit through the
  ritual, the head has moved, and an index seeded earlier — or copied from
  a shared index that predates your own commit — now encodes the *old*
  head's file states. The second commit built on it un-does the first:
  files your first commit added come out recorded as **deleted**, and its
  modifications come out reverted — all invisible in the commit command's
  output, surfaced only by reading back the landed commit's file-status
  list. This is the ritual's one known self-defeat, and it was discovered
  in production use, not in theory — twice in one commit, recovered by
  amending through a correctly seeded index: the ritual protects against
  siblings, and the stale seed made it attack its own session's history.

The rule that closes both: **seed the private index from the head commit's
tree, at the moment of building, once per commit.** Fresh seed, one commit,
delete. The private index is a single-use tool, not a session-long
workspace.

One bookkeeping consequence: the *shared* index never saw your commits, so
after your last one it is stale relative to the head — every session
reading the shared status view sees phantom differences. Close the session
by resynchronizing the shared index to the head (a mixed reset — it touches
no working files), **after** first checking that nothing a sibling has
staged there would be swept out by the resync. If a sibling's staged work is
present, leave the shared index alone; phantom staleness is annoying, and
destroying a sibling's staging is a loss.

## Scope and honesty

What this ritual defends: the mapping from "what I staged" to "what the
commit contains", against every form of shared-index and shared-tree
interference. What it does not defend: hook interactions (commit hooks that
inspect or re-stage through the shared index have not been exercised
against an index override everywhere this ritual is used — verify in your
own environment before trusting the combination), and head movement between
seed and commit (a sibling committing in that window moves the head; your
commit then extends the old head — the readback catches it as a
non-fast-forward surprise). Name these limits where the ritual is taught;
a ritual trusted past its tested envelope is how the next incident gets
minted.
