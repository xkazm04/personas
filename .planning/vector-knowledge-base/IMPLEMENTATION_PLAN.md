# Vector Knowledge Base — Implementation Plan

## Overview

Add a built-in local vector database to the Personas Desktop connector ecosystem, enabling users to create custom knowledge bases for semantic search in agentic automations. Starting with a minimal **Architecture A** (sqlite-vec + fastembed-rs) to validate the use case, with a planned upgrade path to **Architecture C** (hybrid sqlite-vec + LanceDB + tiered models + paid multimodal embeddings).

---

## Phase 1: MVP — sqlite-vec + MiniLM (Architecture A)

**Goal:** Ship a working vector knowledge base that lives alongside `personas_database`, using the existing rusqlite stack and a single free 23MB embedding model. Validate the use case before investing in heavier infrastructure.

**Estimated scope:** ~40 files touched/created across Rust backend and React frontend.

---

### 1.1 Rust Dependencies

**File:** `src-tauri/Cargo.toml`

```toml
[dependencies]
# Vector search extension for rusqlite (MIT/Apache-2.0)
sqlite-vec = "0.1"

# Embedding runtime — wraps ONNX Runtime, auto-downloads models (Apache-2.0)
fastembed = "5.12"

# Text chunking — semantic splitting with token awareness (MIT)
text-splitter = { version = "0.16", features = ["tokenizers"] }
```

**Notes:**
- `sqlite-vec` loads as a SQLite extension into the existing `rusqlite` connection — zero new database processes
- `fastembed` bundles `ort` (ONNX Runtime) — adds ~8-10MB to binary size
- `text-splitter` is lightweight (<200KB)
- All three crates are Apache-2.0 or MIT — safe for desktop distribution

---

### 1.2 Database Schema (Migrations)

**File:** `src-tauri/src/db/migrations.rs` — add new migration

```sql
-- Knowledge base registry (one row per KB)
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    embedding_model TEXT NOT NULL DEFAULT 'AllMiniLML6V2Q',
    embedding_dims  INTEGER NOT NULL DEFAULT 384,
    chunk_size      INTEGER NOT NULL DEFAULT 512,
    chunk_overlap   INTEGER NOT NULL DEFAULT 50,
    document_count  INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'ready',  -- ready | indexing | error
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Source documents tracked for deduplication & re-indexing
CREATE TABLE IF NOT EXISTS kb_documents (
    id              TEXT PRIMARY KEY,
    kb_id           TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source_type     TEXT NOT NULL,       -- 'file', 'text', 'url', 'clipboard'
    source_path     TEXT,                -- filesystem path or URL (nullable for raw text)
    title           TEXT NOT NULL,
    content_hash    TEXT NOT NULL,        -- SHA-256 of raw content for dedup
    byte_size       INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT,                -- arbitrary JSON (tags, author, etc.)
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | indexed | error
    error_message   TEXT,
    indexed_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON kb_documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_hash ON kb_documents(content_hash);

-- Text chunks with back-reference to source document
CREATE TABLE IF NOT EXISTS kb_chunks (
    id              TEXT PRIMARY KEY,
    kb_id           TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id     TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT,                -- inherited + chunk-specific metadata
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(kb_id);
```

**Vector table** — created dynamically per knowledge base (because sqlite-vec virtual tables have fixed dimensions):

```sql
-- Created when a KB is initialized (in Rust code, not migration)
CREATE VIRTUAL TABLE IF NOT EXISTS kb_vectors_{kb_id_safe} USING vec0(
    chunk_id TEXT,
    embedding float[384]
);
```

**Design decisions:**
- One `vec0` virtual table per KB (not global) — allows different dimensions per KB in future
- `kb_id_safe` = KB id with hyphens replaced by underscores (sqlite identifier safety)
- `content_hash` on documents enables skip-if-unchanged re-indexing
- Chunks stored in regular table (not in vec0) so we get full SQL on metadata

---

### 1.3 Rust Models

**File:** `src-tauri/src/db/models/knowledge_base.rs` (new)

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub id: String,
    pub credential_id: String,
    pub name: String,
    pub description: Option<String>,
    pub embedding_model: String,
    pub embedding_dims: i32,
    pub chunk_size: i32,
    pub chunk_overlap: i32,
    pub document_count: i32,
    pub chunk_count: i32,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbDocument {
    pub id: String,
    pub kb_id: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub title: String,
    pub content_hash: String,
    pub byte_size: i64,
    pub chunk_count: i32,
    pub metadata_json: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub indexed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbChunk {
    pub id: String,
    pub kb_id: String,
    pub document_id: String,
    pub chunk_index: i32,
    pub content: String,
    pub token_count: i32,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub document_title: String,
    pub content: String,
    pub score: f32,
    pub distance: f32,
    pub source_path: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbIngestRequest {
    pub kb_id: String,
    pub source_type: String,       // "file" | "text" | "directory" | "url"
    pub source_path: Option<String>,
    pub raw_text: Option<String>,
    pub title: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbSearchQuery {
    pub kb_id: String,
    pub query: String,
    pub top_k: Option<usize>,        // default 10
    pub min_score: Option<f32>,       // optional threshold
    pub filter_source: Option<String>,// filter by source_path prefix
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbIngestProgress {
    pub job_id: String,
    pub kb_id: String,
    pub status: String,
    pub documents_total: usize,
    pub documents_done: usize,
    pub chunks_created: usize,
    pub current_file: Option<String>,
    pub error: Option<String>,
}
```

**Register in:** `src-tauri/src/db/models/mod.rs`

---

### 1.4 Core Engine Modules

#### 1.4.1 Embedding Manager

**File:** `src-tauri/src/engine/embedder.rs` (new)

**Responsibilities:**
- Initialize `fastembed::TextEmbedding` model on first use
- Cache the loaded model in `Arc<tokio::sync::RwLock<Option<TextEmbedding>>>`
- Embed single query or batch of chunks
- Unload model after 5 minutes idle (timer via `tokio::time::sleep`)
- Report model download progress via Tauri events

```rust
pub struct EmbeddingManager {
    model: Arc<RwLock<Option<TextEmbedding>>>,
    model_id: EmbeddingModel,
    last_used: Arc<RwLock<Instant>>,
    cache_dir: PathBuf,
}

impl EmbeddingManager {
    pub fn new(cache_dir: PathBuf) -> Self { ... }

    /// Embed a single query string. Loads model if not cached.
    pub async fn embed_query(&self, text: &str) -> Result<Vec<f32>, AppError> { ... }

    /// Embed a batch of text chunks. Returns Vec<Vec<f32>> in same order.
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, AppError> { ... }

    /// Get embedding dimensions for current model.
    pub fn dimensions(&self) -> usize { 384 }

    /// Unload model from memory.
    pub async fn unload(&self) { ... }
}
```

**AppState addition:** `pub embedding_manager: Arc<EmbeddingManager>`

**Model download location:** `{app_data_dir}/models/onnx/` (via `fastembed::InitOptionsUserDefined::with_cache_dir()`)

**First-use UX:**
- Tauri event `kb:model_download_progress` emitted with `{ bytes_downloaded, bytes_total, model_name }`
- Frontend shows progress bar in ingest dialog
- Model cached permanently after first download (~23MB for MiniLM INT8)

#### 1.4.2 Vector Store (sqlite-vec wrapper)

**File:** `src-tauri/src/engine/vector_store.rs` (new)

**Responsibilities:**
- Load `sqlite-vec` extension into a rusqlite connection
- Create/drop per-KB vector virtual tables
- Insert embeddings (batch)
- Similarity search (KNN via `vec_distance_L2`)
- Delete vectors by chunk_id or document_id

```rust
pub struct SqliteVectorStore {
    pool: DbPool,   // shares the UserDbPool (personas_data.db)
}

impl SqliteVectorStore {
    /// Load sqlite-vec extension. Called once at app startup.
    pub fn init(pool: &DbPool) -> Result<(), AppError> {
        let conn = pool.get()?;
        unsafe { conn.load_extension_enable()?; }
        sqlite_vec::load(&conn)?;
        unsafe { conn.load_extension_disable()?; }
        Ok(())
    }

    /// Create vector virtual table for a knowledge base.
    pub fn create_index(&self, kb_id: &str, dims: usize) -> Result<(), AppError> { ... }

    /// Drop vector virtual table.
    pub fn drop_index(&self, kb_id: &str) -> Result<(), AppError> { ... }

    /// Insert batch of (chunk_id, embedding) pairs.
    pub fn insert_vectors(
        &self, kb_id: &str, entries: &[(String, Vec<f32>)]
    ) -> Result<usize, AppError> { ... }

    /// KNN similarity search. Returns (chunk_id, distance) pairs.
    pub fn search(
        &self, kb_id: &str, query_vec: &[f32], k: usize
    ) -> Result<Vec<(String, f32)>, AppError> { ... }

    /// Delete vectors by chunk IDs.
    pub fn delete_by_chunks(
        &self, kb_id: &str, chunk_ids: &[String]
    ) -> Result<usize, AppError> { ... }
}
```

#### 1.4.3 Document Chunker

**File:** `src-tauri/src/engine/chunker.rs` (new)

**Responsibilities:**
- Read files from disk (`.txt`, `.md`, `.html` — Phase 1 only)
- Split text into chunks using `text-splitter` crate
- Compute SHA-256 content hash for deduplication
- Return structured chunks with positional metadata

```rust
pub struct ChunkResult {
    pub chunks: Vec<TextChunk>,
    pub content_hash: String,
    pub byte_size: usize,
}

pub struct TextChunk {
    pub content: String,
    pub token_count: usize,
    pub chunk_index: u32,
}

/// Chunk a raw text string with given parameters.
pub fn chunk_text(
    text: &str,
    max_tokens: usize,    // default 512
    overlap_tokens: usize, // default 50
) -> ChunkResult { ... }

/// Read a file and chunk its content. Detects format by extension.
pub fn chunk_file(
    path: &Path,
    max_tokens: usize,
    overlap_tokens: usize,
) -> Result<ChunkResult, AppError> {
    let text = match path.extension().and_then(|e| e.to_str()) {
        Some("md" | "txt") => std::fs::read_to_string(path)?,
        Some("html" | "htm") => strip_html_tags(&std::fs::read_to_string(path)?),
        _ => return Err(AppError::unsupported_format(path)),
    };
    Ok(chunk_text(&text, max_tokens, overlap_tokens))
}
```

#### 1.4.4 Ingest Pipeline (Background Job)

**File:** `src-tauri/src/engine/kb_ingest.rs` (new)

**Responsibilities:**
- Orchestrate: read source → chunk → embed → store
- Run as background job with progress events
- Support cancellation via `CancellationToken`
- Skip already-indexed documents (by content_hash)
- Batch embedding (32 chunks at a time)

```rust
pub async fn ingest_documents(
    app: AppHandle,
    pool: DbPool,
    embedder: Arc<EmbeddingManager>,
    vector_store: Arc<SqliteVectorStore>,
    request: KbIngestRequest,
    cancel: CancellationToken,
) -> Result<KbIngestProgress, AppError> {
    // 1. Resolve source → list of (title, content) pairs
    // 2. For each document:
    //    a. Compute content_hash, skip if unchanged
    //    b. Chunk text
    //    c. Insert chunks into kb_chunks table
    //    d. Batch embed (32 at a time)
    //    e. Insert vectors into vec0 table
    //    f. Update kb_documents status
    //    g. Emit progress event
    //    h. Check cancellation token
    // 3. Update knowledge_bases counters
}
```

**Background job integration:** Uses existing `BackgroundJobManager<KbIngestProgress>` pattern from `background_job.rs`.

**Tauri events emitted:**
- `kb:ingest_progress` — `{ job_id, documents_done, documents_total, chunks_created, current_file }`
- `kb:ingest_complete` — `{ job_id, kb_id, total_chunks, total_documents }`
- `kb:ingest_error` — `{ job_id, error }`

---

### 1.5 Tauri Commands

**File:** `src-tauri/src/commands/credentials/vector_kb.rs` (new)

```rust
// --- Knowledge Base CRUD ---
#[tauri::command]
pub async fn create_knowledge_base(name: String, description: Option<String>)
    -> Result<KnowledgeBase, AppError>;

#[tauri::command]
pub async fn list_knowledge_bases() -> Result<Vec<KnowledgeBase>, AppError>;

#[tauri::command]
pub async fn get_knowledge_base(kb_id: String) -> Result<KnowledgeBase, AppError>;

#[tauri::command]
pub async fn delete_knowledge_base(kb_id: String) -> Result<(), AppError>;

// --- Document Ingestion ---
#[tauri::command]
pub async fn kb_ingest_files(kb_id: String, file_paths: Vec<String>)
    -> Result<String, AppError>;  // returns job_id

#[tauri::command]
pub async fn kb_ingest_text(kb_id: String, title: String, text: String)
    -> Result<String, AppError>;  // returns job_id

#[tauri::command]
pub async fn kb_ingest_directory(kb_id: String, dir_path: String, patterns: Vec<String>)
    -> Result<String, AppError>;  // returns job_id

#[tauri::command]
pub async fn kb_cancel_ingest(job_id: String) -> Result<(), AppError>;

#[tauri::command]
pub async fn kb_ingest_status(job_id: String) -> Result<KbIngestProgress, AppError>;

// --- Search ---
#[tauri::command]
pub async fn kb_search(query: KbSearchQuery) -> Result<Vec<VectorSearchResult>, AppError>;

// --- Document Management ---
#[tauri::command]
pub async fn kb_list_documents(kb_id: String) -> Result<Vec<KbDocument>, AppError>;

#[tauri::command]
pub async fn kb_delete_document(document_id: String) -> Result<(), AppError>;

#[tauri::command]
pub async fn kb_reindex_document(document_id: String) -> Result<String, AppError>;
```

**Register in:** `src-tauri/src/lib.rs` → `invoke_handler(tauri::generate_handler![...])` block.

---

### 1.6 Connector Definition

**File:** `scripts/connectors/builtin/vector-knowledge-base.json` (new)

```json
{
  "id": "builtin-vector-knowledge-base",
  "name": "personas_vector_db",
  "label": "Vector Knowledge Base",
  "color": "#8B5CF6",
  "icon_url": "/icons/connectors/vector-db.svg",
  "category": "database",
  "fields": [],
  "healthcheck_config": null,
  "services": [
    { "toolName": "kb_semantic_search", "label": "Semantic Search" },
    { "toolName": "kb_list_documents", "label": "List Documents" },
    { "toolName": "kb_ingest_text", "label": "Ingest Text" }
  ],
  "events": [],
  "metadata": {
    "template_enabled": true,
    "summary": "Local vector knowledge base powered by sqlite-vec. Store documents, create embeddings locally, and run semantic search — entirely offline, no API keys needed.",
    "auth_type": "none",
    "auth_type_label": "Built-in (Local)",
    "connection_mode": "local",
    "capabilities": ["file_read", "vector_search", "embedding"],
    "docs_url": "",
    "setup_guide": "Knowledge bases are stored locally. Drop files or paste text to build your knowledge base. Embedding is done on-device using a lightweight AI model (~23MB download on first use)."
  }
}
```

---

### 1.7 Tool Integration for Agents

**File:** `src-tauri/src/engine/db_query.rs` — extend existing dispatch

Add a new branch for `service_type == "personas_vector_db"`:

```rust
// In execute_query():
"personas_vector_db" => {
    // Parse query as semantic search command
    // Format: "SEARCH <kb_id> <query_text> [LIMIT <k>]"
    // Or: "LIST DOCUMENTS <kb_id>"
    // Or: "INGEST <kb_id> <text>"
    execute_vector_query(pool, &query_text, embedder, vector_store).await
}
```

This lets existing persona tools query knowledge bases using a simple command syntax, and agents can use `kb_semantic_search` tool with natural language.

---

### 1.8 Frontend — API Layer

**File:** `src/api/vault/database/vectorKb.ts` (new)

```typescript
import { invoke } from '../../tauriApi';
import type {
  KnowledgeBase,
  KbDocument,
  VectorSearchResult,
  KbSearchQuery,
  KbIngestProgress,
} from '@/lib/bindings';

// CRUD
export const createKnowledgeBase = (name: string, description?: string) =>
  invoke<KnowledgeBase>('create_knowledge_base', { name, description });

export const listKnowledgeBases = () =>
  invoke<KnowledgeBase[]>('list_knowledge_bases');

export const getKnowledgeBase = (kbId: string) =>
  invoke<KnowledgeBase>('get_knowledge_base', { kbId });

export const deleteKnowledgeBase = (kbId: string) =>
  invoke<void>('delete_knowledge_base', { kbId });

// Ingestion
export const kbIngestFiles = (kbId: string, filePaths: string[]) =>
  invoke<string>('kb_ingest_files', { kbId, filePaths });

export const kbIngestText = (kbId: string, title: string, text: string) =>
  invoke<string>('kb_ingest_text', { kbId, title, text });

export const kbIngestDirectory = (kbId: string, dirPath: string, patterns: string[]) =>
  invoke<string>('kb_ingest_directory', { kbId, dirPath, patterns });

export const kbCancelIngest = (jobId: string) =>
  invoke<void>('kb_cancel_ingest', { jobId });

export const kbIngestStatus = (jobId: string) =>
  invoke<KbIngestProgress>('kb_ingest_status', { jobId });

// Search
export const kbSearch = (query: KbSearchQuery) =>
  invoke<VectorSearchResult[]>('kb_search', { query });

// Documents
export const kbListDocuments = (kbId: string) =>
  invoke<KbDocument[]>('kb_list_documents', { kbId });

export const kbDeleteDocument = (documentId: string) =>
  invoke<void>('kb_delete_document', { documentId });

export const kbReindexDocument = (documentId: string) =>
  invoke<string>('kb_reindex_document', { documentId });
```

---

### 1.9 Frontend — UI Components

**Location:** `src/features/vault/sub_vector/` (new directory)

#### Component Tree

```
sub_vector/
├── VectorKbCard.tsx           # Card in vault database list (name, doc count, status)
├── VectorKbDetail.tsx         # Main detail view when KB is selected
├── tabs/
│   ├── DocumentsTab.tsx       # List of ingested documents with status badges
│   ├── SearchTab.tsx          # Search input + results list with highlighted chunks
│   └── SettingsTab.tsx        # KB settings (name, chunk size, model info)
├── ingest/
│   ├── IngestDropZone.tsx     # Drag & drop file area
│   ├── IngestTextModal.tsx    # Paste raw text modal
│   ├── IngestDirectoryPicker.tsx  # Directory picker with glob patterns
│   └── IngestProgressBar.tsx  # Background job progress (listens to Tauri events)
└── search/
    ├── SearchInput.tsx        # Query input with "Semantic Search" label
    └── SearchResultCard.tsx   # Single result: title, snippet, score, source
```

**Integration points:**
- `VectorKbCard` rendered alongside `DatabaseCard` in the vault databases section
- Reuses existing vault UI patterns (card grid, tab navigation, detail panel)
- Search results show relevance score as a visual bar + distance value

---

### 1.10 Implementation Order

| Step | Files | Depends On | Est. Effort |
|------|-------|-----------|-------------|
| **1** | `Cargo.toml` — add deps | — | 10 min |
| **2** | `db/migrations.rs` — schema | Step 1 | 30 min |
| **3** | `db/models/knowledge_base.rs` — types | — | 30 min |
| **4** | `engine/chunker.rs` — text splitting | Step 1 | 1 hour |
| **5** | `engine/embedder.rs` — fastembed wrapper | Step 1 | 2 hours |
| **6** | `engine/vector_store.rs` — sqlite-vec ops | Step 2 | 2 hours |
| **7** | `engine/kb_ingest.rs` — pipeline | Steps 4-6 | 3 hours |
| **8** | `commands/credentials/vector_kb.rs` — commands | Steps 3, 7 | 2 hours |
| **9** | `lib.rs` — register commands + AppState | Step 8 | 30 min |
| **10** | Connector JSON + icon | — | 20 min |
| **11** | `db_query.rs` — vector query dispatch | Steps 6, 8 | 1 hour |
| **12** | Frontend API layer (`vectorKb.ts`) | Step 8 | 30 min |
| **13** | Frontend UI components | Step 12 | 4-6 hours |
| **14** | Integration testing | All | 2 hours |

**Total estimated:** ~2-3 working days for a single developer.

---

### 1.11 Resource Budget (MVP)

| Resource | Budget | Notes |
|----------|--------|-------|
| Binary size increase | +8-10 MB | ONNX Runtime via fastembed |
| First-use download | 23 MB | MiniLM-L6-v2 INT8 ONNX model |
| RAM during embedding | ~150 MB | Model loaded on demand |
| RAM idle | 0 MB | Model unloaded after 5 min |
| Storage per 100K chunks | ~37 MB vectors + ~50 MB text | INT8 quantized, 384-dim |
| Search latency (100K) | <70 ms | Brute-force; <4ms if quantized+preloaded |
| Embedding speed | ~2500 chunks/sec | MiniLM on mid-range CPU |
| Ingest 1000 docs (~5MB) | ~30 seconds | Chunking + embedding + insertion |

---

## Phase 2: Architecture C Upgrade Path

**Trigger:** Phase 1 validated — users actively building knowledge bases with >50K chunks, requesting better quality, multilingual support, or multimodal ingestion.

---

### 2.1 VectorStore Trait Abstraction

**File:** `src-tauri/src/engine/vector_store.rs` — refactor

Extract the Phase 1 sqlite-vec implementation behind a trait to enable pluggable backends:

```rust
#[async_trait]
pub trait VectorStore: Send + Sync {
    async fn create_index(&self, kb_id: &str, dims: usize) -> Result<(), AppError>;
    async fn drop_index(&self, kb_id: &str) -> Result<(), AppError>;
    async fn insert_vectors(&self, kb_id: &str, entries: &[(String, Vec<f32>)]) -> Result<usize, AppError>;
    async fn search(&self, kb_id: &str, query_vec: &[f32], k: usize, filter: Option<&str>) -> Result<Vec<(String, f32)>, AppError>;
    async fn delete_by_chunks(&self, kb_id: &str, chunk_ids: &[String]) -> Result<usize, AppError>;
    async fn count(&self, kb_id: &str) -> Result<usize, AppError>;
    async fn stats(&self, kb_id: &str) -> Result<StoreStats, AppError>;
}

pub struct SqliteVecStore { /* Phase 1 implementation */ }
impl VectorStore for SqliteVecStore { ... }

pub struct LanceStore { /* Phase 2 implementation */ }
impl VectorStore for LanceStore { ... }

/// Factory — dispatches based on KB backend setting
pub fn open_store(kb: &KnowledgeBase, app_state: &AppState) -> Arc<dyn VectorStore> {
    match kb.backend.as_deref() {
        Some("lance") => Arc::new(LanceStore::new(&kb.lance_path)),
        _             => Arc::clone(&app_state.sqlite_vector_store),
    }
}
```

### 2.2 LanceDB Backend (Feature-Gated)

**Cargo.toml:**
```toml
[features]
default = ["desktop", "vector-sqlite"]
vector-sqlite = ["sqlite-vec"]
vector-lance = ["lancedb", "arrow"]

[dependencies]
lancedb = { version = "0.23", optional = true }
arrow = { version = "53", optional = true }
```

- Default build: sqlite-vec only (~200KB overhead)
- `vector-lance` feature: adds LanceDB + Arrow (~15-20MB binary increase)
- CI builds both variants; user-facing installer includes both

**LanceDB store location:** `{app_data_dir}/vector_stores/{kb_id}/` (directory of Lance columnar files)

**Migration path sqlite-vec → Lance:**
1. Read all vectors + metadata from sqlite-vec
2. Batch insert into new LanceDB table with Arrow RecordBatch
3. Build IVF-PQ index
4. Update KB `backend` field to `"lance"`
5. Drop old vec0 virtual table
6. UI shows progress during migration

**When to suggest upgrade:**
- KB chunk count > 100K
- User enables metadata filtering in search (Lance supports it natively; sqlite-vec requires post-filter)
- User imports large directories (>1000 files)

### 2.3 Tiered Embedding Models

**Extend `EmbeddingManager` with model selection:**

| Tier | Model | Dims | Download | RAM | Quality | When to Recommend |
|------|-------|------|----------|-----|---------|-------------------|
| **S** (default) | all-MiniLM-L6-v2 INT8 | 384 | 23 MB | 150 MB | Moderate | Always (free, fast) |
| **M** | snowflake-arctic-embed-s | 384 | 33 MB | 200 MB | Good | User wants better accuracy |
| **L** | nomic-embed-text-v1.5 Q8 | 768 | 262 MB | 400 MB | High | Large KBs, long docs (8K context) |
| **XL** | EmbeddingGemma INT8 | 768 | ~200 MB | 300 MB | Best <500M | Multilingual needs |

**Model switching rules:**
- Changing model requires full re-embedding of all chunks in the KB
- UI warns user: "This will re-process all N documents. Estimated time: X minutes."
- Re-embedding runs as background job with progress
- Old vectors deleted only after new vectors fully indexed (atomic swap)

**Dimension compatibility:**
- S and M tiers both output 384-dim → interchangeable in same vec0 table
- L and XL tiers output 768-dim → require new vec0 table with different dims
- Switching between 384↔768 requires migration + re-embedding

### 2.4 Google Gemini Embedding Integration (Paid Tier)

**File:** `src-tauri/src/engine/embedding_providers/gemini.rs` (new)

#### Google Embedding 2 Key Facts

| Property | Value |
|----------|-------|
| Model | `gemini-embedding-001` (GA) / `gemini-embedding-2-preview` (multimodal) |
| Modalities | Text only (001) / Text + Image + Video + Audio + PDF (002) |
| Default dims | 3072 |
| MRL support | Yes — can truncate to 128, 256, 384, 512, 768, 1024, 1536, 3072 |
| Max input | 8192 tokens (text) |
| Free tier | ~1000 requests/day, 100 requests/min |
| Paid | $0.20 / million tokens ($0.10 batch API) |
| API | REST: `POST /v1beta/models/{model}:embedContent` |
| Languages | 100+ |

#### Unified Dimension Strategy

**Recommended approach:** Set `outputDimensionality: 768` on Gemini API calls.

This matches the local Tier L/XL models (768-dim) and leverages Matryoshka Representation Learning — Google's first 768 dimensions contain the highest-information features. Quality loss from 3072→768 truncation is minimal per Google's benchmarks.

**Architecture:**

```rust
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, AppError>;
    async fn embed_image(&self, image_bytes: &[u8]) -> Result<Vec<f32>, AppError>;
    fn dimensions(&self) -> usize;
    fn provider_name(&self) -> &str;
    fn supports_modality(&self, modality: &str) -> bool;
}

pub struct LocalEmbedder { /* fastembed wrapper — Phase 1 */ }
pub struct GeminiEmbedder {
    api_key: String,          // from credential fields
    model: String,            // "gemini-embedding-001" or "gemini-embedding-2-preview"
    output_dims: usize,       // 768 recommended
    client: reqwest::Client,
}

impl EmbeddingProvider for GeminiEmbedder {
    async fn embed_texts(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, AppError> {
        // POST /v1beta/models/{model}:batchEmbedContents
        // with outputDimensionality: self.output_dims
        // Normalize output vectors (required for non-3072 dims)
    }

    async fn embed_image(&self, image_bytes: &[u8]) -> Result<Vec<f32>, AppError> {
        // Only gemini-embedding-2-preview supports this
        // Encode image as base64, send as inline_data part
    }

    fn supports_modality(&self, modality: &str) -> bool {
        match self.model.as_str() {
            "gemini-embedding-2-preview" => matches!(modality, "text" | "image" | "video" | "audio" | "pdf"),
            _ => modality == "text",
        }
    }
}
```

#### LanceDB + Gemini Compatibility

**Yes, fully compatible.** LanceDB stores raw float vectors — it doesn't care about the source. Two integration patterns:

**Pattern A — Unified Column (recommended for simplicity):**
- Both local and Gemini embeddings output 768-dim (local via Tier L/XL, Gemini via `outputDimensionality: 768`)
- Single `vector` column in LanceDB table
- Single search path
- User can mix local + Gemini-embedded documents in same KB

**Pattern B — Dual Columns (maximum quality):**
- LanceDB supports multiple vector columns with different dimensions per table
- `vector_local: Vector(384)` + `vector_gemini: Vector(768)`
- Separate ANN indexes per column
- Search specifies which column to query

**Connector definition for Gemini embeddings:**
```json
{
  "id": "builtin-gemini-embeddings",
  "name": "gemini_embeddings",
  "label": "Google Gemini Embeddings",
  "category": "ai",
  "fields": [
    {
      "key": "api_key",
      "label": "Gemini API Key",
      "type": "password",
      "required": true,
      "helpText": "Get a free API key at ai.google.dev"
    }
  ],
  "metadata": {
    "auth_type": "api_key",
    "summary": "Google's multimodal embedding API. Supports text, images, video, audio, and PDFs. Free tier: 1000 requests/day.",
    "capabilities": ["embedding_text", "embedding_image", "embedding_multimodal"]
  }
}
```

#### Multimodal Ingestion Flow (Gemini Embedding 2)

```
Image/PDF dropped into KB
    → Detect modality
    → If Gemini credential exists & supports modality:
        → Send to Gemini API as inline_data part
        → Receive 768-dim vector
        → Store in same vector column as text embeddings
    → Else:
        → Show error: "Image embedding requires Google Gemini API key"
        → Link to free key setup at ai.google.dev

Cross-modal search:
    → User types text query
    → Embed with same provider (Gemini)
    → Search returns matching text AND image chunks
    → Because they share the same embedding space
```

### 2.5 Hybrid Search (Full-Text + Vector)

**Phase 2 addition:** Combine sqlite FTS5 with vector search for best results.

```sql
-- FTS5 table mirrors kb_chunks for full-text search
CREATE VIRTUAL TABLE kb_fts_{kb_id_safe} USING fts5(
    content, chunk_id UNINDEXED
);

-- Hybrid search: RRF (Reciprocal Rank Fusion) of vector + FTS results
```

```rust
pub async fn hybrid_search(
    kb_id: &str,
    query: &str,
    query_vec: &[f32],
    k: usize,
    alpha: f32,  // 0.0 = pure FTS, 1.0 = pure vector
) -> Result<Vec<VectorSearchResult>, AppError> {
    let vec_results = vector_store.search(kb_id, query_vec, k * 2).await?;
    let fts_results = fts_search(kb_id, query, k * 2)?;
    reciprocal_rank_fusion(vec_results, fts_results, k, alpha)
}
```

### 2.6 Architecture C Full Component Map

```
Phase 2 additions (on top of Phase 1):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Rust Engine:
  engine/vector_store.rs        → Refactor to trait + SqliteVecStore + LanceStore
  engine/embedder.rs            → Refactor to EmbeddingProvider trait
  engine/embedding_providers/
    local.rs                    → fastembed wrapper (extracted from embedder.rs)
    gemini.rs                   → Google Gemini API client
  engine/kb_ingest.rs           → Add multimodal support, provider dispatch

DB Models:
  knowledge_base.rs             → Add: backend, embedding_provider, model_tier fields

Commands:
  vector_kb.rs                  → Add: kb_migrate_backend, kb_switch_model, kb_switch_provider

Connectors:
  gemini-embeddings.json        → Paid embedding connector

Frontend:
  sub_vector/settings/
    ModelTierPicker.tsx          → S/M/L/XL model selection with size/quality labels
    BackendToggle.tsx            → SQLite ↔ Lance migration trigger
    EmbeddingProviderPicker.tsx  → Local ↔ Gemini ↔ (future: OpenAI, Cohere)
  sub_vector/ingest/
    IngestImageDrop.tsx          → Image/PDF drop zone (Gemini only)
    MultimodalBadge.tsx          → Shows modality icon on search results
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| sqlite-vec brute-force too slow at scale | Low (fine to 500K) | Medium | Phase 2 LanceDB backend |
| fastembed model download fails (offline user) | Medium | High | Allow manual model file placement; bundle in installer as option |
| ONNX Runtime binary compat issues on older Windows | Low | High | Test on Windows 10 21H2+; `ort` crate handles platform detection |
| sqlite-vec extension loading fails | Low | High | sqlite-vec is pure C, bundled; test early on all platforms |
| User expects multilingual in Phase 1 | Medium | Low | Clear "English-optimized" label; Phase 2 adds multilingual |
| Gemini free tier rate limits hit during bulk ingest | Medium | Medium | Implement backoff + resume; warn user about rate limits in UI |

---

## Success Criteria

### Phase 1 (MVP)
- [ ] User can create a knowledge base from the vault UI
- [ ] User can drag & drop .txt/.md files to ingest
- [ ] User can paste raw text to ingest
- [ ] Semantic search returns relevant chunks with scores
- [ ] Agents can use `kb_semantic_search` tool in automations
- [ ] Embedding model downloads automatically on first use with progress
- [ ] Works offline after first model download
- [ ] Ingest of 1000 documents completes in <60 seconds
- [ ] Search returns in <100ms for KBs under 100K chunks

### Phase 2 (Architecture C)
- [ ] LanceDB backend available for KBs >100K chunks
- [ ] Model tier picker (S/M/L/XL) with re-embedding migration
- [ ] Google Gemini embedding integration with API key
- [ ] Multimodal ingestion (images, PDFs) via Gemini
- [ ] Hybrid full-text + vector search
- [ ] Cross-modal search (text query finds relevant images)
