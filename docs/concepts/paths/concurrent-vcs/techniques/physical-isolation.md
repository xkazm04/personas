---
layer: technique
subject: concurrent-vcs
technique: physical-isolation
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Physical isolation

Every other mechanism in this subject detects, discourages, or repairs
collisions. A linked worktree is the one mechanism that *removes* them: a
separate working copy on its own branch, sharing the repository's object
database but nothing of the checkout's mutable state — its own files, its
own index, its own head. Two sessions in two worktrees cannot interleave
edits, cannot race each other's staging, and cannot sweep each other's files
into a commit, because there is no shared mutable surface left to race on.

## The threshold: multi-file work isolates

The standard is a bright line, not a judgment call:

- **More than one file in the planned scope → create a worktree.** A
  research effort touching a module and its tests; a refactor with a
  multi-file rollout; a generator run that rewrites several manifests — all
  get their own working copy and branch, worked and committed there, merged
  back when done.
- **A single-file, single-sitting fix may stay on the main checkout** — the
  exposure window is one edit and one commit, and the commit still goes
  through the shared-checkout commit discipline (private index if siblings
  are live, verification always).

The line is drawn on file count rather than perceived risk because sessions
systematically underestimate risk and cannot underestimate a file count.
When in doubt, isolate: a worktree's cost is seconds of setup; a collision's
cost is an incident.

## Creation

Create the worktree under a dedicated, well-known directory with a short
task slug, on a branch named for the same slug — a naming convention that
makes a directory listing of worktrees double as a task roster. Then work
entirely inside it: edits, staged changes, commits, validations, all in the
isolated copy. Commit atomically per task exactly as on the main checkout;
isolation removes cross-session interleaving, not the value of small
commits.

Two cautions at creation time:

- **Dependency state does not follow.** A fresh worktree has fresh, empty
  dependency and build directories; tooling that assumes an installed state
  must reinstall or link it. Native or compiled dependencies in particular
  often need a rebuild inside the new copy.
- **The worktree is not a sandbox for the repository's shared surfaces.**
  Its branch, the object database, and any remote are still shared. The
  isolation covers the working files and the index — which is exactly the
  contended surface — nothing more.

## Removal: the hazards live here

A worktree is removed when its branch has merged and the work is confirmed
in the target branch's history. The finish ritual is: verify the merge in
the log, remove the worktree through the version-control tool (never a bare
directory delete — the tool must unregister it), then delete the merged
branch. The worktree names its reaper at creation: the session that made it
removes it, as part of the same finish ritual that closes the ledger entry
([creation names its reaper](../../_laws.md#creation-names-reaper)).

The one genuinely dangerous step is **link artifacts inside the worktree**.
Dependency managers and build tools sometimes materialize directories as
junctions or symbolic links into shared caches or into the main checkout.
A recursive delete that follows such a link destroys the *target* — a
shared cache, or the main checkout's real dependency tree — while appearing
to clean the worktree. Before removing any worktree, remove or unlink its
link-typed directories explicitly, then remove the worktree. This failure
has been paid for; treat the ordering as mandatory.

## Garbage collection: the sweep for abandoned worktrees

Sessions crash without finishing their ritual, so the subject keeps a
periodic sweep that lists every registered worktree with three facts: its
**age**, whether it is **dirty** (uncommitted work in its tree), and whether
its branch is **merged**. The destruction rule is conjunctive — remove only
what is *clean and merged and stale*; anything dirty is a session's
possibly-live work and is surfaced, never deleted.

The sweep must reconcile **both directions** between the tool's worktree
registry and the directory convention on disk, because half-finished
cleanups leave debris on each side — and the debris on the unregistered
side is invisible to a sweep that only enumerates the registry. Measured:
three abandoned full working copies sat under the worktree directory with
*no registry record at all* (the metadata had been cleaned, the directories
had not), unreachable by any registry-driven collection. So the sweep also:

- **prunes stale registry records** whose directory is gone — cheap and
  always safe;
- **surfaces orphaned directories** present on disk but absent from the
  registry, as a *lower-trust class* removed only on explicit opt-in,
  because with no registry record the tool cannot vouch for what they
  contain.

The sweep's report is useful even when it destroys nothing: a roster of
stale worktrees is a roster of crashed or negligent sessions, which feeds
back into the ledger's completed-with-no-outcome accounting. Stale worktrees
are not free while they wait — each holds a full working copy (often with a
multi-gigabyte build cache), confuses the roster, and invites a future
session to wander into it by accident.
