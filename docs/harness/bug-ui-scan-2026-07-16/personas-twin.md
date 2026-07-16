# Personas Twin — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. `twin_update_contact` silently NULLs whatever field the caller omits
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/repos/twin.rs:882-885 (and src/api/twin/twin.ts:472-473)
- **Scenario**: Any caller invokes `twin_update_contact` with only `alias` (the TS wrapper's signature `updateTwinContact(id, alias?, notes?)` explicitly invites partial updates) while the contact has user-authored `notes`. The SQL is `UPDATE twin_contacts SET alias = ?2, notes = ?3 ...` with no tri-state handling, so the omitted `notes` arrives as `None` and is written as NULL.
- **Root cause**: The repo assumes "omitted = clear" while the wrapper's optional parameters read as "omitted = keep". Every other partial update in this file (`update_profile`, `update_channel`) uses the `Option<Option<&str>>` tri-state pattern; `update_contact` is the one that doesn't. Today it's masked only because ContactsPanel.tsx happens to re-send both drafts (prefilled in `startEdit`), so the trap is one refactor or one new call site (e.g. an MCP/persona tool renaming a contact) away from firing.
- **Impact**: Silent, unrecoverable loss of user-curated contact notes/alias — the exact data `upsert_contacts_from_communications` promises never to overwrite. No error, no toast; the returned row even confirms the wipe.
- **Fix sketch**: Convert `update_contact` to the same `Option<Option<&str>>` dynamic-SET pattern used by `update_profile`, and mirror `{ alias?: string | null, notes?: string | null }` in the TS wrapper so "keep" (undefined) and "clear" (null) are distinct.

## 2. `record_interaction` success theater: requested pending memory can be silently dropped
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/twin.rs:598-607
- **Scenario**: A persona/channel bridge calls `twin_record_interaction` with `create_memory = true` while the pending-memory insert fails (SQLite busy/lock contention from a concurrent Studio batch write, or any constraint error). The communication row commits, `create_pending_memory`'s result is discarded via `let _ =`, and the command returns `Ok(TwinCommunication)`.
- **Root cause**: The memory insert is treated as best-effort decoration, but it is the caller's explicitly requested side effect and the input to the human-review learning loop; there is no log, no error propagation, and no retry.
- **Impact**: The twin's knowledge inbox silently starves — interactions are recorded but never surface for review, and nothing anywhere indicates the divergence. Caller cannot even detect it (the returned communication looks identical either way).
- **Fix sketch**: Propagate the error (or at minimum `log::warn!` with the communication id and return a flag in the payload). Since both inserts use the same connection, wrapping them in one transaction gives all-or-nothing semantics cheaply.

## 3. `create_profile` swallows COUNT errors — a transient DB error mints a second active twin
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/twin.rs:143-146 (same pattern at 69-75; consumer at 110-122)
- **Scenario**: User creates a twin while the pool briefly errors (locked DB during a background wiki compile / Studio batch). `query_row("SELECT COUNT(*) FROM twin_profiles").unwrap_or(0)` turns the error into "zero twins exist", so the new row is inserted with `is_active = 1` alongside the existing active twin. The check-then-insert is also non-transactional, so two concurrent creates on an empty table both see 0.
- **Root cause**: `.unwrap_or(0)` conflates "no rows" with "query failed", and first-twin auto-activation isn't guarded by a transaction or a partial unique index.
- **Impact**: Persistent state corruption: two `is_active = 1` rows. `get_active_profile` uses `LIMIT 1` with no ORDER BY, so which twin the connector impersonates becomes arbitrary and can flip between queries — recall bundles, tone, and drafted replies ground on the wrong identity until the user manually re-activates one (the sibling `unique_slug` swallow at line 75 similarly converts a DB error into a raw UNIQUE-constraint failure instead of a clean retry).
- **Fix sketch**: Propagate the count error (`?` instead of `unwrap_or(0)`), and do count+insert inside one transaction. Belt-and-braces: `CREATE UNIQUE INDEX ... ON twin_profiles(is_active) WHERE is_active = 1`.

## 4. `TwinHeaderBand` hardcodes `min-w-[80vw]`, guaranteeing horizontal overflow in any narrower pane
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/twin/shared/TwinHeaderBand.tsx:108
- **Scenario**: User opens any Twin sub-page in a window where the content pane is narrower than 80% of the viewport — i.e. whenever the app sidebar plus panel chrome consume >20vw, or the Twin plugin renders in a split view. The hero band refuses to shrink below 80% of the *viewport* (not its container), pushing the entire page into horizontal scroll.
- **Root cause**: A viewport-relative minimum on a container-scoped component. The band's own responsive design (`px-4 md:px-6`, `hidden sm:flex` ribbon, `hidden md:flex` KPIs, `truncate` on title/subtitle) shows it was meant to degrade gracefully — the `min-w` defeats all of it, and since every Twin sub-page shares this band, the overflow is site-wide within the plugin.
- **Impact**: Horizontal scrollbar / clipped actions slot on every Twin page at moderate window sizes; the right-aligned `actions` (primary buttons) are the first thing pushed off-screen.
- **Fix sketch**: Delete `min-w-[80vw]` (the band is already `flex-shrink-0` in the column axis and full-width by block layout); if a floor is truly needed, use `min-w-0` plus container queries or `min-w-max` on an inner scroll wrapper.

## 5. `TwinPicker` keyboard navigation is invisible to assistive tech
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/twin/shared/TwinPicker.tsx:189-260
- **Scenario**: A screen-reader user opens the picker (built explicitly as a keyboard-first command menu) and presses ArrowDown. Focus stays on the text input; the highlighted option changes only via `bg-violet-500/10`. The input has no `role="combobox"`, no `aria-controls`, no `aria-activedescendant`; option buttons have no `id`s; so nothing is announced — the user cannot tell which twin Enter will select. Additionally the pin toggle `<button>` sits as a direct child of the listbox's `<li>`, which is invalid inside `role="listbox"` structure.
- **Root cause**: Visual-only highlight state; the ARIA combobox pattern (combobox input + activedescendant pointing at option ids) was not wired even though `aria-haspopup="listbox"`, `role="listbox"` and `role="option"` were.
- **Impact**: The picker's headline features (type-to-filter, arrow+Enter selection, pinning) are unusable non-visually; WCAG 4.1.2 name/role/value failure on a primary navigation control.
- **Fix sketch**: Give the input `role="combobox"`, `aria-expanded`, `aria-controls={listId}`, and `aria-activedescendant={optionId(highlightIdx)}`; assign stable `id`s to option buttons; move the pin toggle inside the option's accessible actions or expose pinned state via `aria-description` instead of a nested sibling button.
