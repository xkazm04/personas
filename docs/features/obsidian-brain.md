# Obsidian Brain

> Bidirectional bridge between Personas Desktop and an Obsidian vault — your AI persona memories, profiles, and connectors live as plain markdown that you can edit, version, and back up to your own Google Drive.

The plugin lives at `src/features/plugins/obsidian-brain/` and is exposed through the **Plugins → Obsidian Brain** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/obsidian_brain/`.

---

## What it does

Obsidian Brain treats an Obsidian vault as an external, human-friendly mirror of three Personas data domains:

| Domain | Direction | Storage shape |
|---|---|---|
| **Persona memories** (facts, preferences, instructions) | App ⇄ Vault | `Personas/<AgentName>/memories/<category>/<title>.md` |
| **Persona profiles** (system prompts, config, design context) | App ⇄ Vault | `Personas/<AgentName>/profile.md` |
| **Connector definitions** (catalog entries, service docs) | App → Vault | `Connectors/<service>.md` |
| **Goal trees** (project goals from Lab) | App → Vault | `Personas/<AgentName>/goals/...` |

Notes are written with YAML frontmatter that preserves IDs, hashes, and timestamps so the next sync can detect changes, conflicts, and deletions deterministically. The same vault can also be backed up to **Google Drive** under `Personas/ObsidianSync/` as a free alternative to Obsidian Sync ($4/mo).

---

## User flow

The plugin is organised as four tabs: **Setup**, **Sync**, **Browse Vault**, and **Cloud**. A **Saved Vaults** sidebar appears on the right of the first three tabs and lets you switch between multiple vault configurations without re-running setup.

### 1. Setup — connect a vault

1. Open **Plugins → Obsidian Brain → Setup**.
2. Click **Auto-Detect Vaults** to scan the OS-known Obsidian config directories. Vaults that are already in your Saved Vaults sidebar are filtered out so the list only shows new candidates.
3. (Or) click **Browse** to pick any folder manually.
4. Press **Test** — the backend verifies that the folder contains a `.obsidian/` directory, counts notes, and returns the vault name.
5. In **Sync Options**, pick which domains to sync (Memories / Persona Profiles / Connectors) and whether **Auto-Sync** should fire on every memory write.
6. Optionally tweak **Folder Structure** to change the on-disk layout. A live preview shows the resulting path: `Personas/AgentName/memories/fact/memory-title.md`.
7. Click **Save Configuration**. The config is persisted in the app settings table and added to the Saved Vaults sidebar.

> *Why a separate "saved vaults" list?* You can connect more than one vault — e.g. **Work** vs **Research** — and switch between them from the sidebar in Setup, Sync, or Browse. Selecting a saved vault re-activates it as the live config without touching the form.

### 2. Sync — push / pull deltas

1. Open the **Sync** tab. The active vault name is shown above the actions.
2. **Push to Vault** writes app-side changes (memories, personas, connectors) into the vault as markdown. Optionally pick specific personas first; otherwise everything that has changed since the last sync is pushed.
3. **Pull from Vault** reads the markdown files back, parses frontmatter, and updates the app. If a note has been edited on *both* sides since the last sync, a **Conflict** card appears with the App version and Vault version side by side and three buttons: **Keep App**, **Keep Vault**, **Skip**.
4. Every action is recorded in the **Sync Log** (created / updated / conflict / skipped), with timestamps and the entity it touched.
5. Switching the active vault from the sidebar reloads the log automatically.

### 3. Browse Vault — read-only file explorer

1. Open the **Browse Vault** tab. The selected vault name is shown at the top of the file tree, and the path is exposed as a tooltip.
2. The left pane lists the vault as a collapsible folder tree with note counts. The filter box in the header narrows the tree by file name.
3. Click any `.md` file. The right pane renders the markdown using `react-markdown` + `remark-gfm` — code, tables, blockquotes, links.
4. The **Open in Obsidian** button launches the actual Obsidian app at the selected note via `obsidian://open?vault=…&file=…`.

### 4. Cloud — back up the vault to Google Drive

1. Open the **Cloud** tab.
2. If you are not signed in, the empty state shows a **Sign in with Google** CTA that calls the same auth flow used in the desktop footer (`useAuthStore.loginWithGoogle`).
3. After sign-in, press **Connect Google Drive**. Personas requests the `drive.file` scope (it can only see files it created — your other Drive contents are untouched).
4. Once Drive is connected the panel shows storage usage, the manifest file count, and two buttons:
   - **Push to Drive** — uploads vault files to `Personas/ObsidianSync/`. Only files whose content hash has changed since the last push are uploaded.
   - **Pull from Drive** — downloads remote changes back into the local vault folder.
5. A "How it works" card explains the model in three steps and reinforces that Drive sync is *separate* from app⇄vault sync — Drive treats the vault as an opaque file tree.

### Lifecycle, end-to-end

```
┌─────────────┐    push      ┌─────────────┐    push      ┌────────────┐
│  Personas   │ ───────────► │   Vault on  │ ───────────► │   Google   │
│  (SQLite)   │ ◄─────────── │     disk    │ ◄─────────── │   Drive    │
└─────────────┘    pull      └─────────────┘    pull      └────────────┘
   memories          markdown           cloud-backed
   profiles          frontmatter        manifest
   connectors        + content hash     + per-file SHA
```

Each layer is independent — you can run any subset (e.g. only sync the vault, never push to Drive; or only push to Drive without ever opening Obsidian).

---

## Strongest use case (speculation)

> **A durable, human-editable, vendor-neutral memory layer for AI agents — the "second brain that AIs share with you."**

Most AI memory systems fail one of two tests: they are either (a) opaque vector blobs that you cannot read, edit, or take with you, or (b) tied to a single vendor's cloud. Obsidian Brain solves both by writing memories as plain markdown into *your* Obsidian vault, which you already use for note-taking and which you fully own.

The killer flow is:

1. An agent writes a memory while doing real work — e.g. *"client X prefers Notion, not Linear, for issue tracking."*
2. The memory lands in your vault as `Personas/Sales-Coach/memories/preference/client-x-issue-tracking.md`, indexed by Obsidian's graph and backlink view.
3. You open Obsidian, **edit the note** (add nuance, link to the meeting note, drop it under a project MOC).
4. On the next pull, the edit comes back into the agent. The agent *now reasons with the version you curated*, not the version it generated.

This closes the loop most agent products miss: **the human becomes a co-author of the agent's memory, in the same tool they already use to think.** The agent gets sharper over time without anyone training a model. And because everything is files in a folder, the memory is portable — git, Drive, iCloud, USB stick, whatever. There is no lock-in.

The combination is hard to replicate from outside: you need the desktop app to write the notes (browser sandboxes can't), you need a real local vault (cloud-only competitors don't have one), and you need to respect the user's existing workflow (Notion-style products want to *replace* it). Obsidian Brain occupies a quiet niche where all three constraints meet.

---

## Five development directions

### 1. Vault as RAG context — make the vault *readable* by agents, not just writable

Today the plugin is one-way for runtime: agents *write* memories that end up in the vault, but they do not *read* the vault back at conversation time. Add a retrieval step so any persona can answer "search my vault for…" out of the box.

- Build an embedding index over the vault (chunked by note, with frontmatter metadata).
- Reuse the existing semantic-lint infra (`semantic_lint.rs`) which already knows how to walk vault files.
- Expose a `vault.search(query)` connector tool so agents can pull arbitrary notes into context, not just persona memories.
- Re-index on every pull so the index always reflects user edits.

This single change converts the vault from a *destination* into a *first-class knowledge source* and unlocks every "chat with my notes" use case without leaving the app.

### 2. Backlink- and graph-aware memory writes

Obsidian's superpower is `[[wikilinks]]` and the resulting graph. Right now the plugin writes flat markdown that ignores it. Make memory writes graph-aware:

- When a memory mentions an existing note title, replace it with a wikilink.
- When a persona has a "MOC" (Map of Content) note, automatically backlink new memories to it.
- Push a per-persona dashboard note (Dataview-compatible) that lists recent memories grouped by category.
- Detect orphan notes during pull and surface them in the Sync tab.

The result: notes the agent writes look like notes you would have written yourself, and Obsidian's graph view becomes a live picture of what each persona "knows."

### 3. Live file-watcher and conflict-free pull

The pull flow today is a manual button. Add a `notify`-based file watcher in Rust that detects vault edits and either:

- **Auto-pulls** the changed file (single-file granularity instead of full-vault scan), or
- Surfaces a "vault changed — pull?" toast in the app.

Combined with the existing 3-way merge (`baseHash`/`appHash`/`vaultHash`), this gets you near-real-time bidirectional sync without conflict storms. It also enables the next direction…

### 4. Daily journal & meeting-note automation

Position personas as *journal authors*, not just memory writers:

- A "Daily Note" persona that writes today's `Daily/2026-04-14.md` into the vault on a schedule, populated from the day's executions, errors, and decisions.
- A "Meeting Scribe" persona that listens to a transcript and writes a structured meeting note straight into the vault under `Meetings/`.
- Templates per persona (Templater-compatible) so users can swap layouts without code.

This turns the plugin from a back-end sync tool into a visible, daily-touched feature that users open Obsidian and *see* working for them.

### 5. Multi-vault role separation + workspace presets

The new Saved Vaults sidebar is the foundation. Build on it:

- **Per-persona vault binding**: persona X always syncs to "Work" vault, persona Y to "Research" vault. No more accidentally pushing client memories into a personal journal.
- **Workspace presets**: a saved config bundles vault path *plus* sync options *plus* folder mapping *plus* which personas are bound to it. Switching is one click.
- **Per-vault Drive credentials**: Work vault → company Google account, Personal vault → personal account.
- **Vault tagging in the sidebar** so users can group "Personal", "Client", "Research" visually.

This is the difference between a hobby tool ("I have one vault") and a professional tool ("I keep my work and personal lives strictly separated and I expect Personas to respect that").

---

## Obsidian Memory connector — agent-side execution layer

The plugin also exposes itself as a builtin connector named **Obsidian Memory** (`obsidian_memory`) under the `knowledge` category. The connector is hidden from the catalog and persona pickers until a vault is configured (`metadata.requires_plugin: "obsidian-brain"` is the gating signal). When the user finishes Setup the connector becomes visible automatically.

### Tools the agent can call

| Tool | Purpose |
|---|---|
| `vault_search` | TF-IDF keyword search over note bodies + titles |
| `vault_outgoing_links` | Wikilinks a note links out to |
| `vault_backlinks` | Notes that wikilink *to* a target note |
| `vault_list_orphans` | Notes with no incoming links |
| `vault_list_mocs` | Maps of Content (notes with many outgoing links) |
| `vault_stats` | Aggregate counts (notes, links, orphans, MOCs, daily notes) |
| `vault_append_daily_note` | Append a section to today's daily note (creates if missing) |
| `vault_write_meeting_note` | Write a structured meeting note under `Meetings/` with attendees as wikilinks |

### How tool execution actually works

There are two execution paths and they are intentionally separate:

1. **In-app (Tauri IPC)** — the same operations are exposed as Tauri commands (`obsidian_graph_*` in `src-tauri/src/commands/obsidian_brain/graph.rs`) and called directly from the Graph tab in the plugin UI. This is how a human runs them.

2. **Agent-side (MCP)** — the existing Personas MCP server (`scripts/mcp-server/index.mjs`, registered with Claude Desktop via `register_claude_desktop_mcp`) carries a parallel JS implementation of the same 8 tools. It reads the vault path from the `obsidian_brain_config` row in `app_settings`, walks the vault filesystem itself, and replies to the LLM. This is how an agent connected via Claude Desktop calls them.

Two implementations of the walk/parse logic is the deliberate trade-off: the MCP server runs as a separate stdio process and cannot call back into the desktop app's Tauri runtime. Sharing files (the vault) and config (the SQLite settings row) is enough — and means the agent can use Obsidian Memory the moment the user runs `register_claude_desktop_mcp`, no rebuilds required.

### TF-IDF ranking

Vault search uses a smoothed Robertson TF-IDF: per-document term frequencies + `ln((N+1)/(df+1)) + 1` IDF, plus a flat +5 boost for title hits. Tokenization is Unicode word-class splitting (`\p{L}\p{N}_`). This handles multi-word queries and rare terms much better than substring matching, with zero new dependencies. An embedding-based retriever (ONNX or hosted) is the natural Phase 3 upgrade and would slot into the same `tfidf_scores()` seam without touching call sites.

### Live file watcher

When a user is in the Graph tab the plugin starts a `notify` watcher (Rust, gated behind the `desktop` feature) on the active vault. File create/modify/remove events on `.md` files are debounced 1s and emitted as a Tauri event `obsidian:vault-changed` carrying the changed paths. The Graph tab listens and re-runs `vault_stats` so orphan/MOC counts stay live as you edit notes in Obsidian. Switching vaults stops the previous watcher and starts a new one bound to the new path; unmounting the panel stops the watcher entirely.

---

## Reference: backend commands

| Command | Purpose |
|---|---|
| `obsidian_brain_detect_vaults` | Scan OS-known Obsidian config paths for vaults |
| `obsidian_brain_test_connection` | Validate a folder is a real vault, count notes |
| `obsidian_brain_save_config` / `_get_config` | Persist active vault config in settings table |
| `obsidian_brain_push_sync` / `_pull_sync` | Bidirectional markdown sync, scoped optionally to persona IDs |
| `obsidian_brain_get_sync_log` | Read the rolling sync history |
| `obsidian_brain_resolve_conflict` | Apply Keep-App / Keep-Vault / Skip to a 3-way conflict |
| `obsidian_brain_list_vault_files` / `_read_vault_note` | Tree + note reader for the Browse panel |
| `obsidian_brain_push_goals` | Push project goal trees as markdown under a persona |
| `obsidian_brain_lint_vault` / `_semantic_lint_vault` | Heuristic + LLM-driven vault audit |
| `obsidian_drive_status` / `_push_sync` / `_pull_sync` | Google Drive backup of the vault folder |
| `login_with_google_drive` / `get_google_drive_status` | OAuth bootstrap for Drive scope |
| `obsidian_graph_search` | TF-IDF vault search (Obsidian Memory connector) |
| `obsidian_graph_outgoing_links` / `_backlinks` | Wikilink walking |
| `obsidian_graph_list_orphans` / `_list_mocs` / `_stats` | Graph metrics |
| `obsidian_graph_append_daily_note` / `_write_meeting_note` | Daily journal + meeting capture |
| `obsidian_graph_start_watcher` / `_stop_watcher` | File watcher control |

## Reference: frontend modules

```
src/features/plugins/obsidian-brain/
├── ObsidianBrainPage.tsx              # tab host
├── SavedConfigsSidebar.tsx            # multi-vault switcher (right rail)
├── useSavedVaultConfigs.ts            # localStorage-backed saved configs
├── useVisibleConnectorDefinitions.ts  # plugin-gated connector filter hook
├── sub_setup/SetupPanel.tsx           # detect/test/save flow
├── sub_sync/SyncPanel.tsx             # push/pull/conflict resolution
├── sub_browse/BrowsePanel.tsx         # vault tree + markdown preview
├── sub_graph/GraphPanel.tsx           # search, stats, orphans/MOCs, journal, meeting capture
└── sub_cloud/CloudSyncPanel.tsx       # Google Drive backup + sign-in CTA
```

```
scripts/connectors/builtin/
└── obsidian-memory.json               # Obsidian Memory connector seed (gated on obsidian-brain plugin)

scripts/mcp-server/
└── index.mjs                          # MCP server with vault_* tools agents call via Claude Desktop
```

All copy lives under `t.plugins.obsidian_brain.*` in `src/i18n/en.ts`. Connector gating filter applied centrally in `src/stores/slices/vault/credentialSlice.ts:fetchConnectorDefinitions`. Prompt-builder hint for the connector lives in `src-tauri/src/engine/build_session.rs` next to the `codebase` connector hint.
