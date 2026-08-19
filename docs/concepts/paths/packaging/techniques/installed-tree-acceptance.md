---
layer: technique
subject: packaging
technique: installed-tree-acceptance
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Installed-tree acceptance

The only environment that predicts the user's machine is a machine that
received the software the way the user will: by running the installer. This
technique is the automated ladder that takes each installer artifact through
**install → verify tree → launch → verify launch**, per operating system and
architecture, on every change that could affect packaging — not on release
day, when the queue of unverified changes is longest and the time to fix
them is shortest.

## Why the build directory cannot stand in

Every substitute environment fails the same way: it contains things the
user's machine does not.

- The build directory carries the toolchain's runtime libraries on its
  search path; the installed tree must carry its own, and the only test of
  whether it does is loading from the installed tree with nothing else
  available.
- Dev-mode resource resolution reaches into the source checkout; installed
  resolution reaches into the install location, which has a different
  layout on every platform by each platform's own conventions.
- The developer machine has accumulated globally installed frameworks,
  runtimes, and libraries that mask missing dependencies. A clean machine
  masks nothing.

A green suite that ran against the build output is a claim about the wrong
artifact ([gate-sees-target](../../_laws.md#gate-sees-target)). The gate for
"the user can run this" must observe a user-shaped installation.

## The ladder

Each rung produces its own verdict; a failure names the rung, because the
rungs have different owners and different fixes.

1. **Install silently on a clean environment.** Automation cannot answer
   dialogs; the installer must support an unattended mode, and exercising
   that mode doubles as testing the path enterprise deployment will use.
   "Clean" is enforced by construction — a fresh virtual machine, container,
   or reset image per run — never by hand-cleaning a long-lived runner,
   which accretes exactly the masking state the technique exists to remove.
2. **Verify the tree.** Walk the actual install location against the
   declared contract: the executable, every runtime library, every sidecar,
   every required resource — presence, and where it matters, size class and
   machine type. This is a manifest comparison, cheap and exact; its
   authority comes from running *after* a real install.
3. **Launch.** Start the installed executable — the one in the install
   location, by its installed path — on a machine that has nothing else.
4. **Verify the launch.** A process that starts and dies in the first
   second looks identical to success unless the gate waits and looks. The
   minimum honest smoke: the process is still alive after a settle period,
   and it has produced a positive liveness signal — a log line, a health
   response, a window — that only a successfully initialized application
   produces. Exit-code-zero-at-spawn is not a launch verification; it is
   the absence of one
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

5. **Uninstall, and verify the removal.** Run the uninstaller in the same
   unattended mode and assert the installed tree is actually gone — an
   uninstaller that exits zero and leaves the tree behind is the same
   defect as an installer that exits zero and lays down nothing. Where the
   installer enumerates system-registration entries, the walk covers those
   too, and asserts the user-data locations were left untouched.

Where the matrix includes upgrade support, the ladder gains a further rung:
install the previous released version first, upgrade to the candidate, and
re-run rungs 2–4 — because upgrade-over-existing is a different code path
than fresh install and fails independently.

## Degraded rungs are declared, with a promotion bar

Some rungs are unreliable on some cells through no fault of the artifact —
the canonical case is launching a windowed application on a headless
automation runner. The honest posture is a **per-rung degrade, written into
the job**: the structural rungs (install, tree, signature) assert
unconditionally and remain load-bearing; the unreliable rung still runs but
its failure is advisory. Two disciplines keep the degrade from rotting into
permanent blindness:

- the job's own text names which assertions are load-bearing and which are
  bonus signal, so a green run cannot be over-read;
- the degrade carries a **promotion bar** — an explicit condition ("blocking
  once green for N consecutive runs") under which the advisory rung becomes
  mandatory — so "temporarily non-blocking" has a defined exit instead of
  becoming the permanent state nobody re-decides.

## Per-cell, not per-release

The ladder runs per matrix cell (see [os-arch-matrix](os-arch-matrix.md)).
Cells differ in packaging format, payload set, and loader behavior; a pass
on the most convenient cell is evidence about that cell only. Where a cell's
hardware is unavailable in automation (a niche architecture with no hosted
runners), the standard is an explicit downgrade written into the matrix —
"this cell is verified manually per release, here is the checklist" — not a
silent skip that reads as coverage.

## Failure honesty

The acceptance job must distinguish "verified and failed" from "did not
verify". An installer that could not be produced, a runner image that could
not boot, a manifest that could not be read — each is a gate outage, not a
pass, and the job's output says so loudly. The most expensive state this
technique can enter is *green while not running*, because every downstream
consumer reads green as "the installed tree is proven" and stops checking.

## What this technique does not own

Publishing the proven artifact, choosing version numbers, and feeding the
updater belong to the release pipeline. The runtime behavior of sidecar
processes after launch belongs to
[subprocess-lifecycle](../../subprocess-lifecycle/subprocess-lifecycle.md);
this technique proves the sidecar is present, correct, and launchable — the
first process start is where its jurisdiction ends.
