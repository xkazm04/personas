# Golden path — Caller-supplied filesystem paths

> Situation node: `integrations-external/external-and-host/filesystem-boundary` · [situation spine](../situation-spine.md)
> Leaf metadata: `sides: server` · `convergence: diverged` · `risk: high` · `recurrence: 157` ·
> `twoSided: true` · `fusedAcrossSides: true`. Merged from *File-path arguments from
> the UI*, *Writing a caller-supplied file*, *Local file and folder picker*, *File
> drop-zone ingestion*.
> Composed 2026-08-13 against `master` @ `2602d843b`, from a ground-truth sweep of all
> 564 `.rs` files under `src-tauri/` (all workspace crates) plus the frontend picker,
> validation and error surfaces under `src/`. Every count below was produced by
> parsing real source. `.claude/worktrees/**` and `target/` excluded.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

**Adjacent leaves — do not absorb them here.** *Who may call the command* is
[IPC command authorization](./ipc-command-authorization.md) — cross-referenced
below, because that path found `ipc_auth` being used as a **substitute** for path
validation and this one confirms the substitution is real and load-bearing.
Subprocess argument construction, outbound HTTP to a caller-supplied URL, archive
extraction (tar-slip), and SQLite `ATTACH` sandboxing are each their own situation.
This path covers **proving a caller-supplied path resolves inside a boundary the
app owns, and writing to it without tearing.**

## Trigger

- "Add a command that takes a file path" / "let the user pick a folder"
- "Read this file the user chose" / "save the export where they want it"
- "Wire up a directory picker" / "add a drop zone for files"
- "Ingest a vault / repo / knowledge base from disk"
- "It works on my machine but the path is rejected" / "why is this path not allowed?"
- "Add a watch path to this trigger"

If you are about to type a `#[tauri::command]` with a parameter named `path`,
`file_path`, `dir_path`, `root_path`, `rel_path`, `vault_path`, `output_dir`,
`save_path`, `cwd` or `repo_dir` — or `std::fs::write(&some_param, …)`,
`fs::read_to_string(&some_param)`, `PathBuf::from(&some_param)`, `root.join(rel)`,
or `open({ directory: true })` on the frontend — you are in this situation.

## The one way

**The app owns the root; the caller supplies a fragment; the guard returns the
resolved path and you use only what it returned.** Take the boundary root from
app state (`managed_root(&app)`, the DB config row, `app_data_dir()`) — never from
a parameter — then pass the caller's *relative* fragment through a resolver that
rejects every non-`Normal` path component, refuses any component that traverses a
symlink, canonicalises, and **only then** asserts `starts_with(root)` — on the
canonical form, never on a raw `join`, because `Path::starts_with` compares components
without resolving `..` and a lexical check therefore passes the very input it claims to
reject (category G). Return the canonical `PathBuf`, use that returned value for every
subsequent filesystem call, and never touch the original string again. Reach for
`commands::drive::resolve_safe` as the model; it is the most-used (17 call sites)
and most-hardened resolver in the repo. Only when the path is genuinely an
*absolute* location the user picked through the OS dialog — export targets, a
document to sign, an image to OCR — fall back to `engine::path_safety::validate_file_access_path`,
always paired with `is_sensitive_credential_path`, and understand that you are
trading a containment proof for a blocklist. Never accept an absolute path from
the frontend without one of those two; never accept a *root* from the frontend at
all, because a caller who supplies both the root and the fragment is not contained
by anything. Write through a temp-file-plus-rename in the target directory so a
crash cannot truncate the user's file, and treat `#[requires(privileged)]` as
orthogonal — it decides *who calls*, never *what the argument points at*.

## Mandated primitives

- **`src-tauri/src/commands/drive.rs:376` — `resolve_safe(root: &Path, rel: &str) -> Result<PathBuf, AppError>`.**
  The canonical anchored resolver and the one to copy. Rejects absolute inputs and
  every `Component::ParentDir` / `RootDir` / `Prefix` (which is what closes Windows
  UNC `\\server\share` and drive-relative `C:foo` — both parse as `Prefix`), probes
  every component with `symlink_metadata` on the not-yet-exists branch
  (`:419-432`), canonicalises, and asserts `canonical.starts_with(root)` (`:461`).
  Returns the resolved path. 17 call sites (15 in `drive.rs`, 2 in `ocr/mod.rs`).
- **`src-tauri/src/commands/drive.rs:343` — `managed_root(&AppHandle)`.** Where a root
  legitimately comes from: app data dir in release, `.dev-drive` in debug,
  canonicalised once and cached. The shape to imitate for any new sandbox.
- **`src-tauri/src/commands/obsidian_brain/mod.rs:1426` — `resolve_vault_subpath`.** The
  same doctrine for a DB-configured root, **and the best written statement of this
  golden path that already exists in the repo** (`:1417-1425`): *"Every command that
  joins a caller-supplied VAULT-RELATIVE FRAGMENT to the vault MUST go through this
  so the guard cannot diverge between siblings."* Read that comment before writing a
  new guard.
- **`src-tauri/src/commands/obsidian_brain/graph.rs:261` — `ensure_within_vault`.** The
  sibling shape for an already-absolute in-boundary candidate. Its comment
  (`:262-272`) documents the *bypass-by-fallback* bug — `unwrap_or(<raw path>)` turned
  a `canonicalize()` failure into a guard bypass — which is the single most
  instructive failure in this whole area. **Canonicalise failure is a rejection,
  never a fallback.**
- **`src-tauri/engine/src/path_safety.rs:335` — `validate_file_access_path(path, allowed_extensions)`.**
  The absolute-path guard, for OS-dialog-picked files only. Canonicalises (resolving
  symlinks), strips the Windows `\\?\` prefix, blocks system dirs and the app data
  dir, requires containment under the user's home, and enforces an extension
  allowlist when given one. Returns the resolved `PathBuf`.
- **`src-tauri/engine/src/path_safety.rs:31` — `is_sensitive_credential_path`.** The
  backend-authoritative secret-file denylist (`.ssh/`, `.gnupg/`, `.aws/credentials`,
  `.config/gcloud/`, key extensions, `wallet.dat`, `.npmrc`, `.netrc`). Pair it with
  the above on any read that leaves the machine or gets signed.
- **`src-tauri/engine/src/path_safety.rs:154` — `is_under_user_home`.** Note its
  `None => false` arm (`:160-173`): an unresolvable home directory **denies**. Copy
  that fail-closed posture in any predicate you add.
- **`src-tauri/core/src/validation/mod.rs:111` — `open_log_file_safely(raw_path, root)`.**
  The strongest guard in the repo and the reference for a *read that must not race*:
  rejects NUL bytes and `:` (NTFS ADS) textually before any syscall, opens with
  `O_NOFOLLOW` / `FILE_FLAG_OPEN_REPARSE_POINT`, canonicalises both sides, containment-checks,
  then verifies file identity between the open handle and the canonical path to close
  the TOCTOU window. **It returns the open `File`, not a path** — the shape that makes
  check-then-use-original impossible.
- **`src-tauri/engine/src/desktop_security.rs:172` — `DesktopConnectorManifest::is_path_allowed`.**
  The positive-allowlist shape for connector sandboxes: empty allowlist denies
  (`:173-180`), rejects `..` segments, rejects NTFS ADS via `has_ntfs_ads`, canonicalises
  (resolving junctions and 8.3 short names). Use this for anything manifest-scoped.
- **`src-tauri/src/commands/credentials/api_proxy.rs:17` — `validate_credential_id`.**
  The correct shape for *an identifier used as a path component*: a positive charset
  allowlist (`[A-Za-z0-9-]`, ≤64) rather than a substring blocklist. It is the only
  component guard in the repo that closes ADS, reserved device names and trailing
  dots — because it never has to enumerate them.
- **`src/api/drive.ts:17` — `validateRelPath` / `:51` `validateNonRootRelPath`.** The
  frontend half's only real validator and the model for it: rejects non-strings,
  >1024 chars, NUL, leading separators, `/^[a-zA-Z]:/` drive letters, and `..`
  segments after backslash normalisation. Mirrors `resolve_safe` deliberately.
- **`src/features/shared/components/forms/DirectoryPickerInput.tsx`** — the only shared
  picker primitive. **Read the Gaps section before using it**: it currently renders a
  free-text field alongside the dialog.
- **`src-tauri/capabilities/default.json`** — grants `dialog:default` and **no `fs:`
  permission of any kind**; `tauri-plugin-fs` is not even a dependency in
  `src-tauri/Cargo.toml` or `package.json`. This is the single best thing about this
  area and it is load-bearing: the webview *cannot* touch the filesystem directly, so
  every path crosses a Rust command and the boundary has exactly one enforcement
  layer. The asset protocol is separately scoped in `tauri.conf.json` to
  `$APPDATA/**`, `$DOCUMENT/Personas Media Studio/**`, `$PICTURE/**` etc. — read-only
  serving, not write access. **Do not add `fs:` permissions to widen a shortcut**; the
  correct move is always a new command that goes through step 1.
- **`commands/obsidian_brain/graph.rs:513` — `atomic_write`.** The least-wrong of the
  seven hand-rolled atomic writers (uuid-suffixed sibling temp, cleans up on error).
  Use it as the template until a shared one exists; see Gap 9 and Deviations J.

## Steps

1. **Decide who owns the root.** If the app can name the boundary — the managed
   drive, the configured vault, the twin wiki dir, the app data dir — you are in the
   anchored case; go to step 2. If the path is genuinely an arbitrary user location
   chosen through the OS dialog, you are in the absolute case; go to step 5. If you
   are about to take *both* a root and a relative path from the caller, stop: that is
   not a sandbox, it is an arbitrary write with extra steps.
2. **Take the root from app state**, not from a parameter: `managed_root(&app)?`,
   `get_config_or_err(&state.db)?.vault_path`, `app.path().app_data_dir()?`.
   Canonicalise it once.
3. **Resolve the caller's fragment through `resolve_safe(&root, &rel)`** (or the
   plugin's local anchored resolver, if one already exists for that root — Obsidian
   has two, and adding a third variant is explicitly forbidden by
   `graph.rs:259-260`).
4. **Use only the returned `PathBuf`.** Never re-derive from the original string,
   never pass the original to `fs::*`, never log the original as if it were the
   target. Then go to step 7.
5. **Absolute case: call `validate_file_access_path(&file_path, Some(&ALLOWED_*_EXTENSIONS))`**
   with an extension allowlist wherever the file type is knowable, and add
   `is_sensitive_credential_path` on the **resolved** path if the content is read,
   signed, uploaded or embedded.
6. **Add the command to `PRIVILEGED_COMMANDS`** in `src-tauri/src/ipc_auth.rs` per the
   [IPC authorization path](./ipc-command-authorization.md) — as *defence in depth
   layered on top of* step 5, never instead of it.
7. **Write atomically**: write to a uuid-suffixed temp file in the **same directory**
   as the target (a temp dir on another volume makes the rename non-atomic),
   `sync_all()` it, then `fs::rename` over the target, removing the temp on any error
   path. There is no shared helper yet (Gap 9) — until there is, copy
   `commands/obsidian_brain/graph.rs:513`, which is the closest correct version, and
   add the `sync_all()` that only `daemon/lock.rs:244` currently does. Never
   read-modify-write a user-owned file (`CLAUDE.md`, `settings.json`) non-atomically.
8. **On the frontend, pick — do not type.** Use the dialog with `filters:` matching the
   backend's extension allowlist and `directory:` set explicitly. If the surface must
   accept typed input, run it through a `validateRelPath`-style guard before invoke.
9. **Stop.** No new guard function. No second containment check inside a helper the
   command calls. No frontend-only validation treated as the gate — the renderer holds
   `window.__IPC_TOKEN` and any code in it can call the command directly.

## Anti-patterns

- **`root.join(rel).starts_with(root)` as a containment check — the worst one, and it
  is live in this repo.** `Path::starts_with` matches *whole components* and
  `Path::components()` preserves `ParentDir` rather than resolving it, so
  `vault.join("../../x")` yields `<vault>/../../x`, which **does** start with `vault`.
  The check returns `true`, and the un-normalised path then goes to an OS call that
  *does* resolve `..`. A containment assertion is only meaningful on a canonicalised
  path. Four live instances at `engine/src/desktop_bridges.rs:905,914,921,964`, each
  rejecting with the message "Path traversal detected" while permitting exactly that
  (Deviations G).
- **Taking the sandbox root from the caller.** `fleet_write_dispatch_brief`
  (`commands/fleet/external.rs:78`) accepts `cwd` *and* `path`, checks only
  `root.is_dir()`, then confines `path` to a root the same caller chose. The
  containment code (`resolve_inside`, `:53`) is correct and proves nothing. Composed
  with an unauthenticated transport this is an arbitrary write; see Deviations E.
- **Validating, then using the original string.** `ensure_within_vault` returns
  `Result<()>`; `obsidian_graph_outgoing_links` (`graph.rs:346-348`) checks the
  canonical path and then reads the **raw** `note_path`. A guard that returns `()`
  invites this; a guard that returns the resolved handle or path forbids it. That is
  why `open_log_file_safely` returns a `File`.
- **Copying a guard instead of calling it.** `mcp_server/tools.rs:60`
  `resolve_drive_path` is a line-for-line copy of `resolve_safe`, same error strings —
  written before commit `85f3aed0d` added the symlink-traversal probe to the original.
  The copy still has zero `symlink_metadata` calls, so the vulnerability that was
  fixed in `drive.rs` on 2026-06-07 is **still live** in the MCP server that persona
  CLI executions talk to. Copying a security guard means silently opting out of its
  future fixes.
- **`canonicalize().unwrap_or(raw)`.** Turns a resolution failure into a guard bypass.
  Documented at `graph.rs:262-272` as a real, fixed bug. Any `unwrap_or` /
  `ok().unwrap_or_default()` around a canonicalisation in a security check is the same
  bug.
- **Writing a guard and never wiring it.** `validate_save_path`
  (`path_safety.rs:276`) allows exactly `["persona", "enclave"]` — it was written for
  `export_persona_bundle` and `seal_enclave` and has **never** been called by either
  (`git log -S` over `commands/network/` returns nothing). `validate_watch_path` /
  `validate_file_watcher_paths` were written for file-watcher triggers and are not
  called by the file watcher. All three carry `#[allow(dead_code)]`, which is the
  compiler being told to stop asking.
- **Using `#[requires(privileged)]` as path validation.** `ipc_auth.rs:325-345` says it
  outright — the `artist_*` commands are listed "to catch renderer-context exploits
  steering the `file_path` arg at sensitive files" and because "without gating any IPC
  caller could overwrite an arbitrary file." `artist_save_composition`
  (`artist/persistence.rs:77`) still does `PathBuf::from(&file_path)` and writes.
  Privilege gates the caller; with `withGlobalTauri: true` every caller in the webview
  is already privileged.
- **A substring blocklist on path components.** `foraging::is_safe_path_component`
  (`:779`) checks `!contains("..") && !'/' && !'\\' && !'\0'` — and therefore accepts
  `secret.txt:hidden` (NTFS alternate data stream), `NUL`/`CON`/`COM1` (Windows device
  names, which silently swallow writes), and `name.` (trailing dot, stripped by
  Win32). Enumerate what is *allowed*, as `validate_credential_id` does.
- **A blocklist with no containment.** `vector_kb::validate_path_safety` (`:274`) blocks
  `C:\Windows\`, `C:\ProgramData\` and a handful of dotdirs — and nothing else. It has
  no home-directory containment, so `D:\`, a mapped network share, or another user's
  profile all pass. Blocklists answer "is this one of the bad places I thought of";
  containment answers "is this inside the good place".
- **Trusting the picker.** A path that came from the OS dialog is a string in JS by the
  time it reaches invoke. `src/api/signing/index.ts:48-56` still asserts the TS
  denylist is "the PRIMARY gate, not defense in depth" — the backend inverted that on
  2026-07-14 (`signing/mod.rs:51-53`) and the TS comment was never updated. Two halves
  of one contract, each documented as the authority.
- **A "picker" with a text field.** `DirectoryPickerInput.tsx:45-51` renders
  `<input type="text" onChange={e => onChange(e.target.value)}` next to the dialog
  button. The shared primitive that exists to constrain the input does not constrain
  it.
- **Non-atomic writes over a user's file.** `std::fs::write(&save_path, &bytes)` in
  `export_persona_bundle` (`network/bundle.rs:32`) and `seal_enclave`
  (`network/enclave.rs:22`) truncates first. A crash or a full disk mid-write leaves
  the user with a zero-length `.persona` file where their export used to be. The
  read-modify-write variant is worse: `context_map_export.rs:311-321` and
  `fleet/hook_install.rs:166` rewrite the user's own `CLAUDE.md` and
  `~/.claude/settings.json` in place.
- **A comment that claims atomicity the code does not have.**
  `fleet/hook_install.rs:160` reads `// Ensure parent dir, write atomically.` and is
  followed six lines later by a plain truncating `fs::write` to the user's global
  `~/.claude/settings.json` (`:166`, and again at `:202` for uninstall). The next
  reader will believe the comment.
- **Defining the helper and not calling it.** `obsidian_brain/graph.rs` defines
  `atomic_write` at `:513` and does a raw `fs::write` at `:566`, in the same file.
- **Reading `File.path` off a dropped file.** `IngestDropZone.tsx:44` casts a browser
  `File` to `{ path?: string }` to recover a host path. That is a Tauri v1 / Electron
  API; in Tauri v2 it is `undefined`, so the code dead-ends into its own
  "No valid file paths found" branch. The comment above it (`:43`) still asserts the
  opposite. If you need real host paths from a drop, subscribe to
  `getCurrentWebview().onDragDropEvent` — and then treat what it gives you as
  caller-supplied, because it is.
- **Assuming `require_auth` / `require_auth_sync` gate anything.** Both are documented
  no-ops (`ipc_auth.rs:418-420`, `:479-481`). Most path-taking commands call one of
  them and nothing else.

## Evidence

**Adoption.** 1,661 `#[tauri::command]` definitions, all in `src-tauri/src/`. **71
take a caller-supplied path parameter** by name+type; 3 are semantic false positives
(`list_design_reviews_paginated(sort_dir)` is a sort direction;
`execute_api_request(path)` and `openapi_playground_test(path)` are URL paths), giving
**68 genuine filesystem-path commands**, plus **10** more whose parameter names fall
outside the naming convention (`file_paths`, `file_name`, `file_path_override`,
`output_folder`, `obsidian_subpath`, `folder_names`) — **78 total**. Of the 71
matched, **20 (28%) call a validator in-body and 51 (72%) do not.** Validator usage
among them: `resolve_safe` 11, `validate_file_access_path` 5, bare `canonicalize` 4,
bare `starts_with(` 3, `validate_path_safety` 1.

**The shared guard has two adopters.** `engine::path_safety` is imported by exactly
**two files** — `commands/ocr/mod.rs:16` and `commands/signing/mod.rs:14` — for 6 call
sites total. Hypothesis confirmed exactly.

**There are 32 independent path guards in Rust** (11 resolving, 13 checking, 8 inline)
plus ~8 component/identifier guards and 2 more in TypeScript — not 6. Full inventory in
Deviations B. Across `src-tauri/`, **483 filesystem calls in 133 files**, of which
**57 files** contain at least one call whose path derives from a function parameter
rather than an app-owned constant.

- **`commands/signing/mod.rs:38-60` — `sign_document`. Copy this one for the absolute
  case.** `validate_file_access_path` → existence check → `is_sensitive_credential_path`
  **on the resolved path**, with a comment (`:50-53`) that correctly states the
  renderer guard is bypassable and the backend is primary.
- **`commands/drive.rs:940-976` — `drive_write`. Copy this one for the anchored case.**
  `managed_root(&app)` → `resolve_safe` → size cap → write to the returned path.
- `commands/obsidian_brain/mod.rs:1461-1475` — `obsidian_brain_list_vault_files`, the
  anchored shape over a DB-configured root, with the bug it fixed named in-line.
- `core/src/validation/mod.rs:111-150` — `open_log_file_safely`, the TOCTOU-safe read.
- `engine/src/desktop_security.rs:172-210` — `is_path_allowed`, the allowlist shape.
- `engine/src/tool_runner.rs:436-494` — `validate_script_path_against`, split from its
  wrapper specifically so tests can drive it with synthetic roots. The testability
  pattern to copy for any new guard.
- `src/api/drive.ts:17-49` — the frontend mirror, and the only one.
- `engine/src/path_safety.rs:160-173` — the fail-closed `None` arm, with a comment
  explaining why an unresolvable home must not widen into allow-all.

## Deviations found

**241 individually-addressable deviations** across eleven categories, every one
shipping green under `npm run check`, `npm run lint` and
`cargo test --features desktop` — because, as *Why all 241 are green* records,
**nothing checks any of this**. A few sites carry two distinct defects and are counted in both categories
(`export_persona_bundle` is unvalidated in A *and* non-atomic in J); the categories are
fix-shaped, not site-shaped.

| | Category | Count |
|---|---|---|
| A | Path-taking commands with no validation | 51 |
| B | Independent path guards (the divergence itself) | 32 |
| C | Copied guards missing the original's security fix | 2 |
| D | Guards written and never wired | 3 |
| E | Caller-supplied roots | 7 |
| F | Check-then-use-original (`Result<()>` / `bool` shape) | 18 |
| G | Guards that do not guard | 12 |
| H | Frontend picker / typed-path half | 25 |
| I | Drop-zone half | 8 |
| J | Non-atomic writes to caller-derived paths | 70 |
| K | Path-rejection strings with no user-facing message | 13 |

**Start with G.** It contains the only *live, unmitigated* path traversal found in this
sweep.

### A. Path-taking commands with no validation at all (51)

51 of the 71 path-taking commands never validate. The worst, by what they reach:

| Path | Defect |
|---|---|
| `commands/artist/persistence.rs:77` | **`artist_save_composition`** — `PathBuf::from(&file_path)` + `ensure_parent_dir` + write. Writes to any absolute path, **creating parent directories on the way**. `ipc_auth.rs:343-345` names this exact command as the reason it is on the privileged list. |
| `commands/artist/persistence.rs:107` | `artist_load_composition` — `fs::read(&file_path)`, any path. |
| `commands/network/bundle.rs:32` | `export_persona_bundle` — `fs::write(&save_path, …)`, any path. `validate_save_path` exists for it and is never called. |
| `commands/network/enclave.rs:22` | `seal_enclave` — same, same. |
| `commands/artist/ffmpeg.rs:440,563,656,709,763,833` | Six ffmpeg commands taking `input_path` / `output_path` unvalidated; each spawns a subprocess that reads and writes them. |
| `commands/core/data_portability.rs:2128,2194` | `export_selective_to_path`, `import_portability_bundle_from_path`. |
| `commands/execution/knowledge.rs:245` | `build_kb_index(root_path, filename)` — caller-supplied root. |
| `commands/obsidian_brain/mod.rs:162` | `obsidian_brain_test_connection(vault_path)` — probes an arbitrary path. |
| `commands/core/persona_icons.rs:149` | `import_persona_icon(source_path)`. |
| `commands/design/template_adopt.rs:2115` | `verify_template_integrity(path)`. |
| `commands/infrastructure/webbuild.rs:44`, `commands/companion/jobs.rs:24` | `webbuild_register_existing(path)`, `companion_register_project(path)`. |
| `commands/infrastructure/git_checkpoint.rs:25,55,69` | `dev_checkpoint_stage` / `dev_fork_from_checkpoint` / `dev_rollback_to_checkpoint(repo_dir)` — git operations on a caller-named directory. |
| `commands/infrastructure/dev_tools.rs:62,2565` | `dev_tools_create_project(root_path)`, `dev_tools_get_project_favicon(root_path)`. |
| `commands/infrastructure/context_generation.rs:583` | `dev_tools_scan_codebase(root_path)`. |
| `commands/infrastructure/{ship_ingest.rs:401, triage_ingest.rs:345, kpi_sim.rs:257, workspace_harvest.rs:365}` | Four `run_dir: Option<String>` ingest commands. |
| `commands/artist/mod.rs:210,393` | `artist_scan_folder(folder)`, `artist_ensure_folders(folder)` — the latter **creates** directories. |
| `commands/credentials/vector_kb.rs:549` | `kb_ingest_files(file_paths)` — canonicalises then applies the weak blocklist (see D). |

### B. Thirty-two independent Rust path guards; the shared one has two adopters (32)

The hypothesis named six; a full sweep of all 564 `.rs` files found **32** distinct
guards that decide whether a filesystem path is allowed — 11 that resolve-and-contain
(`Result<PathBuf>`), 13 check-only (`Result<()>`/`bool`), and 8 inline blocks with no
function name at all — plus roughly a further 8 single-component / identifier guards
(`validate_credential_id`, `validate_skill_name`, `validate_voice_id`,
`is_safe_skill_segment`, `team_preset_loader:332,:381`, `eval_runs:686`,
`sanitize_stem`). The nineteen most consequential:

| # | Guard | Shape | Call sites |
|---|---|---|---|
| 1 | `engine/src/path_safety.rs:335` `validate_file_access_path` | absolute, blocklist+home | **6, in 2 files** |
| 2 | `engine/src/path_safety.rs:276` `validate_save_path` | absolute, +ext allowlist | **0** |
| 3 | `engine/src/path_safety.rs:68` `validate_watch_path` | absolute, blocklist+home | **0** |
| 4 | `engine/src/path_safety.rs:122` `validate_file_watcher_paths` | config wrapper for 3 | **0** |
| 5 | `engine/src/path_safety.rs:31` `is_sensitive_credential_path` | denylist | 1 |
| 6 | `commands/drive.rs:376` `resolve_safe` | **anchored** | 17 |
| 7 | `mcp_server/tools.rs:60` `resolve_drive_path` | anchored (stale copy of 6) | 4 |
| 8 | `commands/obsidian_brain/mod.rs:1426` `resolve_vault_subpath` | **anchored** | 4 |
| 9 | `commands/obsidian_brain/graph.rs:261` `ensure_within_vault` | containment-only, `Result<()>` | 3 |
| 10 | `commands/obsidian_brain/drive.rs:40` `safe_drive_filename` | component | 2 |
| 11 | `commands/infrastructure/twin.rs:113` `resolve_wiki_dir` | anchored (hand copy of 6) | 2 |
| 12 | `commands/fleet/external.rs:53` `resolve_inside` | anchored, **caller-supplied root** | 1 |
| 13 | `engine/src/tool_runner.rs:436` `validate_script_path_against` | root allowlist | 2 |
| 14 | `commands/credentials/vector_kb.rs:274` `validate_path_safety` | blocklist, no containment | 2 |
| 15 | `engine/src/desktop_bridges.rs:644` `validate_path_safety` | blocklist | 4 |
| 16 | `engine/src/desktop_security.rs:172` `is_path_allowed` | **allowlist** | 4 |
| 17 | `commands/credentials/auth_detect.rs:211` `is_path_allowed` | binary allowlist | 1 |
| 18 | `commands/credentials/foraging.rs:779` `is_safe_path_component` | component blocklist | 4 |
| 19 | `core/src/validation/mod.rs:111` `open_log_file_safely` | **anchored + TOCTOU-safe** | 2 |

The other thirteen: `companion/jobs/connector_use.rs:1027` `resolve_within` ·
`commands/credentials/api_proxy.rs:212` `verify_path_containment` ·
`commands/artist/transcribe.rs:98` `validate_local_file_path` ·
`commands/infrastructure/skill_files.rs:312` `validate_skill_name` and the inline block
at `:1233` · `commands/companion/approvals/approval_exec_fleet.rs:1040`
`validate_fleet_cwd` (7 call sites; gates `--dangerously-skip-permissions` spawns) ·
`commands/infrastructure/{triage_ingest.rs:307, ship_ingest.rs:365}` `resolve_run_dir`
(byte-identical twins) and the inline equivalents in `kpi_sim.rs:277` and
`workspace_harvest.rs:393` · `commands/core/data_portability.rs:{4434, 8783, 8795}` ·
`src/webbuild/project.rs:55` `project_dir` · `commands/artist/mod.rs:{263, 331, 420}` ·
`commands/companion/debug_export.rs:18` `sanitize_stem` ·
`engine/src/desktop_bridges.rs:{905,914,921,964}` (category G) ·
`engine/src/desktop_security.rs:124` `is_binary_allowed`.

Plus two on the frontend: `src/api/drive.ts:17` `validateRelPath` and
`src/api/signing/index.ts:63` `SENSITIVE_PATH_PATTERNS`.

Four of them (#7, #8, #11, #12) carry comments saying they mirror another — the
divergence is deliberate and documented, which is worse than accidental. Two pairs are
byte-identical twins in different files (`resolve_run_dir` ×2, `is_path_allowed` ×2 with
unrelated semantics under one name), and `atomic_write` is defined three times (category
J), so **one name means different things depending on the module you are in.**

### C. Copied guards that missed the original's security fix (2)

- **`mcp_server/tools.rs:60` — `resolve_drive_path`.** Copy of `resolve_safe` predating
  commit `85f3aed0d` ("reject symlink traversal in resolve_safe write path", 2026-06-07,
  which touched `drive.rs` only). `grep -c symlink_metadata`: `drive.rs` **2**,
  `tools.rs` **0**. The not-exists branch also calls `create_dir_all(parent)` (`:90`)
  **before** the containment check, so a rejected path still creates directories.
  Reachable from persona CLI executions via the stdio MCP server.
- **`commands/fleet/external.rs:53` — `resolve_inside`.** Rejects all non-`Normal`
  components but never canonicalises; its comment (`:50-52`) reasons "the target file
  does not exist yet, so there is nothing to canonicalize against" — which is exactly
  the reasoning `85f3aed0d` disproved. A symlink at any existing component of the
  fragment redirects the write.

### D. Guards written and never wired (3 functions, 1 live consequence)

`validate_save_path`, `validate_watch_path`, `validate_file_watcher_paths`: zero
callers, all three `#[allow(dead_code)]`.

**The file-watcher consequence is a live, end-to-end hole.** `path_safety.rs:1-6`
states the module's purpose: *"Validates that watch paths don't target sensitive
system directories… Defence-in-depth against malicious persona templates that could
leak file names and change patterns from sensitive directories."* The chain today:

1. `src/features/triggers/sub_triggers/configs/FileWatcherConfig.tsx:29` — free-text
   input, array-valued, placeholder literally `"C:/Users/me/projects or /home/me/src"`.
   No client validation.
2. `commands/tools/triggers.rs:85` `create_trigger` → `validate_trigger_input`
   (`:~200`), which runs exactly three checks — `validate_config_json`,
   `validate_polling_url`, `validate_schedule_has_cron_or_interval`. Not watch paths.
   `validate_file_watcher_paths(trigger_type, config)` has the identical signature
   shape to its neighbours; it was built to slot into this list and never was.
3. `commands/tools/triggers.rs:601-626` — the "validation" surfaced to the user checks
   only `Path::new(p).exists()`, reporting *"All N path(s) exist"*. It tells the user
   a path targeting `~/.ssh` is **valid**.
4. `engine/src/file_watcher.rs:397-412` — registers the paths verbatim,
   `RecursiveMode::Recursive` by default.

A persona trigger can therefore recursively watch `~/.ssh`, `~/.aws` or `/etc`, and the
resulting filenames flow into event payloads and from there into prompts. The
mitigation exists, tested (`path_safety.rs:396-414`), and is not called. **One line in
`validate_trigger_input` closes it.**

### E. Caller-supplied roots — containment that contains nothing (7)

The root must come from app state. These take it from the caller:

`commands/fleet/external.rs:78` `fleet_write_dispatch_brief(cwd, path, contents)` —
**writes a caller-controlled file to a caller-controlled root, and is Public** ·
`commands/execution/knowledge.rs:245` `build_kb_index(root_path, filename)` ·
`commands/infrastructure/context_generation.rs:583` `dev_tools_scan_codebase(root_path)` ·
`commands/infrastructure/dev_tools.rs:62` `dev_tools_create_project(root_path)` ·
`commands/infrastructure/git_checkpoint.rs:25,55,69` (three, on `repo_dir`).

**Composed with the adjacent leaf, this is the sharpest finding in the document.**
`commands/infrastructure/dev_tools_http.rs` is an axum router **mounted unconditionally
in release** on `127.0.0.1:17400+` with **no authentication of any kind** (see
[IPC command authorization](./ipc-command-authorization.md) §F). It exposes
`POST /projects { root_path }` (`:461`) and `POST /scan-codebase { root_path }` (`:490`),
and the scan calls `write_context_map_artifacts(&pool, project_id, &project.root_path)`
(`:727,:792`), which does `std::fs::write(root.join("context-map.json"))`
(`context_map_export.rs:69-73`) and `std::fs::write(root.join("CLAUDE.md"))` (`:311-321`).
No authentication × no path validation = **unauthenticated arbitrary file write to two
attacker-named filenames at any path on the machine, from any local process.** Neither
leaf alone shows this; it exists only in the composition.

### F. Check-then-use-original — the `Result<()>` / `bool` shape (18)

A guard that returns `()` or `bool` cannot stop its caller from going back to the raw
input. Eighteen call sites do exactly that:

- `obsidian_brain/graph.rs:346, :387, :560, :638` — `ensure_within_vault` canonicalises
  both sides, then the caller reads the unresolved `&note_path`.
- `engine/src/desktop_bridges.rs:534, :560, :580, :608` — `is_path_allowed(&path)` +
  `validate_path_safety(&path)` both pass, then the I/O runs on the original `path`
  string. `is_path_allowed` went to the trouble of canonicalising and is then discarded.
- `commands/companion/approvals/approval_exec_fleet.rs:1095, :1230, :1748` and
  `approval_exec_{night.rs:60, dev.rs:857, knowledge.rs:269, :615}` — `validate_fleet_cwd`
  canonicalises `cwd` and confirms it is under a registered project root; the spawn at
  `:1106` then uses `PathBuf::from(cwd)`. This one gates
  `claude --dangerously-skip-permissions`.
- `commands/artist/transcribe.rs:147, :182` — `validate_local_file_path` passes, then
  `PathBuf::from(&file_path)`.
- `commands/infrastructure/skill_files.rs:1233-1243` — validates `canonical_file`,
  writes `&file_path`. It is also the one command in that file that skips
  `validate_skill_name`, which its five siblings all call.

Contrast `open_log_file_safely`, which returns the already-open `File` and makes the
mistake unrepresentable. Every one of these is a TOCTOU window as well as a
correctness gap.

### G. Guards that do not guard (12)

- **`engine/src/desktop_bridges.rs:905, :914, :921, :964` — a live path traversal, and
  the highest-severity finding in this sweep.** Inside `execute_via_filesystem`
  (`:884`), four Obsidian actions do:
  ```rust
  let full_path = vault.join(path);
  if !full_path.starts_with(vault) { return Err(AppError::Forbidden("Path traversal detected".into())); }
  std::fs::read_to_string(&full_path)   // and fs::write, and OpenOptions::append
  ```
  `Path::starts_with` is **component-wise and does not normalise `..`** — it is
  documented to consider "whole path components" only, and `Path::components()`
  deliberately preserves `ParentDir`. So for `path = "../../.ssh/id_rsa"`,
  `vault.join(path)` is `<vault>/../../.ssh/id_rsa`, whose leading components are
  exactly the vault's; `starts_with` returns **true**, the check passes while printing
  the words "Path traversal detected", and the un-normalised path is then handed to the
  OS, which resolves the `..` and leaves the vault. There is no canonicalisation, no
  `Component::ParentDir` rejection, and **no outer guard** — I read `:884-897`, and the
  only precondition is `vault.exists()`. `ReadNote` (`:912`) is an arbitrary file read,
  `WriteNote` (`:919`) an arbitrary write that also `create_dir_all`s the parent, and
  `AppendToNote` (`:962`) an arbitrary append-or-create. The `is_path_allowed` and
  `validate_path_safety` calls at `:534-610` are in a **different** function and do not
  cover this one. Reachable through the Obsidian desktop-bridge connector, i.e. from a
  persona action whose `path` may be LLM-influenced. **This is the one entry in this
  document to fix before the others.**
- **`vector_kb::validate_path_safety` (`:274`) has no containment**, only a blocklist of
  `C:\Windows\` / `C:\ProgramData\` (Windows) or `/etc/`,`/var/`,`/private/etc/` (Unix)
  plus 9 dotdirs and 12 filenames. `D:\`, `\\server\share\`, and every other user's
  profile pass. Its callers `kb_ingest_files` (`:549`) and `kb_ingest_directory`
  (`:597`) are **Public** and gated only by `require_auth`, a no-op — so any webview
  code can embed the contents of an arbitrary directory into a vector store.
- **`foraging::is_safe_path_component` (`:779`)** — substring blocklist; accepts NTFS
  ADS (`x:y`), Windows reserved device names (`NUL`, `CON`, `COM1`), and trailing dots.
- **`desktop_bridges::validate_path_safety` (`:644`)** — traversal + a Windows-only
  sensitive-dir list built from `%USERPROFILE%`; the whole `#[cfg(target_os = "windows")]`
  block has no Unix counterpart, so `~/.ssh` is blocked on Windows and allowed elsewhere.
- **`path_safety::resolve_and_guard` (`:195`)** does not reject NUL bytes or ADS
  textually before calling `canonicalize()`; it relies on canonicalisation failing.
  `open_log_file_safely` shows the textual pre-check is the correct first step.
- **`companion/jobs/connector_use.rs:1027` — `resolve_within` re-introduces the
  bypass-by-fallback pattern**, twice: `joined.canonicalize().unwrap_or_else(|_| joined.clone())`
  and the same on the root. Here it happens to fail *closed* rather than open — when
  the root canonicalises to a `\\?\` verbatim form and a not-yet-created target does
  not, the comparison is verbatim-vs-classic and legitimate `local_drive` writes are
  denied — but it is the exact construct `graph.rs:262-272` documents as a security
  bypass, and which arm you land on is accidental.
- **`webbuild/project.rs:55` — `project_dir(slug)`** rejects `/`, `\` and `..` but not
  `:`, so a slug of `C:foo` makes `projects_root().join("C:foo")` evaluate to `C:foo` —
  `Path::join` discards the base when the argument carries a prefix — resolving against
  the per-drive current directory, outside the projects root entirely.
- **`twin.rs:1942` sanitises by replacement, not rejection**:
  `name.replace("..", "_").replace('/', "_").replace('\\', "_")` leaves `:` untouched, so
  device names and `C:evil` survive. Only `resolve_wiki_dir`'s containment on the
  enclosing `output_dir` saves it.
- **`artist_rename_asset` (`artist/mod.rs:331-344`)** rejects `/`, `\`, `\0`, `.` and
  `..` but not `:`, and — unlike its `artist_delete_asset` and `artist_read_image_base64`
  siblings in the same file, which both canonicalise and containment-check — performs
  **no containment check at all** on the asset's parent.
- **`auth_detect::path_matches_dir` (`:232,:238`)** compares with a bare `starts_with`
  and no `/` boundary, so an allowlisted `C:\Program Files\Git` also matches
  `C:\Program Files\Gitwhatever\evil.exe`. `desktop_security:254`, `path_safety`, and
  `tool_runner` all get this boundary right; this one does not.
- **`desktop_bridges::validate_path_safety` (`:644`)** wraps its entire sensitive-
  directory list in `#[cfg(target_os = "windows")]`, so `~/.ssh` and `~/.aws` are
  blocked on Windows and allowed on macOS and Linux.

### H. Frontend picker / typed-path half (25)

- **19 of 20 `@tauri-apps/plugin-dialog` call sites hand-roll `open`/`save`** across 12
  files. The one shared primitive, `DirectoryPickerInput.tsx`, has **exactly one
  consumer** (`QuestionnaireFormGridParts.tsx:453`), has no `@catalog` doc comment so
  `CATALOG.md:113` lists it with no description, and **renders a free-text input**
  (`:45-51`) that bypasses its own dialog.
- **5 free-text filesystem-path inputs, 4 unvalidated**: `DirectoryPickerInput.tsx:45`,
  `obsidian-brain/sub_setup/SetupPanel.tsx:247`, `FileWatcherConfig.tsx:29` (the
  category-D chain), `templates/components/SourceDefinitionInput.tsx:267`. Only
  `drive/components/DriveToolbar.tsx:195` validates, via `api/drive.ts`.
- **The two-sided contract is documented backwards.** `src/api/signing/index.ts:48-56`
  declares the TS denylist "the PRIMARY gate, not defense in depth"; `signing/mod.rs:51-53`
  declares the TS list "bypassable by any direct IPC caller" and itself primary. The
  backend is right. The lists are also **not equal** — the Rust side omits `.aws/config`
  and `~/.git-credentials` — and no test pairs them.
- **2 pickers live in Rust** (`kb_pick_files`, `kb_pick_directory`,
  `credentials/vector_kb.rs:331,…`), so filter/`defaultPath` policy for the KB surface
  is invisible to the frontend and diverges from the 20 TS call sites by construction.
- **`SourceDefinitionInput.tsx:189`** opens a file dialog with `directory: false` and
  **no `filters`** — any file type, handed to a backend command with no extension
  allowlist. (Its `silentCatch` tag at `:197` also claims the path
  `features/shared/components/SourceDefinitionInput`, which is not where it lives.)

### I. Drop-zone half (8)

Four drop zones ingest files; the other eleven `onDrop` handlers are intra-app
reorder/move with a custom MIME and carry no filesystem trust.

- **All four OS→app drop zones are dead on desktop.** `tauri.conf.json` does not set
  `dragDropEnabled`, so it resolves to Tauri v2's default `true` (confirmed in the
  generated `gen/android/.../tauri.conf.json`). Tauri then installs the OS-level drop
  handler and routes file drops to the `tauri://drag-drop` event rather than the DOM —
  and `getCurrentWebview().onDragDropEvent` / `tauri://drag-drop` have **zero
  occurrences** anywhere in `src/`. Every one of these handlers reads
  `e.dataTransfer.files`, which OS-originated drags will not populate.
  Affected: `vault/shared/vector/ingest/IngestDropZone.tsx:32-65`,
  `plugins/drive/DrivePage.tsx:431-487`,
  `shared/components/forms/DesignInput.tsx:149-159`,
  `templates/sub_n8n/steps/upload/useFileUpload.ts:150-156`.
  Decide deliberately: either `dragDropEnabled: false` (DOM drops, byte payloads, no
  host paths — the `DrivePage` shape) or subscribe to the Tauri event and run the
  resulting absolute paths through step 5. The current state is neither.
- **`IngestDropZone.tsx:44` casts `File` to `{ path?: string }`** to recover a host
  path — a Tauri v1 / Electron API. The comment at `:43` states it works. It does not.
- **The only zone that would ship real host paths to Rust has no frontend validation
  at all** — no extension, size, or count check before
  `kbIngestFiles(kbId, paths)` with an unbounded `Vec<String>`. Its only backstop is
  `vector_kb.rs:557-567`, which is the containment-free blocklist from category G.
  Contrast `DrivePage.tsx:62,450`, which mirrors the Rust `MAX_WRITE_BYTES` cap
  deliberately — the right pattern, in the wrong one of the two zones.
- **No shared drop-zone behaviour exists.** `shared/components/feedback/DropZoneGlow.tsx`
  is presentational only (`aria-hidden`, `pointer-events-none`) and used by 2 of the 4;
  `DrivePage` and `DesignInput` hand-roll their own overlays *and* their own identical
  `dragCounterRef` nested-element workaround. `CATALOG.md:92` describes `DropZoneGlow`
  with a truncated fragment of its `radius` prop JSDoc rather than a description — the
  same catalog-extraction defect as `DirectoryPickerInput`.

### J. Non-atomic writes to caller-derived paths (70)

The leaf's server half is *"proving a path stays inside the sandbox **and writing
without tearing**"*. The second half is in worse shape than the first.

- **Seven independent hand-rolled atomic writers, no shared primitive.** Three are
  named `atomic_write` in three modules: `obsidian_brain/mod.rs:62`,
  `obsidian_brain/graph.rs:513` (= the first plus a uuid, in the same module tree,
  neither importing the other), `artist/persistence.rs:296`. Plus inline copies at
  `live_roadmap.rs:376`, `daemon/lock.rs:230`, `core/src/crypto.rs:767` and `:1106`
  (near-copies of each other), and `system/mcp_integration.rs:136` and `:176`
  (verbatim copies 40 lines apart). There is no `fs_util` / `io` module anywhere
  under `src-tauri/`; `core/src/utils/` contains only `sanitization.rs` and `text.rs`.
- **Only one site in the entire repo fsyncs the data file** (`daemon/lock.rs:244`).
  **No site anywhere fsyncs the parent directory**, so a rename can be durable while
  the directory entry pointing at it is not.
- Three of the seven **leak the temp file on rename failure** (`artist/persistence.rs:296`,
  `live_roadmap.rs:376`, `mcp_integration.rs`), stranding `.tmp` siblings in the
  user's own folders. Two use a **fixed `.tmp` suffix with no uuid**
  (`obsidian_brain/mod.rs:62`, `daemon/lock.rs:230`), so two concurrent writers
  clobber each other's staging file — the exact bug `graph.rs:513` was written to fix,
  left unfixed in its sibling.
- **63 write sites derive their path from a caller-supplied parameter and are not
  atomic at all** (of 195 total write sites under `src-tauri/`, after excluding tests,
  app-data constants, and the nine atomic bodies). The highest-blast-radius ones are
  read-modify-writes of files the *user* owns:
  `context_map_export.rs:321` (`CLAUDE.md` at a caller `root_path` — the same command
  reachable unauthenticated per category E), `workspace_projection.rs:512,528`,
  `claude_md_projection.rs:198`, `cli_mcp_config.rs:319`, `worktree_settings.rs:104`,
  `hooks_sidecar.rs:84`, and `fleet/hook_install.rs:166,202` (`~/.claude/settings.json`,
  under a comment claiming atomicity). Then the user-data writes:
  `drive.rs:959` and `mcp_server/tools.rs:313` (`drive_write`, up to 50 MB),
  `obsidian_brain/drive.rs:754`, `obsidian_brain/graph.rs:566`,
  `memory_ledger.rs:787,902`, `skill_files.rs:1243`, `signing/mod.rs:303`,
  `twin.rs:1945`, `data_portability.rs:2184,9658`, `import_export.rs:270`,
  `network/bundle.rs:32`, `network/enclave.rs:23`.

### K. Path-rejection strings with no user-facing message (13)

`src/lib/errors/errorRegistry.ts` has 63 `match:` rules; the `error_registry` section
of `en.json` has 140 keys. Grepping both for `Path traversal`, `home directory`,
`system directory`, `File type`, `symlink`, `sensitive` returns **zero**. All 13
distinct backend path-rejection strings — `path_safety.rs:79,86,95,104,112,225,234,242,291,353,363`,
`desktop_bridges.rs:650`, `vector_kb.rs:283,316`, `drive.rs:426`, `ocr/mod.rs:362,464` —
fall through to `GENERIC_FALLBACK` with an `unclassified` breadcrumb. The most likely
real-world failure of this whole area (a user typing a watch path or a save path that
the guard rejects) renders as untranslated generic English.

### Why all 241 are green

21 custom ESLint rules — 14 design-token, 4 React/store, 2 error-handling, 1 i18n.
**None** touches paths, the dialog plugin, or the filesystem. No script in `scripts/`
and no job in `.github/` mentions path validation. `npm run check` is silent on every
one of the deviations above. See **The missing gate**.

## Gaps in the primitive

1. **The repo holds two incompatible definitions of "a safe path", and the shared one
   is the weaker.** *Anchored*: the app owns the root, the caller sends a fragment,
   the guard resolves and proves containment — an escape requires defeating
   `canonicalize`. *Blocklist*: the caller sends an absolute path and the app checks
   it is not somewhere known-bad — an escape requires only a location nobody
   enumerated. `engine::path_safety`, the module everything points at, implements the
   blocklist model. **That is why it has two adopters**: it does not fit the shape most
   commands need. Every strong guard in the repo (#6, #8, #11, #19 and the frontend
   `validateRelPath`) independently re-derived the anchored model, three of them with a
   comment saying "mirrors X". This single mismatch is upstream of categories B, C and
   most of A, and no amount of documentation fixes it — the anchored resolver has to
   move into the shared crate and the blocklist has to be renamed for what it actually
   is (`validate_user_picked_absolute_path`).
2. **`resolve_safe` is `pub(crate)` inside a command module.** The best guard in the
   repo lives at `src/commands/drive.rs:376`, so `engine/`, `core/` and `mcp_server/`
   structurally cannot call it — which is precisely why `mcp_server` and `twin` hold
   hand copies. It needs to move into `engine::path_safety` — under a name that is not
   already taken, since `resolve_within` is currently `companion/jobs/connector_use.rs:1027`
   and means something subtly different there. This is a genuine module-graph
   limitation, not laziness: the four hand copies could not have called it.
3. **A guard returning `Result<()>` cannot force its own result to be used.** Rust has
   no way to say "you may not touch the input string after calling me". The only
   available fix is the shape: return the resolved `PathBuf` (or the open `File`) and
   make the original inconvenient to reach.
4. **Nothing can decide whether a root is app-owned.** `root: String` and
   `rel_path: String` are the same type. Distinguishing "the app named this boundary"
   from "the caller named it" is a judgement, and category E is what happens when it
   is never made. A newtype (`SandboxRoot(PathBuf)`, constructible only from app state)
   would encode it — that is a real design option, not a limitation.
5. **Windows coverage is per-guard and nowhere complete.** All 32 guards were checked
   against seven Windows-specific hazards (R = rejects · **A** = accepts, a hole ·
   ~ = rejected incidentally by a later containment step):

   | Guard | UNC `\\srv\s` | `\\?\C:\…` | `C:foo` | ADS `f.txt:s` | `NUL`/`CON` | Trailing `.`/` ` | 8.3 |
   |---|---|---|---|---|---|---|---|
   | `resolve_safe` | R (Prefix) | R | R | **A** | **A** | **A** | R |
   | `validate_file_access_path` | ~ (home) | R (strips `//?/`) | ~ | **A** when `allowed_extensions = None` | **A** | **A** | R |
   | `open_log_file_safely` | ~ | ~ | ~ | **R** | ~ | **A** | R |
   | `desktop_security::is_path_allowed` | ~ | R | ~ | **R** | ~ | **A** | R |
   | `api_proxy::verify_path_containment` | **R** | **R** | R | **R** | ~ | **A** | R |
   | `transcribe::validate_local_file_path` | **R** | **R** | **A** | **R** | **A** | **A** | n/a |
   | `safe_drive_filename` | R | R | **R** | **R** | **A** | **A** | n/a |
   | `foraging::is_safe_path_component` | R (sep) | R | **A** | **A** | **A** | **A** | n/a |
   | `vector_kb::validate_path_safety` | **A** | **A** | **A** | **A** | **A** | **A** | **A** |
   | `desktop_bridges::validate_path_safety` | **A** | **A** | **A** | **A** | **A** | **A** | **A** |
   | `desktop_bridges` inline `:905…` | R | R | R | **A** | **A** | **A** | **A** |
   | `webbuild::project_dir` | R | R | **A** | **A** | **A** | **A** | n/a |
   | `debug_export::sanitize_stem` | **R** | **R** | **R** | **R** | **A** | **R** | **R** |

   Three results generalise. **Reserved device names are checked by exactly zero of the
   32** — a grep for `CON`/`PRN`/`AUX`/`NUL`/`COM1`/`LPT1` across all crates returns no
   guard code. Every resolver that permits a *new* file canonicalises the parent and
   re-appends the basename, so `NUL` passes containment and the write vanishes into the
   device; `NUL.png` / `NUL.ts` / `NUL.persona` also defeat every extension allowlist.
   **Trailing dots and spaces are stripped by nobody** — the concrete consequence is
   that `is_sensitive_credential_path`'s `ends_with(".pem")` is defeated by `key.pem.`
   (mitigated in `signing` only because it runs post-canonicalisation). **ADS is checked
   by 7 of 32**, and by *none* of the six sandbox resolvers. Every one of these is cheap
   to add to a single shared resolver and impossible to maintain across thirty-two —
   which is the argument for consolidation stated as a measurement.
6. **`canonicalize()` requires the path to exist**, which is why every anchored resolver
   grows a not-yet-exists branch, and why that branch is where the symlink bug lived in
   `resolve_safe` and still lives in `resolve_drive_path` and `resolve_inside`. There is
   no stable Rust API for "resolve as far as possible without following the tail", so
   the component-walking `symlink_metadata` probe at `drive.rs:419-432` is the correct
   workaround — it just has to exist in exactly one place.
7. **Nothing can prove a path came from the OS dialog.** `open()` returns a string; by
   invoke time it is indistinguishable from a typed one. A picker-issued nonce the
   backend could verify is the only real answer, and it does not exist. Until it does,
   "the user picked it" is a UX statement and never a security one — which is why
   step 5 pairs the absolute guard with a denylist rather than trusting provenance.
8. **`#[allow(dead_code)]` disables the only automatic signal.** All three dead guards
   in category D carry it. The compiler was going to catch this.
9. **There is no atomic-write primitive to route people to.** Unlike the path half —
   where the right answer exists and is simply unshared — the durability half has no
   canonical implementation anywhere: no `fs_util`/`io` module under `src-tauri/`, and
   `core/src/utils/` holds only `sanitization.rs` and `text.rs`. So "use the shared one"
   is not yet advice anyone can follow, and step 7 has to describe the mechanics instead
   of naming a function. This is the one place where the fix is genuinely *write a new
   primitive* rather than *route to the existing one*: a
   `personas_core::fs_atomic::write_atomic(path, bytes)` that uses `NamedTempFile::new_in(parent)`
   (RAII cleanup, same-volume by construction — the shape `core/src/crypto.rs:767`
   already gets right), `sync_all()`s before `persist()`, and fsyncs the parent
   directory. Nothing in the repo does the last of those.
10. **Tauri's drag-drop is either/or, and the repo has silently taken neither branch.**
    With `dragDropEnabled` at its default `true`, OS file drops go to
    `tauri://drag-drop` (real host paths) and *not* to the DOM; with it `false`, the DOM
    gets `dataTransfer.files` (byte payloads, no paths). You cannot have both, and the
    four drop zones are written for the branch that is not active (category I). This is
    a genuine platform constraint — the gap is that nothing records which branch the app
    intends, so four surfaces were written against an assumption no one checked.

## The missing gate

Nothing in `npm run check`, `npm run lint`, `cargo clippy` or
`cargo test --features desktop` touches path handling — verified by grepping all 21
custom ESLint rules, all of `scripts/`, and `.github/`. All 241 deviations are green
today — including the live traversal in category G. This is not a weak gate; it is the
absence of one.

**Signal.** Two, both verified as near-exact:

- **Backend:** a `#[tauri::command]` whose signature carries a parameter matching
  `/(^|_)(path|paths|dir|directory|folder|root|cwd|file)(_|$)/` with type `String` /
  `PathBuf` / `Option<…>` / `Vec<String>`. Measured precision: 71 matches, 68 true
  positives, **3 false positives** (`sort_dir`, and two URL `path`s), and 10 known
  false negatives from the non-conforming names listed in Evidence — better than the
  `role="columnheader"` precedent, and the false negatives are fixable by adding those
  six names to the pattern.
- **Frontend:** an import from `@tauri-apps/plugin-dialog` (20 sites, 12 files, zero
  ambiguity) and `onChange` on an input whose state variable matches `/Path$|Dir$|Root$/`.

**Mechanism — six parts. Part 1 is ~30 lines and catches the live vulnerability; do it
first regardless of the rest.**

1. **A lexical-containment lint.** `Path::starts_with` on a value produced by
   `Path::join` with no intervening `canonicalize()` is a *syntactic* signal, and it is
   exactly the bug at `desktop_bridges.rs:905,914,921,964`. A clippy
   `disallowed_methods` entry cannot express the dataflow, but a source-walk test can:
   flag any function body containing both `.join(` and `.starts_with(` with no
   `canonicalize` between them. **Four true positives today**, all of them the live
   traversal, and it generalises to every future copy of the mistake.
2. **A Rust test in `engine::path_safety`, `guarded_path_commands`.** Walk
   `src-tauri/src/**/*.rs`, parse every `#[tauri::command]` signature, and for each with
   a path-typed parameter assert its body contains a call to one of the sanctioned
   resolvers (`resolve_within` / `resolve_safe` / `validate_file_access_path` /
   `resolve_vault_subpath` / `open_log_file_safely` / `is_path_allowed`) **or** appears
   in a typed exemption table:
   ```rust
   const UNGUARDED_PATH_COMMANDS: &[(&str, &str)] = &[
       ("drive_read_text", "delegates to drive_read, which resolves via resolve_safe"),
       …
   ];
   ```
   A written reason per entry, checked by review, attributed by `git blame`. Seed it
   with the 51 from category A and burn it down. This is categories A, C, E and F at
   `cargo test` time.
3. **Delete-or-wire, enforced.** Assert every `pub fn` in `path_safety` has at least one
   non-test caller. `validate_save_path`, `validate_watch_path` and
   `validate_file_watcher_paths` fail it today; fixing them means either one line in
   `validate_trigger_input` and one in `export_persona_bundle`/`seal_enclave`, or
   deletion. Either outcome is correct; the current state is not. Remove the three
   `#[allow(dead_code)]` attributes in the same change and let the compiler hold the
   line afterwards.
4. **A duplicate-guard ratchet.** Assert the count of functions matching
   `fn \w*(resolve|validate|ensure|is)_\w*(path|safe|within|inside)\w*` under
   `src-tauri/` does not exceed a declared ceiling, starting at today's **32** and
   ratcheting down. Crude, but it is the only mechanism that makes adding a
   thirty-third guard visible, and the ratchet is what converts consolidation from a
   one-off into a direction. Pair it with an assertion that no two guards share a name
   with different semantics — `is_path_allowed`, `validate_path_safety` and
   `atomic_write` each currently name two or three different behaviours.
5. **An atomic-write check**, once Gap 9's primitive exists: flag `fs::write` /
   `tokio::fs::write` / `File::create` whose path argument derives from a function
   parameter and which is not `write_atomic`. 63 hits today; seed the same
   reason-bearing exemption table.
6. **An ESLint rule `prefer-directory-picker-input`**, modelled on the existing
   `prefer-shared-clipboard` / `prefer-section-card` (which are precedent for exactly
   this shape). Warn on a direct `open`/`save` import from `@tauri-apps/plugin-dialog`
   outside `src/features/shared/components/forms/` and outside `src/api/`. 19 warnings
   on day one, which is the point. Pair it with fixing `DirectoryPickerInput` so the
   thing it routes people to does not itself contain a free-text bypass.

Alongside: a Vitest case that reads the 13 rejection literals out of the Rust sources at
test time and asserts each matches a rule in `errorRegistry.ts`, so category I cannot
regress and a backend message change fails loudly rather than silently degrading to
generic English. And a contract test pairing `SENSITIVE_PATH_PATTERNS`
(`src/api/signing/index.ts:63`) against `is_sensitive_credential_path`
(`path_safety.rs:31`) in both directions — it fails today on `.aws/config` and
`~/.git-credentials`, which is the correct first result. Fix the inverted comment at
`src/api/signing/index.ts:48-56` in the same change.

**Allowlist.** The `UNGUARDED_PATH_COMMANDS` table (51 entries at seeding, each with a
prose reason, target zero). Plus `CALLER_SUPPLIED_ROOT_OK` for the category-E commands
that genuinely must accept a root — `dev_tools_*` operating on registered projects has
a real claim, `fleet_write_dispatch_brief` does not — each requiring a written reason
and, per the composition finding in E, an authenticated transport. Plus the three URL-path
false positives (`execute_api_request`, `openapi_playground_test`) and `sort_dir`, which
belong in a `NOT_A_FILESYSTEM_PATH` table so the signal's precision is asserted rather
than assumed.

**How it fails loudly if its own precondition is absent.** The failure mode this repo
has actually shipped is a checker that passes because it examined nothing —
`ci.yml`'s `cargo test` aborting pre-compile without `--features desktop`, the secret
scan exiting 0 with gitleaks absent. Copy `ipc_auth.rs:971-976`'s `checked > 50`
precedent and go further:

- `assert!(commands_parsed > 1_500, "command walk broke — parsed {commands_parsed}, expected ~1,661")`.
  A regex that stops matching `#[tauri::command]` must read as breakage, not as
  compliance.
- `assert!(path_commands_found >= 60, …)` as a **separate** counter from the total. One
  combined counter would let the parameter-matching half break silently while the
  command count carried the assertion — which is exactly how the async blind spot in
  the adjacent authorization guard survived.
- `assert!(!SANCTIONED_RESOLVERS.iter().any(|r| resolver_call_sites(r) == 0), …)` — a
  sanctioned resolver with zero call sites means either the walk broke or the resolver
  died. Both need to be loud; today the second one is silent (category D).
- `assert!(UNGUARDED_PATH_COMMANDS.iter().all(|(n, _)| commands.contains(n)), …)` and
  the same for the root table. An exemption naming a command that no longer exists is a
  stale exemption, and stale exemptions are how an allowlist rots into a blanket pass.
- Assert the exemption table's length is **non-increasing** against a checked-in
  baseline. Without a ratchet, an allowlist seeded at 51 is just a record of the
  problem.
- Run it under `cargo test --features desktop` where `ci.yml:252-258` already runs — the
  job whose own comment records that it once "never actually run a test" for want of
  that flag. That history is why the counter assertions above are not optional.

**What no gate can do.** No checker decides whether a root is legitimately app-owned
(gap 4), whether a blocklist is complete enough for its exposure, or whether a
particular command *should* accept an absolute path at all. Those are the judgements in
steps 1 and 5 and they stay human. A checker guarantees only that a path-taking command
went through *some* sanctioned resolver, that an exception is written down and shrinking,
and that a guard which exists is either used or deleted. The strongest available proxy
for the judgement is a **warn-only advisory** on the two shapes that produced categories
E and A: a command taking both a root-like and a path-like parameter, and a command whose
body contains `fs::write` / `fs::read_to_string` / `File::create` / `create_dir_all` on a
value derived from a parameter with no sanctioned resolver between them. That is a
review-time nudge, and it should be labelled as one.
