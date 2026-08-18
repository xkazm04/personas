---
layer: technique
subject: outbound-notifications
technique: per-channel-templating
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Per-channel templating

An internal event is a structured fact. What lands in a channel is prose —
or a card, or a JSON envelope — and the transformation between them is
where outbound systems either respect their receivers or spam them. The
technique: **each channel class owns its rendering**, the rendering is
driven by a deliberately small placeholder grammar over the event's
structure, users may override templates as data, and rendering is **total**
— it can produce a worse message, never a failed delivery.

## The rendering context is a contract

Before any template runs, the event is projected into one documented
context shape: identity, event type, source coordinates, timestamps,
status, and the payload as structured data — with the payload parsed
leniently (an unparseable stored payload becomes a string leaf, not an
error). This projection is the template author's entire world, so it is
part of the subscription feature's public contract: renaming a context
field breaks user templates in the field, silently, and deserves the same
migration discipline as renaming a database column. Publish the context
shape next to the template editor; nothing else about templating is
learnable by users.

## The grammar: small enough to be total

Placeholder substitution over dotted paths into the context — `{{a.b.c}}`,
walking objects and array indices — covers the real need. Resist logic:
conditionals, loops, and formatting functions in templates move
presentation *policy* into user data where it cannot be reviewed, tested,
or migrated. The grammar's semantics must be pinned, because every choice
below becomes someone's debugging session:

- **A missing path renders as empty**, not as an error and not as the
  literal placeholder. Rendering must not fail (totality), and leaking
  `{{payload.staus}}` into a public room is worse than an empty gap. But
  note what this trades away: a typo'd path and a legitimately empty value
  are now indistinguishable *in the output*
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
  bent, knowingly, for the send path). Repay the debt where it belongs —
  at authoring time: the template editor and the test-delivery ritual
  should resolve paths against a real sample context and flag the ones
  that resolve to nothing.
- **Malformed delimiters degrade to literal text.** An unclosed
  placeholder, or braces around content the grammar doesn't accept, passes
  through as typed. The user sees exactly what they wrote and fixes it;
  the delivery still happened.
- **Non-string leaves have one serialization** (compact, deterministic),
  and one escape hatch renders the whole event for receivers that want
  everything.

## Every channel class renders honestly — which means differently

One rendered summary feeds N channel-class body shapes, and the shapes are
owed to the target, not to symmetry: a plain-text line for one chat
dialect, a content field for another, a typed card envelope for the
enterprise messenger, and — for the generic JSON endpoint — the summary
*plus the full structured event*, because a machine receiver should never
be forced to parse prose back into data. Escaping belongs to this layer
and is per-target: each chat dialect has its own significant characters,
its own link syntax, its own length cap, and text that was safe in one is
an injection or a formatting accident in another. The adapter that owns
the body shape owns the escaping; templates stay markup-agnostic.

Size caps are real and enforced by the target, usually by rejecting the
whole message. Truncate with headroom, at a character boundary, with an
honest marker — losing a tail is a degraded message; a delivery bounced
for length is a lost one.

## The default rendering carries most of the traffic

Most subscriptions never get a custom template, so the default summary is
the product: event type plus source coordinates in one line, stable enough
to eyeball in a busy room, prefixed so the sender is identifiable among
other integrations posting into the same space. Design it deliberately —
it is the single most-seen string this subject produces.

## Digests are renderings too

When the fan-out loop coalesces a burst (fifty occurrences of one event
type in one tick), the digest message must carry its predicate: *what* was
collapsed, *how many*, over *what window*
([count-carries-predicate](../../_laws.md#count-carries-predicate)).
"47 events" is noise; "47 `job.failed` from one source in 90 seconds" is a
signal a human can act on. The digest is composed by this layer with the
same per-channel honesty as a single message — it is not the transport's
apology, it is content.

## The line this technique holds

Template errors degrade content; they never veto delivery, never throw
into the dispatch loop, never pin a watermark. A user's typo in a template
is a cosmetic incident scoped to their own channel. The moment rendering
can fail, a template becomes an availability lever over the shared
pipeline — and template editing is the least-guarded write surface in the
whole subject.
