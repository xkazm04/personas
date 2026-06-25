# Obsidian Brain — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: obsidian-brain | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. Drive cloud-sync round-trip silently drops every note that lives in a subfolder
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-loss / lost-sync
- **File**: src-tauri/src/commands/obsidian_brain/drive.rs:493-519 (push) and drive.rs:603-624 (pull)
- **Scenario**: User configures Drive sync (commands ARE registered — see lib.rs:2524-2526, despite the stale "dormant/unwired" comments at drive.rs:16-21 and mod.rs:1759-1761). Push walks the vault recursively: `walk_markdown_files` returns relative paths like `fact/Some note.md` or `Alice/profile.md` (the memories folder is organized by category subdir, personas by name subdir). Push then calls `upload_file(..., file_name = &relative_path, ...)`, so the Drive file is literally named `fact/Some note.md` (Drive permits `/` in names). On a second machine the user runs Drive **pull**: `safe_drive_filename(&df.name)` rejects any name containing `/` (drive.rs:48), so every subfoldered note is pushed to `result.errors` and `continue`d — never downloaded.
- **Root cause**: Push encodes folder structure into the Drive file *name* (flat namespace with embedded slashes), but pull's hardening guard `safe_drive_filename` rejects exactly those slash-bearing names. The two halves of the round-trip disagree on the on-Drive naming scheme. Manifest `file_key`s also never match between push (`Personas/Alice/profile.md`) and pull (`Personas/<safe_name>`), so even skip-detection is broken.
- **Impact**: The primary synced entities (per-category memories, per-persona profiles) all live in subfolders, so a fresh-machine pull recovers essentially *none* of them and floods the UI with "rejected unsafe Drive filename" errors. The free-cloud-sync feature silently fails its core promise; users believe their knowledge is backed up and restorable when it is not.
- **Fix sketch**: Recreate the folder hierarchy on Drive (create nested Drive subfolders per path segment) and upload each note with a single-component leaf name, OR encode the relative path reversibly (e.g. percent-encode `/`) on push AND decode it on pull before the `safe_drive_filename` check. Add a push→pull round-trip integration test over a vault with at least one nested note.
- **Value**: impact=8 effort=3

## 2. Every graph command re-walks and re-reads the entire vault with no index; stats load fires three full walks concurrently
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance / scalability (huge note sets)
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:96-140 (`walk_vault`), called at graph.rs:284,325,374,399,431,452; GraphPanel.tsx:69-73 (`Promise.all`)
- **Scenario**: A knowledge brain is meant to hold a large vault. `obsidian_graph_stats`, `_list_orphans`, and `_list_mocs` each call `walk_vault`, which `std::fs::read_to_string`s the *full body* of every `.md` file into a `Vec<NoteEntry>`. `GraphPanel.loadStats` runs all three in `Promise.all`, so a single stats refresh walks and slurps the whole vault three times in parallel. `obsidian_graph_search` additionally re-tokenizes every note body into a `HashMap` per query (`tfidf_scores`, graph.rs:175-217). The file watcher re-triggers `loadStats` (debounced 800ms) on every edit burst.
- **Root cause**: No shared in-memory index or cache across commands; each command is O(vault bytes) in IO and allocation. The module docstring even defers this ("A future revision can mount an embedding index").
- **Impact**: On a 5k-note (~50MB) vault, each stats refresh transiently allocates ~150MB+ and reads ~150MB from disk; during active editing this repeats every ~0.8s. Search latency grows linearly with vault size. Degrades exactly the power-user scenario the feature targets.
- **Fix sketch**: Build the `Vec<NoteEntry>` once behind a cached, mtime/-watcher-invalidated index (e.g. a `OnceLock<Mutex<Option<VaultIndex>>>` keyed by vault path), and have stats/orphans/mocs/search read from it. At minimum, compute stats+orphans+mocs from a single walk instead of three.
- **Value**: impact=6 effort=5

## 3. Graph commands return absolute filesystem paths, breaking "Open in Obsidian" deep links and leaking the full path — silently violating the Browse tab's documented vault-relative contract
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: unclear/undocumented path contract → concrete failure
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:295 (search), 384 (backlinks), 407 (orphans), 436 (mocs); contrast mod.rs:1451-1456 (Browse: "Always report vault-relative paths, never absolute"); consumer openInObsidian.ts:7-10
- **Scenario**: The Browse tab's `build_tree` deliberately returns vault-*relative* paths, and `buildObsidianOpenUri` strips `.md` and feeds `notePath` into `obsidian://open?...&file=<path>` — which requires a vault-relative path. But the Graph tab's search hits / orphans / MOCs each set `path: n.path.to_string_lossy()` — an **absolute** path (`C:\Users\…\vault\Daily\2026-01-01.md`). Clicking a Graph search result builds `file=C:/Users/…/vault/Daily/2026-01-01`, which Obsidian cannot resolve, so the deep link fails. The absolute path is also rendered in the UI (`title=`, hit list).
- **Root cause**: There is no single enforced "all IPC results return vault-relative paths" rule; Browse documents and follows it, Graph silently diverges. The path-format contract is tribal knowledge, not a shared helper.
- **Impact**: All "Open in Obsidian" actions from the Graph tab are broken; full local filesystem paths (usernames, directory layout) are disclosed in the UI. Inconsistency invites further drift.
- **Fix sketch**: Strip the vault root in the graph commands (`path.strip_prefix(vault_root)`), normalising to forward slashes, before returning — mirroring `build_tree`. Add a shared helper both tabs call so the contract can't diverge again.
- **Value**: impact=5 effort=2

## 4. `obsidian_brain_push_goals` collides same-titled goals onto one file (no id suffix) and emits inconsistent parent/child wikilinks
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-loss / wrong-graph
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1640 (filename), 1578 (parent link), 1591-1596 (child link)
- **Scenario**: `filename = format!("{}.md", sanitize_filename(&goal.title))`. `sanitize_filename` is many-to-one (collapses many chars to `-`, truncates at 100). Two goals titled e.g. `Q3: launch` and `Q3- launch` (or any pair sharing a sanitized form) write to the same `DevTools/Goals/Q3- launch.md` — the second `atomic_write` overwrites the first, and both `sync_state` rows then point at one file. This is the exact collision class fixed for memories via `vault_note_filename` (id suffix, mod.rs:507-521) but never applied to goals. Separately, the child links use `[[{sanitize_filename(child.title)}]]` (mod.rs:1592) while the parent link uses `[[{parent_goal_id}]]` (mod.rs:1578) — the parent wikilink targets the raw goal id, but the file is named by title, so the parent backlink never resolves.
- **Root cause**: Goal filenames key on title alone (no injective entity-id component), and the wikilink target scheme is inconsistent between parent (id) and child (title) directions.
- **Impact**: Silent loss of a vault goal note on title collision (re-derivable from DB on next push, so not catastrophic), plus a broken goal-tree graph in Obsidian (dangling parent links) — defeating the "linked markdown notes" purpose.
- **Fix sketch**: Reuse `vault_note_filename(&goal.title, &goal.id)` for the filename, and make parent/child links agree — link by the same key the file is named with (sanitized title, or switch both to a stable id-based note name).
- **Value**: impact=6 effort=2

## 5. Empty vault name collapses to the shared `"default"` Drive folder (cross-vault contamination) and folder/vault names are interpolated unescaped into Drive `q` queries
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: cloud-sync leak / wrong-folder
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1809-1813 & 1846-1850 (`vault_name` → "default"); drive.rs:212-213, 354, 413, 585-586 (`q` interpolation); drive.rs:256-263 (`ensure_vault_folder`)
- **Scenario**: `ObsidianVaultConfig::vault_name` defaults to `String::new()` (models/obsidian_brain.rs:121) and the setup UI does not force it non-empty. Both Drive commands map an empty name to the literal `"default"`. So two *different* vaults that were ever configured with a blank name both sync into `Personas/ObsidianSync/default/`, mixing — and on pull, downloading — each other's note content into one folder. Independently, `ensure_folder`/`load_manifest`/`pull_from_drive` build the Drive search query by string-interpolating `name = '{name}'` with user-controlled vault/folder names; a name containing `'` breaks the query or makes it match unintended folders (`ensure_vault_folder` then takes `list.files.first()` of whatever matched).
- **Root cause**: The on-Drive vault namespace is keyed by a non-unique, user-editable (and emptyable) display name rather than a stable vault id, and Drive query strings are assembled without escaping the interpolated names.
- **Impact**: Note content from vault A becomes visible/restorable under vault B's Drive folder (a genuine cloud-sync content leak across vaults), and a stray quote in a name can silently sync into the wrong folder. Self-owned Drive limits blast radius, but the cross-vault mixing is silent and surprising.
- **Fix sketch**: Key the Drive folder on a stable vault identifier (e.g. a hash of the canonical vault path) instead of the display name, reject/normalise empty names at config save, and escape `'` (or use Drive's parameterised query escaping) when building every `q` clause.
- **Value**: impact=6 effort=3
