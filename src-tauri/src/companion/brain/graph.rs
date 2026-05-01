//! Typed-relation graph over markdown nodes. Backed by `companion_edge` in
//! SQLite (the markdown frontmatter `links:` field is the source of truth;
//! the SQL table is a reindex-able cache for fast traversal).
//!
//! Edge relations: supports | contradicts | replaces | derives_from |
//! about | blocks
//!
//! Phase 0: stub. Phase 2: traverse, add_edge, contradict_scan.
