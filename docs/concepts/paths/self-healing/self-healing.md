---
layer: golden-path
subject: self-healing
status: forged
techniques:
  - failure-diagnosis
  - strategy-selection
  - blast-radius-bounds
  - effectiveness-accounting
  - auto-rollback
  - incident-promotion
evidence:
  - src-tauri/engine/src/healing_orchestrator.rs      # the decision tree: documented precedence + mutual exclusion in the module doc, pure evaluate(), AI healing dev-gated, storm cap with distinguishable diagnosis
  - src-tauri/engine/src/failure_signature.rs         # signature normalization (uuid/hex/number/whitespace → tokens, length-capped) + recurrence breaker
  - src-tauri/db/src/repos/execution/healing.rs       # confirmed-vs-reverted effectiveness ledger per category; pending-state machine with a deterministic TTL reaper
  - src-tauri/src/engine/auto_rollback.rs             # aggregate error-rate regression rollback: volume floors on BOTH sides, target-health gate, atomic transactional undo, loud (UI event + persisted audit event)
  - src-tauri/db/src/audit_incidents_promoter.rs      # per-source incident promotion, idempotent re-promote, healing misses only — routine successes never surface
  - src/stores/toastStore.ts                          # the dedicated 'healing' toast class: severity-ranked priority, dedupe by issue id, priority-respecting eviction
counter_evidence:
  - src-tauri/db/src/repos/execution/healing.rs       # same ledger, the gap: no unknown lane — attempted = confirmed + reverted, so TTL-expired pendings vanish from the denominator instead of being reported as unmeasured
deviations:
  - w8-self-healing   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-error-handling   # 40/43 Unknown healing issues collapse to one normalized string — the diagnosis layer gone blind upstream (registered under error-handling; cited, not re-registered)
---

# Self-healing & automated remediation

Some failures are cheap to fix by hand and rare enough that automating the fix is
vanity. This subject exists for the other kind: failures that recur at a rate where
human repair becomes a queue, in a system expected to keep working while its operator
is absent. Self-healing is the machine acting on its own diagnosis — it observes a
failed piece of work, decides what change would alter the outcome, applies that
change, and (the step most implementations omit) checks whether it helped.

The boundary with the neighboring subjects is sharp and worth stating first, because
most "self-healing" systems are actually one of the neighbors wearing a costume:

- [Retry & backoff](../retry-backoff/retry-backoff.md) owns replaying the *same*
  request against the *same* world. **Healing begins where retry ends: the fix
  changes something first** — a stale credential refreshed, a wedged session
  cleared, a corrupted piece of state reset, a resource released. If nothing
  changed between attempts, it is a retry, and retry's disciplines (classification,
  jitter, budgets) apply, not these.
- [Error handling](../error-handling/error-handling.md) owns classification. The
  healer *consumes* the failure's category from the single taxonomy authority; a
  healer that re-parses messages to decide what went wrong is a second, drifting
  classifier (see failure-diagnosis).
- [Health checks](../health-checks/health-checks.md) owns remediation affordances
  offered to *human* operators — the "restart this" button next to a red status.
  This path owns the machine pressing the button itself, which changes everything
  about consent, accounting, and blast radius.

## The core stance: healing is a decision, and decisions leave records

The naive design is a reflex arc: pattern-match the failure, fire the fix. It fails
for the same reason reflexive retry fails, but with higher stakes — **a healer does
not merely repeat load, it mutates state.** A wrong retry wastes calls; a wrong heal
leaves the system *different* than it was, in a way nobody chose, at a moment nobody
was watching. Automated remediation is the only subsystem whose failure mode is
*plausible, silent corruption performed with the system's own credentials.*

> **A healer earns autonomy the way a junior colleague does: by diagnosing before
> acting, by touching only what it was told it may touch, by keeping honest records
> of whether its fixes worked, and by escalating when it is out of its depth.**

Five commitments follow, and they are the spine of this subject:

1. **Diagnose before acting.** A failure becomes actionable only after signature
   extraction and category assignment — and the healer states whether it has a
   *diagnosis* (known signature, known cause) or a *guess* (category-level
   heuristic). Permitted aggression scales with diagnostic confidence
   (see failure-diagnosis).
2. **Select exactly one strategy, from a tree with stated precedence.** When two
   strategies match one failure, a documented rule picks the winner; the loser does
   not also run. Two strategies racing on one failure each mutate the state the
   other one diagnosed, and the combination is worse than either alone — often
   worse than doing nothing. Doing nothing is itself a strategy, chosen explicitly
   and recorded with its reason (see strategy-selection).
3. **Enumerate the touchable surface.** What a healer may mutate is an allowlist
   with risk tiers, and the risky tiers — content mutation, generative fixes,
   anything irreversible — sit behind explicit human consent or a development-mode
   gate. A healer whose blast radius is "whatever its code happens to reach" has no
   blast radius, it has a range (see blast-radius-bounds).
4. **Account for effectiveness honestly.** Every attempt terminates in
   *confirmed-fixed*, *reverted*, or *unknown* — per strategy, per failure
   category — and the rates feed back into selection. A healer that never measures
   itself does not stay neutral; it degrades into a noise generator, spending its
   budget re-applying fixes that stopped working while its operators learn to
   ignore it (see effectiveness-accounting).
5. **Watch your own wake, and undo regressions automatically.** A healing change
   is an experiment. If aggregate error rates worsen after the change, the change
   is rolled back by machinery designed at apply time — not improvised during the
   incident the healer just caused (see auto-rollback).

And one meta-commitment over all five: **healing is visible.** Every attempt is
recorded with what was diagnosed, what was selected, what was touched, and what the
outcome was — attributable to the healer as an actor, surfaced where operators
already look, and joined to the work it acted on (the
[audit-logging](../audit-logging/audit-logging.md) discipline applies to machine
actors doubly, because nobody was in the room). Silent healing that works is
invisible maintenance; silent healing that is wrong is silent corruption, and no
healer knows in advance which one it is being.

## The epistemic ladder: confidence gates aggression

The single most useful design device in this subject is an explicit ladder from
what the healer *knows* to what the healer *may do*:

| The healer holds… | It may… |
|---|---|
| a known signature with a verified cause and a fix that has confirmed history | apply the mapped fix autonomously, within its tier |
| a category-level heuristic ("this class usually responds to X") | apply a cheap, reversible, low-tier fix; record it as a guess |
| a generated hypothesis (novel failure, machine-authored fix) | propose — to a human gate, or apply only inside a development-mode sandbox |
| nothing (unclassified, no matching branch) | do nothing, say so, and count the occurrence toward promotion |

Systems drift when action outruns confidence — when the hypothesis lane borrows the
autonomy of the diagnosis lane because the plumbing made it easy. The ladder is a
contract that makes that drift a visible violation instead of a quiet default.

## The lifecycle of one healing attempt

Diagnose → select → check bounds and budgets → apply through the same validated
doors as any other writer → record the attempt → observe the attribution window →
account the outcome → feed the rates back. Two loops close over this pipeline: the
*inner* loop (auto-rollback watching aggregate error rates in the change's wake)
and the *outer* loop (incident-promotion watching for signatures that keep
recurring despite healing — the machine noticing the boundary of its own
competence and handing the case, with its full history, to a human via the
escalation surfaces that [alerting](../alerting/alerting.md) and
[triage-queues](../triage-queues/triage-queues.md) own).

## What "done" looks like for this subject

A remediation layer meets the bar when: every heal is preceded by a recorded
diagnosis carrying a stable signature, a category from the one taxonomy authority,
and an honesty marker (diagnosis vs guess); exactly one strategy runs per failure,
chosen by a tree whose precedence and mutual exclusions are written down; the set
of things the healer may touch is enumerated and tiered, with the dangerous tiers
behind consent that is granular, durable, and revocable; every attempt reaches one
of three spelled-out outcomes and the per-strategy-per-category rates are queryable
by the selection logic and by humans; an aggregate regression in the wake of a
healing change triggers an automatic, pre-designed rollback that is itself
recorded; failures the healer cannot fix get *louder* over time — promoted, deduped
by signature, carrying their healing history — rather than quieter; and an operator
reading the record can answer, without reading source: what did the machine change
while I was gone, why, and did it help?
