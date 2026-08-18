---
layer: technique
subject: terminal-multiplexing
technique: keystroke-injection
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Keystroke injection

A multiplexer that hosts interactive sessions is eventually asked to *drive*
them: automation submitting a command, an orchestrator answering a
confirmation prompt, a harness navigating a full-screen menu. The device
accepts only bytes, so the temptation is to treat injection as string
writing. This technique exists because that model is wrong at exactly the
moments automation matters: full-screen programs attach meaning not just to
*what* bytes arrive but to *how* they arrive — grouped, separated, timed —
and an injection layer that cannot express those distinctions can type into
a shell but cannot operate a program.

## Keys are semantic; a notation makes them sayable

The unit of injection is the **keystroke**, not the character. Arrow keys,
function keys, and modifier chords have no printable form — they are escape
sequences whose exact bytes depend on declared terminal type and mode — and
even the keys that do have printable forms (Enter, Tab, Escape) are
semantically distinct from the characters they resemble. An injection
request therefore needs a **readable key notation**: a small closed
vocabulary in which special keys and modifier chords are named
(`<enter>`, `<escape>`, `<c-c>`-style chords, in whatever surface syntax
the product picks) and everything else is literal text.

Two rules make the notation trustworthy:

- **One parser is the authority**
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
  Every injection path — user macros, automation, tests, the orchestrator —
  parses through the same door, and the byte encoding of each named key
  lives only there. Two parsers, or one parser plus call sites that
  hand-encode "just this one arrow key", is the standard drift engine: the
  vocabularies diverge the day one of them learns a new key.
- **Escaping is defined, not discovered.** Literal text can contain the
  notation's own delimiters; the notation defines how, or the first user
  who types an angle bracket files the bug that reveals nobody decided.
- **An unknown key name is an error, never a literal.** A typo'd key parsed
  as the literal text of its own name gets *typed into a live session* —
  worse than not driving at all, and invisible until the target program
  does something with the garbage. Failing the plan loudly at parse time is
  the cheap version of that incident.

The notation earns a second dividend the byte form cannot: **legible plans
and safe logs.** A driving plan rendered in notation can be read, asserted
on in tests, and round-tripped; and the logging rule above becomes
mechanical — named keys render as themselves, literal text renders as its
length only, so the shareable trace shows the plan's *shape* without ever
carrying the payload.

## Typed versus pasted: the Enter question

The single most load-bearing distinction in terminal automation is how a
newline arrives:

- **Pasted** — the newline is a byte inside a larger chunk. Under bracketed
  paste (which most modern line editors and full-screen programs enable),
  the receiving program treats the whole chunk as inert text: newlines
  become literal line breaks in a buffer, *nothing is submitted*.
- **Typed** — the newline arrives as its own keypress, outside any paste
  bracket, after the text. Line editors submit; dialogs confirm.

Automation that concatenates command-plus-newline into one write works
against a dumb line reader and silently does nothing against a bracketed-
paste-aware program — the command sits in the input buffer, unsubmitted,
while the automation waits for output that will never come. The injection
contract therefore makes the distinction first-class: *paste this text*
and *press this key* are different verbs, and the common macro is their
sequence — paste the payload, then type Enter as its own keystroke, often
with a short settle delay between them so the target's input loop observes
two events rather than one coalesced read.

## Chunking is part of the message

Between the injector and the child sit buffers that are free to merge or
split writes; the child's input loop sees reads, not messages. For plain
text this is harmless. For driving full-screen programs it is not, in both
directions:

- **Unwanted merging** — a navigation key and a confirmation key written
  back-to-back arrive in one read; a program that processes one event per
  read-and-repaint cycle acts on the first and drops or misorders the
  second. The fix is deliberate separation: distinct writes with settle
  delays where the target repaints between inputs.
- **Unwanted splitting** — a multi-byte escape sequence split across writes
  can arrive across the child's read boundary; a program with a short
  escape-disambiguation timeout interprets the lone escape byte as the
  Escape key, then the tail as garbage text. The fix is atomicity: a named
  key's bytes are always a single write.

The resulting discipline: **atomic within a key, deliberate between keys.**
Chunk boundaries are placed by the notation layer — never left to whatever
the transport happened to do — which is also what makes automation
reproducible across machines with different buffering behavior.

## Pace against evidence, not against hope

Fixed sleeps between keystrokes are the injection layer's equivalent of the
unbounded queue: a constant tuned on one machine, wrong on every other —
too slow where it passes, flaky where it matters. The honest pacing signal
is the terminal's own feedback loop: the injector can observe the session's
output flow (this subject already buffers it), so "wait until the screen
settles" and "wait for the prompt/menu to appear" are implementable
predicates. The standard posture is paced defaults for the common case and
evidence-based waits at the load-bearing steps — before answering a prompt,
after triggering a screen change. An injection layer with no access to
output is typing blind, and blind typing into a full-screen program is a
random walk: every design that starts there grows a readback channel later,
after the flakes.

## Injection is input, with input's obligations

Injected bytes enter the same device as human keystrokes, so they inherit
the session's input state: a session in a mode that reinterprets keys (a
modal editor, a search prompt, a paste bracket left open by a previous
injection) applies that mode to the injection. Automation that assumes a
neutral state must either establish it (an Escape-to-known-state preamble
is the classic) or verify it from output. And because injected input can
carry secrets — tokens pasted into login prompts — the injection path is a
place where logging discipline applies: record *that* keys were sent and
which named keys, not the literal payload, unless the payload is explicitly
marked loggable.
