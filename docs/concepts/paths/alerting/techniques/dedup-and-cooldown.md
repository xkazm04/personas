---
layer: technique
subject: alerting
technique: dedup-and-cooldown
status: forged
laws:
  - count-carries-predicate
  - identity-survives-reuse
shared_with: []
---

# Dedup and cooldown

A threshold condition that is true now will, in the overwhelmingly common
case, still be true at the next evaluation tick. Without suppression, every
persisting condition becomes a metronome of identical alerts — one per tick
until someone fixes the disk or mutes the channel, and the channel always
gets muted first. Suppression is therefore not an optimization; it is the
difference between an alerting system and a harassment system.

The general suppression shapes — cooldown, debounce, throttle, hysteresis,
and the state-predicate fifth shape — are owned by the scheduling subject
at [cooldown-and-debounce](../../scheduling/techniques/cooldown-and-debounce.md).
This technique covers what alerting adds: the durable substrate the
suppression must be computed from, and the one architectural failure that
no window survives.

## The substrate: persisted fire history, not process memory

Cooldown is a computation over the question *"when did this rule last
fire?"* — and the answer must come from **durable storage**, never from a
variable in the evaluator's memory. The in-memory version passes every
test and fails in production on a schedule:

- **Restart re-fire storm.** Process restarts (deploy, crash, update) clear
  in-memory last-fired times. Every rule whose condition is currently true
  fires simultaneously on the first tick after restart — a page storm at
  the exact moment the team is doing something delicate.
- **The evaluator moved.** When evaluation migrates between hosts or
  processes (failover, scale-out, the second window), memory does not
  migrate with it; history does.
- **History is the audit.** "Did this fire during the incident?" is
  answered by the fire record, and a record maintained only for suppression
  tends to be the record that exists when the audit question arrives.

So the write order is fixed: **evaluate → check history → persist the fire
→ then deliver**. A fire that was delivered but not persisted is a fire the
system will repeat; a fire persisted but not delivered is recoverable from
the record. Persist first.

## Keys and identity

Suppression is computed **per rule** — and per whatever finer key the rule's
semantics demand (per rule × source, when one rule watches many sources and
their problems are independent). The key question, "what counts as the same
occurrence?", is settled at rule design and is the semantic heart of the
technique; choosing it is covered in the owning technique. What alerting
adds is an identity discipline
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): the
fire history is keyed by the rule's **minted identity**, never by its name
or its threshold tuple. A rename must not orphan the cooldown history, and
— the sharper edge — editing a rule's threshold poses a real question:
does the edit reset suppression? The defensible default is yes for
*material* changes (the author just declared the old firing pattern wrong)
and no for cosmetic ones; whichever is chosen, it is chosen explicitly,
because keying history on the threshold value chooses "yes" silently and
invisibly.

## Count what the cooldown ate

A cooldown window that suppresses nine evaluations of a still-true
condition holds information: *nine*. The suppressed occurrences are
counted against the fire record they deduplicate into
([count-carries-predicate](../../_laws.md#count-carries-predicate) — the
count travels with what was counted: this rule, this window, this
condition), and the next allowed fire says "still failing; 9 suppressed
since last notice". Without the count, a condition that flapped once and a
condition that hammered through an entire cooldown window read identically
in history, and the fatigue analysis that decides which rules to retune
loses its best column.

## The two-evaluator double-fire

The failure that no cooldown window survives: **two evaluators, each
correct, each with its own history view or its own timing**. Two loops that
both see rule R and both believe they own firing will double-page even with
perfect per-loop cooldowns — their windows interleave, and the effective
suppression becomes the phase gap between two schedules that nobody
designed. This arises innocently: a lightweight in-app evaluator ships
first; a deeper backend evaluator arrives later with better data; both stay
enabled because each is individually useful.

The remedy is an **explicit authority rule**, written where both evaluators
can be read: exactly one component may write fire records and trigger
delivery for a given rule (or rule class). The non-authoritative evaluator
is explicitly demoted — it may render live status, it may pre-compute, but
it does not fire. Sharing the persisted history helps (a fire written by
one suppresses the other's window check) but is not sufficient alone, for
two reasons. First, the race: two writers consulting the same history
within one tick interval still double-fire at the boundary. Second — the
insidious one — **a shared cooldown converts disagreement into silencing.**
Two evaluators never compute *exactly* the same predicate for long (their
data windows, scopes, or refresh timing drift apart), and once they share
suppression state, whichever fires first suppresses the other for the full
window — including when the first one fired on the *wrong* data. A demoted
evaluator that still writes fires is not a harmless redundancy; it is a
component that can silence the authority's correct alert with its own
incorrect one. Authority is the invariant; shared history is the mechanism
that makes the demoted evaluator's *display* truthful — never a license to
keep two fire paths alive.

## Decision rules

- Persist the fire before delivering it; recover from "persisted but not
  delivered", never from "delivered but not persisted".
- Cooldown windows are rule data, not code constants — the first noisy rule
  will need its own window, and that must not require a deploy.
- On restart, the first tick consults history like any other tick; there is
  no special-case grace period, because the history makes one unnecessary.
- If two evaluators exist, the code of each names the authority — a comment
  in one file is a start; a runtime assertion or a capability the demoted
  one lacks is better.
- Recovery notifications (condition cleared) have their own, separate
  suppression state — a flapping condition must not bypass cooldown by
  alternating fire and recovery; see [flap-control](flap-control.md).
