---
layer: technique
subject: agent-chaining
technique: handoff-payload-contracts
status: forged
laws:
  - one-validation-door
  - count-carries-predicate
  - failure-not-empty-success
shared_with: []
---

# Handoff payload contracts

The arrow's second meaning — after "start B when A finishes" — is "carry
this across." What crosses a handoff is the chain's data plane, and left
undeclared it converges on one of two failures: unbounded growth as every
link appends and forwards, or silent loss of the one field downstream
needed. The technique: the payload is a **declared, bounded, stamped
envelope**, the same shape at every handoff in the system.

## Three compartments, declared

A handoff envelope has three parts with different owners and different
growth laws:

- **Output** — what the upstream link produced; the thing the arrow exists
  to forward. Owned by the emitting link; replaced wholesale at each hop.
- **Context** — what the chain accumulates across links: the original
  request, decisions made upstream, artifacts referenced. Owned by the
  chain; grows unless governed, which is why it needs the strictest rules.
- **Provenance** — who produced this and where in the chain: emitting agent,
  link identity, chain identity, depth, the edge that fired. Owned by the
  chaining machinery itself; the receiving agent may read it, never write
  it. Provenance is what lets a mid-chain link answer "who told me this?"
  without trusting the payload's own claims.

Declaring the compartments is not bureaucracy — it is what makes the next
two sections possible. An envelope that is "whatever the upstream code put
in a dictionary" can be neither bounded nor validated, because nobody can
say what is load-bearing.

## Bounds, and where truncation happens

Every compartment has a size bound, and the bound is enforced **at the
emit site, explicitly**, not wherever the transport happens to choke. The
distinction matters because the two failure modes read completely
differently downstream. Transport-choke truncation is silent corruption: a
payload cut at a byte boundary mid-structure, a handoff that fails for
reasons invisible at either end, a chain that works in testing and dies in
production when outputs grow. Emit-site truncation is a *decision*: the
oversized compartment is reduced by a stated policy (tail-truncate the
output, drop the oldest context entries, summarize — whichever the design
chooses), and the envelope records **that truncation occurred and what the
original size was** ([count-carries-predicate](../../_laws.md#count-carries-predicate):
"output, truncated from N" is honest; a short output that was silently cut
is a lie downstream will act on).

The context compartment deserves the special rule, because it is the one
with a growth law: **forwarding context is a copy with a budget, not an
append into a shared blob**. Each link decides what context continues, and
the budget forces the decision. A chain where context grows monotonically
fails at the worst possible place — several links deep, in the middle of
the run that finally exceeded the bound.

## The receiver validates at one door

The downstream agent does not spelunk a foreign dictionary. The envelope is
parsed and validated at one entry point before the link starts
([one-validation-door](../../_laws.md#one-validation-door)) — required
compartments present, provenance well-formed, sizes within bounds. Two
outcomes need distinct spellings
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
*the output compartment is legitimately empty* (upstream ran and produced
nothing — the chain may still continue, subject to conditions) versus *the
envelope is malformed* (the handoff itself is broken — the link must not
start as if handed an empty task, because "agent B ran on a blank input" is
far harder to diagnose than "handoff rejected: malformed envelope"). A
malformed envelope is a chain stop with its own typed reason, not an
improvised run.

## Provenance is stamped by the machinery, not the participants

The chaining layer — not the emitting agent's own logic — writes the
provenance compartment at handoff time. This is a trust boundary, small but
real: link outputs are model-produced text and structures, and a payload
that can describe its own origin can misdescribe it. Depth counters, chain
identity, and edge attribution must come from the machinery that actually
observed the handoff, because the cycle guards and the rollups
(cycle-and-depth-guards, chain-identity-and-rollup — this subject's
neighboring techniques) key on them; a guard that reads a depth the
payload's author could have written is a guard the payload's author can
disarm.

## Decision rules

- One envelope schema system-wide; an arrow never invents its own shape.
- Output replaced per hop; context copied forward under budget; provenance
  machinery-written and participant-read-only.
- Bounds enforced at emit, with truncation recorded (policy + original
  size), never discovered at transport.
- One validation door on receive; malformed-envelope is a typed stop, not
  an empty-input run.
- The envelope is inspectable after the fact: what crossed each handoff is
  part of the chain's durable record, because "what did B actually
  receive?" is the first question every chain debugging session asks.
