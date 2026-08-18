---
layer: technique
subject: markdown-vault
technique: vault-as-database
status: forged
laws: [identity-survives-reuse, one-validation-door]
shared_with: []
---

# Vault as database

The mapping that makes a directory of notes queryable: a file is a record,
its frontmatter block is the typed fields, its body is the document payload,
folders are coarse partitions, and the filename is a **display key** — human-
readable, mutable, and never identity. Everything else in this technique
follows from one asymmetry: there is no engine to enforce any of it. The
schema is a convention held up entirely by the writers' discipline and the
readers' tolerance.

## Write strict, read tolerant, test the round trip

A conventional database validates on write and lets clients be sloppy. A
vault inverts both halves:

- **Emitters escape everything user-controlled.** Frontmatter is a line-
  oriented format where a quote, a colon, a backslash, or a newline inside a
  value changes the parse. Interpolating raw values works until the first
  title containing a quote — and then fails *silently*: the record still
  looks like a record, but its fields no longer parse back to what was
  written, so lookups keyed on those fields stop matching. The emit path
  quotes and escapes every scalar; multi-line content is encoded so each
  field stays on one line, keeping the cheap line-oriented reader correct.
- **Parsers accept what they did not write.** Hand-authored notes, older
  emitters, other tools: bare scalars, single-quoted scalars, reordered or
  missing optional keys are all legitimate rows. A reader that only accepts
  its own emitter's output has claimed exclusive custody of a shared store.
- **The test that counts is emit → parse → equality with the original.**
  Escaping bugs live precisely in the seam between an emitter and a parser
  that are each individually defensible. A table of hostile values (embedded
  quotes, colons, backslashes, newlines, the empty string) driven through
  the full round trip is the cheapest insurance the technique has.

Keep frontmatter scalar and shallow. It is a field list, not a document
format; anything with internal structure belongs in the body, where the
human edits it anyway.

## Identity is minted, filenames are derived

Per [identity-survives-reuse](../../_laws.md#identity-survives-reuse): the
operations a vault record actually undergoes are rename, move, duplicate,
and merge — and a filename survives none of them as a key. Titles collide
across folders. Sanitization (stripping characters the filesystem reserves,
capping length, falling back when nothing survives) is **lossy and one-way**:
a filename can be derived from a title, but a title or key must never be
derived back from a filename.

So: mint an id at record creation, store it in frontmatter, and make every
cross-store reference (mirror rows, sync ledgers, backlink caches) point at
the id. The filename is regenerated presentation. When an external tool or
the human renames the file, the id still says which record this is — which
is the difference between "the note moved" and "the note vanished and a
stranger appeared".

## The vault root is a trust boundary

The moment any caller-supplied path reaches the store — "read this note",
"list this folder" — the vault inherits the filesystem's entire attack
surface: parent-directory segments, absolute paths, symbolic links pointing
outside the root, platform path-representation mismatches. Per
[one-validation-door](../../_laws.md#one-validation-door), the cure is
structural, not per-call-site vigilance:

- **One canonical resolver** for relative fragments: reject absolute input
  and parent segments up front, join to the root, fully resolve, then assert
  the result is still inside the fully-resolved root.
- **One containment assertion** for paths that are legitimately already
  absolute (results the application itself previously handed out): resolve
  both sides, then check the prefix.
- **Resolution failure is rejection, never fallback.** Comparing raw paths
  because canonical resolution failed converts the guard's error branch into
  a bypass — the exact input that cannot be normalized is the one that must
  not be trusted.

Two shapes, two named funnels, and a standing rule against a third ad-hoc
variant: an enumerable set of doors is what makes the boundary auditable.

## Writes are atomic because readers are strangers

Another program renders these files at arbitrary moments. A record write is
therefore write-to-temp-sibling then rename-over-target: any reader at any
instant sees either the complete old note or the complete new one, never a
torn intermediate. This protects a single write's integrity — it does *not*
arbitrate two writers editing the same record, which is the concern of the
sync layer, not the write primitive. The temp file names its reaper: on
rename failure it is removed, not leaked into the vault as a phantom record.
