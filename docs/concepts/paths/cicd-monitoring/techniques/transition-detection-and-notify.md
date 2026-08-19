---
layer: technique
subject: cicd-monitoring
technique: transition-detection-and-notify
status: forged
laws:
  - identity-survives-reuse
  - failure-not-empty-success
shared_with: []
---

# Transition detection & notify

The remote system stores states; the user needs changes. This technique is
the derivation in between: consecutive snapshots, diffed per entity, emit
transition events — and only transition events reach the notification
layer. State is for rendering; **a notification fired on state rather than
transition re-announces the same failure on every poll**, which trains the
user to disable notifications, which un-monitors the pipeline.

## The detection contract

Keep a **previous-snapshot memory**: for each watched entity, the last
observed status, keyed by the entity's provider-issued identity — never by
list position or name, per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse) (runs get
re-listed, re-sorted, and re-created for the same branch; only the issued
id survives all three). Each poll:

1. index the new snapshot by identity;
2. for every entity present in both: if status differs, emit
   `(identity, from, to)`;
3. entities present only in the new snapshot are *births* (a run appeared
   between polls) — emit as their own class, not as a transition from a
   fabricated previous state;
4. replace the memory wholesale.

**Polling samples; it does not stream.** A run can pass through
pending → running → failed between two polls, and the diff will emit
pending → failed. This is correct behavior, not a bug to engineer away:
classify transitions by their *destination* (entered-running,
entered-success, entered-failure), so a skipped intermediate state changes
nothing the user sees. Any design that needs every intermediate state
observed needs a push channel, not faster polling.

## The cold-start baseline rule

The first snapshot after startup is a **baseline, not news**. Diffing it
against empty memory would announce every visible pipeline as a birth —
the morning burst of déjà vu, re-announced on every app launch. The rule:
first observation per entity populates memory silently. The one deliberate
exception: an entity in a *failed* terminal state on first observation may
surface through a persistent indicator (a red row, a badge) — the display
tier — but not through the interruption tier; the failure is old news that
the display is obligated to show and the notifier is forbidden to replay.
Whether memory persists across restarts or rebuilds from baseline is a
choice; what is not a choice is announcing the diff between empty memory
and the world.

## The failed-poll trap

A poll that fails must yield **no snapshot**, never an empty snapshot, per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success).
Diffing against a failed poll fabricates a world where every run vanished;
the next successful poll then fabricates one where they were all born
again. Both diffs are lies manufactured by the monitor itself. On fetch
failure: keep the previous memory, mark the display stale (data age is
honest state), and count consecutive failures — the monitor's own health
is a monitored signal too, and a monitor that has silently failed to poll
for an hour is worse than none, because it displays green confidence over
dead data.

## Notification identity and class

Each emitted event carries a dedup identity — (entity identity,
destination class) — and a **class** from a small closed set: started,
succeeded, failed, fixed (failure → success, the highest-value class and
the one naive implementations miss). Downstream policy is per-class user
preference: failures interrupt, fixes reassure, successes are usually
display-only, starts are almost never worth an interruption. Two
boundaries with neighboring subjects:

- **Policy and delivery are not this technique's job.** Budgets, quiet
  hours, coalescing across sources, and channel choice belong to the
  nudge/notification subjects (see nudge-identity-dedup for the identity
  doctrine this technique's key feeds into, and os-escalation +
  severity-taxonomy on the toast side). This technique ends at a
  well-identified, class-tagged, preference-filtered event.
- **OS-level escalation is an opt-in capability, requested at opt-in.**
  Asking the operating system for notification permission at surface
  mount — before the user has expressed any interest — burns a one-shot
  prompt on a guess. The permission request belongs in the affirmative
  act of enabling the preference that needs it.

## Decision rules

- Diff on identity, classify by destination, replace memory wholesale —
  no in-place status mutation that loses the `from` side.
- First observation is baseline; only genuine post-baseline changes reach
  the interruption tier.
- A failed poll never updates memory and never produces transitions; it
  produces staleness, visibly.
- `fixed` is a first-class transition class — a monitor that announces
  failures but not recoveries teaches users that red is permanent and the
  monitor is only bad news.
- Per-class preferences are data (persisted, per user), consulted at emit
  time, defaulting to the quiet side for everything except failures.
