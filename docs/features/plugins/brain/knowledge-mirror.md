# Design — Obsidian as an optional knowledge mirror

> **Status:** Approved in substance (2026-05-26) — the open questions are resolved (§9). Ready to implement P0→P3 on go-ahead.
> **Decision inputs:** data model = **Mirror** (SQLite/embeddings stay canonical; the vault is a dual-write, removable mirror). Gated on Obsidian presence; **off by default**. **Single** Brain vault for all stores; **one** `obsidian_mirror` settings object; surfaced in the Setup → Sync Options card. All mirrors are **one-way (app → vault)** in v1. Athena's vault relationship is **on-demand external-tool access**, not a bulk memory mirror (§5.1).

This doc specifies how three internal knowledge/memory stores — **Athena Brain**, **Execution Knowledge**, and **Research Lab** — can optionally project themselves into an Obsidian vault as human-readable, portable markdown, *only* for users who have Obsidian. It is a design for review, not an implementation.

---

## 1. Guiding principle — Obsidian is opt-in, off by default

The correctness floor: **the app must be fully functional with no Obsidian installed.** All three stores already persist to SQLite / embeddings and must keep doing so unchanged. Obsidian is a *mirror*, never a dependency.

| State | Behaviour |
|---|---|
| **No Obsidian** (default) | Nothing changes. No plugin requirement, no prompts, no gated UI. Stores write to SQLite/embeddings as today. |
| **Obsidian detected** | A single, dismissible opt-in offer appears. Per-feature toggles, all default **off**. |
| **A feature enabled** | One-time **backfill** ("migrate") of existing rows into the vault, then **dual-write** going forward. SQLite/embeddings remain canonical. |
| **A feature disabled / Obsidian removed** | Dual-write stops. Vault files are left in place (the user owns them). No SQLite change, zero data loss. |

"Mirror" is the load-bearing choice: because SQLite stays canonical, enabling and disabling are both safe and reversible, which is what makes a default-off, detect-and-offer model honest.

---

## 2. Detection & gating

Two presence signals already exist in the codebase; they play different roles:

| Signal | Source | Role |
|---|---|---|
| **Binary installed** | `engine/desktop_discovery.rs` (finds `Obsidian.exe` under `%LOCALAPPDATA%`) | **Prompt trigger** — "We noticed Obsidian. Want to mirror your knowledge into it?" |
| **Vault configured** | `obsidian_brain_config` row in `app_settings` | **Enable gate** — a feature can only be turned on once a target vault + folder mapping exists (managed by the Brain plugin's Setup tab). |

This mirrors the existing precedent: the project-tracking watcher is already "gated on Obsidian credential detection" (`engine/project_tracking/mod.rs:27`), and the `obsidian_memory` connector is hidden until a vault is configured (`credentialSlice.ts:fetchConnectorDefinitions`).

**New surface:** a single resolver `obsidian_available()` (binary-detected OR vault-configured) plus per-feature enable flags persisted in settings (§5). Every gated write path and UI offer consults these; with both false (the default), no code path changes behaviour.

---

## 3. The enable offer (UI)

Surfaced in **two** places, no new top-level navigation:

1. **One-time prompt** when the binary is detected and no feature is yet enabled — a dismissible card (respecting a "don't ask again" flag) pointing at the toggles.
2. **Brain plugin → Setup tab**, as an extension of the existing **Sync Options** card. Today that card toggles Memories / Persona Profiles / Connectors / Auto-Sync; add a **"Knowledge mirror"** group with three independent toggles: *Athena Brain*, *Execution Knowledge*, *Research Lab*.

Enabling a toggle:
1. If no vault is configured → route to the Setup detect/test/save flow first.
2. Run the one-time **backfill** of existing rows (progress surfaced via the existing toast + sync-log).
3. Register the store for ongoing **dual-write**.

Keeping the offer inside the existing Sync Options card (rather than a new page) is deliberate — it reuses the mental model users already have for "what syncs to my vault."

---

## 4. Shared mirror infrastructure

All three features reuse the Brain plugin's existing sync machinery rather than re-implementing it:

- **Folder mapping** — extend `ObsidianVaultConfig.folderMapping` with `athenaFolder`, `knowledgeFolder`, `researchFolder` (defaults `Athena`, `Knowledge`, `Research`).
- **Frontmatter + content hash** — every mirrored note carries `id`, source `type`, `created`/`updated`, and a content hash, exactly like persona memories, so re-sync is a hash-diff and edits are detectable.
- **Sync log + 3-way merge** — reuse the existing `baseHash`/`appHash`/`vaultHash` merge and the sync-log table; add a per-domain `entity_type` discriminator (`athena_memory`, `execution_knowledge`, `research_experiment`).
- **Dual-write hook** — on a canonical write, if the feature is enabled and a vault is configured, enqueue a background mirror write. Writes are queued (not inline on the hot path) so the canonical store never blocks on disk I/O.

The concrete refactor is to generalize today's "sync memories / personas / connectors" into a small **mirror-domain** trait/abstraction so each store plugs in as another domain with `(list_since, render_note)` for the one-way v1. A `parse_note` / pull-back hook is reserved on the trait for a later two-way phase but is unused in v1.

---

## 5. Per-feature specs

### 5.1 Athena Brain ↔ vault — on-demand external tool (not a bulk mirror)

Per the approval pass, Athena does **not** wholesale-mirror its `companion_*` memory tables into the vault. The vault is instead an **external reference library Athena consults on demand** — when a task needs specific cases or analysis — plus a place it can deposit a *specific* durable finding worth keeping.

- **Read (primary):** Athena can search and read the vault *during reasoning*, reusing the existing **Obsidian Memory** tool surface (`vault_search`, `vault_backlinks`, `vault_list_mocs`, read-note, …) via the companion's MCP bridge (`companion/mcp_bridge.rs`). The tool is gated on `obsidian_available()` + the Athena toggle, so with no Obsidian it is simply never offered to Athena.
- **Write (selective, one-way):** when Athena produces a durable analysis or case worth retaining, it can write a *single* structured note into `Athena/…` (frontmatter + hash, same machinery). This is deliberate and per-finding — never a continuous dump of every `companion_*` row.
- **Canonical store unchanged:** Athena's 5-tier memory (working, episodic, semantic, procedural, identity) + embeddings stay in SQLite as the source of truth (mirror principle). The vault is a consultable, human-readable adjunct.
- **Working memory:** moot — with no bulk mirror, volatile working memory never reaches the vault.
- **Why it's still last:** it touches the companion's tool/reasoning loop (`mcp_bridge.rs` + tool gating), but it is materially lighter than the originally-scoped bulk migration — no whole-brain backfill, no pull-back, no provenance-rewrite path.

### 5.2 Execution Knowledge → `Knowledge/…`

- **Source:** `execution_knowledge` table, auto-extracted after each execution by `engine/knowledge.rs`.
- **Layout:** `Knowledge/<category>/<slug>.md`, wikilinked. This finally implements what `knowledge.rs`'s own module doc recommends ("for curated knowledge under ~1000 docs, prefer the Obsidian vault path").
- **Direction:** **one-way** (app → vault). Execution knowledge is auto-derived, not user-authored, so pull-back is out of scope for v1 (could later allow edits as curation).
- **Migrate:** backfill existing rows; ongoing, write on each extraction (dual-write hook in the post-execution path).

### 5.3 Research Lab → Brain vault

- **Today:** `research_lab_sync_to_obsidian` (`research_lab.rs:249`) writes `{project.obsidian_vault_path}/Research/{project}/<exp>.md` with frontmatter — but it uses a **per-project vault path** (separate from Brain's config), is **manual** (a command), and **full-rewrites** every file (no hash tracking).
- **Change:** converge onto the **Brain-configured vault** + the new `researchFolder` mapping; keep the per-project subfolder. Add content-hash + sync-log tracking so it becomes **incremental**, and offer **auto-sync** on experiment changes instead of a manual button.
- **Migrate:** relink existing per-project `obsidian_vault_path` values to the Brain vault, then re-sync. The `obsidian_vault_path` project field is deprecated in favour of the shared config (kept readable for back-compat during migration).
- **Why it's first:** it already writes valid notes, so it's the lowest-risk way to prove the mirror-domain abstraction end-to-end.

---

## 6. Schema & migrations

- **Settings (additive, default off):** a single `obsidian_mirror` config object in `app_settings` holding the three per-feature booleans (`athena`, `execution_knowledge`, `research_lab`) plus a `offer_dismissed` flag. One object → atomic read/write and a single gating fetch.
- **Folder mapping:** additive fields on `ObsidianVaultConfig` (`athenaFolder`, `knowledgeFolder`, `researchFolder`) with safe defaults — old configs deserialize fine.
- **Sync tracking:** extend the existing obsidian sync-log/hash store with the new `entity_type` discriminator. No new top-level table required.
- **All migrations additive.** No destructive changes; disabling a feature is a runtime flag flip, not a migration.

---

## 7. Rollback / disable semantics

- **Disable a feature** → stop the dual-write hook. Existing vault files are left untouched (user-owned). SQLite/embeddings unchanged. Re-enabling re-syncs via hash-diff (no full rewrite).
- **Remove the vault / uninstall Obsidian** → `obsidian_available()` returns false; all features silently revert to SQLite-only. No errors, no orphaned state in the canonical stores.

---

## 8. Sequencing

| Phase | Scope | Risk |
|---|---|---|
| **P0** | `obsidian_available()` resolver, settings flags, the mirror-domain abstraction, and the Setup-tab offer UI (all default off — no behaviour change for existing users) | low |
| **P1** | **Research Lab** mirror (converge vault path, incremental hashing, migrate) — proves the abstraction | low |
| **P2** | **Execution Knowledge** mirror (one-way write + backfill) | medium |
| **P3** | **Athena Brain** vault tool — gate the Obsidian Memory tool surface for Athena (read) + selective one-way note write | medium |

Each phase is independently shippable behind its off-by-default flag.

---

## 9. Resolved decisions (approval pass, 2026-05-26)

1. **Direction** — all mirrors are **one-way (app → vault)** in v1. No pull-back; vault edits do not flow back into any canonical store yet.
2. **Surface** — extend the existing **Sync Options** card with a "Knowledge mirror" group (no new top-level surface).
3. **Vault** — a **single** Brain-configured vault serves all three features; no per-feature vault selection.
4. **Settings** — **one** `obsidian_mirror` object (§6), not discrete keys.
5. **Athena** — the vault is an **on-demand external tool** Athena reads for specific cases/analysis, plus selective one-way note writes — **not** a bulk mirror of its memory tables (§5.1). Working-memory exclusion is therefore moot.
