---
layer: technique
subject: scheduling
technique: cooldown-and-debounce
status: forged
laws:
  - count-carries-predicate
shared_with: []
---

# Cooldown and debounce

Triggers that evaluate conditions or react to event streams face a rate problem the
clock family never has: the stimulus can arrive far faster than the reaction is useful.
A disk-space check that alerts every 30 seconds while the disk stays full, a file
watcher that fires per keystroke of a save, a flapping health check that alternates
alarm and recovery — each is technically correct and operationally destructive.
Suppression is therefore a first-class part of trigger semantics, with named shapes,
not an if-statement someone adds after the first bad night.

## The four shapes

| Shape | Semantics | Use for |
|---|---|---|
| **Cooldown** (rate limit per key) | after a fire, suppress further fires for the same key for a window | alert-like reactions to persisting conditions |
| **Debounce** (trailing quiet period) | fire only after the stimulus has been quiet for a window; each new stimulus restarts the wait | bursty inputs where only the settled state matters (batch of changes → one reaction) |
| **Throttle** (leading + window) | fire immediately, then at most once per window while stimulus continues | progress-style reactions where freshness matters but every occurrence does not |
| **Hysteresis** (dual threshold) | enter the fired state at threshold A, leave it only at stricter threshold B | flapping conditions oscillating around a single threshold |

Debounce delays and coalesces; throttle keeps first-response latency at zero; cooldown
bounds repetition; hysteresis prevents state oscillation. They compose — an alerting
pipeline commonly wants edge-triggering + hysteresis at evaluation, then a cooldown at
dispatch.

**A fifth shape beats time windows whenever the reaction creates a trackable
artifact.** If firing produces something with a lifecycle — an open incident, a queued
notification, a pending task — suppress on a **state predicate** instead of a clock:
"do not fire while a previous occurrence for this key is still open/unresolved."
Resolved, dismissed, and expired occurrences stop blocking the moment they resolve.
This suppresses *more* than any window (the alarm stays quiet exactly as long as it is
already raised) and loses *nothing* (the instant the artifact closes, the next
occurrence may fire) — a fixed window has to be tuned to approximate both properties
and achieves neither at the boundaries. Time windows remain for reactions that leave
no artifact to key on.

## Procedure

1. **Choose the suppression key deliberately.** Cooldown "per item" and "per (item,
   subject)" are different features: one disk-full alert per host needs the host in
   the key. Too coarse a key suppresses distinct problems under one umbrella; too fine
   a key suppresses nothing. The key is the semantic statement of *what counts as the
   same occurrence*.
2. **Persist suppression state with the schedule state.** Last-fired-at per key,
   debounce deadlines, hysteresis side — all survive restart, or every restart opens
   with a burst of re-fires that the suppression existed to prevent. In-memory
   suppression is suppression until the first deploy.
3. **Count what you suppress** (law: count-carries-predicate). A suppressed fire
   increments a counter attached to the key and window — "suppressed 41 fires of
   disk-full/host-7 in this cooldown window" — and the *next allowed* fire carries that
   count. "Still failing, 41 occurrences since last notice" is a materially different
   message from a lone alert, and the count is unrecoverable if not kept at
   suppression time.
4. **Edge-trigger conditions, then suppress the edges.** Evaluate condition triggers as
   transitions (false→true fires, true→true does not); hysteresis defines when the
   state may return to false; cooldown then bounds even the transition rate for
   flapping inputs. Level-triggered evaluation with a cooldown is a siren with a
   snooze button — the shape of the fix is wrong even when the rate looks right.
5. **Make suppression visible and overridable.** The trigger's status surface shows
   "in cooldown until T, N suppressed"; an operator can clear a window manually. A
   suppression no one can see is, from the outside, a trigger that mysteriously
   stopped working — the observability cost is paid either in the status surface or in
   the incident channel.

## Decision rules

- Reaction is a *notification* → cooldown (+ hysteresis if the input flaps). Reaction
  is *work over accumulated input* → debounce. Reaction is *keeping something fresh* →
  throttle.
- Debounce needs a max-wait ceiling: continuous stimulus must not defer the fire
  forever — a debounce without a ceiling is starvation with good intentions.
- If two layers both suppress (evaluator and dispatcher), each records its own
  decisions; a fire that vanished must be attributable to exactly one window at
  exactly one layer.
- Tuning belongs in data (per-item windows), not in code — the first false-negative
  incident will demand a different window for one noisy item, and redeploying to
  change a number teaches the wrong lesson.
