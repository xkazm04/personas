---
layer: technique
subject: prompt-safety
technique: untrusted-span-fencing
status: forged
laws: [one-validation-door]
shared_with: []
---

# Untrusted-span fencing

The golden path's first move — instructions and data are different types — is
realized here as prompt structure. A fenced span is untrusted text wrapped so
that three things are true at once: the model can tell **where** the data
begins and ends, it is told **what** the region is (provenance) and **how** to
treat it (a type judgment: data, not directions), and the payload **cannot
forge its way out** of the region it was placed in. Miss any of the three and
the fence is decoration.

## Delimiters the payload cannot forge

The central failure of naive fencing is the fixed marker. Wrap payloads in a
well-known tag and every attacker who has seen one prompt — or can guess the
convention — closes the tag inside their payload, steps outside the fence, and
continues in the voice of the application. A fence built from public knowledge
is a fence with a published key.

The remedy is a **nonce fence**: a fresh random token minted per assembly,
woven into the opening and closing delimiters, and referenced by the trusted
instructions ("the region delimited by *this* token is data"). The properties
that matter:

- **Unpredictable** — cryptographic randomness, generated at assembly time.
  Any text authored before the prompt was built cannot contain it except by
  astronomical accident.
- **Fresh per assembly** — a reused nonce is a fixed marker with extra steps;
  one leak (a logged prompt, an echoed transcript) converts it permanently.
- **Verified absent from the payload before use** — the vanishing-probability
  collision is free to check, so check it; if the payload somehow contains the
  nonce, re-mint. This closes even the theoretical forgery.
- **Screened out of the output** — a nonce that appears in the model's answer
  is a boundary event, not a curiosity; that screening belongs to
  [canary-tripwires](canary-tripwires.md).

Where the conversation protocol offers genuinely structural separation —
distinct message roles, tool-result framing that the transport itself
enforces — use it *as well*. Protocol structure is stronger than any in-band
marker, but it is coarse (whole messages, not spans), so real prompts still
need in-band fences for the spans inside a message.

## Provenance labels and the type judgment

A fence says where the data is; the label says what it is and how it got here:
*retrieved document, third-party service response, user-imported file, output
of an earlier automated run*. Provenance matters because the model's treatment
should differ — quoting a document is fine; obeying it is not — and because the
downstream reader of a flagged run needs to know **which** span went hostile.

The trusted frame around the fence states the type judgment explicitly and
asymmetrically: content inside the region is to be *analyzed, summarized,
quoted* — never *executed as instruction*, regardless of how imperatively it is
phrased. Two placement rules earn their keep:

- **Instructions bracket the data.** State the judgment before the fence and
  reassert authority after it. Long hostile spans exert positional pull;
  a restatement after the fence is cheap insurance against the model treating
  the most recent voice as the current speaker.
- **The fence never moves the goalposts.** Trusted instructions never say
  "unless the document asks otherwise." The judgment is unconditional; any
  softening clause is an open gate written by the defender.

## Neutralize what looks like a fence

Payloads arrive containing markup that resembles the fence syntax, the framing
vocabulary, or the protocol's own structural tokens — sometimes innocently,
sometimes not. The fence builder neutralizes these before wrapping: escape or
transform sequences that could read as delimiters, framing keywords, or
role/structure markers. The rule generalizes past this subject: **when you
embed text into any carrier syntax, the text must be made inert in that
syntax.** Fencing is escaping, applied to a prompt instead of a query string.

## One door builds every fence

Fencing discipline dies by bypass, not by bad design: the tenth call site that
interpolates a variable straight into a template because the deadline was
close. The countermeasure is structural
([one-validation-door](../../_laws.md#one-validation-door)): prompt assembly
exposes **one API for inserting untrusted content**, and that API fences,
labels, caps (see [input-caps-and-clamps](input-caps-and-clamps.md)), and
neutralizes as a unit. Raw string concatenation of third-party text into a
prompt is treated as a defect class, findable by review or lint, not as a
style choice. The sibling discipline prompt-assembly owns the composition
door itself; this technique defines what that door must do to every untrusted
span passing through it.

## What fencing does not buy

Fencing raises the cost of injection; it does not zero it. A model can be
steered by content that never leaves its fence — no forged delimiter, just
persuasive text that the model, while "analyzing" it, partially adopts. That
residual is why the fence ships with detection behind it
([canary-tripwires](canary-tripwires.md)) and why nothing the model says after
reading hostile text is trusted on the way out
([model-output-as-untrusted](model-output-as-untrusted.md)). Treat fencing as
the first wall of a keep, and budget for the walls behind it.
