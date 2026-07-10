# Memory Management Service — design & rollout plan

> Status: **Phase 1 shipped** (local Memory Engine v2 inside Personas), **Phase 2 planned**
> (standalone cloud service — Qwen Cloud hackathon Track 1 "MemoryAgent" entry).
> Session: 2026-07-10.

## 1. Why

Two goals with one architecture:

1. **At worst**: upgrade Personas' internal memory system — reflection/consolidation,
   value-aware recall, and category-aware forgetting were the three real gaps in an
   otherwise mature subsystem (tiers, importance, proposal-gated curation, scheduling).
2. **At best**: a path to a standalone **memory management service** usable by any
   agent product, entered into the Qwen Cloud hackathon (Track 1: MemoryAgent) and
   potentially productized. Track 1 judges exactly the three verbs below.

The strategy that makes both true simultaneously: define the engine as **three verbs**
whose local Rust implementation (phase 1) IS the behavioural spec for the cloud API
(phase 2). Personas becomes the service's first client, not its prison.

## 2. The three verbs

### 2.1 `recall(scope, budget)` — context-window-aware retrieval

Local implementation: `src-tauri/src/engine/memory_recall.rs`.

- **Value model**: `score = importance × 0.5^(age / half_life(category)) × (1 + 0.25·ln(1 + access_count))`
  - age anchors at `last_accessed_at` (real use keeps memories fresh), else `created_at`
  - category half-lives: constraint 365d · instruction 180d · preference 120d ·
    fact 90d · learned 60d · context 21d
- **Budget packing**: candidates are re-ranked by decayed value and greedy-packed
  *whole* into an explicit char budget (6,000 chars ≈ 1.5k tokens in the runner).
  Replaces the old "importance sort, then blind truncation" which could cut the most
  relevant memory because a stale one padded the budget first.
- **Access discipline**: only memories actually injected get `access_count` bumps —
  the signal the decay model feeds on stays honest.
- Cloud mapping: `POST /v1/recall {scope, budget_tokens, query?}`. The service adds an
  optional embedding re-rank stage (`query` → Qwen `text-embedding-v3`) in front of the
  same packer. Locally the seam is the same function boundary; fastembed (`ml` feature)
  can slot in later without touching callers.

### 2.2 `reflect(persona)` — synthesis of durable insights

Local implementation: `src-tauri/src/engine/memory_reflection.rs`.

Pipeline: fetch non-archived memories → **deterministic cluster hints** (word-set
Jaccard ≥ 0.30, union-find single-linkage) → one-shot LLM pass → validated
`synthesize` / `archive` actions → written as a `persona_memory_review_proposal`
(review-and-discard, never direct mutation).

- `synthesize`: N ≥ 2 source memories → one durable insight; contradiction resolution
  is a synthesis citing both sides. On apply: `create_synthesized` writes the insight
  with **`derived_from` provenance** (new column on `persona_memories`), then archives
  the sources (reversible; `core` guarded at three layers: prompt, classifier, repo).
- `archive`: standalone stale rows.
- Validation firewall (`classify_reflection_output`, unit-tested): drops hallucinated
  source ids, core-tier sources, <2-source insights; clamps importance; normalizes
  category; caps at 10 insights per pass.
- Runs three ways: `reflect_memories_with_cli` (IPC, synchronous), the
  `memory_reflection_run` background-job kind (async, cancelable, Tauri events), and —
  later — on the curation cron.

Why cluster hints matter for phase 2: they move structure discovery OUT of the LLM.
A frontier model doesn't need them; **Qwen doing single-pass synthesis over
pre-clustered input is exactly the low-iteration shape it handles well**. Determinism
is also what makes reflection auditable and replayable.

### 2.3 `forget(policy)` — decay-based archival

Local implementation: `run_decay_forgetting` in `memory_recall.rs`, invoked after each
run's lifecycle pass.

- Archive (never delete) `active`-tier memories whose decayed score < 0.75, with
  guards: min age 21 days, importance ≤ 3 only, `core` untouchable.
- Replaces the binary "30 days + zero access" rule; a constraint effectively never
  decays, session context fades in weeks.
- Cloud mapping: a background policy per tenant (`PUT /v1/policies/forgetting`), same
  scoring function, plus a "why was this forgotten" audit log (score trace at archive
  time — a differentiator worth demoing).

## 3. Phase 2 — the standalone service

### 3.1 Shape

Standalone open-source repo (working name: `recollect`) — NOT an extraction of
Personas code; a small service that implements the same three-verb contract:

```
Client (any agent app) ──HTTP──▶ recollect API (Alibaba Function Compute or ECS)
                                   ├─ ingest pipeline  ── Qwen: normalize / categorize /
                                   │                       PII-scrub / semantic dedup
                                   ├─ store: ApsaraDB RDS PostgreSQL (+pgvector)
                                   ├─ recall: embedding re-rank (DashScope
                                   │          text-embedding-v3) + decay pack
                                   ├─ reflect: cluster hints (port of the Rust
                                   │           Jaccard/union-find) + Qwen synthesis
                                   └─ forget: scheduled decay policy + audit log
```

API sketch (multi-tenant, API-key scoped):

| Endpoint | Verb | Notes |
|---|---|---|
| `POST /v1/memories` | ingest | Qwen cleaning at write time; returns normalized row + dedup verdict |
| `POST /v1/recall` | recall | `{scope, budget_tokens, query?}` → packed set + omission report |
| `POST /v1/reflect` | reflect | async job → proposal object; `POST /v1/proposals/{id}/apply\|discard` |
| `PUT /v1/policies/forgetting` | forget | per-tenant half-life overrides + floor |
| `GET /v1/analytics` | — | memory health: growth, consolidation ratio, recall hit-rate |

### 3.2 Where Qwen fits (and why its limits don't matter here)

Every LLM call in the service is **single-pass, schema-validated, low-iteration**:
ingest cleaning (normalize/categorize/PII), semantic dedup verdicts, reflection
synthesis over pre-clustered input, analytics summaries. No agentic loops, no tool
use, no long-horizon reasoning. The deterministic validation firewall (ported from
`classify_reflection_output`) catches bad outputs instead of retry loops.

### 3.3 Hackathon submission mapping (Track 1: MemoryAgent)

- *efficient memory storage and retrieval* → ingest cleaning + embedding recall + budget packer
- *timely forgetting of outdated information* → decay policy + audit log
- *recalling critical memories within limited context windows* → `budget_tokens` packing (the demo: same query at 500/2000/8000-token budgets)
- Proof of Alibaba Cloud deployment → Function Compute handler + DashScope SDK calls in-repo
- Architecture diagram → §3.1; demo video → Personas desktop as the live client
  (its Memories UI visualizes proposals/provenance) + a second trivial client
  (CLI notes bot) to prove generality.
- Open-source license: MIT/Apache-2 on the service repo only; Personas stays private.
- **Credential rule** (hard, per project policy): only memory content syncs to the
  service; vault material never leaves the machine. Memory sync must be opt-in
  per persona.

### 3.4 Phase 2 work plan (next sessions)

1. Scaffold `recollect` repo (TypeScript or Python, zero-heavy-deps), port scoring +
   cluster-hint functions with the SAME unit-test vectors as the Rust originals
   (behavioural parity gate).
2. DashScope integration: chat (qwen-max for reflection, qwen-turbo for ingest
   cleaning) + text-embedding-v3; MOCK mode for offline dev (reuse the
   `cloud-worker/` PoC pattern).
3. Alibaba deployment: Function Compute + ApsaraDB; smoke-test round trip.
4. Personas adapter: opt-in per-persona sync (push on memory write, pull proposals) —
   a thin client of the public API, feature-flagged.
5. Demo assets: architecture diagram, 3-min video, blog post.

## 4. Phase 1 file map (shipped this session)

| Piece | Location |
|---|---|
| `derived_from` migration + model | `db/migrations/incremental.rs`, `db/models/memory.rs` |
| provenance create + decay fetch | `db/repos/core/memories.rs` (`create_synthesized`, `get_active_for_decay`) |
| recall scoring / packing / forgetting | `engine/memory_recall.rs` (unit-tested) |
| reflection engine | `engine/memory_reflection.rs` (unit-tested classifier + clusterer) |
| proposal extension (`synthesize`/`archive`) | `db/repos/core/memory_review_proposal.rs`, apply arms in `commands/core/memories.rs` |
| IPC + background job | `reflect_memories_with_cli`, `enqueue_persona_memory_reflection`, `memory_reflection_run` job kind |
| runner integration | `engine/runner/mod.rs` (budget pack, access discipline, decay pass) |

Open follow-ups (phase 1.5, not blocking phase 2): reflection on the curation cron
(second schedule or shared cadence), embedding re-rank behind the `ml` feature,
provenance chain UI in `sub_memories` beyond the proposal modal, prepared-run cache
path still uses the count-cap fetch.
