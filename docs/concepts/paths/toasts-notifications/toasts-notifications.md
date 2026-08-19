---
layer: golden-path
subject: toasts-notifications
status: forged
techniques:
  - severity-taxonomy
  - queue-discipline
  - actionable-toasts
  - durable-notification-ledger
  - os-escalation
  - announcement-accessibility
evidence:
  - src/stores/toastStore.ts                                          # closed three-tone vocabulary driving dwell, priority, and announcement; priority-ranked eviction (capToasts); healing dedup by issueId
  - src/features/shared/chrome/ToastContainer.tsx                     # max-visible render budget (3) + overflow chip; classifier-supplied navigate-to-fix action gated by isGlobalErrorAction
  - src/features/shared/chrome/useToastTimer.ts                       # attention pauses the clock: hover + hidden-window pause, drift-corrected resume
  - src/stores/notificationCenterStore.ts                             # durable ledger: one commit door, countUnread as the single badge derivation, capped retention
  - src/features/shared/chrome/notifications/NotificationCenter.tsx   # ledger UI: read/unread, per-entry deep-link redirects (retry, open execution, restore chat)
  - src/features/shared/chrome/sidebar/BadgeSlot.tsx                  # priority-ranked badge slot with suppressed-count overflow on stable navigation
  - src/features/shared/components/feedback/AriaLiveProvider.tsx      # persistent polite+assertive regions, single imperative writer, serial burst draining
  - src-tauri/src/notifications.rs                                    # OS + external escalation tier: per-event prefs, per-channel delivery metrics, doors that never throw into callers
  - src/lib/notifications/notifyProcessComplete.ts                    # the correct escalation door: ledger record written unconditionally outside the OS try
  - src/lib/errors/errorActionNav.ts                                  # toast actions carry full addressing; context-requiring actions excluded from global surfaces
  - src/lib/silentCatch.ts                                            # the upstream routing door (toastCatch) — error-handling decides what arrives here
counter_evidence:
  - src/features/overview/sub_observability/components/AlertToastContainer.tsx   # a second, independent toast stack with a forked tone vocabulary, no attention pause, no live region
deviations:
  - w3-toasts-notifications   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Toast & notification feedback

Some messages belong to the surface that produced them: a field's validation
error renders beside the field, a failed list load renders where the list
would be. That is **in-band** feedback, and it is the neighboring subject's
domain ([async-ui-states](../async-ui-states/async-ui-states.md)). This
subject owns everything **out-of-band**: messages that must reach the
operator *regardless of where they are looking* — because the surface that
caused them is gone, because no surface caused them at all, or because the
event outranks whatever the user is currently doing. A save confirmation
after the dialog closed, a background job that finished, a credential that
expired overnight, a connection that dropped mid-session.

The boundary is bright and worth stating as a rule: **if the user is looking
at the thing the message is about, the message belongs on the thing; if they
may not be, the message must travel.** Products that blur this send toasts
for field errors (feedback divorced from its cause, gone before the user
reads the field) and inline banners for background completions (news posted
where nobody is standing). Both directions are the same mistake — the
message shipped through the wrong channel for its relationship to the
user's attention.

The blur has an economic cause worth naming, because exhortation does not
fix it: the toast will be over-used **in exact proportion to how much
cheaper it is to reach than its alternatives**. A global one-call helper
with no state, no props, and no layout decision competes against an inline
error that costs a state variable, a render branch, and a placement — so
every ambiguous case resolves to the toast, not because it is right but
because it is closer. Measured codebases show hundreds of toast call sites
with dozens delivering field-level diagnoses to the opposite screen corner.
The structural counter is making the in-band path comparably cheap (a form
field primitive with a built-in error slot), not a review rule.

Out-of-band messaging is a *system* with layered tiers — transient toast,
durable ledger, operating-system escalation — and every message flows
through the same small set of decisions: how severe, how long-lived, what
can be done about it, and how far it must travel to be seen.

## One severity vocabulary drives everything

Every message carries a severity from one **closed vocabulary** — a handful
of levels on the order of *info, success, warning, error, critical* — and
that single classification drives every downstream presentation decision:
visual encoding, dwell time, dismissibility, whether the message earns a
durable record, whether it may escalate to the operating system, and how
assertively it interrupts assistive technology.

Two disciplines keep the vocabulary honest:

- **One authority, every consumer derives**
  ([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
  The level set is defined once; the color map, the dwell table, the
  escalation policy, and the announcement mapping all key off it. The
  moment a call site picks a color directly, that site has forked the
  vocabulary — its message will drift out of step the first time the
  taxonomy gains a level or changes a meaning.
- **Level is chosen by consequence, not by vibe.** "How bad does this feel"
  produces a taxonomy where everything is a warning. The assignable
  question is: *what happens if the user never sees this?* Nothing — info.
  They miss confirmation of their own action — success. Something will
  degrade if unaddressed — warning. Something already failed — error.
  The product cannot do its job until a human acts — critical.

The full design of the level set and its presentation mapping is
[severity-taxonomy](techniques/severity-taxonomy.md).

## Transience is a consequence of actionability

The most common design error in this domain is choosing transient vs
persistent by *severity aesthetics* ("errors feel important, make them red
and let them linger a bit longer"). The correct axis is **actionability**:

> **A message that requires the user to do something must not evaporate.**

A transient toast is a legitimate channel only for messages whose entire
job is *awareness* — the operation succeeded, the sync finished, a
low-stakes background fact. If the message carries an obligation — re-enter
credentials, review a failure, approve a request — then auto-dismissal is
the system destroying its own demand while claiming to have delivered it.
The user who glanced away for four seconds now carries an obligation they
were never told about, and the system believes it told them.

So the decision table is:

| | Awareness only | Action required |
|---|---|---|
| Presentation | transient toast, auto-dismissed | persistent until acted on or explicitly dismissed |
| Durable record | optional, by severity | **mandatory** — the obligation must survive the toast |
| If missed | no harm — the ledger has it if it mattered | not possible *by construction*: the message waits |

"Persistent" does not have to mean "a toast that never leaves" — pinning
undismissed obligations to the screen forever converges on a wall of stale
demands. The senior structure is **hand-off**: the transient layer shows
the message, and when its dwell expires unacted, the obligation *remains
alive* in the durable ledger with an unread marker that keeps claiming
attention until resolved. Evaporation of the pixels is fine; evaporation of
the demand is the defect.

## The queue is a designed system

Toasts arrive concurrently — a burst of background completions, a failure
storm from one dead dependency — and an undesigned toast layer degrades
into a stack of divs racing each other off screen. The transient layer is a
**queue with policy**:

- **Max visible** — a small fixed number on screen; the rest wait. Twelve
  simultaneous toasts communicate less than two.
- **Dwell per severity** — read time scales with consequence; success
  confirmations leave quickly, errors linger. Timers pause while the user
  hovers or focuses the message: attention resets the clock, because
  dismissal-under-the-cursor is the system snatching back what it was
  handing over.
- **Dedup and coalescing** — the same failure repeating does not earn N
  toasts; it earns one toast with a count. Identity comes from the
  message's *semantic key* (kind + subject), never its display position
  ([identity-survives-reuse](../_laws.md#identity-survives-reuse)).
- **Overflow policy** — when the queue outruns the screen, the system
  degrades deliberately: collapse to a summary ("N more notifications"),
  drop the lowest severities first, and route the overflow to the ledger
  rather than silently discarding it.

Every timer created names its cancellation
([creation-names-reaper](../_laws.md#creation-names-reaper)) — the classic
toast bug family (a dismissed toast's timer firing into a reused slot, a
torn-down surface's timer resurrecting a message) is entirely a reaper
failure. The mechanics are [queue-discipline](techniques/queue-discipline.md).

## A toast is a door, not a dead end

A message worth interrupting the user for is usually worth *acting on*, and
the toast is the moment of maximum context — the user has just been told
what happened and is one gesture away from the remedy. A toast that names a
problem and offers no path to the fix ("connection failed" — now go find
the settings yourself) squanders exactly that moment.

The rule: **any toast about an addressable condition carries one action
that lands the user at the remedy** — retry the operation, open the
failing item, jump to the configuration that needs attention. One primary
action, not a menu; the toast is a doorway, not a workspace. And the
special case that earns its keep everywhere: the **undo toast**, which
converts destructive operations from "confirm first, annoy always" into
"act immediately, offer a recovery window" — the dwell time *is* the
contract, so it must be honored generously and paused on hover like any
other. Design of the affordance, its races (action vs expiry vs
navigation), and the undo window are
[actionable-toasts](techniques/actionable-toasts.md).

## The ledger behind the toasts

The transient layer is a *projection* of events; the **notification
center** is the durable record behind it. Its existence changes what the
transient layer is allowed to do — toasts may be missed *because* nothing
important lives only in a toast:

> **Every message that matters has a durable twin. The toast is the
> announcement; the ledger entry is the fact.**

The ledger carries what transience cannot: read/unread state per entry, an
unread count surfaced as a badge on stable navigation (a count that states
its predicate — *unread*, not *total* —
[count-carries-predicate](../_laws.md#count-carries-predicate)), history
for the operator who was away, and retention with a stated reaper. Toast
and ledger entry share one identity: acting on either resolves both, so
the user never clears the same news twice.

What does *not* enter the ledger is as designed as what does — pure
ephemera (copy-confirmations, micro-acknowledgments) would bury the signal
under ceremony. The admission rule, the read-state model, and retention are
[durable-notification-ledger](techniques/durable-notification-ledger.md).

## Escalation to the operating system

The third tier leaves the application entirely: operating-system
notifications reach the user when the app is backgrounded, minimized, or on
another virtual desktop. This tier is *louder* and *less owned* — the OS
renders it, the OS logs it, the user's system-wide preferences govern it —
so it carries its own rules:

- **It is an escalation, not a mirror.** Only events that justify pulling
  the user back into the application qualify; forwarding every toast to
  the OS trains the user to revoke the permission, which destroys the
  channel for the events that needed it.
- **Focus-awareness is mandatory.** Never OS-notify about something the
  user is currently looking at — if the app is foregrounded and the
  relevant surface visible, the in-app tier suffices. The OS tier exists
  precisely for absent attention.
- **Consent is explicit and granular.** OS notification permission is a
  grant the user extends, per event type where the domain has more than
  one notifying event — a per-event matrix of *in-app / OS / neither*,
  not a single master switch that forces all-or-nothing.

Permission lifecycle, focus detection, dedup across tiers, and click-through
back to the relevant surface are [os-escalation](techniques/os-escalation.md).

## Announced, not just rendered

A toast is, by construction, *away* from where the user is working — which
for a screen-reader user means it may as well not exist unless it is
announced. Out-of-band messages reach assistive technology through **live
announcement regions**, with assertiveness mapped from the same severity
vocabulary as everything else: routine messages announce politely (after
the current utterance), only genuinely urgent ones interrupt. Bursts drain
serially through a persistent region rather than racing; focus never moves
to a toast uninvited; and every transient message remains keyboard-reachable
and keyboard-dismissable while it lives. The mechanics — region lifetime,
politeness mapping, burst draining, and the focus rules — are
[announcement-accessibility](techniques/announcement-accessibility.md).

## Attention is a budget

Every tier of this system spends the same finite resource: the user's
willingness to be interrupted. Overspending is not a neutral cost — it is
compounding debt, because each unjustified interruption raises the user's
dismissal reflex, and the reflex does not distinguish justified from not.
The system-level defenses are the ones above (severity honesty, dedup,
overflow collapse, escalation restraint). The *policy* question — when the
product should initiate contact at all, how proactive outreach is rationed,
and how an agentic system earns rather than assumes interruption rights —
is the sibling subject **proactive nudges** (not yet forged); this subject
supplies the delivery machinery that such a policy spends.

## The techniques

- [severity-taxonomy](techniques/severity-taxonomy.md) — the closed level
  set, consequence-based assignment, and the single mapping from level to
  every presentation channel.
- [queue-discipline](techniques/queue-discipline.md) — max-visible, dwell
  and pause, dedup/coalescing by semantic identity, overflow policy, timer
  ownership.
- [actionable-toasts](techniques/actionable-toasts.md) — the one-action
  door, navigate-to-fix, action/expiry races, and the undo window.
- [durable-notification-ledger](techniques/durable-notification-ledger.md) —
  admission rules, read/unread, badge predicates, retention, and the shared
  identity between toast and entry.
- [os-escalation](techniques/os-escalation.md) — consent lifecycle,
  focus-awareness, per-event channel preferences, cross-tier dedup,
  click-through.
- [announcement-accessibility](techniques/announcement-accessibility.md) —
  live regions, politeness from severity, burst draining, focus and
  keyboard rules.

Upstream of all of this sits the routing decision — *which* failures reach
the user at all — owned by
[error-doors](../error-handling/techniques/error-doors.md): that subject
decides **what** reaches the user; this one decides **how it presents and
how far it travels**. What the user-facing message *says* is
[user-facing-mapping](../error-handling/techniques/user-facing-mapping.md).
