---
layer: technique
subject: voice-io
technique: engine-abstraction
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Engine abstraction

Every voice pipeline terminates in an engine — a synthesis model or a
transcription model, local or remote — and engines are the most volatile
component in the subject: services get deprecated, local models get
superseded, licensing changes, a user's hardware runs one engine and not
another. The product's voice features must outlive every individual engine
it ships with. The technique is the standard interface-and-adapter discipline
applied with voice's specific complications: capabilities differ wildly
between engines, configuration outlives engines, and "installed" is a
many-valued state.

## One interface per direction, adapters behind it

Each direction gets **one** interface, shaped by what callers need, not by
what any engine offers:

- synthesis: *speak this text, as this voice, with these parameters* →
  a playback-controllable handle (or a stream of audio segments);
- transcription: *transcribe this audio* → partial and final transcripts
  with whatever confidence the engine can attest.

Behind each interface, **one adapter per engine** translates the interface
contract into that engine's dialect: its process or connection lifecycle,
its audio formats, its error vocabulary. All engine-specific knowledge —
formats, quirks, retry characteristics, warm-up behavior — lives inside the
adapter and nowhere else. The tell that the abstraction has failed is an
engine's name appearing in surface code: a branch on which engine is active,
in a component that renders a button, means engine knowledge has escaped and
every future engine now costs a hunt through the interface's consumers.

The set of engines is a closed vocabulary with a single authoritative
definition — the registry that maps engine identifiers to adapters
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Settings surfaces, catalogs, and diagnostics all enumerate engines *from the
registry*; a second hand-maintained list of engines (in a settings enum, in
a display-name map) is the classic two-copy race, and it loses the moment an
engine is added under deadline.

## Capabilities are declared, probed, and branched on — engine names are not

Voice engines differ on axes that surfaces genuinely care about: streaming
synthesis versus whole-clip; word-level timestamps; language coverage;
partial transcripts; speed control; local versus remote execution. The
abstraction survives this diversity by making **capability a first-class,
queryable declaration** on the adapter — and requiring callers to branch on
capability, never on identity. "If the engine can stream, start playback on
the first segment; otherwise show synthesis progress" is portable across
every engine that ever exists; "if the engine is X" is a defect with a
delay fuse.

Declared capability is a claim; **probing verifies it at selection time**.
An adapter declares what the engine can do when healthy; whether *this
installation's* engine is healthy — model file present and readable, service
reachable, credential valid, sample invocation returns — is established by
an actual probe, and the probe's outcomes are honest per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success):
**absent** (not installed — offer setup), **broken** (installed but failing
its probe — show the failure, offer repair), and **ready** are three
distinguishable states. Collapsing absent and broken into one "unavailable"
strips the user of the only fact that decides their next action: download
something, or fix something.

## Selection and fallback

Which engine serves a direction is **configuration with a declared fallback
chain**, resolved at use time: the preferred engine if ready, else the next,
ending at the direction's degraded terminal state (visible text for
synthesis; typing for transcription — the golden path's degradation ladder).
Two honesty rules govern the chain:

- **fallback is visible.** Speaking through the second-choice engine after
  the first failed is good engineering; doing it without any indication
  teaches the user that voice quality randomly fluctuates. A quiet indicator
  is enough — the difference between degraded-by-design and flaky is whether
  the product *admits it noticed*;
- **fallback is not repair.** The chain keeps the session working; the
  failure that triggered it is still surfaced through the engine's
  diagnostics so it gets fixed rather than permanently absorbed.

## Retired-engine normalization: one door

Stored configuration — the persisted engine choice, the persisted voice
reference, per-surface narration settings — outlives engines by years. The
retirement problem is therefore permanent, and its solution is structural:
**one normalization door through which every read of stored voice
configuration passes**
([one-validation-door](../../_laws.md#one-validation-door)), which maps
references to engines or voices that no longer exist onto their declared
successors or the current default, and records that it did so.

The enumerable-writers half of the law matters as much as the door: every
consumer that reads a stored engine or voice reference — playback, settings
display, diagnostics, export — goes through the same normalization, or the
product disagrees with itself (settings shows the retired name, playback
uses the fallback, and the user cannot reconcile the two). Normalization at
N call sites is normalization minus the call site added next quarter.

Normalize **on read, persist on the user's next write** — not eagerly on
upgrade. Eager rewriting of stored preferences destroys the information that
the user ever chose the retired voice; if that engine returns (reinstalled,
re-licensed), a read-time-normalized preference snaps back to what the user
actually picked, while an eagerly rewritten one has forgotten.

## The seam is where mocks live

One interface per direction yields the test seam for the entire subject: a
scripted fake engine (deterministic transcripts, instant or clock-controlled
synthesis, injectable failures at every probe outcome) makes every other
technique in this subject testable without audio hardware, network, or
model files. If testing a voice surface requires a real engine, the
abstraction boundary is in the wrong place — the fake is not a testing
convenience but the proof that the interface actually contains the engine.
