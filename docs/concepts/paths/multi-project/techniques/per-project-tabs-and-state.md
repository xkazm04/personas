---
layer: technique
subject: multi-project
technique: per-project-tabs-and-state
status: forged
laws: [identity-survives-reuse, creation-names-reaper, one-authority-per-vocabulary]
shared_with: []
---

# Per-project tabs and state

An operator managing a portfolio does not visit projects; they *hold* them.
Three or six projects stay open for days, switched between dozens of times,
each mid-something — a view scrolled to a spot, a panel expanded, a run in
flight. The instrument for this is the one users already know from browsers:
**a persisted, ordered tab set**, and the technique is what separates a real
working set from a row of navigation buttons.

## The working set is durable state

The tab set — which projects are open, in what order, which is active — is
**persisted as it changes and restored exactly on restart**. Not "the app
reopens on a default view with your projects reachable"; the same tabs, same
order, same active tab. An operator's working set encodes a plan ("these
four are this week's focus") that the tool did not create and must not
discard. The set is stored keyed by minted project identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)), so it
survives renames and re-paths along with every other artifact — a tab set
stored as names or paths is the name-join defect wearing a UI costume, and
it manifests as tabs that silently vanish after a rename.

Restore must also survive *the portfolio changing underneath it*: a
persisted tab whose project was archived or removed since the last session
is dropped visibly (or shown disabled with a reason), never restored as a
ghost that errors on click, and never allowed to crash the restore of its
siblings.

## A tab is a handle, not a runtime

The working set stays affordable only if opening a tab is nearly free. A tab
holds a project key plus lightweight view state; it must **not** boot the
project's machinery — no scan, no index build, no watcher spawn, no full
data hydration — merely for being open. Heavy per-project resources belong
to the layer that needs them, acquired when the project is *actively viewed
or worked*, and every resource a tab activation does acquire names what
releases it — on tab close, on switch-away, or on an idle timeout
([creation names its reaper](../../_laws.md#creation-names-reaper)). The
failure mode this prevents is the working set with a hardware ceiling: six
tabs fine, ten tabs and the machine pages — which quietly teaches the
operator to keep the set small, defeating the feature's purpose.

The same boundary gives closing its meaning: **closing a tab edits the
working set and nothing else.** It does not archive the project, stop its
watchers, or discard its per-project state beyond the view residue the tab
itself owned. A tab is the operator's attention, not the project's
lifecycle; the two must not share a control.

One deliberate exception exists, and it must stay deliberate: a **workbench
tab** — one that represents a live working session on the project (a build
in progress, a running preview) rather than a management view of it — *does*
own a lease, and closing it is that lease's named reaper: the session stops,
explicitly, as part of the close. The distinction to preserve is that each
tab strip is one kind or the other by design, never per-tab by accident; a
portfolio strip where some closes are free and some kill processes is a
control whose meaning the operator cannot predict. Workbench tabs also earn
a stronger restore: when the underlying session outlives the front end (a
crash, a reload), reopening the tab **re-attaches to the still-running
work** rather than rebooting it — the tab was always a handle; the runtime's
survival is what proves it.

## Tabs are a status surface

The tab strip is the one region visible from *everywhere* in the tool, which
makes it the portfolio's peripheral vision. Each tab therefore carries a
**live status glyph** for its project — working, awaiting input, attention
needed, quiet — so a project can raise its hand while the operator is deep
in another one. Rules that keep this trustworthy:

- The glyph vocabulary is the portfolio's one status vocabulary, not a
  tab-local invention
  ([one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary));
  a tab that says "busy" while the wall says "idle" for the same project
  costs more trust than either surface earns.
- Status updates arrive by the same signal path every other surface reads —
  the tab strip subscribes to the digest; it never polls its projects
  (see [passive-signal-ingestion](passive-signal-ingestion.md)).
- Peripheral means calm: a state *change* may announce itself briefly, but
  a steady state never animates. A tab strip that blinks constantly is
  peripheral vision with a flashlight in it.
- Peripheral also means cheap: the strip subscribes to the **narrowest
  projection** of per-project status — the name and the glyph class, not
  the full live record — because a surface rendered on every screen
  otherwise re-renders on every event any project emits, and the busiest
  project taxes the whole shell.

## Per-project view state, scoped and bounded

Switching back to a tab restores where the operator left off: active
sub-view, selection, scroll, expanded panels. Three rules keep this from
rotting:

- **Scoped by project key.** View state is a map keyed by minted identity —
  never a single shared slot that the last-viewed project happens to fill,
  which is the classic bug where project B opens scrolled to project A's
  position.
- **Residue, not record.** View state is reconstructible convenience,
  clearly separated from durable data. Discarding it must always be safe;
  nothing in it may become load-bearing.
- **Bounded and reaped.** State for projects long absent from the working
  set is expired ([creation names its
  reaper](../../_laws.md#creation-names-reaper)); a view-state store that
  only grows is a slow leak with a UX excuse.
