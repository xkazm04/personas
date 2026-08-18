---
layer: technique
subject: ipc-contract
technique: error-shape-mapping
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Error shape mapping

Success payloads get generated types, review, and gates; error payloads, left
to the transport's defaults, get flattened into strings somewhere in transit.
The result is an interface world that decides what to show the user by
substring-matching prose — a contract written on wording, broken by the first
reword, and untranslatable by construction. This technique keeps the error's
*structure* alive across the boundary and concentrates its *interpretation*
at one door.

## The envelope

Errors cross the boundary in a fixed envelope, exactly as first-class as any
success shape (generated, gated, versioned with the rest of the contract):

- **code** — a machine identifier from a closed vocabulary. The only field
  program logic may branch on.
- **message** — human-readable, for logs and diagnostics. Never parsed, never
  shown raw to end users of a polished product; it is the developer's string,
  not the user's.
- **data** — optional structured payload for codes that need parameters
  (which field failed validation, how long to back off, which resource was
  missing).

The discipline that makes the envelope real: **the far side's handlers return
it on purpose.** A handler that lets an internal panic or a raw library error
propagate to the transport gets the transport's default flattening; the
handler layer therefore ends in a normalization step — catch, classify,
wrap — so that everything reaching the wire is enveloped. Unclassifiable
errors get an explicit `internal` code rather than leaking their guts; the
guts go to the diagnostic channel, with a correlation identity so the
user-visible event and the log line can find each other.

## The code vocabulary is closed and owned

Error codes are a vocabulary, and vocabularies obey the law: one authoritative
definition, every consumer derives
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The codes are declared once on the authoring side of the contract and cross
the boundary through the same generation machinery as the data shapes — so an
added code is a visible contract change, and a consumer switching on codes can
be exhaustiveness-checked against the generated set.

Keep the vocabulary small and behavioral. Codes exist to select *handling*,
not to enumerate every distinct misfortune; if two failures are handled
identically, they are one code with different `data`. The core classes that
almost every boundary needs, because each demands different downstream
behavior:

- **invalid-input** — the user can fix it; show them where.
- **not-found / conflict** — the world changed under the caller; refresh and
  reconcile.
- **unavailable** — a dependency is down or busy; retryable, with backoff.
- **forbidden** — retry is pointless; the path is closed to this caller.
- **timeout / outcome-unknown** — the special one: the operation *may have
  succeeded*. Handling must verify state, never assume failure
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **internal** — the product's fault; apologize, report, attach the
  correlation identity.

## One mapping door on the near side

The near side owns the translation from code to user experience — copy in the
user's language, a suggested action, a severity. That translation lives in
**one registry** ([one-validation-door](../../_laws.md#one-validation-door)):
raw failure in, `{presentable message, suggested action, severity}` out, and
every surface that shows an error calls it. Scattered per-call-site `catch`
blocks each composing their own message are the same defect as scattered
validation — the site added next quarter ships the raw string.

The door also hosts the **legacy fallback**, honestly. Real products meet
un-enveloped errors — old handlers not yet migrated, third-party layers,
transport-level failures below the envelope. The door may pattern-match those
*as a quarantined compatibility layer*, clearly separated from the code
switch, with each pattern carrying a pointer to the un-migrated source it
exists for. That inverts the anti-pattern: string-matching as the *documented
exception* burning down to zero, not the architecture.

## What refuses to cross

Two things never ride the envelope:

- **Stack traces and internals** — they go to the diagnostic channel keyed by
  correlation identity, not across the user-facing boundary. The envelope's
  `message` is already the sanitized account.
- **Prose as protocol** — no consumer branches on `message` content, ever.
  The moment a condition matters enough to branch on, it earns a code (or a
  `data` field); the review question "what do you switch on?" has exactly one
  acceptable answer.
