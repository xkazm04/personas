---
layer: golden-path
subject: markdown-vault
status: forged
techniques:
  - vault-as-database
  - link-graph-extraction
  - knowledge-integrity-lint
  - vault-walking
  - mirror-indexes
  - editor-interop
evidence:
  - src-tauri/src/commands/obsidian_brain/vault_fs.rs      # one walker, five callers — depth/error/hidden policies as explicit options
  - src-tauri/src/commands/obsidian_brain/lint.rs          # staleness, orphans, broken links as defects with detectors; abort-on-unreadable walk
  - src-tauri/src/commands/obsidian_brain/semantic_lint.rs # the judgment tier: bounded, opt-in, propose-only
  - src-tauri/src/commands/obsidian_brain/graph.rs         # wikilinks → edges; backlink index; TTL cache + watcher invalidation; atomic writes
  - src-tauri/src/commands/obsidian_brain/markdown.rs      # frontmatter as schema: escaped emit, tolerant parse, round-trip tested
  - src-tauri/src/commands/obsidian_brain/mod.rs           # hash-gated mirror writes; push/pull sync over three-way compare; the one path funnel
  - src-tauri/src/commands/obsidian_brain/conflict.rs      # both-sides-changed detection — sync-replication's ground, consumed here
  - src/features/plugins/obsidian-brain/openInObsidian.ts  # deep links hand navigation back to the human's editor
  - scripts/census/check-corpus-integrity.mjs              # the subject practiced on itself: this doc tree IS a linted markdown vault
counter_evidence: []
deviations:
  - w11-markdown-vault   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Markdown knowledge vault

A directory of markdown notes can be treated as a database: files are records,
frontmatter is the schema, links between notes are the relations, and queries
are walks. This is a real and load-bearing architecture, not a shortcut — it
buys durability (plain text outlives every application), inspectability (any
tool can read it), and above all **shared custody**: the human opens the same
store in their own editor and works it directly, with no API between them and
the data.

That last property is the physics of the whole subject. A conventional
database assumes it is the only writer and builds everything — transactions,
indexes, integrity — on that assumption. A vault *starts* by surrendering it.
The engine is the filesystem; the concurrent writers include a human with a
text editor and root privileges; the schema is advisory because no engine
rejects a malformed row. Every technique below is a consequence of designing
honestly under those conditions instead of pretending they away.

## Files as records, schema as convention

A record is a file whose frontmatter carries the typed fields and whose body
carries the document. This mapping works only when the write side is
disciplined and the read side is tolerant — the inverse of a real database,
where the engine enforces and clients can be sloppy:

- **The emitter escapes everything user-controlled.** A title containing a
  quote, a colon, or a newline must survive the trip into frontmatter and
  back byte-identically. The test that matters is the **round trip** —
  emit-then-parse equals the original — not the emitter and parser tested
  separately, because each can be individually plausible and jointly wrong.
- **The parser accepts what it did not write.** Hand-authored notes, older
  emitters, and other tools all produce legitimate records. Bare scalars,
  alternate quoting, missing optional keys — a reader that chokes on them has
  misunderstood whose store this is.
- **Identity lives in frontmatter, not the filename.** Humans rename files;
  titles collide; filename sanitization is lossy and one-way. A record that
  must be found again after a rename carries a minted id in its fields
  ([vault-as-database](techniques/vault-as-database.md)).

The vault root is also a **trust boundary**: paths supplied by callers resolve
through one canonical funnel that rejects escape attempts and verifies
containment after full resolution — because a store made of files inherits
every filesystem attack the moment paths become inputs.

## The link graph is data, not decoration

Notes reference each other with inline links, and those references are worth
extracting into a first-class structure: an edge list, a backlink index, an
in/out-degree profile per note. The graph serves two masters at once
([link-graph-extraction](techniques/link-graph-extraction.md)):

- **Navigation.** Backlinks answer "what points here"; high out-degree notes
  are de facto tables of contents; unresolved links are invitations — edges
  to nodes that do not exist yet.
- **Integrity.** A link whose target resolves nowhere is a broken reference.
  A note nothing points to is unreachable except by search. Both are
  measurable, and both are meaningless unless every consumer resolves links
  by the **same rules** — one shared extractor and normalizer, or the linter
  and the navigation will disagree about which links are broken.

The extracted graph is a derived value over a store other programs mutate.
It must name its recomputation (a fresh walk) and bound its staleness
(invalidation on observed change, plus a time floor for changes nobody
observed).

## Integrity is lint, because rot is silent

A knowledge store fails differently from code: nothing crashes, no test
reddens. A broken link waits until someone follows it; a stale note waits
until someone trusts it; an orphan simply stops existing for every reader who
navigates instead of searching. The failure mode is **invisible erosion of
trust**, and the countermeasure is the same one code uses for its silent
defect classes: lint —
[knowledge-integrity-lint](techniques/knowledge-integrity-lint.md).

Three defect classes with detectors: broken links (reference integrity),
orphans (reachability), staleness (temporal integrity — a proxy predicate,
declared as such). Two tiers of detector: a deterministic syntactic pass
cheap enough to run always, and a judgment pass (contradictions between
notes, missing hub pages, missing cross-links) that is expensive, bounded,
and **propose-only**. And one structural rule inherited from every gate that
matters: the lint walk fails loudly on an unreadable corner, because a
partially-scanned vault reporting clean is the most expensive lie the store
can tell.

Detection and repair are separate passes with separate authority. Lint never
mutates. Repair is bounded, goal-declared, and measured before/after — and
"repair" that deletes a note without preserving its distinct facts is not
repair.

## Every operation begins with a walk

Enumerate the records: the query planner of a filesystem database is a
directory walk, and it shares physics with directory listing everywhere —
[file-browsing](../file-browsing/file-browsing.md) owns the general subject.
What the vault adds is that *many* features walk the same tree, and each walk
makes three decisions that drift silently when hand-rolled per caller: depth
policy, exclusion policy (the editor's own metadata directories, trash,
hidden entries), and error policy — abort or skip, chosen by what the
consumer means by "done" ([vault-walking](techniques/vault-walking.md)). One
shared walker with those decisions as explicit, per-caller options is the
cure; unifying them while silently changing any caller's semantics is a new
defect wearing a refactor's clothes.

## Mirrors are derivations, and they say so

The filesystem engine has no indexes. The moment queries outgrow the walk —
relational filters, full-text ranking, incremental change feeds — a second
store appears beside the vault, and every such store is a **derivation** of
it ([mirror-indexes](techniques/mirror-indexes.md)). The vault is
authoritative; the mirror names how it is rebuilt from a full walk, gates its
writes on recorded state so re-runs are cheap and idempotent, and never lets
its own failure break the primary write path.

Direction is the contract. A one-way projection (application data rendered
*into* the vault for the human to read and link) declares that human edits to
projected notes are overwritten — or it upgrades to two-way sync, which
requires remembering the content at last sync and running a three-way
comparison per record. Both-sides-changed is a conflict escalated to the
human; the comparison discipline is
[sync-replication](../sync-replication/sync-replication.md)'s ground,
consumed here rather than re-derived. Long-lived agents storing their memory
as markdown under a relational mirror are the same pattern with higher
stakes — [agent-memory](../agent-memory/agent-memory.md) holds that evidence.

## The human's editor is a peer, not a client

The defining constraint, elevated to a design principle: another program —
the human's own editor — reads and writes these files whenever it likes, and
**it wins ties** ([editor-interop](techniques/editor-interop.md)). So the
application never holds a file open, writes atomically so no reader ever
sees a torn note, watches for external changes instead of assuming quiescence,
emits the link and metadata syntax the editor renders natively, and hands
navigation *back* across the boundary with deep links addressed by full path,
not ambiguous basename. Overwriting a human edit because the application
wrote last is not a race lost; it is data loss with the application's
fingerprints on it.

## Failure modes this standard exists to prevent

- **The silent rot** — no integrity lint, so broken links, orphans, and stale
  claims accumulate until the humans quietly stop trusting the store.
- **The false-clean scan** — a walker that skips what it cannot read and
  reports the remainder as the whole vault.
- **The emitter/parser schism** — escaping bugs that corrupt round-trips, so
  records with quotes or colons in their fields silently stop matching.
- **Filename-as-identity** — a rename or title collision severs every
  reference that used the name as the key.
- **The drifted walkers** — five hand-rolled walks with five accidental
  policies, disagreeing about depth, hidden files, and errors.
- **The lying mirror** — a derived index with no named recomputation,
  trusted long after it diverged from the files.
- **Fighting the user for the file** — locks, torn writes, or last-writer-
  wins against the human's editor.
- **The predicate-free count** — "12 orphans" from one feature and "31
  orphans" from another, because nobody wrote down which exemptions each
  count applies.

## The techniques

- [vault-as-database](techniques/vault-as-database.md) — the record contract:
  frontmatter schema, escaped emit / tolerant parse / round-trip tests,
  minted identity, sanitized filenames, atomic writes, and the one path
  funnel at the trust boundary.
- [link-graph-extraction](techniques/link-graph-extraction.md) — links as
  edges: one shared extractor, normalization and resolution rules, backlink
  indexes, hubs and unresolved edges, and the cache honesty of a derived
  graph.
- [knowledge-integrity-lint](techniques/knowledge-integrity-lint.md) —
  staleness, orphans, and broken links as defects with detectors; syntactic
  and semantic tiers; exemptions declared, not smuggled; repair as a
  separate, bounded, measured pass.
- [vault-walking](techniques/vault-walking.md) — depth caps, declared
  exclusions, and error policies as explicit options on one shared walker;
  behavior-preserving unification.
- [mirror-indexes](techniques/mirror-indexes.md) — secondary stores as named
  derivations: hash-gated incremental writes, projection vs two-way sync,
  and the ledger-vs-disk gap a skip-gate must confess.
- [editor-interop](techniques/editor-interop.md) — coexisting with a peer
  writer: atomic writes, change watching, deep links, native syntax, and
  conflicts escalated instead of raced.
