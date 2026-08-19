---
layer: technique
subject: usage-analytics
technique: privacy-scrubbing
status: forged
laws: [one-validation-door]
shared_with: []
---

# Privacy scrubbing

Privacy in a measurement pipeline is determined by what the pipeline is
*capable* of leaking, not by what its operators intend. The technique is a
set of structural choices — allowlist at the source, one admission door,
aggregation before egress, silence on opt-out — each of which removes a
capability rather than promising restraint.

## Scrub at the source, admit by allowlist

The only reliable place to remove data is before it exists. A pipeline that
records rich payloads and redacts them downstream has already lost: the raw
data sat in memory, hit a buffer, possibly a local file, possibly a crash
report; every downstream stage is a place the redaction can be forgotten,
reordered, or bypassed by the next integration. The standard inverts the
model:

- **Payloads are built by allowlist.** Each event's registry entry (see
  [event-taxonomy](event-taxonomy.md)) enumerates its permitted fields and
  their types; the emit door copies exactly those fields and drops everything
  else. Unknown keys do not pass. A denylist — "strip anything that looks
  like personal data" — fails open on the pattern nobody anticipated;
  an allowlist fails closed.
- **No free-form text rides in a payload.** User content — names users typed,
  titles, prompts, file paths, queries, error strings containing any of the
  above — is categorically inadmissible, not filtered case by case. The
  admissible types are: identifiers from closed product vocabularies, counts,
  durations, booleans, and enum members. If a question seems to need prose,
  the question is wrong or the vocabulary is missing an enum.
- **One admission door.** Every event, from every call site, passes through
  the single emit function that validates against the registry and applies
  the allowlist
  ([law: one validation door](../../_laws.md#one-validation-door)). A second
  path to the sink — a "quick" direct write, a debug backdoor left on — is
  the hole through which the unscrubbed payload eventually walks.

## Identity: the pipeline should not know who

Product measurement needs to distinguish *sessions* and, at most, count
*distinct installations*; it never needs to know who a person is.

- **No account identity in payloads.** Names, contact addresses, and account
  ids stay out of the measurement stream entirely.
- **Session ids are random and disposable** — minted at session start,
  meaningless outside it, never derived from anything identifying.
- **If a stable installation id is genuinely required** (for "how many
  distinct installations use X"), it is a random value generated locally,
  unlinked to any account, resettable by the user, and it never appears
  alongside data that could re-identify by combination.
- **Beware the quasi-identifier mosaic.** Precise timestamps, fine-grained
  locale, hardware details, and rare-surface visits combine into a
  fingerprint even when no field alone identifies. The defenses are
  coarsening (day-level times, bucketed durations) and the aggregation rule
  below — transmit so little that the mosaic has no tiles.

## Aggregate before egress

The strongest privacy property available is that the behavioral trail
*never exists off the device*. Counters accumulate locally; what leaves is a
session summary — "these surfaces, these counts, these durations" — not a
timestamped event stream (the transmission mechanics are
[batching-and-quota](batching-and-quota.md)). A collector that only ever
receives summaries cannot reconstruct sequence or rhythm, cannot be subpoenaed
for what it never stored, and cannot leak in a breach what it never received.
Where the product can answer its question with local computation alone —
insight rendered on the user's own machine from the user's own data — egress
is not merely minimized but absent, and that option is evaluated first, not
as an afterthought.

## Consent: opt-out is silence

Consent state gates the pipeline at the sink, and the shape of "no" matters:

- **A declined user produces no egress at all.** Not events flagged
  do-not-process — the collector must not learn that the user exists, which
  is itself a datum. Structurally this is the null sink of
  [sink-abstraction](sink-abstraction.md): call sites are consent-blind, and
  the destination choice enforces the answer.
- **Consent is asked in product language** — "share anonymous usage summaries
  to help improve the product" is answerable; a wall of categories is not —
  and the honest answer to "what do you collect" is short *because the
  allowlist is short*. When the true answer is embarrassing to state, the
  pipeline is wrong, not the prose.
- **A consent change takes effect now.** Withdrawal stops the next flush, and
  pending accumulated data for a withdrawn user is discarded, not grandfathered
  out the door.

## The audit is cheap because the surface is small

A quarterly review of this pipeline is one sitting: read the event registry
(closed), the allowlisted fields per event (enumerated), the admission door
(one function), and the sink roster (one seam). That the audit *can* be done
in a sitting is itself the design goal — a measurement system too sprawling to
audit is too sprawling to trust, whatever its policy says.
