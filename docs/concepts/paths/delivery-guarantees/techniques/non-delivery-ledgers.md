---
layer: technique
subject: delivery-guarantees
technique: non-delivery-ledgers
status: forged
laws:
  - failure-not-empty-success
  - one-authority-per-vocabulary
shared_with: []
---

# Non-delivery ledgers

Most events that go unprocessed were not dropped by a bug. They were gated by
a disabled subscription, filtered by a predicate, suppressed as duplicates,
deferred by a quota, skipped because their target was paused, expired past a
staleness bound. Each of those is a *correct* decision — and each one, made
silently, is indistinguishable from the bug it isn't. The operator's question
is always the same: **"I sent the event; where did it go?"** — and a pipeline
that cannot answer it converts every deliberate skip into an investigation.
The technique: every accepted event that will not be processed writes a
**typed reason** at the moment of the decision, into a ledger an operator can
query. Silence and skip must be spelled differently (law:
failure-not-empty-success — the deliberate no and the accidental nothing are
different facts and must produce different records).

## Typed reason tokens, never prose, never null

The reason is a token from a closed vocabulary — one authoritative enum, every
writer and every display deriving from it (law: one-authority-per-vocabulary).
Three properties make tokens the load-bearing choice:

- **Groupable.** "Show me skip counts by reason for the last day" is the
  operator's first query; free-text reasons make it string forensics, and a
  null reason column makes it impossible. NULL is the one value banned
  outright: a null reason asserts "not delivered, and we chose not to say
  why," which is the silent drop with a row number.
- **Exhaustive by construction.** Adding a new gate to the pipeline means
  adding its token to the vocabulary — the compiler or validator makes the
  new skip path name itself. Vocabularies grown one incident at a time,
  with a `misc` bucket absorbing the rest, decay back into prose; a `misc`
  share that grows is the vocabulary telling you it is missing a word.
- **Stable for automation.** Alerts key on tokens ("page if
  quota-deferred exceeds N/hour"); tokens must therefore never be renamed
  casually and never carry per-event data inside the token itself — the
  variable part (which quota, which predicate) rides in a detail field
  beside the token, not inside it.

The vocabulary's first cut falls out of who is supposed to act:

| Family | Examples | Actor |
|---|---|---|
| **Policy** | subscription disabled, target paused, mode excludes it | nobody — working as configured; the record exists to prove it |
| **Filter** | predicate not matched, wrong type for this consumer | sender, if surprised — the record shows which predicate |
| **Duplicate** | already processed under this identity, replay behind the watermark | nobody — the guarantee working (see guarantee-selection) |
| **Resource** | quota exhausted, queue full, load-shed | operator — capacity decision needed |
| **Staleness** | accepted too long ago, moment expired | depends — a burst indicates a stalled pipeline upstream |

## The reason survives the event

Ledger entries outlive the events they explain. The event row may be pruned,
the payload may expire, the subscription that gated it may be deleted — the
reason record persists on its own retention, because the question "why did
nothing happen last Tuesday?" arrives *after* last Tuesday's operational data
has cycled out. Practical consequences: the entry denormalizes what it needs
(event type, source, target, timestamp, token, detail) rather than joining to
rows that may be gone; and its retention is set by audit horizon, not by
storage convenience.

One distinction deserves first-class treatment in the schema, borrowed from
the sibling ledger for time-driven work
([schedule-observability](../../scheduling/techniques/schedule-observability.md)):
**replayable versus consumed.** Some skips leave the event replayable — the
gate can be lifted and the event re-offered (disabled target, quota window).
Others consumed the moment — a staleness expiry or a superseded edit cannot
meaningfully re-run. The ledger marks which kind each token is, because the
operator's follow-up differs completely: "re-enable and redrive" versus
"acknowledge and move on." A ledger that cannot say which skips are
recoverable answers *where did it go* but not *can I have it back* — half
the question.

## Decision rules

- **Write the reason at the decision site, atomically with the decision.**
  A skip recorded by a later sweep ("infer why these events went nowhere")
  reconstructs; reconstruction guesses; guesses about non-delivery are the
  original problem restated. The gate that says no writes the row that says
  why — one door per decision, not a shadow accounting.
- **Ledger the classes that are questions, sample the ones that are noise.**
  Policy and resource skips are always ledgered — they are the ones humans
  ask about. Per-event duplicate suppressions in a high-volume stream may be
  counted (by token, with the count carrying its predicate) rather than
  written row-by-row; aggregation is a volume decision, never a "this reason
  doesn't matter" decision. Every token is either ledgered or counted —
  no third, silent tier.
- **Expose the ledger where the sender looks, not only where the operator
  does.** Half the value is deflection: a sender who can see "delivered ·
  skipped (filter: type mismatch)" next to their event stops filing the bug.
  The ledger is a product surface, not just a forensic table.
- **Dead-lettering is not a ledger entry — it is a state.** The ledger
  records *decisions not to process*; the dead-letter lane holds *failures
  to process* that still await a verdict (see dead-letter-design). The two
  meet only at expiry: a dead-letter record aging out unresolved writes its
  final ledger entry, so even the abandoned failure leaves a reason behind.
