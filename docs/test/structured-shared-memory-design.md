# Structured Shared Memory for Long-Running Teams — Design

**Problem (from the longitudinal finding):** the team writes flat, per-persona,
near-duplicate `learned` memories that accumulate **unbounded in the always-injected
`active` tier** → every role's prompt grows every run → cost compounds 2.2× over 3
runs with flat quality. Durable knowledge is in the wrong place (the hot prompt) and
in the wrong shape (free-text dupes, per-persona not shared, no relations).

**Goal:** let the team generate **structured, shared, deduplicated** knowledge —
decisions, constraints, events — that promotes QUALITY (consistent, graph-grounded
decisions; settled questions not re-litigated) and LONGEVITY (prompt cost stays flat
as the knowledge base grows). Use the three memory substrates the app already has.

---

## The three substrates (what exists)

| Substrate | What it is | Bounded? | Shared? | Structure | Anchor |
|--|--|--|--|--|--|
| **1. Per-persona relational** (`persona_memories`) | tiers core/active/working/archive, categories, importance, access_count, 24h dedup | ❌ active tier grows unbounded; lifecycle only archives 30-day zero-access working | per-persona (or team via `home_team_id`) | free text + category | `db/repos/core/memories.rs` (`get_for_injection_v2`, `run_lifecycle`) |
| **2. Shared team** (`team_memories`) | team-scoped, run_id (auto/manual), importance 1-10, **revision history on update**, **`evict_excess` caps at 200** (evicts lowest-importance auto rows; manual never evicted) | ✅ capped + evicted | ✅ whole team | category (decision/constraint/observation…) | `db/repos/resources/team_memories.rs`; injected `engine/pipeline_executor.rs:944` (top-20) |
| **3. Obsidian graph** (`obsidian-brain`, SHIPPED) | markdown vault, `[[wikilinks]]` form a graph; runtime MCP tools `obsidian_vault_search` / `obsidian_vault_write_note` + graph traversal (backlinks/MOCs/orphans, TF-IDF) | ✅ not injected — recalled on-demand | ✅ vault is shared | true graph (notes + links) | `commands/obsidian_brain/graph.rs`, `mcp_server/tools.rs:881` (gated on the vault/Athena toggle) |

Also: **events** (`persona_events`) are a structured, persisted log; **execution
knowledge** (`engine/knowledge.rs`) extracts tool/failure/cost patterns and one-way
mirrors to the vault. **No first-class decision/ADR record exists** — decisions live
as free-text `learned` memories today.

**Why bloat happens:** the review→learned loop + `agent_memory` write to substrate 1
(per-persona, always-injected, unbounded), one row per resolution → near-duplicates
pile up in the hot prompt. Substrate 2 (bounded+shared) and 3 (on-demand graph) are
barely used by the SDLC team.

---

## Design — stratify durable knowledge out of the hot prompt

The core principle: **knowledge should get more durable and less injected as it
matures.** Three layers, each with a different residency:

- **L1 — working memory** (`persona_memories`, per-persona): short-term, the
  persona's own recent context. Keep LEAN. Injected, but token-budgeted + dedup'd +
  aggressively archived. NOT where durable team knowledge lives.
- **L2 — shared structured ledger** (`team_memories`, typed): the team's durable,
  bounded, deduplicated source of truth — **decisions, constraints, glossary**. ONE
  record per decision (updated via revision history, not duplicated). Capped +
  evicted. Injected as a **compact structured digest** (not raw rows).
- **L3 — knowledge graph** (Obsidian vault): the long-term, relational,
  human-editable graph (decision ↔ module ↔ constraint via `[[wikilinks]]`). Grows
  unbounded **safely** because it is **recalled on-demand** (search/backlinks), never
  injected wholesale. This is the longevity engine.

**Flow per run:** a decision made → written once to L2 (typed `team_memory`, stable
key) AND projected to L3 (a linked decision-note). The review→learned loop feeds **L2
as a shared decision/constraint**, not 23 per-persona dupes in L1. Next run: the team
reads the compact L2 digest + **queries L3 on-demand** for decisions touching the
files it's about to change — instead of drowning in flat L1 dupes. Prompt cost stays
roughly flat as L2 is capped and L3 isn't injected.

### Structured record shapes (typed, dedup-keyed)

Stored in `team_memories` with `category` ∈ {`decision`, `constraint`, `glossary`,
`event`} and a stable dedup key in `tags` (e.g. `key:decision:funnel-conversion`) so
re-deciding the same thing **updates** the row (revision history) instead of adding a
duplicate:

```
DECISION   key:decision:<slug> · title · context · choice · rationale · alternatives · supersedes?
CONSTRAINT key:constraint:<slug> · rule · scope (files/modules) · why
GLOSSARY   key:glossary:<term> · definition (shared vocabulary so roles align)
EVENT      key:event:<run>:<n> · what happened (release cut, defect found+fixed)
```

### Graph convention (L3)

The team writes decision/constraint/module notes with frontmatter + wikilinks:
`Decisions/<slug>.md` → `[[Module: X]]`, `[[Constraint: Y]]`. Then any role can
`obsidian_vault_search("rank delta")` → `obsidian_vault_backlinks("Module: rankings")`
to find *every prior decision touching the code it's about to change* — relational
recall the flat memory pile can't give.

---

## Phasing — current tools first, then targeted extensions

**Phase 1 — use what exists (no/low engine change):**
- **Route shared knowledge to L2.** Give the team a way to write `team_memories`
  (typed decision/constraint/glossary). Two options: (a) scope `agent_memory` writes
  with `home_team_id` so they become team-shared (already supported by
  `get_for_injection_v2`'s home-team OR-clause), or (b) a small `emit_team_memory`
  protocol/tool. Prefer (a) first (least change) + a prompt convention to tag
  decisions/constraints. The review→learned synthesis writes a **team-scoped**
  decision/constraint instead of a per-persona row.
- **Inject L2 as a compact digest** in the SDLC runner prompt (team_memories already
  inject in the pipeline path; wire the same for the event-cascade path), capped
  top-N by importance — the bounded shared source of truth.
- **Enable L3 for the team.** The vault tools are gated behind the Athena toggle;
  enable vault read/write for the SDLC personas + a prompt convention to write
  decision-notes with wikilinks and to query the graph before changing code.

**Phase 2 — memory hygiene on L1 (directly fixes the bloat):**
- **Token-budgeted injection** (not just the 40-count cap): cap injected memory by a
  token budget; evict lowest value (importance×recency×access) beyond it.
- **Dedup-by-meaning:** before writing a `learned` memory, check semantic/near-text
  duplicate against recent ones (the review loop's near-identical "Human approved …"
  are the worst offenders) → update/skip instead of add.
- **Aggressive archive/demote:** tighten `run_lifecycle` so L1 stays small (durable
  knowledge has moved to L2/L3).

**Phase 3 — first-class structure (if Phase 1 conventions prove valuable):**
- A typed `team_decisions` table (or formalize the L2 category convention) with
  dedup-by-key + supersedes links; project to L3 automatically; inject as a digest.
- Semantic recall (vector) over L2/L3 so the team injects only the *relevant* subset.

---

## Why this promotes quality + longevity

- **Quality:** decisions/constraints are structured, shared, and graph-linked — the
  team makes consistent decisions, doesn't re-litigate settled ones, grounds new work
  in prior decisions touching the same files (L3 backlinks), and shares a glossary so
  roles align. Human feedback becomes a durable shared constraint, not noise.
- **Longevity:** durable knowledge lives in bounded L2 (capped+evicted) and on-demand
  L3 (graph, never injected wholesale), so **prompt cost stays flat as knowledge
  compounds** — the opposite of the measured bloat. L1 stays lean via hygiene.
- **Measurable:** re-run the longitudinal eval after Phase 1+2 — success = cost flat
  or falling across iterations while quality holds, and L2 decision-reuse / L3
  backlink-hits rising. That is the works-for-weeks bar.

## Recommended first step
Phase 1 — route the review→learned + decision writes to **team-scoped** L2 records
(home_team_id) + inject the compact L2 digest in the SDLC cascade + a prompt
convention for typed decisions/constraints. Lowest-change, directly attacks the
"per-persona flat dupes" root cause, and is measurable via a longitudinal re-run.
