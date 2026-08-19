---
layer: technique
subject: toasts-notifications
technique: os-escalation
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# OS escalation

The in-app tiers reach a user who is *in the app*. When the news justifies
pulling someone back — the long job finished, the pipeline they watch
failed, an approval blocks a teammate — the message escalates to
**operating-system notifications**: rendered by the platform, delivered to
the desktop or lock screen, alive while the app is backgrounded, minimized,
or on another workspace. This tier is the loudest and the least owned —
the platform controls its look, its sound, its grouping, and the user's
system-wide settings can silence it entirely — and both properties shape
every rule below.

## Escalation, not mirroring

The OS tier exists for **absent attention**. Forwarding every in-app toast
to it is the fastest way to lose it: users respond to OS-level noise with
the OS-level remedy — revoking permission or muting the app system-wide —
which is a *channel-destroying* event. Unlike an ignored toast, a revoked
permission silences the one event next month that genuinely needed the
lock screen. So admission is strict:

- Qualifying by default: completion or failure of long-running work the
  user initiated and left; conditions blocking other people; critical
  severity.
- Disqualified by default: successes of foreground actions, info-class
  awareness, anything whose remedy can wait for the user's natural return.
- The qualifying set is small enough to enumerate — and it is enumerated,
  in the per-event preference matrix (below), where the user can see and
  veto every kind.

## Focus-awareness

> **Never OS-notify about something the user is currently looking at.**

The decision runs at *send time*, per message: if the application is
foregrounded and the surface relevant to this message is visible, the
in-app tier suffices and the OS tier stays silent. If the app is
backgrounded, minimized, or the user is elsewhere in it, escalate.

- The check is **which surface**, not just "is the app focused" — a
  failure in a subsystem whose panel the user has open needs no OS banner
  even though a different failure at the same moment might.
- Visibility state is sampled when the message fires, not when the
  triggering operation started — the user moves during long operations,
  in both directions.
- The border cases err toward the in-app tier plus the ledger: a
  wrongly-suppressed OS banner still lands in the center with its unread
  badge; a wrongly-sent one spends trust with no refund.

## Consent: explicit, granular, and honestly reported

- **Permission is requested in context** — at the moment the user enables
  something that will want the channel ("notify me when this finishes"),
  never as an ambush at first launch. A permission dialog with no visible
  reason gets denied, and platform permission denials are sticky.
- **Denial is a state the app models, not an error it forgets.** When
  permission is absent or revoked, the app knows, routes affected events
  in-app + ledger, and — where the user has asked for OS delivery of
  something — *tells them* the channel is blocked and where to restore it.
  Requesting, failing silently, and carrying on is delivery failure
  dressed as success
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **Per-event preferences, two channels.** Where more than one event kind
  can notify, the settings surface is a matrix: event kind × {in-app, OS},
  each cell independently on or off. A single master switch forces
  all-or-nothing, and users pick "nothing". Defaults follow the admission
  rules above; the user's cells win over defaults, in both directions.
- The platform's own do-not-disturb regime sits above all of this and is
  respected by construction (the OS enforces it); the app never tries to
  route around it with in-app simulacra of system banners.

## Cross-tier coordination

The OS notification is a third projection of the same event — same
identity as the toast and the ledger entry:

- **Reading in one tier retires the others.** When the user returns and
  views or resolves the event in-app, the corresponding OS notification is
  withdrawn from the platform's notification list; stale banners that
  outlive their news train users to ignore the tray.
- **Click-through deep-links.** Activating the OS notification brings the
  app forward *and lands on the relevant surface* — same addressing
  discipline as toast actions
  ([actionable-toasts](actionable-toasts.md)): full addressing carried in
  the notification, no assumption about what the app was showing.
- **Coalescing extends outward.** A failure storm that the in-app queue
  collapses to one counted toast produces at most one OS notification,
  updated in place where the platform allows, never a banner per repeat.

## Sent means immutable — compose accordingly

An in-app message lives inside the product's rendering loop: a wrong
string, a missing translation, an unbounded detail can all be fixed by the
next paint. An escalated message cannot — once handed to the platform it
sits in the system's notification history exactly as sent, beyond reach of
any later correction. Two disciplines follow:

- **Compose where the language lives.** The title and body must be
  resolved through the product's localization layer *at the moment of
  delivery*. The classic failure is structural, not careless: the event
  originates in a layer (a backend process, a background worker) that has
  no notion of the user's locale, and the text gets composed there as an
  untranslatable literal. Measured in practice this captures the majority
  of escalated messages even in products that enforce translation
  completeness everywhere else — the enforcement gates the catalog, and
  these strings never enter it. Route the escalation through the
  locale-bearing layer, or ship the locale to the composing layer; never
  compose blind.
- **One delivery door.** Multiple independent mechanisms for reaching the
  platform (a plugin wrapper, a raw platform call, a backend-side sender)
  guarantee divergence: different permission handling, different failure
  visibility, and — when an event is observable from two layers — the
  double-notification, which the user reads as a bug. One helper owns
  permission, focus-awareness, the ledger write, and failure reporting;
  when an event is visible to both a backend and a frontend layer, one of
  them is named the notifying authority and the other explicitly declines.

## The platform is a dependency, not a given

Delivery through the OS tier can fail for reasons the app never sees —
permission changed behind its back, notification daemons absent, platform
quotas. Treat the send as a fallible call with a result: log or telemeter
failures, and never let an OS-tier send failure take the in-app tiers down
with it. The layering means every escalated message *already* has a toast
and a ledger entry — the OS tier is additive reach, and its failure
degrades reach, never the record.
