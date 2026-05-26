# Obsidian Memory connector — agent-side execution layer

> How a *persona* leverages the vault at runtime. The plugin UI (see [README.md](README.md)) is the human-facing side; this connector is the agent-facing side. Both call the same underlying vault operations.

The plugin exposes itself as a builtin connector named **Obsidian Memory** (`obsidian_memory`) under the `knowledge` category. The connector is hidden from the catalog and persona pickers until a vault is configured (`metadata.requires_plugin: "obsidian-brain"` is the gating signal). When the user finishes Setup the connector becomes visible automatically.

Connector gating is applied centrally in `src/stores/slices/vault/credentialSlice.ts:fetchConnectorDefinitions`; the seed lives at `scripts/connectors/builtin/obsidian-memory.json`.

---

## Tools the agent can call

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

The Graph tab in the plugin UI surfaces the same metrics and capture tools to a human — it is the visible twin of this connector.

---

## How tool execution actually works

There are two execution paths and they are intentionally separate:

1. **In-app (Tauri IPC)** — the operations are exposed as Tauri commands (`obsidian_graph_*` in `src-tauri/src/commands/obsidian_brain/graph.rs`) and called directly from the Graph tab in the plugin UI. This is how a human runs them.

2. **Agent-side (MCP)** — the Personas MCP server (`scripts/mcp-server/index.mjs`, registered with Claude Desktop via `register_claude_desktop_mcp`) carries a parallel JS implementation of the same 8 tools. It reads the vault path from the `obsidian_brain_config` row in `app_settings`, walks the vault filesystem itself, and replies to the LLM. This is how an agent connected via Claude Desktop calls them.

Two implementations of the walk/parse logic is the deliberate trade-off: the MCP server runs as a separate stdio process and cannot call back into the desktop app's Tauri runtime. Sharing files (the vault) and config (the SQLite settings row) is enough — and means the agent can use Obsidian Memory the moment the user runs `register_claude_desktop_mcp`, no rebuilds required.

The prompt-builder hint that tells an agent how to use the connector lives in `src-tauri/src/engine/build_session.rs`, next to the `codebase` connector hint.

---

## TF-IDF ranking

Vault search uses a smoothed Robertson TF-IDF: per-document term frequencies + `ln((N+1)/(df+1)) + 1` IDF, plus a flat +5 boost for title hits. Tokenization is Unicode word-class splitting (`\p{L}\p{N}_`). This handles multi-word queries and rare terms much better than substring matching, with zero new dependencies. An embedding-based retriever (ONNX or hosted) is the natural Phase 3 upgrade and would slot into the same `tfidf_scores()` seam without touching call sites (see [README.md → Roadmap #1](README.md#roadmap--where-brain-could-go-next)).

---

## Live file watcher

When a user is in the Graph tab the plugin starts a `notify` watcher (Rust, gated behind the `desktop` feature) on the active vault. File create/modify/remove events on `.md` files are debounced 1s and emitted as a Tauri event `obsidian:vault-changed` carrying the changed paths. The Graph tab listens and re-runs `vault_stats` so orphan/MOC counts stay live as you edit notes in Obsidian. Switching vaults stops the previous watcher and starts a new one bound to the new path; unmounting the panel stops the watcher entirely.
