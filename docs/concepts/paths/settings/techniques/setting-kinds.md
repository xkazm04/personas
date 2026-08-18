---
layer: technique
subject: settings
technique: setting-kinds
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Setting kinds

"Settings" is one storage substrate wearing four different contracts. The
substrate is uniform — keys, values, defaults, audit — which tempts the
design into treating the *keys* as uniform too, and that is how a spend cap
ends up with the same write path, the same validation posture, and the same
casual edit surface as a theme toggle. The kinds differ in blast radius, and
blast radius is what every per-kind rule derives from.

## The taxonomy

| Kind | What it is | Who writes it | Wrong-value blast radius |
| --- | --- | --- | --- |
| **User preference** | taste: theme, density, language, sounds | the user, freely | one annoyed user |
| **Operational config** | machine behavior: endpoints, intervals, concurrency, timeouts | the user or an admin, deliberately | degraded or broken behavior |
| **Safety ceiling** | bounds on autonomous action: spend caps, rate caps, autonomy levels | the accountable human, ceremonially | unbounded machine action |
| **Feature flag** | staged capability: experiments, rollouts, escape hatches | the operator or the release process | inconsistent behavior, stranded states |

The kind is **declared in the registry**, not inferred from the key's name or
guessed at the call site. It is a closed vocabulary with one authority
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)),
and every per-kind behavior — validation strictness, audit weight,
confirmation ceremony — derives from the declared kind, so adding a key means
choosing its kind once, and choosing it is the design review.

## Per-kind contracts

The kinds diverge on five axes; the table is the contract:

- **Default fail direction.** Preferences: any reasonable value. Operational
  config: the conservative value. Ceilings: **closed, always** — the full
  argument lives in [typed-accessors](typed-accessors.md). Flags: off.
- **Validation posture.** Preferences validate for coherence (a legal enum
  member). Operational config validates for *survivability* — a polling
  interval of zero or a concurrency of a million must clamp, because the user
  who typed it was guessing and the store is the last line before the
  scheduler believes it. Ceilings validate provenance as well as range: the
  write path may demand confirmation or authorization, not just a legal
  number.
- **Edit ceremony.** Preferences change with a click and take effect
  immediately. Operational config may warrant an "apply" step or a restart
  notice. Raising a ceiling is a consequential act: it deserves explicit
  confirmation, and in systems with autonomy gates, the *gating* of that act
  belongs to [hitl-approval](../../hitl-approval/hitl-approval.md) — this
  subject stores the value; that subject owns who may move it and how the
  boundary behaves.
- **Audit weight.** Everything is recorded, but ceilings and flags are
  recorded *conspicuously* — surfaced in recent-change views, eligible for
  alerting — because "who raised the cap, and when" is an incident-review
  question, not a curiosity
  ([settings-audit-and-history](settings-audit-and-history.md)).
- **Scope and sync.** Preferences are per-user and travel with the user.
  Operational config is per-installation or per-environment, and copying it
  blindly between environments is a classic incident source. Ceilings bind
  to the accountable scope — the org, the budget owner — and must not be
  widened by a sync mechanism designed for wallpaper choices.

## Boundary cases that test the taxonomy

- **A flag that gates spending** is a ceiling wearing a flag's clothes:
  classify by blast radius, not by data type. Anything whose wrong value
  lets the machine act bigger is a ceiling, boolean or not.
- **Developer/debug toggles** are operational config with a smaller
  audience, not a fifth kind; they follow conservative defaults (off) and
  they still audit — the debug switch left on in production is a recurring
  character in incident reports.
- **Derived limits** ("effective cap = plan cap × user cap") are not stored
  settings at all; storing the product bakes yesterday's factors into a row
  that nothing recomputes. Store the inputs; derive at read.

The payoff of the declared taxonomy is that the store can *enforce* the
differences mechanically. Without kinds, every rule above is a convention
distributed across call sites; with kinds, the write door looks up the key's
kind and applies its contract — one place, all writers, no exceptions.
