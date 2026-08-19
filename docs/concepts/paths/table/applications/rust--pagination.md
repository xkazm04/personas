---
layer: application
subject: table
technique: pagination
stack: rust
---

# Keyset pagination in the Rust/SQL backend

The repo's compliant exemplar is `list_events_for_team_after` at
`src-tauri/db/src/repos/orchestration/team_assignments.rs:376-397`, the relay
cursor for the team → Slack bridge's step feed. It walks a team's assignment
events oldest-first, strictly after a composite `(created_at, id)` cursor.

## Query shape

```rust
// team_assignments.rs:386-394
"SELECT e.id, e.assignment_id, e.step_id, e.kind, e.payload, e.created_at
 FROM team_assignment_events e
 JOIN team_assignments a ON a.id = e.assignment_id
 WHERE a.team_id = ?1
   AND (e.created_at > ?2 OR (e.created_at = ?2 AND e.id > ?3))
 ORDER BY e.created_at ASC, e.id ASC
 LIMIT ?4"
```

Every element of the standard's cursor design is present:

- **Tuple predicate** (`:391`): `created_at > ?2 OR (created_at = ?2 AND id >
  ?3)` — the whole ordering tuple, not the sort value alone. SQLite has no
  row-value comparison in this form's favor here, so the OR-expansion is the
  portable spelling of `(created_at, id) > (?2, ?3)`.
- **Composite ORDER BY** (`:392`) matches the predicate exactly — `created_at
  ASC, id ASC` — so page boundaries fall between well-defined neighbors.
- **Why the tiebreaker is not optional here**: the doc comment (`:374-375`)
  says it outright — `created_at` is **second-resolution**, so equal
  timestamps are the common case, not the edge case. The same rationale and
  shape appear in the sibling
  `src-tauri/db/src/repos/resources/team_channel.rs` (`list_for_team_after`),
  which this function's comment cites.

## Cursor encoding

The cursor is the raw pair `(created_at: String, id: String)` of the last
delivered row, carried as two `Option<&str>` parameters. Absent halves default
to `""` (`:384-385`), which sorts before every real value, so "no cursor"
degrades cleanly to "from the origin". This is a trusted-caller encoding —
the cursor never leaves the process (the consumer is the in-process relay),
so the standard's opacity requirement is satisfied by scope rather than by
sealing. A cursor that crossed the IPC boundary to the webview or beyond
should be opaque (encoded, versioned against its ordering) rather than two
naked columns.

## Seeding — head, not origin

`newest_event_cursor_for_team` (`team_assignments.rs:402-420`) returns the
newest `(created_at, id)` for a team, `None` when there are no events. Its
purpose (`:399-401`): **seed a newly wired bridge's cursor forward so it never
replays historical step events** — the standard's "a new consumer's cursor is
seeded, not defaulted" rule, implemented as its own named query. The seed
query mirrors the walk's ordering (`ORDER BY created_at DESC, id DESC LIMIT
1`), so head-seeding and forward-walking agree about what "newest" means.

## Contrast: the bounded-recent variant

The same file's `list_events` (`:351-367`) is the *other* legitimate shape —
`ORDER BY created_at DESC LIMIT ?2` with a 200 default and no cursor: a
"recent slice" for display, not a resumable walk. Note it has **no `id`
tiebreaker** in its ORDER BY; that is tolerable only because nothing resumes
from its boundary — the moment a caller pages from where it stopped, it must
graduate to the `list_events_for_team_after` shape. Keep the two shapes
distinct: bounded-recent for painting a panel, keyset-after for anything that
walks.
