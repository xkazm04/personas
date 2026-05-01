//! Embedding pipeline for the companion brain. Reuses the existing
//! `engine::embedder::EmbeddingManager` (AllMiniLML6V2Q, 384-dim) and
//! `engine::vector_store` patterns — no new model bundling.
//!
//! The `companion_embedding` vec0 virtual table is created at runtime (not
//! at migration time) so that sqlite-vec auto-extension registration can
//! run first. Mirrors how knowledge bases provision their per-KB vec
//! tables in `engine::vector_store::SqliteVectorStore::create_index`.
//!
//! Schema columns `embedding_model` and `embedding_dims` on `companion_node`
//! exist so we can swap models in the future without a schema break — a
//! reindex job is sufficient.
//!
//! Phase 0: stub. Phase 2: ensure_vec_table, embed_node, reindex_all.
