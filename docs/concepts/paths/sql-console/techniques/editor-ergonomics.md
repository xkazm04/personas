---
layer: technique
subject: sql-console
technique: editor-ergonomics
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Editor ergonomics

The console competes with every external database client the user has ever
installed, and it competes for the highest stakes in the subject: the user
who leaves takes the credential with them, out of the vault's custody and
out from under the safe-mode guard. Ergonomics is therefore the technique
that makes the security techniques *apply* — a guard on a console nobody
uses guards nothing. The bar is not "usable"; it is "the user stops opening
the other tool".

## The editor floor

What a credible SQL editing surface provides, in rough order of leverage:

- **Dialect-aware highlighting** driven by the connection's declared
  capability profile — keywords, literals, comments, placeholders. Beyond
  legibility, highlighting is *live feedback on the same lexical analysis
  the guard performs*: a string literal that renders as a literal is one the
  stripper will strip, and an unterminated literal is visible as a smear of
  string-color before it is a guard refusal.
- **Schema-aware completion**, fed from the introspection door's cache — the
  same source the browser reads, never a second query path. Completion is
  the feature users rank tools by, and it is also error prevention: a
  clicked column name is a column that exists.
- **Run ergonomics:** a keyboard run binding; run-selection (execute the
  highlighted fragment) and statement-at-cursor for multi-statement
  buffers, so the working style of iterating inside one buffer is
  first-class rather than fought. Whatever fragment is chosen, *that exact
  fragment* is what travels to the guard and the engine.
- **A visible target:** which connection, which database, safe-mode state —
  in the editor's chrome, not a settings page. Every seasoned user has run
  a correct query against the wrong environment; the console's job is to
  make the environment impossible to not know.
- **A cancel affordance for the running statement.** A statement in flight
  is a resource on someone else's engine; the executor bounds it with a
  deadline, and the editor exposes an interrupt that reaches the engine
  (not just the request), so a runaway query is stopped rather than waited
  out. A cancellation stack that exists end-to-end but is not wired to a
  button on the primary editor is a feature that does not exist for the
  user.
- **Comfort details** that mark tool maturity: multi-line editing that
  behaves like a code editor, bracket/quote pairing, a monospace grid,
  reasonable behavior on very large buffers.

## History: automatic, honest, bounded

Query history is the console's memory and the user's undo for thought.

- **Automatic** — capture on execution, success or failure, with the
  verdict, timing, and the connection it ran against. History that requires
  a save action is not history.
- **Keyed by identity, not position** ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)):
  entries get durable ids at creation, so re-running, deleting, and
  re-ordering do not corrupt references; "re-run entry N" must mean that
  entry forever, not whatever now sits at index N.
- **Scoped per connection** for retrieval (queries make sense against the
  schema they ran on) with cross-connection search available — the user
  remembers writing the query, rarely where.
- **Bounded, with a named reaper**
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)): a cap or
  age policy declared at the store, enforced by the same component that
  writes entries. An unbounded history table quietly becomes the console's
  own database problem.
- **Deduplicated on write** (an identical statement re-run bumps recency
  rather than appending a clone), so the recent list stays a list of
  *thoughts*, not keystrokes.

## Saved queries: promotion, not duplication

History is what happened; saved queries are what the user *decided to keep*.
The natural flow is promotion — "save this" from history or from the buffer
— producing a named, editable, deliberately-kept artifact. Saved queries
carry a name, the statement, the intended connection (advisory: running a
saved query against a different compatible connection is legitimate), and
their edit history is the user's business, not auto-overwritten by runs.
Keep the two stores distinct in the UI and the schema; merging them turns
"my curated toolbox" into "everything I ever typed", which is the fastest
way to make users stop curating.

## What ergonomics may never do

Convenience features acquire execution paths, and every one must terminate
at the same guard and door as typing:

- re-run from history → through the guard, at *current* safe-mode state,
  not the state at capture time;
- run a saved query → through the guard;
- a snippet, a completion, a formatted rewrite → it edits the buffer; the
  buffer runs through the guard.

The technique's boundary with [safe-mode-guarding](safe-mode-guarding.md) is
exactly this: ergonomics multiplies the number of ways a statement reaches
the run action, and the architecture keeps the number of ways a statement
reaches the *engine* at one.
