# Skill ↔ Memory Unification — one contract, graph core, optional Obsidian

**Status:** PROPOSED (design for review) · 2026-07-26
**Owner ask:** unify the three spreading memory mechanisms — (a) harness `MEMORY.md`,
(b) the SQLite memory module, (c) Obsidian vaults inside specific skills — so every
project skill binds to one memory variant, memory is keyed to the context map
(coverage tracking, cross-terminal progress sharing, auto-update), Obsidian stays
optional, and the *shape* of memory is a graph (which the operator has found to beat
relational for complex memory systems).

## 1. Inventory — what exists today and what each is actually for

| # | System | Scope & owner | Shape | Consumers |
|---|--------|--------------|-------|-----------|
| a | `~/.claude/projects/<slug>/memory/` (`MEMORY.md` + fact files) | **Personal** — one operator's Claude sessions on one checkout | flat files, `[[links]]` by convention | the CLI agent only |
| b1 | `team_memories` + Memory Engine v2 (reflection, decay, forgetting, proposal gate) | **Team runtime** — personas executing pipelines | relational rows + categories | engine runner, Athena |
| b2 | `workspace_knowledge` + practices (Knowledge Center arcs 1–2) | **Workspace** — curated, human-reviewed cross-project doctrine | relational rows, review queue | workspaces module, `/practice-harvest` |
| c | Obsidian vaults in skills (`/tiger` overlay-is-vault, `/research`, `/perfect`, `/reflect`+`/prime`) | **Skill-local** — notes + progress maps per skill | **graph** (notes + wikilinks) | each skill privately |

The spread is real but the scopes are NOT redundant — a, b1, b2 answer different
questions. The actual gap is the missing **fourth scope**: durable, shareable,
context-anchored **project working memory** that any skill or terminal can read and
write. Today that role is being improvised per-skill in Obsidian (c), invisibly to
the app and to sibling terminals.

## 2. Design principles (from the operator, binding)

1. Every project skill connects to variant **b or c** — never invents a new store.
2. Memory participates in the **context map**: coverage tracked per context,
   progress shared across LLM terminals, context map auto-updated.
3. **Obsidian is optional** — users without it get the full system.
4. **Graph beats relational** for complex memory — the data model is a graph
   regardless of which engine stores it.

## 3. Architecture — Project Memory Ledger

### 3.1 Graph core in SQLite (the canonical store — satisfies §2.3 + §2.4)

The graph is the **data model**; SQLite is merely the engine. Two tables:

```sql
memory_nodes (
  id TEXT PK, project_id TEXT NOT NULL,          -- REFERENCES dev_projects
  context_id TEXT,                               -- context-map anchor (nullable)
  kind TEXT NOT NULL,       -- 'fact' | 'progress' | 'decision' | 'gotcha' | 'map'
  title TEXT NOT NULL, body TEXT,
  source TEXT NOT NULL,     -- 'skill:<name>' | 'terminal' | 'app' | 'import:obsidian'
  status TEXT NOT NULL DEFAULT 'active',         -- active | superseded | archived
  created_at TEXT, updated_at TEXT
)
memory_edges (
  from_id TEXT, to_id TEXT,
  rel TEXT NOT NULL,        -- 'relates' | 'supersedes' | 'blocks' | 'covers' | 'derived_from'
  PRIMARY KEY (from_id, to_id, rel)
)
```

This gives wikilink-equivalent semantics (typed, traversable, cheap recursive CTE
queries) with zero external dependency. An app-native graph view can render it later;
Obsidian becomes a *projection*, not the source of truth.

**Boundary with existing stores:** `team_memories` (b1) stays the personas-runtime
memory; `workspace_knowledge` (b2) stays curated doctrine. The ledger is upstream
working memory. One promotion path each way: a ledger node can be proposed into
workspace knowledge (reuse the existing review queue), and reflection (b1) can cite
ledger nodes as provenance. No table merges — scopes stay honest.

### 3.2 The ingest bridge — how dispatched terminals write (satisfies §2.2 sharing)

Dispatched Fleet sessions run in *target repos* with no IPC. The app already has a
proven pattern for exactly this: **result-file ingest** (`kpi-sim` `result.json`,
`/practice-harvest` `result.json`). Memory generalizes it:

- A skill writes append-only JSONL to `.personas/memory-outbox.jsonl` in the target
  repo (nodes + edges, context_ids included when known).
- The app ingests on Fleet-session terminal events (and on demand): validates,
  dedupes (content-hash), inserts, deletes the outbox. The same watcher every
  terminal shares — so terminal A's progress notes are queryable by terminal B's
  next dispatch (its MEMORY BLOCK includes fresh ledger excerpts, see §3.4).
- Repos never need DB access, credentials, or the app installed.

### 3.3 Context-map involvement (satisfies §2.2 coverage + auto-update)

- **Anchoring:** writers SHOULD set `context_id` (the dispatch context block lists
  the project's contexts from `context-map.json` so skills can pick without
  guessing). Unanchored nodes are allowed but excluded from coverage math.
- **Coverage:** `contexts with ≥1 active node fresh within N days / all contexts` —
  surfaced per project (Mastermind cell detail and/or Knowledge Center). This is the
  "memory coverage" instrument the operator wants.
- **Auto-update:** a reconciler runs at ingest: nodes of kind `map` that reference
  files no longer matching their context's `filePaths` flag the context stale and
  enqueue the existing **delta context scan** (`runContextScan(slug, delta)`), which
  refreshes `context-map.json`. The map stays derived-from-code; memory only
  *triggers* refreshes, never hand-edits the map.

### 3.4 Skill binding (satisfies §2.1)

SKILL.md frontmatter declares the binding — mirroring the `category:` pattern:

```yaml
memory: project     # ledger via outbox (default for project skills)
memory: vault       # Obsidian-first skills (/tiger, /research) — see §3.5
memory: none        # stateless utilities
```

`dispatchSkillToRepo` (the placement wrapper) reads the binding and appends a
**MEMORY BLOCK** to the prompt: outbox path + contract, the project's context list,
and the K most relevant fresh ledger nodes (recall). One wrapper, every dispatch —
the same chokepoint that already solved skill placement.

### 3.5 Obsidian adapter — optional projection (satisfies §2.3)

- **Settings:** an optional vault path per operator (absent = feature off, zero UI).
- **Projection (app → vault):** one note per ledger node (`personas/<project>/<id>.md`,
  frontmatter carries id/kind/context), one wikilink per edge. Idempotent, one-way,
  on write + on demand. The operator gets Obsidian's graph UX for free.
- **Import (vault → app):** an explicit scan (not a watcher) that ingests notes
  changed in the vault under the projection root back into the ledger
  (`source: import:obsidian`).
- **Vault-first skills** (`memory: vault`): keep their vault workflow, but their
  wrapper also mirrors summary nodes through the outbox, so vault users and
  non-vault users produce the same ledger signal. Long-term, `/tiger`-class skills
  can migrate to `memory: project` + projection and lose their private vault code.

### 3.6 `MEMORY.md` (a) — deliberately NOT merged

It is *personal operator memory* (preferences, cross-project feedback), lives
outside the app's trust boundary, and other terminals reading it would be a privacy
inversion. The rule that unifies it: **"if another terminal would benefit, it goes
to the ledger"** — session agents promote durable project facts via the outbox and
keep only personal/cross-project notes in `MEMORY.md`. (Optionally later: a
`CLAUDE.md` line in managed repos stating this rule, seeded by passport-onboard.)

## 4. Rollout

| Phase | Scope | Notes |
|-------|-------|------|
| **P0** | `memory_nodes`/`memory_edges` migration + ingest command + outbox watcher on Fleet terminal events + coverage query | pure backend, no UI |
| **P1** | `memory:` frontmatter parse (next to `category:`) + MEMORY BLOCK in `dispatchSkillToRepo` + retrofit `passport-onboard` and `kpi-sim` as first writers | proves the loop end-to-end |
| **P2** | Coverage surfacing (Mastermind cell detail / Knowledge Center pillar) + stale-context reconciler → delta rescan | context-map auto-update lands here |
| **P3** | Obsidian adapter (settings + projection + import) + `/tiger`-class migration | optional component last, by design |

## 5. Decisions (operator, 2026-07-26)

1. **Recall size:** context-filtered, capped at 8 nodes per MEMORY BLOCK
   (fresh-first; falls back to project-wide fresh nodes when the dispatch has no
   context focus). *(Operator left this one open — capped context-filtering chosen.)*
2. **Coverage freshness window:** **30 days.**
3. **Vault layout:** **per project** (`personas/<project>/…` subtree).
4. **Promotion UX:** **reuse the existing practice review queue** — ledger →
   workspace-knowledge proposals enter the same lane as harvested practices.

**Status:** ALL PHASES SHIPPED. P0 `d89b5e960` (schema + outbox ingest +
coverage + exited-session hook) · P1 `09574254d` (`memory:` binding + MEMORY
BLOCK in dispatchSkillToRepo + writers: passport-onboard, kpi-sim) · P2+P3
(Mastermind sidebar Memory section with coverage; `map`-node → delta-context-
scan reconciler; Obsidian projection/import reusing the Brain plugin's vault —
`dev_tools_memory_project_vault` / `_import_vault`, auto-projection after
ingest). Note: vault projection is one-way-per-direction on explicit triggers —
edges project as wikilinks but vault-side wikilink edits do not import as edges
(nodes only).
