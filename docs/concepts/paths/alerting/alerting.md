---
layer: golden-path
subject: alerting
status: forged
techniques:
  - rule-authoring-validation
  - evaluation-loop
  - dedup-and-cooldown
  - flap-control
  - alert-lifecycle
  - escalation-routing
evidence:
  - src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts   # always-mounted 60s loop; overlapping-tick guard; private metric window so the viewed filter can't skew evaluation
  - src-tauri/src/commands/execution/alert_evaluator.rs                       # the NOC authority loop: cooldown from persisted fired_alerts (restart-proof), per-rule scope, fire → persist → incident → event
  - src-tauri/src/commands/communication/observability/alerts.rs              # always-true rules rejected at the create door (non-negative metrics × >= 0)
  - src/stores/slices/overview/alertSlice.ts                                  # severity/metric vocabulary from shared enums with a never-typed exhaustiveness arm; history-fallback cooldown; eval health record
  - src/features/overview/sub_observability/components/AlertHistoryPanel.tsx  # fire history as a queryable, dismissable record
  - src/features/overview/sub_observability/components/AlertToastContainer.tsx # delivery surface consuming fire records — severity mapped onto the one shared palette
counter_evidence:
  - src/features/overview/sub_observability/libs/useObservabilityData.ts      # measured third evaluator: fires evaluateAlertRules() off the tab's viewed metrics (range/persona filter), so changing a chart filter can fire and persist an alert
deviations:
  - w5-alerting   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Alerting & thresholds

An alert is a **claim on human attention**: it asserts that someone should
stop what they are doing and consider doing something else. Everything that
does not meet that bar is a log line, a chart annotation, or a status badge —
valuable, but not an alert. This definition is not rhetoric; it is the load-
bearing design constraint of the whole subject. Every decision below — what
rules are allowed to exist, when they may fire, how often they may repeat,
who they may interrupt — derives from the fact that human attention is the
scarcest resource the system spends, and the only one it cannot get back by
retrying.

The subject sits between two neighbors and must not absorb either.
[Health checks](../health-checks/health-checks.md) own *probing*: actively
asking a dependency "do you work, right now?" and classifying the answer.
Alerting owns *rules over measured signals*: a user- or operator-authored
predicate ("error rate above 5% for ten minutes", "queue depth over 1,000")
evaluated against metrics the system is already collecting. A health probe
can feed a metric that an alert rule watches — that is the correct
composition — but the probe's three-state verdict discipline lives there,
and the threshold-crossing discipline lives here. On the other side,
[toasts & notifications](../toasts-notifications/toasts-notifications.md)
own *delivery presentation*: how an interruption looks, stacks, persists,
and escalates to the operating system. Alerting decides **that** and
**when** something fires; the notification subject decides how the firing
reaches eyes. The boundary is the fire record: alerting produces it,
delivery consumes it.

## A rule is a claim that can be wrong at authoring time

Alert rules are data — authored by users, stored, edited, evaluated by
machinery the author never sees. That makes the rule editor a validation
door ([one-validation-door](../_laws.md#one-validation-door)), and the
critical insight is that **a rule can be provably broken before it ever
runs**. A threshold below the metric's floor produces a rule that is always
true; a threshold above its ceiling produces one that can never fire; a
comparison pointed the wrong direction produces an alert that fires on
health and sleeps through failure. Each of these is detectable at the door,
from the rule's own shape plus the metric's known domain — and each is
catastrophically expensive to discover in production instead, because the
always-true rule burns the channel's credibility and the never-true rule
provides fake coverage: the team believes a condition is watched when
nothing is watching. Authoring-time validity — rejection of the impossible,
preview of the probable — is
[rule-authoring-validation](techniques/rule-authoring-validation.md).

## Exactly one evaluator per rule

Somewhere, on some cadence, something walks the enabled rules and asks each
one "true now?" That something must be **singular per rule**. Two evaluators
that can both see the same rule and both fire it are not redundancy — they
are a double-page generator, and worse: their cooldown windows, computed
independently, interleave so that the effective suppression is the *gap*
between two schedules rather than the window anyone configured. If the
architecture genuinely contains two candidate evaluators (a lightweight
in-app loop and a deeper backend authority, say), one of them must be
designated the authority for firing, in writing, in the code of both — and
the other reduced to display or delegated scope. This is the alerting
instance of a general truth: a gate must be one gate. Singularity has a
quieter precondition that authoring supplies: **the rule carries its whole
predicate** — metric, comparator, threshold, window, scope — because any
part left implicit in evaluator code is a part on which two evaluators can
silently disagree, the same stored rule asking different questions in
different places. The loop's mechanics —
fixed cadence, overlap guards, and the private data window that keeps a
user's viewed filter from skewing what the rules see
([gate-sees-target](../_laws.md#gate-sees-target)) — are
[evaluation-loop](techniques/evaluation-loop.md).

## The fire record is durable state, or the cooldown is fiction

When a rule fires, the fire is **written down before it is delivered** — a
durable record carrying the rule's identity, the observed value, the
threshold it crossed, and the moment of crossing. Everything downstream
hangs off this record. Cooldowns are computed from persisted fire history,
never from process memory: an in-memory "last fired at" evaporates on
restart, and the restart re-fires every currently-true rule at once — a
paging storm at exactly the moment (a deploy, a crash recovery) when the
team is least able to absorb it. The fire record is also the audit trail
("did this rule fire last Tuesday?"), the fatigue dataset ("which rule fires
most?"), and the deduplication substrate. Suppression semantics —
per-rule cooldowns over that history, and the double-fire problem when
evaluator authority is ambiguous — are
[dedup-and-cooldown](techniques/dedup-and-cooldown.md). The general
suppression shapes (cooldown, debounce, throttle, hysteresis) are owned by
the scheduling subject at
[cooldown-and-debounce](../scheduling/techniques/cooldown-and-debounce.md);
this subject applies them, it does not re-derive them.

## Alert fatigue is the death of the channel

The failure mode that kills alerting systems is not missed alerts — it is
**too many true ones**. A rule that fires forty times a day, correctly, about
a condition nobody acts on trains every reader that alerts are ignorable;
the training generalizes, and the one alert that mattered arrives into a
channel that has already been muted, mentally or literally. Fatigue is
therefore a first-class engineering target, attacked from every layer at
once: at authoring (preview shows the rule *would have fired 200 times last
week* — is that what you meant?), at evaluation (a condition must be
sustained, not merely touched; a recovered condition must cross back through
a stricter band before it may re-fire —
[flap-control](techniques/flap-control.md)), at suppression (cooldowns bound
repetition and the next allowed fire carries the count of what was
suppressed), and at routing (severity decides how loud, and most alerts are
not loud — [escalation-routing](techniques/escalation-routing.md)). The
metric of a healthy channel is not "how much it catches" but **actionability
rate**: the fraction of fires a human did something about. When that number
sinks, the channel is dying regardless of how correct each individual fire
was.

## A fire has a life after firing

Firing is the beginning of an alert's life, not the end. The record moves
through a small, explicit lifecycle — firing, acknowledged, resolved — where
acknowledgment is a human claiming ownership ("seen, mine") and resolution
records *how* it ended: the condition cleared on its own, someone fixed it,
or someone dismissed it as noise. Each terminal kind is signal — a rule
whose fires are routinely dismissed-as-noise is a rule begging for a higher
threshold or deletion, and that judgment is only possible because the
history is queryable. The backlog of open alerts is itself a worked queue,
and working it well is the [triage-queues](../triage-queues/triage-queues.md)
discipline applied to this record type. Lifecycle states, transitions, and
the history as a first-class queryable record are
[alert-lifecycle](techniques/alert-lifecycle.md).

## Severity is a routing decision, not a mood

"Critical" and "warning" are not adjectives; they are **routing
instructions**. A severity vocabulary defined once
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary))
maps each level to a reach: which surfaces show it, whether it interrupts,
whether it penetrates quiet hours, whether it survives being unseen. The
essential asymmetry: evaluation never sleeps — rules are evaluated and fire
records written around the clock — while *delivery* respects human rhythms.
Muting delivery must not mute measurement, or the morning after a quiet
night is indistinguishable from a night where nothing happened. The mapping
of severity to channel and the quiet-hours interplay are
[escalation-routing](techniques/escalation-routing.md); the presentation
mechanics of each channel belong to
[toasts & notifications](../toasts-notifications/toasts-notifications.md).

## The techniques

- [rule-authoring-validation](techniques/rule-authoring-validation.md) —
  threshold semantics; rejecting always-true and never-true rules at the
  door; preview-before-save against recent data.
- [evaluation-loop](techniques/evaluation-loop.md) — one always-running
  evaluator; fixed cadence; overlapping-tick guards; the private metric
  window that view filters cannot skew.
- [dedup-and-cooldown](techniques/dedup-and-cooldown.md) — persisted fire
  history as the suppression substrate; per-rule cooldowns that survive
  restart; the two-evaluator double-fire problem and the authority rule.
- [flap-control](techniques/flap-control.md) — sustained-for durations,
  hysteresis bands, and recovery notifications; why edge-triggering comes
  before any cooldown.
- [alert-lifecycle](techniques/alert-lifecycle.md) — firing → acknowledged →
  resolved; resolution kinds as signal; alert history as a queryable record
  with a named retention.
- [escalation-routing](techniques/escalation-routing.md) — severity as a
  routing vocabulary; reach per level; quiet hours muting delivery but never
  measurement.
