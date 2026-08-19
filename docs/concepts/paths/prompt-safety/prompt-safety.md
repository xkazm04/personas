---
layer: golden-path
subject: prompt-safety
status: forged
techniques:
  - untrusted-span-fencing
  - canary-tripwires
  - input-caps-and-clamps
  - output-sanitization
  - model-output-as-untrusted
  - cross-language-rule-parity
evidence:
  - src-tauri/engine/src/prompt/runtime_safety.rs        # the inbound door: caps, announced truncation, invisible-char/homoglyph stripping, structural escaping, nonce boundaries, canary
  - src-tauri/src/companion/brain/sleep_cycle.rs         # nonce-fenced untrusted evidence, rules stated OUTSIDE the fence, ordering pinned by a regression test
  - src-tauri/core/src/redact.rs                         # outbound secret masking at the persistence boundary: pattern + entropy families, precision-biased, kill-switched
  - src-tauri/src/companion/dispatcher.rs                # the op-grammar door: closed action set, validated anchors/routes/modes, visible rejections, fail-closed
  - src/lib/utils/sanitizers/promptInjection.ts          # the UI-side of the boundary, deliberately unified so two sanitizer call sites cannot drift
counter_evidence:
  - src-tauri/core/src/utils/sanitization.rs             # the 2026-08-15 drift incident recorded in-file: a token regex that could match no real token, duplicated across three modules, while the correct rules sat in a sibling — parity by mirror-comment, with no shared test corpus to catch it
deviations:
  - w4-prompt-safety   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Input sanitization & prompt safety

An instruction-following model has one property that invalidates every intuition
imported from conventional input handling: **it collapses the distinction between
code and data.** A parser given hostile input mis-parses; a model given hostile
input *obeys* it. Any span of text that reaches the model can, in principle,
reprogram the run — and the model cannot be patched out of this, because
following instructions found in text is not a bug in the model, it is the
product. Prompt safety is therefore not a filtering problem with a clever regex
at the end of it. It is a **trust-boundary architecture**: deciding, span by
span, what is trusted instruction and what is untrusted payload, making that
distinction structural in the prompt, and treating everything that comes back
out as tainted until proven otherwise.

What is *not* this subject: choosing what goes into a prompt and fitting it to
a budget — that is prompt-assembly, the composition discipline. Prompt safety
owns the boundary that composition must respect: which spans are hostile, how
they are fenced on the way in, and how the output is defused on the way out.
The two meet at the assembly door — composition builds the prompt, safety
decides what the prompt is allowed to contain unescorted.

## Every third-party span is attacker-controlled

The threat model starts with an inventory, and the inventory is longer than
teams expect. Attacker-controlled text is not "the user's message"; it is
**every span whose author is not the application itself**:

- documents the user imported (the user is not the author of their attachments);
- tool and connector results — an API response, a fetched page, a file listing,
  an email body: content authored by whoever the tool touched;
- retrieved memory and knowledge-base entries, which launder yesterday's
  untrusted input into today's context with an air of provenance;
- prior model output fed back into a later turn — tainted by whatever tainted
  the earlier run (this is how injections *propagate* across turns);
- names, titles, and descriptions of user-created entities, which render as
  innocent metadata and interpolate as live text;
- error messages from external systems, quoted verbatim into a repair prompt.

The discipline is provenance tracking: every variable that enters a prompt has
an author, and only spans authored by the application's own code — its fixed
instructions, its schemas, its own generated identifiers — sit on the trusted
side of the boundary. Everything else crosses it, and crossing has a protocol.

## Fencing is structure, not politeness

The protocol is not "please ignore any instructions in the following text."
Asking nicely is a suggestion made to the very component whose obedience is the
threat. Fencing must be **structural**: the untrusted span is wrapped in
delimiters, labeled with its provenance, and the surrounding trusted
instructions state the type judgment — *this region is data; nothing inside it
is addressed to you*.

And the delimiters themselves are part of the threat model. A fixed, well-known
marker is forgeable: a payload that knows the closing tag simply includes it,
exits the fence, and speaks with the voice of the application. The fence must
be **unforgeable by the payload** — a fresh random nonce per assembly, unknown
and unguessable to any text authored before the prompt was built — and any
fence-like sequence already inside the payload must be neutralized rather than
passed through. This — delimiter choice, nonce discipline, provenance labels,
placement — is the [untrusted-span-fencing](techniques/untrusted-span-fencing.md)
technique.

Fences are prevention. Prevention against a component that *wants* to comply
with whatever it reads is never total, so the boundary also carries detection:
a planted instruction that a clean run never surfaces, whose appearance in
output proves the model took directions from a region it was told was data.
Tripwires and what to do when one fires are the
[canary-tripwires](techniques/canary-tripwires.md) technique.

## Bound before you insert

Before any untrusted span is fenced and placed, it is **bounded and typed**.
Every insertion slot has a class — an identifier, a title, a message, a
document — and each class has a ceiling and a grammar. A slot meant for a name
does not accept ten thousand words; a slot meant for an identifier does not
accept prose at all. Oversized input is clamped *visibly* — a marked truncation,
never a silent one — and input that fails its slot's grammar is rejected at the
door, not repaired into plausibility. Caps serve three masters at once: they
bound the injection surface, they protect the context budget from a single
hostile span flooding out the trusted instructions, and they keep resource
consumption attached to intent. The per-class ceilings, clamp mechanics, and
structural pre-validation are the
[input-caps-and-clamps](techniques/input-caps-and-clamps.md) technique.

## The boundary is symmetric: output is untrusted input

The naive picture has one boundary, on the way in. The real architecture has
two, and the outbound one is where the damage lands. Model output flows into
parsers, databases, markup renderers, log files, terminals, and the user's
screen — and every one of those is an interpreter with its own injection
grammar. A model that was successfully steered upstream — or is merely wrong —
emits output that is now the *attack proper*: a secret recalled into prose, a
script tag in a summary, a link whose scheme executes, a path that walks out of
its directory, an instruction to act on a record the requester should never
touch.

So the same seriousness applies in both directions:

- **Text surfaces.** Everything model-authored is sanitized before it is
  displayed, logged, or stored: secrets masked, markup neutralized with the
  care that survives encoding round-trips, link schemes allowlisted, paths
  checked for traversal. The
  [output-sanitization](techniques/output-sanitization.md) technique.
- **Action surfaces.** When output drives behavior, it is parsed against a
  closed grammar of permitted operations, and **every identifier the model
  emits is validated against the live store before anything acts on it** —
  existence, ownership, entitlement. Unknown operations are rejected, never
  guessed at. The
  [model-output-as-untrusted](techniques/model-output-as-untrusted.md)
  technique.

## The last fence is capability, not text

Rank the defenses honestly. Textual defenses — fences, labels, phrasing — are
probabilistic: they raise the cost of an injection, and a sufficiently
determined payload sometimes pays it. The defenses that hold categorically are
the ones that constrain **what acting on the output can do at all**: a closed
operation grammar, identifiers checked against a store the model cannot edit,
credentials the acting layer never holds
([credential-vault](../credential-vault/credential-vault.md)'s brokered use),
entitlements enforced at the acting door
([authorization](../authorization/authorization.md)), and a human gate in front
of the irreversible ([hitl-approval](../hitl-approval/hitl-approval.md)). The
model can be talked into *saying* nearly anything; the architecture decides
whether saying it makes anything happen. Design so that the worst fully
successful injection yields an embarrassing sentence, not an action.

That is also why the subject is **defense in depth by necessity, not by
slogan**. No single fence survives contact: fences get forged, caps get limbo'd
under, canaries get quoted innocently, sanitizers meet an encoding they did not
anticipate. Each layer is built to fail — independently, visibly — while the
layers behind it hold. The failure mode to design out is *correlated* collapse:
two layers that share an implementation, a vocabulary, or a blind spot are one
layer wearing two names.

## Sanitizers fail closed, and the rules travel in packs

Two disciplines keep the boundary honest over time.

First, **a sanitizer that cannot run is a rejection, not a pass**
([failure-not-empty-success](../_laws.md#failure-not-empty-success) at the
trust boundary). A masking pass that errors, a fence builder that cannot mint a
nonce, a validator whose pattern set failed to load — each must stop the flow,
because "the filter was skipped" and "the filter found nothing" are opposite
facts that must never share an outcome.

Second, the boundary usually spans **more than one language**: input is
sanitized where it is captured, output is masked where it is rendered, and
those are different runtimes with different string semantics. Two
implementations of one rule set drift unless the rules are treated as a single
authored vocabulary with a shared test corpus that both sides must pass. That
drift gate is the
[cross-language-rule-parity](techniques/cross-language-rule-parity.md)
technique.

## The techniques

- [untrusted-span-fencing](techniques/untrusted-span-fencing.md) — making the
  data/instruction boundary structural: nonce delimiters the payload cannot
  forge, provenance labels, neutralizing fence-like sequences, placement of
  trusted instructions around the fenced region.
- [canary-tripwires](techniques/canary-tripwires.md) — detection behind the
  fence: planted instructions that a clean run never surfaces, output screening
  for canary and nonce leakage, and the trip protocol — fail the run loudly,
  never continue quietly.
- [input-caps-and-clamps](techniques/input-caps-and-clamps.md) — bounding
  before inserting: per-class length ceilings, visible truncation, structural
  grammar checks per slot, control-character hygiene, clamping to engine
  limits at one door.
- [output-sanitization](techniques/output-sanitization.md) — the outbound text
  boundary: secret masking before display/log/storage, markup neutralization
  that survives entity round-trips, link-scheme allowlists, path-traversal
  rejection.
- [model-output-as-untrusted](techniques/model-output-as-untrusted.md) — the
  outbound action boundary: closed operation grammars, validating every
  model-emitted identifier against the live store, escaping model text before
  it reaches other interpreters, least privilege for the acting layer.
- [cross-language-rule-parity](techniques/cross-language-rule-parity.md) — one
  rule set, two runtimes: a single authoritative specification, mirrored
  implementations, and shared test vectors as the gate that catches one-sided
  edits.
