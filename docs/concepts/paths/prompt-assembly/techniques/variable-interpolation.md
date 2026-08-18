---
layer: technique
subject: prompt-assembly
technique: variable-interpolation
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Variable interpolation

Templates hold the prompt's fixed language; variables are where the world
enters it. This technique governs the holes: every placeholder is a *typed,
classified, declared* input — not a string slot — because the difference
between a prompt system and an injection vector is exactly what its holes
will accept.

## Variables are typed and declared, not discovered

A template's variable set is a contract, stated where the template lives:
each variable has a name, a type (text span, enumerated token, count, list
of items), a source (which pipeline produces it), and a trust class. The
rendering pass takes exactly that set — no ambient lookups, no "whatever is
in scope." Two properties follow:

- **The set is checkable both ways.** A template referencing a variable
  nobody declared, or a declared variable no template uses, is detectable
  before any call is made — at load or in tests, not in production output.
- **Rendering is pure.** Interpolation reads its inputs and nothing else:
  no clock, no randomness, no global state. Anything volatile the prompt
  needs (the date, a session id) enters as a declared variable, which is
  what keeps assembly deterministic and lets the fingerprint see every
  input that shaped the text.

## Trust class is a property of the variable, not the call site

Every variable carries one of three classes, assigned at declaration:

- **Authored** — text the system's own maintainers wrote: doctrine
  fragments, canned phrasing, enumerated mode strings. May appear anywhere.
- **Machine-derived** — values the system computed from its own state:
  counts, digests, state summaries, identifiers. Trustworthy as *data* but
  not as instructions; belongs in context and task layers, rendered so it
  cannot read as a directive.
- **Untrusted** — anything whose author is not the system: user documents,
  external messages, retrieved content, prior model output. Admissible
  only at declared insertion points in the context and task layers, never
  in identity or policy positions — and always through the wrapping
  discipline owned by the sibling standard prompt-safety, which fences and
  sanitizes such spans. This technique owns the *classification* and the
  *insertion-point policy*; the sibling owns what the wrapper does.

Assigning class at declaration is the load-bearing choice. Call sites do
not get a vote — the moment "is this span trusted?" is answered per call
site, the answer is eventually wrong at one of them, and one is enough.
The insertion-point policy is then mechanical: a variable may only be
placed in a section whose trust floor admits the variable's class, and the
assembler can verify that statically, template by template.

## A missing variable is a loud failure

Rendering with an absent input has exactly three honest outcomes, chosen
per variable at declaration: fail the assembly, substitute a declared
default, or omit the enclosing section entirely. The dishonest outcomes are
the common ones: rendering the placeholder syntax literally (the model now
reads scaffolding), or rendering an empty string (the sentence around the
hole silently changes meaning — "your name is " followed by nothing is an
instruction, just not the intended one).

This is [failure-not-empty-success](../../_laws.md#failure-not-empty-success)
at the template layer: a variable that resolved to nothing and a variable
that was never wired up must not produce the same bytes. The empty-string
render is precisely the empty success that hides the wiring failure — the
prompt still ships, the call still succeeds, and the defect surfaces as a
behavioral oddity three layers downstream, unattributable to its cause.

## Lists interpolate as rendered items, not joined strings

Composite variables — the recalled facts, the pending items, the active
constraints — are rendered by an item template with its own delimiting and
its own per-item trust handling, plus an explicit cap coordinated with the
budget (a list variable without a cap is a budget leak wearing a loop). The
degenerate case follows the missing-variable rule: an empty list omits its
section rather than rendering a heading over nothing.
