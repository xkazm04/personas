---
layer: technique
subject: embedded-preview
technique: dev-server-registry
status: forged
laws: [creation-names-reaper, failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Dev-server registry

Behind every embedded preview is a development server: a long-lived child
process serving the guest on a local port, usually started through a
package-manager wrapper that spawns the real server as *its* child. This
technique is the ownership structure that keeps those servers from
becoming the product's signature leak: **one registry, keyed by project,
that is the only thing allowed to spawn a preview server and the only
thing allowed to kill one.**

## Why a registry, not a spawn call

The naive shape — the preview surface spawns a server when it opens and
kills it when it closes — fails on four fronts at once:

- **duplication**: two surfaces preview the same project (or one surface
  remounts fast) and two servers race for the port; the loser either dies
  confusingly or binds the next port and the frame points at the wrong
  one.
- **orphaning**: the surface unmounts without its cleanup running (crash,
  forced shutdown, code path nobody tested) and the server outlives its
  owner. An orphaned dev server is a port leak with a memory footprint in
  the hundreds of megabytes — and it keeps serving, so tomorrow's preview
  of the same project may silently attach to yesterday's stale process.
- **amnesia**: nothing holds the pid/port/project triple, so nothing can
  answer "what is running right now?" — which is the question both
  debugging and shutdown need.
- **re-entry races**: start requested while a stop is in flight, or
  vice versa, with no serialization point.

The registry is the fix for all four because it is a *single authority
with memory*: an entry per project recording process identity (the whole
tree's root), port, expected origin (consumed by
[origin-validation](origin-validation.md)), state
(starting / ready / unhealthy / stopping), and start time. A request to
preview a project goes through one door: an existing healthy entry is
reused; a starting entry is awaited; only a missing or dead entry spawns.

## Registration is the reaper's contract

Everything teardown will need is recorded **at spawn time, before the
first await** — process identity, port, project key — because the
information needed to kill a process is only reliably available at its
birth ([creation-names-reaper](../../_laws.md#creation-names-reaper)). A
server whose pid was never recorded can only be found later by heuristics
(who owns this port?) that are exactly wrong when two projects' servers
sit on adjacent ports.

Teardown itself is **process-tree termination**: the wrapper the registry
spawned is the parent of the real server, which may parent its own
watchers and compilers; killing the root and walking away leaves the
grandchildren serving. The mechanics — tree enumeration, kill escalation,
reaping, platform differences — are
[subprocess-lifecycle](../../subprocess-lifecycle/subprocess-lifecycle.md)'s
charter, canonically its
[termination-and-reaping](../../subprocess-lifecycle/techniques/termination-and-reaping.md)
technique; the registry's duty is to *invoke* that discipline on every
exit path:

- explicit stop (user closed the preview, switched projects);
- replacement (restart after crash or port conflict — kill fully before
  respawning, never overlap two servers for one project);
- host shutdown — the registry drains itself, killing every entry, as a
  blocking step of product exit. This is the path that separates products
  that leak servers from products that do not, because it is the path
  that runs when nobody is watching;
- startup reconciliation — on boot, the registry assumes nothing it
  remembers is alive (the host may have crashed past its drain) and
  verifies or discards stale entries rather than adopting them blind.

## Ready means serving the application, not owning the port

The gap between "the process started" and "the guest renders" is long and
full of impostors: the port accepts connections while the bundler is still
compiling; the server answers with an error page; a *different* process
already owned the port and the spawn failed silently behind it. The
registry therefore gates the frame on a **real readiness probe** — an
actual request to the served application answering with something the
application would serve — and only a passing probe flips the entry to
ready and hands the frame its URL
([gate-sees-target](../../_laws.md#gate-sees-target): probe the thing the
frame will consume, not a proxy for it). The probe has a deadline and a
verdict: a server that never becomes ready is *declared failed*, killed as
a tree, and surfaced to the user with the server's own output attached
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
the alternative is the eternal loading frame, this subject's most common
user-visible defect.

Readiness is not permanent. Long-lived entries get a cheap periodic or
on-focus health re-probe, because dev servers die of their own causes
(out of memory, a crash in a watcher) while the registry's state still
says ready; a failed re-probe moves the entry to unhealthy and the
surface offers a restart rather than rendering a dead frame.

## Ports are allocated, recorded, and never guessed

The registry allocates ports from a scanned range (ask-the-system-for-any
port defeats origin pinning downstream; a fixed single port defeats
multiple projects), records the allocation in the entry, and treats the
recorded port as the *only* truth about where the guest lives. Every
consumer — the frame URL, the origin validator, the health prober — reads
the entry; nobody recomputes "probably the usual port". One project, one
entry, one port, one origin: the invariant that makes the rest of the
subject's security and protocol story hold.
