# Obsidian Brain

> Bidirectional bridge between Personas Desktop and an Obsidian vault — your AI persona memories, profiles, and connectors live as plain markdown that you can edit, version, and back up to your own Google Drive.

The plugin lives at `src/features/plugins/obsidian-brain/` and is exposed through the **Plugins → Obsidian Brain** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/obsidian_brain/`.

**In this folder:**
- **README.md** (you are here) — what it does, the user flow, the end-to-end lifecycle, and where it could go next.
- **[connector.md](connector.md)** — the agent-side **Obsidian Memory** connector: the tools an agent can call, the dual (Tauri + MCP) execution model, TF-IDF ranking, and the live file watcher. Read this to understand how a *persona* leverages the vault at runtime.
- **[reference.md](reference.md)** — backend command and frontend module lookup tables.

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

The plugin is organised as five tabs: **Setup**, **Sync**, **Browse Vault**, **Graph**, and **Cloud**. A **Saved Vaults** sidebar appears on the right of every tab except Cloud and lets you switch between multiple vault configurations without re-running setup. When no vault is connected, the Sync, Browse, Graph, and Cloud tabs show a *No vault connected* empty state with an **Open Setup** button that jumps straight to the Setup tab.

### 1. Setup — connect a vault

1. Open **Plugins → Obsidian Brain → Setup**.
2. Click **Auto-Detect Vaults** to scan the OS-known Obsidian config directories. Vaults that are already in your Saved Vaults sidebar are filtered out so the list only shows new candidates.
3. (Or) click **Browse** to pick any folder manually.
4. Press **Test** — the backend verifies that the folder contains a `.obsidian/` directory, counts notes, and returns the vault name.
5. In **Sync Options**, pick which domains to sync (Memories / Persona Profiles / Connectors) and whether **Auto-Sync** should fire on every memory write.
6. Optionally tweak **Folder Structure** to change the on-disk layout. A live preview shows the resulting path: `Personas/AgentName/memories/fact/memory-title.md`.
7. Click **Save Configuration**. The config is persisted in the app settings table and added to the Saved Vaults sidebar.

> *Why a separate "saved vaults" list?* You can connect more than one vault — e.g. **Work** vs **Research** — and switch between them from the sidebar in Setup, Sync, Browse, or Graph. Selecting a saved vault re-activates it as the live config without touching the form.

### 2. Sync — push / pull deltas

1. Open the **Sync** tab. The active vault name is shown above the actions.
2. **Push to Vault** writes app-side changes (memories, personas, connectors) into the vault as markdown. Pick the personas to push from the chip selector, which carries a live *N of M selected* count; once you have more than six personas a name filter appears so large rosters stay manageable, and **Select all** unions the currently-visible matches into your selection.
3. **Pull from Vault** reads the markdown files back, parses frontmatter, and updates the app. If a note has been edited on *both* sides since the last sync, a **Conflict** card appears showing a line-level diff of the two versions — blue `−` lines exist only in the App version, violet `+` lines only in the Vault — above three buttons: **Keep App**, **Keep Vault**, **Skip**.
4. After each push or pull a **result summary card** stays on the page (it does not auto-dismiss like the toast). The headline reads e.g. *"Pushed 5"* with semantic-colored count pills (created / updated / skipped / converged / conflicts / errors), and expands to a per-category breakdown plus the individual error messages. Push and pull each get their own card with a distinct direction glyph and accent (↑ violet for push, ↓ emerald for pull) so the two directions never blur together; the most recent of each stays visible.
5. Every action is recorded in the **Sync Log** (created / updated / conflict / skipped), with timestamps and the entity it touched.
6. Switching the active vault from the sidebar reloads the log automatically.

### 3. Browse Vault — read-only file explorer

1. Open the **Browse Vault** tab. The selected vault name is shown at the top of the file tree, and the path is exposed as a tooltip.
2. The left pane lists the vault as a collapsible folder tree with note counts. The filter box in the header narrows the tree by file name.
3. Click any `.md` file. The header shows the note's word count and its copyable vault-relative path; any flat YAML frontmatter is lifted out and rendered as a **Properties** chip row. The right pane renders the remaining markdown body using `react-markdown` + `remark-gfm` — code, tables, blockquotes, links.
4. The **Open in Obsidian** button launches the actual Obsidian app at the selected note via `obsidian://open?vault=…&file=…`.

### 4. Graph — vault metrics & quick capture

1. Open the **Graph** tab. It loads aggregate vault stats (notes, links, orphans, MOCs, daily notes), a TF-IDF search box, and collapsible **Orphan notes** / **Maps of Content** lists.
2. Every result row — a search hit, an orphan, or a MOC — is clickable and opens that note directly in Obsidian (`obsidian://open?…`), so the Graph metrics are a navigable index, not a read-only report.
3. The lower half offers **quick capture**: append a section to today's daily note, or write a structured meeting note (with comma-separated attendees) straight into the vault.
4. While the tab is open a file watcher keeps the stats live as you edit notes in Obsidian (see [connector.md → Live file watcher](connector.md#live-file-watcher)).

The Graph tab is the human-facing twin of the **Obsidian Memory** connector — the same metrics and capture tools an agent can call are surfaced here as a UI. See **[connector.md](connector.md)**.

### 5. Cloud — back up the vault to Google Drive

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

## Roadmap — where Brain could go next

### 1. Vault as RAG context — make the vault *readable* by agents, not just writable

Today the plugin is one-way for runtime: agents *write* memories that end up in the vault, but they do not *read* the vault back at conversation time — except through the **Obsidian Memory** connector's `vault_search` (see [connector.md](connector.md)), which is keyword-only. Deepen this into first-class retrieval:

- Build an embedding index over the vault (chunked by note, with frontmatter metadata).
- Reuse the existing semantic-lint infra (`semantic_lint.rs`) which already knows how to walk vault files.
- Re-index on every pull so the index always reflects user edits.

This converts the vault from a *destination* into a *first-class knowledge source* and unlocks every "chat with my notes" use case without leaving the app.

### 2. Backlink- and graph-aware memory writes

Obsidian's superpower is `[[wikilinks]]` and the resulting graph. Right now the plugin writes flat markdown that ignores it. Make memory writes graph-aware:

- When a memory mentions an existing note title, replace it with a wikilink.
- When a persona has a "MOC" (Map of Content) note, automatically backlink new memories to it.
- Push a per-persona dashboard note (Dataview-compatible) that lists recent memories grouped by category.

The result: notes the agent writes look like notes you would have written yourself, and Obsidian's graph view becomes a live picture of what each persona "knows."

### 3. Conflict-free pull via the live watcher

The watcher (see [connector.md](connector.md#live-file-watcher)) already detects vault edits while the Graph tab is open. Extend it to **auto-pull** the changed file (single-file granularity instead of full-vault scan) or surface a "vault changed — pull?" toast. Combined with the existing 3-way merge (`baseHash`/`appHash`/`vaultHash`) and the conflict diff view, this gets near-real-time bidirectional sync without conflict storms.

### 4. Daily journal & meeting-note automation

The `vault_append_daily_note` / `vault_write_meeting_note` tools already exist (Graph tab + connector). Position personas as *journal authors* on top of them:

- A "Daily Note" persona that writes today's `Daily/2026-04-14.md` on a schedule, populated from the day's executions, errors, and decisions.
- A "Meeting Scribe" persona that listens to a transcript and writes a structured meeting note under `Meetings/`.
- Templates per persona (Templater-compatible) so users can swap layouts without code.

### 5. Multi-vault role separation + workspace presets

The Saved Vaults sidebar is the foundation. Build on it:

- **Per-persona vault binding**: persona X always syncs to "Work" vault, persona Y to "Research" vault. No more accidentally pushing client memories into a personal journal.
- **Workspace presets**: a saved config bundles vault path *plus* sync options *plus* folder mapping *plus* which personas are bound to it. Switching is one click.
- **Per-vault Drive credentials**: Work vault → company Google account, Personal vault → personal account.
- **Vault tagging in the sidebar** so users can group "Personal", "Client", "Research" visually.

This is the difference between a hobby tool ("I have one vault") and a professional tool ("I keep my work and personal lives strictly separated and I expect Personas to respect that").
