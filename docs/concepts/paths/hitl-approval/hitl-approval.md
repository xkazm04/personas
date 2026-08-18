---
layer: golden-path
subject: hitl-approval
status: forged
techniques:
  - gate-state-machines
  - consent-gates
  - review-queues
  - unattended-mode
  - decision-records
  - resume-after-decision
evidence:
  - src-tauri/src/engine/build_session/gates.rs                 # per-capability Closed→Pending→Open FSM enforced in code because the model treats the prompt rule as advisory; intent-derived auto-open; batched question synthesis
  - src-tauri/db/src/repos/communication/manual_reviews.rs      # CAS single-winner verdict flip (lost CAS = loud conflict); resolved_at record; verdicts feed the learning loop; keyset-paginated queue + predicate counts
  - src-tauri/src/commands/tools/triggers.rs                    # resolve_pending_trigger_fire — only the CAS winner publishes the held event; unattended mode auto|dry_run|approval set per trigger
  - src-tauri/src/engine/pipeline_executor.rs                   # per-node approval gate; wait-indefinitely poll (the 1-hour cap force-rejected overnight approvals and was removed)
  - src-tauri/src/companion/dispatcher.rs                       # ALLOWED_ACTIONS allowlist → approval rows; read-only ops auto-fire by design; every write capability requires approval, locked by test
  - src-tauri/engine/src/autonomy.rs                            # the one front door for "may this act unattended" — 13 named actions, fail-closed reads, precedence unit-tested
  - src/features/triggers/sub_triggers/PendingTriggerApprovals.tsx  # the pending-fires decision surface
  - src/features/triggers/sub_triggers/UnattendedModeSection.tsx    # the per-trigger autonomy dial UI
counter_evidence:
  - src/features/shared/components/overlays/FirstUseConsentModal.tsx  # re-opened consent gate initializes from defaults and overwrites a stored refusal on Accept — the re-ask defect the consent technique exists to prevent
deviations:
  - w2-hitl-approval   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Human-in-the-loop approval

An autonomous system earns its autonomy by knowing when to stop. Human-in-the-
loop approval is the discipline of pausing a machine at a consequence boundary
and handing the decision to a person — and the design of the pause matters as
much as the design of the action. Done well, the mechanism concentrates human
judgment exactly where it changes outcomes. Done carelessly, it degrades into
one of two failure states that look nothing alike and are equally fatal: a
prompt the machine can talk its way past, or a click the human performs without
reading. Everything in this subject exists to prevent those two endings.

The subject owns **two flows that are mirror images of each other**:

- **The review flow** — the machine has *produced* something (a draft, a plan,
  a change set) and a human evaluates the output before it takes effect.
  The gate sits between production and effect.
- **The consent flow** — the machine *wants to act* and asks the human for
  authorization before execution: first use of a new capability, an action
  with disclosed impact, a step beyond the granted autonomy level. The gate
  sits between intent and execution.

Review gates output after it exists; consent gates action before it happens.
They share everything that matters — the pending state, the decision surface,
the durable record, the continuation — which is why they are one subject and
not two. A system that builds them separately builds the same machinery twice
and then lets the two copies disagree about what a decision means.

## When a gate is mandatory

Not every action deserves a gate — most must not have one, or the mechanism
dies of fatigue (below). A gate is *mandatory* when any of these hold:

- **Irreversibility.** The action cannot be undone at acceptable cost:
  deletion, sending, publishing, signing, overwriting the only copy. The gate
  is the last moment the mistake is free.
- **Spend.** The action commits real resources — money, quota, paid capacity.
  Budgets are a human contract; the machine executes them but does not get to
  extend them.
- **External visibility.** The action's effect leaves the boundary of the
  system: a message to a third party, a post, anything a customer or outsider
  will see. Inside the boundary, errors are bugs; outside, they are incidents.
- **Low confidence or first exposure.** The machine is doing something novel —
  a capability never used before, an instruction it is unsure it understood, a
  situation outside its trained competence. Novelty is a risk signal even when
  the action class is otherwise safe.

The complement is equally load-bearing: **actions that cannot change the world
need no gate**. Reads, previews, dry runs, and queries are exempt *by design*,
not by oversight — gating them spends the human's attention budget on events
where their judgment cannot matter. A correct gate map is mostly white space.

## The gate lives in the substrate, not the prompt

Telling the machine "always ask before deleting" is a request, not a gate. A
gate is only real when it lives in the layer that *executes* the action — when
the action's sole path to effect passes through a structural checkpoint that
inspects recorded state, and no output the machine produces can move that state
by itself. The distinction is not pedantic; it is the whole mechanism. A
prompt-level gate holds exactly as long as the machine behaves, and the
scenario the gate exists for is the one where it doesn't — misunderstanding,
hallucinated authority, injected instructions, or plain drift. A gate the
gated party can open is a decoration
([gate-sees-target](../_laws.md#gate-sees-target)).

Two corollaries:

1. **Transition authority is separated from work authority.** The identity
   that produces the work cannot be the identity that approves it. In code
   terms: the decision write comes from the decision surface, authenticated as
   the human, and the executor verifies the recorded state — never a claim of
   approval carried in the requester's own message.
2. **The human decides on the real thing.** The decision surface shows the
   actual content, diff, or disclosed impact — not a summary produced by the
   same untrusted process being gated. A summary written by the gated party is
   the fox describing the henhouse door.

## Anatomy of a gate

Every gate, in either flow, has five parts; skipping any one of them produces
a recognizable defect.

| Part | What it is | Defect when missing |
| --- | --- | --- |
| **Trigger predicate** | the condition that arms the gate — action class, threshold, first-use, confidence | gates fire arbitrarily, or everything is gated |
| **Pause state** | a durable pending record; the system survives restart while waiting | a crash while pending silently loses the question |
| **Decision surface** | where the human sees pending items, with enough context to decide in place | decisions stall, or are made blind |
| **Decision record** | who decided what, when, on which version, having seen what | approvals cannot be audited or bounded |
| **Continuation** | approve → resume; reject → cleanup; timeout → policy | approved work re-runs from scratch, rejected work lingers as a zombie |

The pause deserves emphasis because it is the part naive implementations get
wrong first: a pending decision **must be durable state, not a live process
blocked on an answer**. Humans answer in minutes, hours, or days. Any design
where the question exists only in a running process's memory has decided that
a restart, a deploy, or a crash silently discards the question — and a
discarded question defaults to whatever the code does next, which is never a
decision anyone made.

## The decision is a record, not an event

An approval that exists only as a state flip is unauditable and unboundable.
The decision is a first-class durable record: **who** decided, **what verdict**,
**when**, on **which exact version** of the gated thing, having been shown
**what disclosure**. From this record two properties follow that the whole
mechanism depends on:

- **Approval binds to what was approved.** If the gated content changes after
  the verdict, the approval is void and the gate re-closes. Approval of
  version N is not approval of version N+1, however small the diff.
- **Approval does not travel.** A verdict is a fact about one (actor, action,
  target, version, context) tuple. Approval in one context does not extend to
  the next occurrence, the next target, or the broader category — unless a
  consent rule *explicitly* grants that scope, recorded as such. Silent scope
  creep is how "I approved one message" becomes "it has been sending messages
  for a week".

The full treatment — record shape, immutability, reuse boundaries, learning
from rejections — is the [decision-records](techniques/decision-records.md)
technique.

## Gate fatigue is the failure mode that kills the mechanism

Every prompt for human judgment debits a finite attention budget. When the
budget is overdrawn, the human does not stop approving — they stop *reading*,
and click approve reflexively. At that point the mechanism is dead while every
metric says it is healthy: gates fire, decisions are recorded, the audit trail
is immaculate, and no judgment is occurring anywhere in it. A rubber stamp is
worse than no gate, because it manufactures accountability for decisions
nobody actually made.

Fatigue is a *design* failure, not a user failure, and every technique in this
subject carries part of the countermeasure:

- **Tier by consequence.** Gate the four mandatory categories; exempt reads
  and reversible acts; let everything in between earn a gate with evidence.
- **Remember decisions with explicit scope.** First-use consent that is
  recorded and honored means the second use asks nothing
  ([consent-gates](techniques/consent-gates.md)).
- **Batch the homogeneous.** Twenty items of identical shape and risk are one
  decision, not twenty ([review-queues](techniques/review-queues.md)).
- **Make the opt-out honest.** When an operator genuinely wants the machine to
  run ungated, an explicit, scoped, expiring, audited unattended grant is the
  truthful form of that trust — reflexive approval is the dishonest form of
  the same thing ([unattended-mode](techniques/unattended-mode.md)).
- **Learn from verdicts.** A gate whose approvals run near 100% for months is
  measuring nothing; its trigger belongs at a higher threshold. Rejection
  reasons are the highest-signal input for tuning triggers.

## Defaults are part of the design

Three defaults recur, and each has exactly one safe direction:

- **Closed by default.** New capabilities, new action classes, and unknown
  requests start gated (or denied), and openings are enumerated — an
  allowlist, not a blocklist. A blocklist gates yesterday's risks.
- **Timeout is deny or hold, never proceed.** A pending decision must not be
  immortal — it expires on a named schedule
  ([creation-names-reaper](../_laws.md#creation-names-reaper)) — but expiry
  resolves to the safe verdict. "Nobody answered, so it went ahead" is the
  mechanism executing the exact outcome it was built to prevent.
- **A failed decision write is a failure, not a decision.** If recording the
  verdict fails, the gate stays closed and the surface says so; the one thing
  the mechanism may never do is let a lost write be indistinguishable from a
  verdict ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).

## The techniques

- [gate-state-machines](techniques/gate-state-machines.md) — the gate as
  enumerated, durable state on the gated entity; transitions only a human can
  drive; approval invalidation on change.
- [consent-gates](techniques/consent-gates.md) — the machine-asks-human flow:
  first-use consent, informed consent with impact disclosure, the autonomy
  dial, revocation.
- [review-queues](techniques/review-queues.md) — one surface for pending
  judgment: context to decide in place, batch verdicts, write-back
  reliability, queue hygiene.
- [unattended-mode](techniques/unattended-mode.md) — the explicit opt-out:
  scoped, expiring, audited auto-approval that goes *through* the gate rather
  than around it.
- [decision-records](techniques/decision-records.md) — the durable verdict:
  who/what/when/why/what-was-shown, immutability, and the reuse boundary.
- [resume-after-decision](techniques/resume-after-decision.md) — the
  continuation half: approve→resume without re-generation, reject→cleanup
  without zombies, staleness checks at resume time.
