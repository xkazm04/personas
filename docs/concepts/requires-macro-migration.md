# `#[requires(level)]` migration plan

**Status:** Scaffold landed 2026-05-16. Thin slice: `src-tauri/src/commands/core/personas.rs` (12 commands migrated).
**Predecessor:** [capability-audit.md](./capability-audit.md) — Phase 2 verdict that replaced the lattice mega-refactor with this targeted ticket.

---

## What landed in the scaffold

1. **Workspace conversion** — `src-tauri/Cargo.toml` is now a Cargo workspace
   with two members: `.` (the existing `personas-desktop` crate) and `macros/`
   (the new `personas-macros` proc-macro crate). No build pipeline changes
   needed: `tauri build` still operates on the root `src-tauri/` package.

2. **`personas-macros` crate** — a tiny proc-macro library at
   `src-tauri/macros/`. Single export: `#[requires(level)]` attribute that
   wraps a `#[tauri::command]` and prepends the matching guard call to the
   function body.

3. **Thin-slice migration** — every `#[tauri::command]` in
   `commands/core/personas.rs` (12 commands) now reads:

   ```rust
   #[tauri::command]
   #[requires(auth)]
   pub fn list_personas(state: State<'_, Arc<AppState>>) -> Result<Vec<Persona>, AppError> {
       repo::get_all(&state.db)
   }
   ```

   …instead of the previous one-line-of-ceremony pattern. The macro auto-detects
   `async fn` and selects the async guard (`require_auth(&state).await?` vs.
   `require_auth_sync(&state)?`).

4. **No behavior change** — the macro expands to the *same call* that was
   there before (`crate::ipc_auth::require_auth_sync(&state)?`). No
   parallel-run validation is needed because no semantic shift happened.

### Verification

- `cargo check --manifest-path src-tauri/Cargo.toml` — clean (142 pre-existing
  warnings, 0 errors, 0 new warnings).
- `cargo test ... --lib personas` — 30/30 pass.

---

## Levels

| Level | Sync expansion | Async expansion | Auto-derives command name? |
|---|---|---|---|
| `auth` | `require_auth_sync(&state)?` | `require_auth(&state).await?` | No (the guard doesn't need it) |
| `privileged` | `require_privileged_sync(&state, "<fn_name>")?` | `require_privileged(&state, "<fn_name>").await?` | **Yes** — derived from `fn` name via `stringify!` |
| `cloud` | (compile error — cloud is async-only) | `require_cloud_auth(&state, "<fn_name>").await?` | **Yes** |

For `privileged` and `cloud`, the macro injecting `stringify!(fn_name)` eliminates
the string-literal drift bug class: today, a contributor renaming a command
must remember to update the literal passed to `require_privileged_sync`. With
the macro the name comes from the function definition itself.

---

## Migration path for the remaining call sites

The audit found 995 imperative auth calls across the backend. The thin slice
covered 12. Remaining work, grouped by command module, is roughly:

| Surface | Approximate sites | Target level |
|---|---:|---|
| `commands/core/{personas, memories, data_portability, ...}` | ~120 | `auth` |
| `commands/credentials/**` (CRUD, vault, rotation) | ~110 | mostly `privileged` |
| `commands/cloud/**`, `commands/gitlab/**` | ~50 | `cloud` |
| `commands/communication/**` | ~80 | `auth` |
| `commands/execution/**` | ~150 | `auth` (a few `privileged`) |
| `commands/design/**`, `commands/recipes/**`, `commands/tools/**` | ~250 | `auth` |
| `commands/infrastructure/**`, `commands/network/**` | ~80 | `auth` (BYOM audit reads are `privileged`) |
| Other modules (artist, twin, companion, obsidian, …) | ~150 | mix |

**Approach for each file:**

1. Grep for the relevant `require_*` import: most files import one or two of
   `require_auth_sync`, `require_auth`, `require_privileged_sync`,
   `require_privileged`, `require_cloud_auth`.
2. Replace `use crate::ipc_auth::{...}` with `use personas_macros::requires;`
   (or add it alongside if other ipc_auth items are still used).
3. For each `#[tauri::command]` fn, add the matching `#[requires(...)]`
   attribute and delete the in-body guard line.
4. Run `cargo check -p personas-desktop` after each file.

The `personas.rs` migration used a 15-line Node regex script (see the
2026-05-16 commit). Most files follow the same pattern and the script can be
adapted by changing the level keyword.

**Estimated effort:** ~1 hour per ~30-command file, ~30 hours total for the
remaining ~983 sites. **Do this incrementally, one module per PR.** Each
module is independent; there is no global state shared by the migration.

---

## What NOT to migrate

- **Helper functions** inside `commands/` that aren't `#[tauri::command]` but
  call `require_*` internally. The macro only applies to Tauri command entry
  points; internal helpers that take `&Arc<AppState>` and bubble up auth
  errors should keep their explicit calls.

- **Test-only commands** behind `#[cfg(feature = "test-automation")]`. These
  bypass auth deliberately; leave them as-is.

- The `require_*` functions themselves in `ipc_auth.rs`. The macro is a
  syntactic convenience over them, not a replacement.

---

## Rollback plan

If `personas-macros` turns out to cause trouble (compile-time slowdown, IDE
indexing weirdness, etc.):

1. Revert the workspace conversion in `src-tauri/Cargo.toml` (remove the
   `[workspace]` block and the `personas-macros` dependency).
2. In every migrated file, replace `#[requires(auth)]` with the explicit
   in-body call. Trivially scriptable.
3. Delete `src-tauri/macros/`.

The macro adds no new dependency on its consumers' types and produces
identical expansion to hand-written code, so the rollback is a pure
string-level revert.

---

## Open follow-ups (not part of this scaffold)

- **CI-enforced sync between `#[requires(level)]` and the `PRIVILEGED_COMMANDS` /
  `CLOUD_COMMANDS` static lists in `ipc_auth.rs`.** Today these are two
  sources of truth; a contributor adding `#[requires(privileged)]` must
  remember to also add the command name to the static list. A `compile_check`
  test could iterate over both and fail on drift. Filed implicitly by this
  ticket; pick up when convenient.

- **Ticket B from the audit** — build-time / runtime tier-sync CI check —
  is independent and has not been started.
