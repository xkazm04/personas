# Handoff — Template Adoption UX Overhaul (sessions Apr 12-13, 2026)

## Context

Multiple sessions of template review surfaced a cluster of UX and correctness
issues in the template adoption flow. This document summarizes what changed,
what the root causes were, and captures the follow-up **Drive plugin** and
**Local Drive connector** requirements that emerged at the end of the work.

---

## Completed work (by commit)

### `2bc72671` — research: idea browser + paper + humbalytics walkthrough (scratch)

### `156d8436` — round 4: close button, blocking callout, fonts, signaller cleanup
- **Questionnaire close button fix**: `ConfirmDestructiveModal` now passes
  `portal` to BaseModal, AND `AdoptionWizardModal` resets `buildSession` on
  open so stale state can't trigger the discard-confirmation dialog while the
  user is still in the questionnaire phase.
- **Prominent blocked-credentials callout**: new top-of-questionnaire banner
  appears whenever any vault category has 0 matching credentials; lists each
  missing category with a primary "Add credential" CTA. Submit stays disabled
  until resolved.
- **Font promotion**: option pills `text-xs → text-base`, question label
  `text-sm → text-base`, help tips `text-xs → text-sm`.
- **Financial Stocks Signaller**: removed `desktop_browser` everywhere —
  `service_flow`, `suggested_tools` (browser_navigate/extract),
  `suggested_connectors` (the whole entry). Rewrote Step 4.5 instructions +
  toolGuidance to use native `web_search` + `http_request`. Marked
  `alpha_vantage` as `optional: true`.
- **Visual Brand Asset Factory**: `aq_brief_concept` now accepts URLs /
  local file / directory paths in textarea. Added 4th option to
  `aq_brief_source` ("Read from a local file or URL") + new
  `aq_brief_source_path` text question.

### `9cf6cd92` — round 3: modal portal, search sync, multi-round, dynamic options
- **Adopt modal renders full-app overlay**: added `portal={true}` to the
  AdoptionWizardModal's BaseModal so it escapes the Agentic Templates panel's
  `overflow-hidden` container.
- **Command Hub missing buttons on skipped tests**: added `onDeleteDraft`
  prop + red "Delete Draft" button through
  `TestResultsPanel → MatrixCommandCenter → PersonaMatrix → MatrixAdoptionView`.
  Also wired `onApproveTestAnyway` so users can promote despite skipped tools.
- **Gallery search state disconnect after module switch**: root cause was
  the module-level `_cachedInput`/`_cachedChips` in `useStructuredQuery`
  rehydrating the visual input on remount without syncing back to the
  parent's filter state. Added a one-shot mount effect that replays cached
  input + chip filters through `onSearchChange` / `onCategoryFilterChange` /
  `onDifficultyFilterChange` / `onSetupFilterChange`.
- **Multi-round questions regression**: `autoTestedRef` was set once per
  `draftPersonaId`, so after answering a follow-up pending question and
  cycling back to `draft_ready`, the auto-test guard blocked re-triggering.
  Added a reset effect (in both `MatrixAdoptionView` and `UnifiedMatrixEntry`):
  whenever a new pending question appears, `autoTestedRef` clears so the next
  `draft_ready → no-questions` transition re-fires the test.
- **Dynamic options filter when 2+ vault matches**: extended
  `vaultAdoptionMatcher` to return a `filteredOptions` map. When a question
  has 2+ vault matches, options are narrowed to only the user's actual
  credentials (plus null/"Other" fallbacks). Threaded through
  `QuestionnaireFormGrid` → `QuestionCard` → `SelectPills`.
- **Idea Harvester**: added `aq_sources_1` textarea and `aq_codebase_1` select
  with `vault_category: "devops"`.

### `ac33ecc5` — Wave 2: adoption resume + runtime project probe
- **Adoption state persistence**: `handleAddCredentialForCategory` saves
  in-progress adoption to `adoptionDraft` (reviewId, templateName,
  userAnswers) before redirect. `MatrixAdoptionView` restores answers on
  mount when the draft's reviewId matches. Draft cleared after restoration.
- **Runtime project probe (Budget Spending Monitor)**: removed static
  `aq_domain_2` (project text input). Added Step 0 to template instructions:
  detect provider from injected credential type, call provider's project
  list API, surface results as a `pending_question` during the build/test
  phase. Reuses existing `pendingQuestions` mechanism. Pattern is
  generalizable to any template needing runtime resource discovery.

### `c95d0523` — Wave 1: vault-aware adoption with blocking + restoration
- **Phase 1** — cloud connector mappings for `gcp_cloud`, `aws_cloud`,
  `azure_cloud`, `cloud_billing`. Builtin connectors: 99 total.
- **Phase 2** — vault-aware questionnaire with 3 states (auto-detect when 1
  match / user picks when 2+ / BLOCK with "Add credential" when 0 matches).
  New `TransformQuestionResponse` fields: `vault_category`,
  `option_service_types`. New `vaultAdoptionMatcher.ts` utility. UI badge
  for auto-detected answers.
- **Phase 3** — Budget Monitor connector category `cloud` + vault_category;
  Visual Brand intent question + vault_category on both AI questions.
- **Earlier-session restoration** — deferred persona creation (questionnaire
  close no longer leaves orphan drafts), default "Ready" coverage filter,
  optional connector filtering in readiness scoring, sidebar L1 cleanup
  (purple draft / blue execution dots), sidebar L2 templates banner removal.
- **Catalog redirect plumbing** — `pendingCatalogCategoryFilter` in uiSlice,
  `usePickerFilters` reads pending filter on mount + clears.
- **Template content audit** — 19 templates marked optional connectors, 27
  with vault_category added, 3 with `desktop_browser` removed, 61 with
  connector category normalization via `fix-template-connectors.mjs`.

---

## Pending follow-ups (next session)

### Freelancer Invoice Autopilot — final touches
Already patched in the current session (not yet committed at time of writing):
- Moved `toggl`, `clockify`, `harvest` to new `time-tracking` category in
  `connector-categories.json` (new category added).
- Template's generic `time_tracking` suggested_connector now has
  `category: "time-tracking"`.
- `aq_domain_1` now has `vault_category: "time-tracking"` +
  `option_service_types: ["toggl", "clockify", "harvest", null]`.
- New `aq_output_1` destination question with `vault_category: "storage"` +
  `option_service_types: ["local_drive", "google_drive", "dropbox", "aws_s3", null]`.
- New `aq_output_2` text input for folder path/prefix inside the chosen
  destination.
- Added `local_drive` → `storage` mapping in `connector-categories.json`
  (connector does not exist yet — to be created with the Drive plugin below).

---

## NEW REQUIREMENT: Drive Plugin + Local Drive connector

### Goal
Provide a managed local filesystem that agent templates can use as a
persistent export destination — independent of which version of the app is
installed. Users who don't want to set up cloud storage (Google Drive,
Dropbox, S3) for template outputs should have a first-class local option.

### Scope

**1. New plugin at `src/features/plugins/drive/`**

- Follow the existing plugin pattern (see `src/features/plugins/dev-tools/`,
  `src/features/plugins/artist/`, `src/features/plugins/obsidian-brain/` for
  reference).
- Add `'drive'` to the `PluginTab` type in `src/lib/types/types.ts`.
- Register in the sidebar via `sidebarData.ts` if appropriate, or via the
  plugin browse list.
- Enable/disable through the existing `enabledPlugins` Set in `uiSlice.ts`.

**2. Managed folder location**

- **Production builds**: use the OS-appropriate app data directory. On
  Windows: `%APPDATA%\Personas\drive\`. On macOS: `~/Library/Application
  Support/Personas/drive/`. On Linux: `~/.local/share/Personas/drive/`.
  Tauri's `app_data_dir()` API returns the correct path.
- **Dev builds**: use a `.gitignored` folder at the repo root, e.g.
  `./.dev-drive/`. Distinguish via `cfg!(debug_assertions)` or similar.
- Create the folder on first launch if it does not exist.
- Store the resolved path in a new Tauri command/state for the frontend to
  query.

**3. macOS Finder-style visualizer**

- Two-pane layout: left sidebar with folder tree, right pane with file list.
- File list supports columns view / list view / icon view toggle.
- Icons for folders, common file types (HTML, JSON, PDF, images).
- Double-click opens files (via `shell.open` Tauri API) or navigates into
  folders.
- Breadcrumb navigation in the top bar.
- Right-click context menu: Open, Rename, Delete, Show in OS file manager.
- Drag-and-drop to reorganize files (optional stretch — file operations via
  Tauri `fs` API).
- Search bar that filters the current folder (optional stretch).

**4. New builtin connector `local_drive` in Storage category**

- Create `scripts/connectors/builtin/local-drive.json` following the schema
  of other builtin connectors (see `scripts/connectors/builtin/aws-s3.json`
  as a reference).
- Fields: no credentials needed (it's a local filesystem). Probably just a
  single `path` field defaulting to the managed Drive root, or no fields at
  all if the path is always resolved server-side.
- `category: "storage"`, `auth_type: "local_app"`, `is_builtin: true`.
- Already mapped in `connector-categories.json` (added this session:
  `"local_drive": "storage"`).
- Run `node scripts/generate-connector-seed.mjs` after creating the JSON.

**5. Backend file I/O commands**

- New Tauri commands in `src-tauri/src/commands/` (new module `drive.rs`):
  - `drive_list(path: String) -> Vec<DriveEntry>` — list a folder.
  - `drive_read(path: String) -> Vec<u8>` — read a file (with size limits).
  - `drive_write(path: String, content: Vec<u8>)` — write a file.
  - `drive_mkdir(path: String)` — create a folder.
  - `drive_delete(path: String)` — delete a file/folder.
  - `drive_get_root() -> String` — return the managed root path.
- All paths must be validated to stay inside the managed root (prevent
  traversal via `..`).
- Register the commands in `src-tauri/src/lib.rs` invoke_handler.

**6. Template integration**

- Templates that already use the `local_drive` service_type in their
  `option_service_types` arrays (Freelancer Invoice Autopilot is the first)
  will "just work" once the connector exists in the catalog.
- Build process credential resolution: `local_drive` needs to expose the
  managed root path as an env var the agent can use (e.g. `LOCAL_DRIVE_ROOT`)
  so agents can resolve relative paths from template answers.

**7. UX considerations**

- Show total size / available space in the Drive plugin header.
- Empty-state onboarding: "No files yet. Agents that export to Local Drive
  will save here."
- When a file is written by an agent, show a subtle flash/highlight in the
  file list if the Drive plugin is currently open.

### Why this matters

- **Upgrade resilience**: files survive app version upgrades (stored outside
  the app bundle, in the OS-managed data directory).
- **No cloud setup friction**: users who just want local file outputs don't
  need to create Google Drive OAuth apps or S3 buckets.
- **Vault integration**: Local Drive appears as a normal credential in the
  vault, which means templates automatically pick it up via the
  `vault_category: "storage"` mechanism (Wave 1 Phase 2).
- **Pattern extends**: other templates (research report exporter, design
  brief generator, etc.) will gain a managed local destination option
  automatically once the connector exists.

### Files to create

| File | Purpose |
|------|---------|
| `scripts/connectors/builtin/local-drive.json` | Builtin connector definition |
| `src-tauri/src/commands/drive.rs` | Tauri commands for file I/O |
| `src/features/plugins/drive/DrivePage.tsx` | Main plugin page + Finder layout |
| `src/features/plugins/drive/components/DriveFileTree.tsx` | Left sidebar tree |
| `src/features/plugins/drive/components/DriveFileList.tsx` | Right pane file list |
| `src/features/plugins/drive/components/DriveToolbar.tsx` | Breadcrumb + view mode toggles |
| `src/features/plugins/drive/hooks/useDrive.ts` | Hook wrapping Tauri commands |
| `src/api/drive.ts` | Frontend API layer (invokeWithTimeout wrappers) |

### Files to modify

| File | Change |
|------|--------|
| `src/lib/types/types.ts` | Add `'drive'` to `PluginTab` type |
| `src/features/shared/components/layout/sidebar/sidebarData.ts` | Add drive to plugin list if shown in sidebar |
| `src/features/personas/PersonasPage.tsx` | Route `plugins + drive` to `DrivePage` |
| `src/stores/slices/system/uiSlice.ts` | Add `'drive'` to `enabledPlugins` default Set |
| `src-tauri/src/lib.rs` | Register `drive_*` Tauri commands in invoke_handler |

### Estimated effort

- Backend Tauri commands: 2-3h
- Connector JSON + seed regeneration: 30min
- Plugin UI (Finder layout): 4-6h
- Plugin registration + routing: 30min
- Template integration verification: 1h
- **Total**: ~8-11 hours

---

## Architectural learnings from this work

1. **Two BaseModals, same name** (`@/lib/ui/BaseModal` and
   `sub_generated/shared/BaseModal`). The latter re-exports the former.
   Always pass `portal={true}` when a modal is rendered inside a container
   with `overflow-hidden`.
2. **Module-level caches across unmount/remount** (`useStructuredQuery`'s
   `_cachedInput`) must also re-propagate to parent state on mount, not just
   to the child input's visible value.
3. **`autoTestedRef` patterns** need to reset on state changes that reopen
   the auto-fire condition — not just on identity changes.
4. **`fix-template-connectors.mjs`** only touches `category` and `role`
   on existing entries; it does NOT revert connector additions/removals.
   Past "reverts" of our template JSON work were from a different process
   (likely `git pull` conflict resolution or parallel worktree merges).
5. **Commit at the end of each phase.** Don't leave working-tree changes
   overnight — the lost-code incident earlier in this conversation proved
   this. All waves/rounds are now committed atomically.

---

## Current state (Apr 13, 2026)

- 105 templates with regenerated checksums
- 109 builtin connectors (after adding 3 cloud providers in Wave 1 + linter
  additions since)
- `time-tracking` category added, 3 connectors reassigned from productivity
- `local_drive` mapping added, connector definition pending (Drive plugin)
- 0 TypeScript errors on master
- Plan document at `.claude/plans/declarative-gathering-forest.md` (4-phase
  template improvement plan — Waves 1-2 complete, Rounds 3-4 were fixes on
  top, Drive plugin is the next wave)

## Entry point for next session

Read this file + the plan file, then:
1. Commit the in-progress Freelancer Invoice Autopilot + time-tracking
   category changes (Task #37 below).
2. Start the Drive plugin implementation (new section above).
