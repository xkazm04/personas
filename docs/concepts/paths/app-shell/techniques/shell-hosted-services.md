---
layer: technique
subject: app-shell
technique: shell-hosted-services
status: forged
laws: [creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Shell-hosted services

The shell never unmounts, which makes it the product's service host: the one
place to mount machinery whose lifetime is the session, not a page — event
bridges, connection managers, notification outlets, command palettes, tour
engines, schedulers, telemetry flushers. This technique is the discipline of
hosting: what earns residency, how residents start, in what order, and how
they end.

## The admission test

Shell residency is expensive — every resident runs on every screen for the
whole session — so admission has a test, applied per candidate:

- **Session-lifetime state or side effects.** The candidate holds something
  that must survive navigation: an open connection, a subscription, a queue,
  a timer that must not reset when the user changes sections. Page-lifetime
  work dressed as a service ("mount it globally so we don't have to think
  about cleanup") fails the test — that is leak laundering, not hosting.
- **Cross-section reach.** Its effects are visible or needed from more than
  one section: toasts appear over everything, the palette opens anywhere,
  the connection feeds many pages. A service only one section consumes
  belongs to that section, warm-kept if need be.
- **Exactly one.** The candidate is a singleton by nature. If two instances
  could meaningfully coexist, it is a component, not a shell service.

The resident list is enumerable in one place — a single host region in the
shell where every service is mounted, visible in one reading. Services
scattered through the tree ("this panel also happens to start the sync
loop") make the session's machinery unknowable; the classic symptom is a
side effect that stops when an unrelated page unmounts, and nobody knows
why.

## Two populations: workers and surfaces

Residents split by whether they paint:

- **Workers** — headless: bridges, pollers, flush loops, watchers. They
  mount invisibly, produce no layout, and communicate only through owned
  state and events.
- **Global surfaces** — visible on demand: the notification outlet, the
  command palette, dialogs hoisted to survive their opener, tour overlays.
  They mount permanently but render nothing until summoned, and they render
  at the shell's layer roots so their stacking is governed by the product's
  one layer policy, not by whichever page is up.

The split matters because their failure modes differ: a crashed worker must
not take the frame down with it, and a global surface must not be reachable
only from the page that happened to configure it.

## Start-up: order is declared, readiness is real

Services depend on each other — the event bridge before anything that
subscribes to it, identity/session before anything that acts on the user's
behalf, persisted-state hydration before services that read it. The
discipline:

- **Order is explicit.** The host mounts residents in a declared order that
  encodes the dependency story, readable in one place. Order-by-accident
  (whatever the tree happened to evaluate first) works until a refactor
  reorders siblings, and the resulting bugs — missed early events, reads of
  unhydrated state — are timing-shaped and unreproducible on demand.
- **Ready is a state, not a hope.** A service that consumers depend on
  exposes readiness; consumers that fire during start-up either wait on it
  or their inputs are buffered. The alternative is the silent first-event
  loss: everything works except whatever happened in the first second.
- **Start-up never blocks first paint.** Workers initialize behind the
  shell, not in front of it; a service that needs a slow resource acquires
  it after the frame is interactive.

## Shutdown and the reaper

"Never unmounts" is almost true, and *almost* is where the leaks live. The
session does end — sign-out, workspace or profile switch, app exit — and
some hosts also tear down on hot-replace during development. Every resident
names, at creation, what destroys it and when
([law: creation names its reaper](../../_laws.md#creation-names-reaper)):
subscriptions unsubscribed, timers cancelled, connections closed, queues
flushed or persisted. A service that cannot answer "who stops this?" is a
leak with scheduling.

Two ending classes, kept distinct:

- **Session end** (sign-out, switch): residents flush and reset *user-scoped*
  state completely — the next session must not inherit the previous user's
  queues, marks, or connections. Ordering reverses: consumers stop before
  the bridges they consume.
- **Process end** (quit): best-effort flush with a deadline; anything that
  must survive uses write-ahead persistence during normal operation rather
  than a heroic exit handler.

## Failure containment

A resident's crash is a degraded session, not a dead product:

- Each resident is isolated so its failure cannot unmount the frame or its
  sibling services.
- A dead worker is *known* dead: it reports its failure to the product's
  error channel and, where users depend on its effects, degrades visibly
  (a stale indicator, a reconnect affordance) — a silently absent service
  is indistinguishable from a healthy quiet one, which is the failure mode
  that costs the most to notice
  ([law: failure is not empty success](../../_laws.md#failure-not-empty-success)).
- Restartable residents restart with backoff; non-restartable ones say so.

## The prohibitions, collected

1. No service mounts outside the shell's one enumerable host region.
2. No page-lifetime work admitted as a shell resident.
3. No implicit start order — dependencies are declared where residents are
   mounted.
4. No consumer of a service fires before that service is ready, silently.
5. No resident without a named reaper for every ending class.
6. No worker that dies silently; absence must be distinguishable from
   quiet health.
