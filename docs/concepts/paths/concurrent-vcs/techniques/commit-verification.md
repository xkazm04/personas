---
layer: technique
subject: concurrent-vcs
technique: commit-verification
status: forged
laws: [gate-sees-target, failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Commit verification

In a shared checkout, every prevention layer — ledgers, worktrees, private
indexes — can be skipped, misapplied, or hit an untested edge. Verification
is the layer that cannot be substituted, because it is the only one that
observes *outcomes*. Its premise is uncomfortable and load-bearing: **a
commit that did not happen looks exactly like one that did.** The command
prints its normal output, hooks run and report, and the session proceeds —
while the commit no-oped because a sibling consumed the staged files, or
landed with a sibling's twelve staged files fused into it, or scoped
correctly but captured a neighbor's unstaged edit. Happy-path output is a
report about the *attempt*, not the *result*
([the gate must see its target](../../_laws.md#gate-sees-target)).

## Before the commit: count what you staged

Immediately before committing, compare the staged file count against the
number of files you explicitly staged. The comparison carries its predicate
([a count carries its predicate](../../_laws.md#count-carries-predicate)):
not "some files are staged" but "exactly the N files I named are staged."

- **Staged > intended** — the index already held a sibling's pre-staged
  files; your adds layered on top. Unstage the foreign entries per path
  before committing, or switch to the private-index ritual.
- **Staged < intended** — something consumed your entries between add and
  now; a sibling's commit is the usual suspect. Re-stage and re-check.

And be honest about what this check is: **a time-of-check-to-time-of-use
race.** The index can change between the inspection and the commit — this
has been observed as "inspected one file, committed two." The pre-commit
count catches the *already-drifted* state cheaply; it guarantees nothing
about the commit itself. Never let a clean pre-check substitute for the
readback.

## After the commit: read the log back

After **every** commit — no exceptions for small ones, since no-ops are
cheapest to produce on small commits — read back the newest log entry and
confirm three things:

1. **The message is yours.** If the newest commit carries a sibling's
   message, your staged work was swept into their commit, or your commit
   never happened.
2. **The changeset is yours** — the file list matches what you intended,
   in count and in names. A matching message with a superset of files
   means you swept a sibling. And a swept file is not only your problem:
   a commit whose message describes a *subset* of its diff poisons every
   later reader — the measured worst case took a swept deletion through a
   well-reasoned "restore" by a repair session and a second deletion a
   week later, four commits to remove one file, because the message was
   the only record anyone consulted and it was silent about the sweep.
3. **It exists at all.** A "nothing to commit" notice earlier in the output
   is the spelling of a no-op, and it reads like a mild success; the log
   is where a no-op becomes undeniable
   ([failure must be spelled differently from empty
   success](../../_laws.md#failure-not-empty-success)).

The readback is the single point where this subject's failure class is
*detectable at all*. Every incident in the evidence base that was recovered
cleanly was caught by a readback one step after the fault; every one that
festered was a readback skipped.

## Recovery: amend first

Verification exists to catch failures while they are one commit old,
because at that age they are cheap:

- **Swept-in foreign files** — the content is present, the attribution
  wrong. Amend the commit to the correct file set (or split it), never
  reset: rewinding a shared timeline to fix a label destroys whatever
  siblings landed meanwhile.
- **Your work landed under a sibling's message** — the work is safe in
  history; coordinate the attribution fix or record it and move on. The
  worst response is re-committing the same content on top.
- **No-op** — nothing landed; the working tree still holds your edits.
  Re-stage (via the private index this time) and re-commit.
- **Nothing in the log and nothing in the tree** — the reference log is
  the recovery surface of last resort; consult it before assuming loss.

## Publishing a shared branch: the same discipline, one level up

When multiple sessions share one checkout *and one branch*, pushing has its
own verification asymmetry, measured in the field hours after the commit
rules above were written down:

- **A rejected push does not mean unpublished work.** The rejection is a
  compare-and-swap failure on the *ref*, not a verdict on your *content* —
  and because a sibling's push carries the whole shared branch, your
  commits may already be ancestors of the published head, delivered by the
  sibling. The reflexive responses — re-push, pull, rebase, reset — are all
  edits to shared history in service of a problem that may not exist.
- **The check is an ancestry test against a freshly fetched remote**, per
  commit: is this commit an ancestor of the published head? Comparing your
  head against the *locally cached* remote pointer is not the check — a
  failed push leaves that cache wherever the last fetch put it, so it
  reports "diverged" states that are not real
  ([the gate must see its target](../../_laws.md#gate-sees-target), again:
  the cache is a proxy, and it diverges from the target exactly when you
  consult it).
- **Pre-push validation time is the race window.** Every second the push
  spends in checks is a second the shared ref can move under it. That is
  not an argument against the checks — it is a reason to expect this
  rejection as *normal* on a busy shared branch, and to answer it with
  verification first, action second. Often the correct action is none.

## The discipline is per-commit, not per-session

The whole technique is two cheap commands wrapped around every commit.
Sessions abandon it exactly when it matters — under time pressure, in
"trivial" commits, in the last integration step of a long run. Bind it into
the commit ritual itself (the same script or habit that commits also reads
back) rather than leaving it as advice, because a verification that
depends on remembering is a verification the failure case will skip.
