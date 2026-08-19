---
layer: application
subject: data-access
technique: query-construction
stack: rust
---

# Query construction in the Rust data layer

The repo's construction machinery is exactly the technique's three pieces —
a builder that owns placeholder bookkeeping, escaping hoisted to one
function, and a marked raw hatch — plus one advisory gap worth knowing
about before trusting it.

## The builder: `QueryBuilder` (`src-tauri/db/src/query_builder.rs`)

The module doc states the mandate outright: *"eliminates manual parameter
index tracking … instead of manually managing `Vec<Box<dyn ToSql>>` and
`format!("?{idx}")`"*. The core invariant is the technique's exactly:

```rust
// query_builder.rs:65-70
pub fn where_eq(&mut self, col: &str, val: impl ToSql + 'static) -> &mut Self {
    let idx = self.next_idx();
    self.conditions.push(format!("{col} = ?{idx}"));
    self.params.push(Box::new(val));
    self
}
```

Predicate and value appended in one motion; `next_idx()` (`:58`) is
`params.len() + 1`, so indexes are derived from builder state and the
off-by-one spelling does not exist in the API. `where_in` (`:138-153`)
generates one placeholder per element and answers the empty list with an
**always-false condition** (`push("0")`, `:141`) — the compose-friendly of
the two honest empty-list spellings, since the membership test is usually
one conjunct among several. `build_clauses` (`:269-297`) even covers the
engine quirk where offset-only needs `LIMIT -1` to stay a valid, fully
bound clause, with the incident that taught it cited in the comment.

Representative use: `get_all_global`
(`src-tauri/db/src/repos/execution/executions.rs:274-332`) assembles four
optional filters plus order and limit; every value rides `params_ref()`,
no index appears in the calling code.

## Escaping hoisted: `escape_like` (`src-tauri/db/src/repos/utils.rs:22-27`)

The doc comment is a one-paragraph proof of the technique's "one audited
place" rule: it names the ordering hazard (*"`\` must be escaped first so
it doesn't double-escape the `%`/`_` escapes introduced after it"*) and
its own origin story (*"previously hand-rolled identically in multiple
repos … hoist here so the escaping rule lives in exactly one place"*). The
builder pairs it with `where_like_escape`/`where_like_escape_any`
(`query_builder.rs:97-120`), which emit the `ESCAPE '\'` clause — escaping
and binding used together, as the technique requires.

## The marked hatch: `where_raw` (`query_builder.rs:167-176`)

Named raw, documented as "for edge cases where the standard methods don't
fit", and — the load-bearing property — **it still binds values**: the
caller receives the next parameter index and supplies boxed params. The
shape discipline is relaxed; the value discipline is not.

## Two gaps, honestly

- **Identifiers are advisory, not structural.** `order_by`
  (`query_builder.rs:198-204`) interpolates column and direction with only
  a doc comment: *"callers must validate (e.g. via allowlist)"*. The
  technique wants the unknown token to be a hard error at one closed map;
  here the map is per-call-site diligence. Every current caller passes
  literals or pre-validated tokens, but nothing makes the next one do so.
- **The hatch has a duplication problem the file itself warns about.** The
  ops-chat exclusion predicate (`input_data NOT LIKE '%"_ops"%'`) is
  spelled verbatim through `where_raw` at `executions.rs:298-301`, inline
  at `:348`, and again at `:420` — three copies of one predicate in one
  file, in a module whose own comment block (`:1755-1767`) documents, for
  a different predicate, exactly why copies "MUST stay in lock-step" or
  the count stops matching the list. Raw fragments do not deduplicate
  themselves; a fragment used twice has earned a named constant.
