# Golden path — Client state persistence

> Situation node: `client-runtime/state-management/client-state-persistence` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a repo-wide ground-truth sweep (~135 tool calls, incl.
> two parallel corpus sweeps), against `master` @ `2a874e692`. Dimensions:
> **function · resilience · performance · security**. `twoSided` — the browser-side
> stores and the backend `app_settings` surface are two answers to one question;
> both halves and the contract between them are below.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

## Trigger

- "Remember this setting / preference across restarts"
- "This resets every time I reopen the app" / "my choice didn't stick"
- "Where should this state live?" / "should this go in the store or the backend?"
- "Persist the draft / the selection / the wizard progress"
- "The backend needs to know what the user picked" (language, model, autonomy toggle)
- "Save the user's API key / token"

If you are about to type `localStorage.`, `sessionStorage.`, `window.localStorage`, `const STORAGE_KEY = '...'`, `persist(` from `zustand/middleware`, `JSON.parse(localStorage.getItem(`, or `setAppSetting(` — you are in this situation.

## The one way

Answer **"who is the authority?"** before you write a line, because this repo has already lost user data three times by answering it wrong. If the value is transient session state, put it in a zustand slice and **do not persist it**. If it is per-surface view state (sort, widths, collapse, filters), it belongs in localStorage — go to [`view-state-persistence`](../situation-spine.md). For everything else — anything a user deliberately chose, anything the backend also reads, anything whose loss would be felt — **the backend `app_settings` table is the authority and localStorage is at most a cache**, because localStorage in this app is per-WebView2-profile and a profile clear wipes it silently and completely. Reach for the **backend-authority pattern** first (`sub_mastermind/lib/layoutStore.ts`): one versioned JSON doc under an allow-listed key, hydrated once at mount into module memory, synchronous reads from that memory, a debounced coalescing write-through, and localStorage only as a degraded fallback when IPC fails. Use the **mirror pattern** (`lib/appearanceMirror.ts`) *only* when the value must be read before React mounts — theme, language, sidebar route — where localStorage stays the render authority precisely because it is synchronous, and the backend row exists to re-hydrate a cleared profile. Register every backend key in `settings_keys.rs` (`ALLOWED_KEYS` + a `_DEFAULT` + `validate_value`) in the same change, and never let the two halves diverge. **Secrets are not state**: an API key, token, or password goes into the encrypted credential vault via `create_credential` — never localStorage, never a plaintext `app_settings` row, never a debounced autosave of a JSON column. And when you do touch localStorage directly, do not write a 33rd private try/catch dialect — copy `layoutStore.ts`'s `safeLocalGet` / `safeLocalSet` / `jsonOr` verbatim until the shared wrapper in Gaps #1 exists.

## Mandated primitives

**Backend half — the durability authority**

- **`src-tauri/db/src/settings_keys.rs`** — the `app_settings` key registry. `ALLOWED_KEYS` (89 exact keys) + `ALLOWED_PREFIXES` (7 prefix families) + `validate_key` (`:843`) + `validate_value` (`:874`) + `audit_category` + `deprecated_replacement`. **Every key needs a doc comment and a paired `<KEY>_DEFAULT` constant** — "what does unset mean" must have exactly one answer.
- **`src-tauri/db/src/repos/core/settings.rs`** — `get` / `set` / `get_batch` / `get_by_prefix` / `delete`. Validation is enforced at the **repo** layer (`set` at `:95-97`), so internal Rust callers cannot bypass it. `audit_setting_change` (`:25`) writes the audit trail with structural secret redaction for the `api_keys` category (`:45-49`).
- **`src-tauri/src/commands/infrastructure/settings.rs`** — `get_app_setting` / `get_app_settings_bulk` / `set_app_setting` / `delete_app_setting`. Auth-checked, 64 KB value ceiling (`:14`, `:129`), and `emit_settings_changed` (`:40`) broadcasting a **key-only** `settings-changed` event — the value is deliberately omitted because settings can hold secrets and the bus reaches every window (`:22-25`).
- **`src-tauri/core/src/crypto.rs`** — `encrypt_for_db` (`:1302`) / `decrypt_from_db` (`:1317`) / `encrypt_field` (`:1350`), AES-256-GCM under an OS-keychain-bound, fail-closed, mlock-pinned master key (`get_master_key` `:497`). `SecureString` (`:220`) for in-memory handling.
- **`src-tauri/src/commands/credentials/crud.rs`** — `create_credential` (`:33`) / `update_credential` (`:135`) / `get_session_public_key` (`:28`). **The correct home for every secret.** Note the read model: there is deliberately no "give me the plaintext" command — decryption happens server-side at point of use (`engine/runner/credentials.rs`).

**Frontend half — the read/write surface**

- **`src/api/system/settings.ts`** — `getAppSetting` / `getAppSettingsBulk` / `setAppSetting` / `deleteAppSetting`, all through `invokeWithTimeout`.
- **`src/hooks/utility/data/useSettings.ts`** — `useSettings(keys)` and `getAppSettingCoalesced(key)`. A **microtask-level coalescer** (`:80-93`) collapses every read requested in one tick into a single `get_app_settings_bulk` invoke, and the hook subscribes to `settings-changed` (`:182-190`) so a write in one panel refreshes every other mounted reader live, without polling. **Use this, never a fan-out of `getAppSetting`.**
- **`src/stores/util/dedupedStorage.ts`** — `createDedupedJSONStorage()`. The `storage:` option for **every** `persist()`. Skips a `setItem` when the serialized payload is unchanged; without it a hot store issues ~1000 identical synchronous writes/sec.
- **`src/lib/throttledStorage.ts`** — `createThrottledLocalStorage(debounceMs = 300)`. Trailing-debounce `Storage` adapter with a `pagehide`/`beforeunload` flush and read-your-writes buffering. **Currently dead — 134 lines, zero call sites, no test** (see Deviations G). It is the missing half of `dedupedStorage` for burst-write stores.

**The two durability patterns — copy one of these two files**

- **`src/features/teams/sub_mastermind/lib/layoutStore.ts`** — the **backend-authority** pattern, and the most complete persistence implementation in the repo. `LAYOUT_KEY = 'mastermind.layout.v1'` (`:39`) with a separate `LAYOUT_DOC_VERSION` field (`:41`) so the key is stable while the doc migrates; `hydrateLayout()` once at mount; synchronous reads from the in-memory doc so no caller signature changed; `WRITE_DEBOUNCE_MS = 500` (`:62`) coalescing write-through; `migrateAuthored` (`:174`) as the in-band v1→v2 migration; `safeLocalGet` / `safeLocalSet` / `jsonOr` (`:137` / `:146` / `:155`) as the degraded fallback when IPC fails (`:101`).
- **`src/lib/appearanceMirror.ts`** — the **mirror** pattern, for values on the first-paint path. localStorage stays the render authority; `scheduleWriteThrough()` (`:172`) debounces at 400 ms (`:162`); `bootstrapAppearanceMirror(hadLocalAppearance)` (`:193`) hydrates from the backend **only** on a fresh/cleared profile and does a one-time migration push otherwise; `coerceAppearancePrefs` (`:92`) treats the backend blob as untrusted and falls back per-field rather than throwing; `suppressWriteThrough` (`:135`) prevents the hydrate from echoing back.
- **`src/features/plugins/obsidian-brain/useSavedVaultConfigs.ts:32-61`** — the **migration** template: read legacy key → merge → write backend → `removeItem` the legacy key, and **keep the legacy key on failure** (`:52`) so the next launch retries.

## Steps

1. **Classify the value.** Transient session state → zustand slice, no `persist`. Per-surface view state → [`view-state-persistence`](../situation-spine.md). A secret → step 9. Everything else → continue.
2. **Ask whether it is needed before first paint.** Yes (theme, language, sidebar route) → mirror pattern. No → backend-authority pattern. This is the whole decision; do not skip it.
3. **Register the key on the backend first.** Add the constant to `settings_keys.rs` with a doc comment saying what unset means, a paired `<KEY>_DEFAULT`, an entry in `ALLOWED_KEYS`, and a `validate_value` arm if the value has a typed contract. A key not in `ALLOWED_KEYS` is **rejected by `repo::set`** — the `AUTONOMOUS_DELIBERATION` toggle shipped unusable for exactly this reason (`settings_keys.rs:793-795`).
4. **Version the document, not the key.** For a JSON value, put a `version` integer *inside* the doc and keep the key stable (`layoutStore.ts:39` + `:41`). Bumping the key orphans every existing row.
5. **Hydrate once, read from memory.** One async read at mount into a module-scoped doc; every subsequent read is synchronous off that doc. Callers keep their existing synchronous signatures.
6. **Write through debounced and coalescing.** 400–800 ms trailing debounce, one in-flight write per key, fire-and-forget with `silentCatch`. Never `await` a preference write in an interaction handler.
7. **Read on the frontend through `useSettings` / `getAppSettingCoalesced`,** never a fan-out of `getAppSetting`. You get the microtask batch and the live `settings-changed` refresh for free.
8. **Treat the backend blob as untrusted on read.** Coerce field by field with a per-field fallback (`coerceAppearancePrefs`); never `JSON.parse` straight into the store. A validator that throws turns a stale row into a broken app.
9. **If it is a secret, stop and leave this path.** Route it to `create_credential` / `update_credential`. Do not put it in `app_settings` (values are plaintext `TEXT` — `schema.rs:595`), do not put it in localStorage, do not let it ride a debounced JSON-column autosave.
10. **If you must touch localStorage directly,** copy `safeLocalGet` / `safeLocalSet` / `jsonOr` from `layoutStore.ts:137-160`. Guard the `getItem` *and* the parse *and* the `setItem` — all three throw in a WebView2 profile with storage disabled or quota exhausted.
11. **Stop.** No new private storage helper, no new module-local `const STORAGE_KEY`, no new key prefix convention, no `JSON.parse` outside a `try`, no write in a keystroke or `mousemove` handler, no `localStorage.length` scan.

## Anti-patterns

- **Putting durable user-authored data in localStorage.** The single most expensive mistake in this repo's history — it has been made and reverted **three times**: the Obsidian saved-vault roster (`settings_keys.rs:201-206` — "*silently dropped the list whenever the webview profile was cleared*"), the Mastermind canvas (five localStorage keys → one DB doc, `7c95138b2`), and every appearance preference (`f85ddde92`). localStorage here is per-WebView2-profile; a profile clear is silent, total, and indistinguishable from a first run.
- **Writing a private try/catch storage wrapper.** **32 hand-rolled read/write pairs across 30 files**, in three incompatible error dialects (`silentCatch`, `logger.warn`, bare `catch { return fallback }`). `triageSession.ts:104` and `triageJournal.ts:105` are the same seven-line `storage()` function copy-pasted verbatim between sibling files.
- **Declaring the key as a module-local `const`.** **89 files** define their own storage-key constant; only 4 are exported and each is consumed by exactly one other file. There is no registry, so `'personas.channel.draft.'` is declared twice (`ConversationComposer.tsx:29` and `useTeamChannel.ts:26`) and `'template-adopt-context-v1'` twice in one directory — a rename in either silently orphans the other's data.
- **Inventing a key prefix.** Eight competing conventions for one product namespace: `personas.` (17), `personas:` (8), `__personas_` (6), `persona-` (4, singular — and it is the three zustand persist keys), `personas-` (3), `dolla:` (3, a dead brand), bare `__` (2), and **~24 keys with no product prefix at all** (`sidebar-collapsed`, `dashboard-help-dismissed`, `dac-lab-baselines`).
- **A slice of a persisted store writing its own localStorage key.** `tourSlice`, `onboardingSlice` and `catalogPrefsSlice` each hand-roll a second key alongside the `persist` middleware already wrapping their store — two writers for one conceptual state. `onboardingSlice.ts:106` states the mechanism plainly: "*mirrors tourSlice's localStorage approach*". The anti-pattern propagates by imitation, which is exactly why prose does not hold this line.
- **`persist()` without `storage: createDedupedJSONStorage()`.** Zustand re-runs `partialize` + `setItem` on **every** `set()`, even when the payload is unchanged.
- **`persist()` without `version` + `migrate`.** Six of the seven persisted stores have neither; `themeStore.ts:361-378` instead hand-rolls two shape migrations inside `onRehydrateStorage`, which runs *after* the state is already in the store.
- **Writing to localStorage on the keystroke path.** `ConversationComposer.tsx:55-61` writes the channel draft in a `useEffect([draft, teamId])` — one synchronous `JSON`-free `setItem` per character typed. The repo already solved this twice (`useDeckControls.tsx:88` `DRAFT_SAVE_DEBOUNCE_MS = 400`; `useN8nSession.ts:178` `LS_SYNC_DELAY` + unmount flush).
- **Scanning the whole origin to prune.** `timingMiddleware.ts:71-86` loops `for (let i = 0; i < localStorage.length; i++)` with a `getItem` + `JSON.parse` per matching key, then a second removal loop — on **every** execution completion.
- **`JSON.parse` on storage content outside a `try`.** A corrupt or truncated value throws and takes the component with it. (Credit where due: production code is clean here — see Evidence.)
- **`getItem` outside the `try` that guards the parse.** `usePersistedContext.ts:52` — a disabled-storage `SecurityError` on the read itself escapes into a `useEffect` body.
- **A secret in a debounced autosave.** `useEditorSave.ts:53,:62` serializes `auth_token` into the `model_profile` JSON on an 800 ms debounce (`:213-221`), so prefixes of a key being typed are persisted and re-encrypted repeatedly.
- **A plaintext secret in `app_settings`.** `ByomApiKeyManager.tsx:165` writes a `type: 'password'` field straight to `app_settings`; `:199` reads it back to the renderer. The values land in a plain `TEXT` column while the AES-256-GCM vault sits unused two directories away.
- **Hand-parsing the zustand persist envelope.** `main.tsx:93`, `:151`, `:163` reach into `{ state: { … } }` by hand. Adding `version`/`migrate` to any of those three stores changes the envelope and these readers fail silently to their defaults.
- **A fan-out of `getAppSetting` on mount.** Each invoke costs ~1–5 ms of serialisation even for cache-hot SQLite; `useSettings` exists to make that one call.

## Evidence

**Adoption:** 7 zustand `persist()` stores; 89 allow-listed `app_settings` keys + 7 prefix families; 3 correct backend-durability implementations; 2 backend mirrors of webview state.

- **`src/features/teams/sub_mastermind/lib/layoutStore.ts` — copy this one.** The only implementation that gets all four dimensions right at once: durable (DB authority), resilient (versioned doc, in-band migration, localStorage fallback on IPC failure, `jsonOr` on every parse), fast (hydrate-once + synchronous memory reads + 500 ms coalescing write-through), and it carries a test (`__tests__/layoutStore.test.ts`).
- `src/lib/appearanceMirror.ts:1-27` — the mirror pattern's own rationale, naming the loss mode and the accepted trade-off (one corrected repaint rather than blocking startup). `:92-128` is the model for coercing an untrusted persisted blob.
- `src/features/plugins/obsidian-brain/useSavedVaultConfigs.ts:42-55` — the migration template, including the retry-on-failure branch most migrations forget.
- `src/hooks/utility/data/useSettings.ts:44-93` — the microtask read coalescer.
- `src-tauri/src/commands/infrastructure/settings.rs:22-29` — the key-only broadcast, with the leak it prevents written down.
- `src-tauri/db/src/repos/core/settings.rs:95-124` — validation at the repo layer so internal callers can't bypass it; `:462-489` is the test proving a bare `ghp_…` token is redacted before it reaches the audit table.
- `src-tauri/db/src/settings_keys.rs:635-651` — `APPEARANCE_PREFERENCES`: the best-documented key in the file, stating which half is authoritative and *why* theme ids are deliberately not validated in Rust.
- `src/lib/utils/crashPersistence.ts:93-124` — the best resilience ladder in the repo: bounded to 20 entries, corrupt-wipe on read (`:66-70`), sanitized before write (`:22-32`), and a quota-degradation chain of `setItem` → halve → `sessionStorage` → log. Copy this ladder for anything that writes under memory pressure.
- `src/features/shared/components/display/ColumnResize.tsx:84,:95` — correct hot-path discipline: writes on `pointerup`, never in `pointermove`.
- `src/stores/i18nStore.ts:85-98` — the minimal correct mirror: lazy-imported IPC (keeps it out of a store loaded before Tauri is ready), fire-and-forget, plus `echoLanguageMirrorOnce()` (`:126`) covering users who set the value before the mirror existed.
- `src/features/vault/sub_credentials/**` — **zero** localStorage references. The one part of the app handling real secrets never touches web storage.

## Deviations found

### P0 — the shared-layer root cause (upstream of ~30 files and all of category B)

| Path | What's wrong |
|---|---|
| `src/stores/util/dedupedStorage.ts` · `src/lib/throttledStorage.ts` | **Both shared storage helpers are zustand-`persist` adapters only.** Neither exposes a direct-call `safeGet` / `safeSet` / `safeRemove`. Every feature that needs plain key/value storage — 30 of them — therefore had to write its own. This is not laziness; the primitive genuinely does not exist. See Gaps #1. |
| `src/stores/util/dedupedStorage.ts:27-35` | The adapter backing **four** stores (`themeStore:360`, `systemStore:57`, `agentStore:40`, `companionStore:1379`) passes `setItem`/`removeItem` through **with no try/catch**. Zustand's `persist` does not catch synchronously here, so a quota error propagates out of `set()`. Its sibling `throttledStorage.ts` guards all six of its operations. |

### A — hand-rolled storage wrappers (32 read/write pairs across 30 files)

Three incompatible error dialects. Representative worst cases:

- `triageSession.ts:104` + `triageJournal.ts:105` — the same 7-line `storage()` function, copy-pasted verbatim between siblings.
- `layoutStore.ts:137,:146,:155` (`safeLocalGet`/`safeLocalSet`/`jsonOr`) — **the best of the 32; promote these three, delete the rest.**
- `tourSlice.ts:1085` `probeTourStorage` — a hand-rolled storage-availability feature-detect cached on `globalThis`, needed by everyone, owned by one slice.
- Also: `crashPersistence`, `updateHistory`, `designDrift`, `scanSweep`, `telemetryPreference`, `activation`, `catalogPrefsSlice`, `onboardingSlice`, `gitlabSlice`, `labSlice`, `channelSlice`, `notificationCenterStore`, `playbookCache`, `useDensity`, `useRecentAgents`, `useSkillData`, `useDrive`, `ProjectOverviewPage`, `PrBridge`, `sendNonceLedger`, `usePipelineNotifications`, `TwinPicker`, `CoachMark`, `SectionCard`, `UnifiedTable`, `ColumnResize`, `studioDraftModel`, `passportHistory`, `memoryActions`, `UnifiedBuildEntry`, `useSavedVaultConfigs`, `setupInstructionHelpers`, `MetricHelpPopover`, `GoalsPage`, `GoalsProgress`, `workspaceStore`, `useResumeContext`, `sinceLeftBriefing`, `createTemplateTypes`.

### B — unguarded storage access (11 production sites)

| Path | What's wrong |
|---|---|
| `hooks/agents/useRecentAgents.ts:25` | `persist()` → unguarded `setItem`; its sibling `load()` at `:16` **is** guarded. Runs on every persona selection. |
| `overview/components/dashboard/widgets/MetricHelpPopover.tsx:63` | `persistDismissed()` unguarded; sibling `getDismissedSet()` at `:54` guarded. Same asymmetry. |
| `lib/icons/autoAssignIcons.ts:64,:83,:112` | Unguarded read **and** two unguarded writes inside an `async` fn → a throw becomes an unhandled rejection. Runs from the `personaSlice` fetch path. |
| `templates/sub_generated/generation/modals/createTemplateTypes.ts:17,:21` | 23-line file, two storage writes, zero guarding. |
| `teams/sub_teamMemory/components/panel/TeamMemoryPanel.tsx:50-56,:82` | Unguarded `getItem` inside a `useState` lazy initializer → **throws during the initial render**, taking the panel with it; `setItem` in `mouseup` also unguarded. |
| `hooks/utility/data/usePersistedContext.ts:52` | `getItem` sits **outside** the `try` that starts at `:55`. The parse is guarded; the read is not. |
| `lib/utils/crashPersistence.ts:68` | The `removeItem` recovery call is inside the `catch`, not itself wrapped — with storage disabled, the recovery path throws out of `readCrashLogs()`. |

*Corrected from discovery:* discovery predicted a class of unguarded `JSON.parse(localStorage.getItem(...))`. **All 53 production storage-derived parses are inside a `try`.** The 16 unguarded ones are all in `*.test.ts`, which is correct. `memoryActions.ts:43` is best-in-repo — it separates read failure from parse failure, keeps a session backup, and toasts once.

### C — hot-path and unbounded writes (13 write sites across 9 files)

| Path | What's wrong |
|---|---|
| `fleet/monitor/channels/ConversationComposer.tsx:55-61` | **The clearest debounce target in the repo.** `useEffect([draft, teamId])` → one synchronous `setItem` (or `removeItem`) per keystroke in the team-channel composer. Two solved precedents already exist in-repo. |
| `lib/execution/middleware/timingMiddleware.ts:50,:58,:71-86` | Write + `_pruneTimingEntries(50)`, which scans **every key in the origin** (`localStorage.length` loop) with a `getItem` + `JSON.parse` each, then a second removal loop — on every `frontend_complete`. |
| `overview/sub_incidents/components/IncidentsInbox.tsx:207,:216,:228,:236,:247,:279` | **Six write sites in one component** — five persisting `useEffect`s (collapse `:207`, group-mode `:216`, filters `:228`, ordering `:236`, unmount cleanup `:247`) plus a `markSeen` callback `:279`, against five separate keys. `filters` is a fresh object per `setFilters`, so that dep never memo-hits. One `defineKey`'d doc would replace all five keys. |
| `shared/components/display/UnifiedTable.tsx:473-481` | `useEffect([tableId, sortKey, sortDir])` → a `setItem` per sort click, on the app-wide table primitive. Undebounced, in shared code. |
| `vault/sub_catalog/.../InteractiveSetupInstructions.tsx:66` | `setItem` per checkbox toggle. |
| `home/sub_cockpit/widgets/BrowserTestReportWidget.tsx:71` | `useRef(window.localStorage.getItem(...) === '1')` — a **render-body read**, evaluated every render though only the first value is kept, and unguarded. |
| `plugins/drive/hooks/useDrive.ts:36-49` | Read-modify-write: two storage ops per view change. |
| `lib/debug/freezeDetector.ts:31` | `JSON.stringify` of a 50-entry ring inside a `requestAnimationFrame` tick. Gated to freeze events, but rAF-driven. |
| `teams/sub_teamMemory/.../TeamMemoryPanel.tsx:82` | Correctly in `mouseup` not `mousemove`, but the effect re-registers listeners on every `resizePanelFrame` identity change. |

### D — key namespace fragmentation

- **89 files** declare a module-local storage-key constant; **0 keys** are imported from a shared registry.
- **8 competing prefix conventions** (see Anti-patterns); ~24 keys carry no product prefix at all.
- **2 duplicate literals across files** — `'personas.channel.draft.'` (`ConversationComposer.tsx:29` / `useTeamChannel.ts:26`) and `'template-adopt-context-v1'` (`useAdoptionCompletionNotifier.ts:10` / `GeneratedReviewsTab.tsx:9`).
- **11 fully inline literals** with no named constant: `main.tsx:36,93,151,163`; `executionSlice.ts:218,224,479,550,672` (`'personas:active-execution'` repeated **5×** in one file); `platform.ts:22,38`; `storeMonitor.ts:138`; `freezeWatchdog.ts:89,92`; `Sidebar.tsx:25,30`; `DesktopFooter.tsx:326,332`.
- `'sidebar-collapsed'` inlined 4× across 2 files.

### E — slices of a persisted store writing their own key (3)

`stores/slices/system/tourSlice.ts:1155,:1182` · `stores/slices/system/onboardingSlice.ts:117,:135` · `stores/slices/vault/catalogPrefsSlice.ts:27,:52`. The first two are slices of `systemStore`, which is **already** `persist`-wrapped with `createDedupedJSONStorage` — these fields belong in its `partialize` (`systemStore.ts:58`). `onboardingSlice.ts:106` names `tourSlice` as its model, so the pattern is spreading by imitation.

### F — `persist()` misconfiguration (3 + 6)

| Path | What's wrong |
|---|---|
| `stores/i18nStore.ts:111-118` | No `storage:` → raw undeduped localStorage on a store that also mirrors to the backend. |
| `features/home/sub_learning/powerMoves/powerMovesStore.ts:24` | No `storage:`. (Has `version: 1` — the **only** store that does.) |
| `features/studio/studioHistory.ts:63` | No `storage:`, no `version`, no `partialize`. |
| All except `powerMovesStore` | **6 of 7 persisted stores have no `version` + `migrate`.** `themeStore.ts:361-378` hand-rolls two shape migrations inside `onRehydrateStorage` instead. |
| `features/plugins/companion/companionStore.ts:1382` | Persists `draftsByConversation` — unsent user chat text with Athena — to localStorage in plaintext. Privacy, not a secret; worth a decision either way. |

### G — dead primitive (1)

`src/lib/throttledStorage.ts` — 134 lines, a `pagehide`/`beforeunload` flush, read-your-writes buffering, **zero call sites, no test, never wired since the commit that added it** (`c3cbe48ab`). Meanwhile the burst-write problem it solves is live in `dedupedStorage`'s four stores. Either compose the two (dedupe *then* throttle) or delete it — a documented primitive nobody uses is worse than none.

### H — security (7)

| Path | What's wrong |
|---|---|
| `settings/sub_byom/components/ByomApiKeyManager.tsx:165,:199` | Writes a `type: 'password'` API key into `app_settings` (**plaintext `TEXT`**, `schema.rs:595`) and reads it back to the renderer. |
| `overview/components/health/ConfigurationPopup.tsx:89` + `popupFieldConfigs.tsx:6,:29` | Same, from the health-check popup. |
| `settings_keys.rs:28,:34,:70` | `OLLAMA_API_KEY`, `LITELLM_MASTER_KEY`, `BROWSER_BRIDGE_PAIRING_TOKEN` are allow-listed `app_settings` keys holding raw secrets. Only the **audit log** redacts them (`settings.rs:45-49`); the row itself is plaintext. The AES-256-GCM vault is the correct home. |
| `agents/sub_editor/libs/useEditorSave.ts:53,:62` + `:213-221` | The provider `auth_token` rides an **800 ms debounced autosave** into the `personas.model_profile` JSON column. *Discovery's claim verified as PARTIALLY TRUE:* the value **is** encrypted at rest — `repos/core/personas.rs:52-81` `encrypt_model_profile` swaps `auth_token` for `auth_token_enc` + `auth_token_iv`. The residual defects are real, though: |
| ↳ | **Plaintext over IPC both ways.** `update_persona` takes the token in the clear and `get_persona` hands the **decrypted** token back to the renderer (`personas.rs:350`, `ProfileMode::Decrypt`). The vault path uses hybrid RSA+AES session encryption for that hop (`crud.rs:41-51`) and has **no** plaintext-read command at all. |
| ↳ | **Partial secrets persisted repeatedly.** At 800 ms, prefixes of a key being typed are written and re-encrypted; `useDebouncedSave.ts:82-92` adds a fire-and-forget unmount flush. |
| ↳ | **No audit trail.** The vault stamps `audit_log::insert_warn` (`crud.rs:87`); this write does not. |

*Corrected from discovery:* **no secret reaches localStorage anywhere in the repo.** All six token-shaped hits are false positives (a send-idempotency nonce, a consent version flag `'3'`, a pseudonymous install id, a public referral code, a textarea placeholder, a modal name). `authStore.ts` has no `persist()` and no localStorage.

### I — hand-parsed persist envelope (3)

`main.tsx:93,:151,:163` reach into `{ state: { … } }` for `persona-ui-agents`, `personas-i18n-storage`, `persona-ui-system`. These reads are **legitimate** — they must be synchronous before React mounts — but they hard-code an envelope shape that adding `version`/`migrate` (deviation F) would change, and they would fail **silently to defaults**, not loudly.

## Gaps in the primitive

1. **No direct-call storage primitive exists — the headline gap.** `dedupedStorage` and `throttledStorage` are both `Storage`-shaped zustand adapters. There is no `safeGet<T>(key, fallback)` / `safeSet(key, value)` / `safeRemove(key)` / `isStorageAvailable()` for the ~70 call sites that are not zustand stores. This one absence produces deviations A (32 wrappers), B (11 unguarded sites), and the three error dialects. **Fix: `src/lib/storage/index.ts` absorbing `layoutStore.ts:137-160` + `tourSlice.ts:1085`'s availability probe + `crashPersistence.ts:108-123`'s quota ladder.**
2. **No key registry.** Nothing declares which keys exist, who owns them, or whether a key is ephemeral / mirrored / backend-owned. Consequence: 89 private constants, 8 prefixes, 2 duplicate literals, and no way for a machine to check any of it. **Fix: `src/lib/storage/keys.ts` — `defineKey('personas.x.v1', { durability: 'ephemeral' | 'mirrored' | 'backend' })`.** This is also the precondition for the gate below.
3. **No shared mirror primitive.** The mirror pattern has now been hand-written **twice** (`appearanceMirror.ts`, `i18nStore.mirrorLanguageToBackend`) and the backend-authority pattern **three** times (`layoutStore`, `useSavedVaultConfigs`, `appearanceMirror`), each re-deriving hydrate-once + suppress-echo + debounce + coerce. A third mirror author will write a third one. **Fix: `createMirroredValue({ localKey, settingKey, coerce, debounceMs })`.**
4. **`app_settings` cannot hold a secret safely.** `value` is plain `TEXT` (`schema.rs:595`) with no per-key encryption hook, so three secret-bearing keys sit in plaintext while `crypto::encrypt_field` exists one crate away. The `is_sensitive` machinery is credential-table-only. **Fix: an `encrypted` flag in the `settings_keys` registry that routes `set`/`get` through `encrypt_for_db`/`decrypt_from_db`.**
5. **`settings-changed` only fires from the command layer.** Documented at `settings.rs:35-39`: internal engine/repo writes have no `AppHandle` and emit nothing, so a frontend panel showing an engine-written value goes stale until remount. Acceptable today because the hot-apply paths propagate in-process, but it is a real hole in the live-refresh contract.
6. **No `set_app_settings_bulk`.** The read path was batched (`get_app_settings_bulk`, 256-key cap); the write path was not. A settings panel saving eight fields still issues eight invokes and eight `settings-changed` broadcasts, each triggering a refetch in every subscribed panel.
7. **Zustand `persist` has no cross-tab/cross-window sync,** and this app can run multiple WebView windows. Two windows with the same persisted store last-write-wins with no `storage` event listener anywhere in `src/`.
8. **No quota telemetry.** `crashPersistence` is the only code that handles `QuotaExceededError`, and it degrades silently. Nothing reports storage pressure, so the first symptom of a full profile would be scattered unexplained write failures.
9. **Debounce intervals are unowned constants** — 300 ms (`throttledStorage`), 400 ms (`appearanceMirror`, `useDeckControls`), 500 ms (`layoutStore`), 800 ms (`useDebouncedSave`). Not wrong, but nothing says which to pick.
10. **Zero enforcement.** 21 custom ESLint rules exist — `enforce-base-modal`, `prefer-numeric`, `prefer-status-badge`, `no-silent-catch` — and **none** covers storage. All 430 references, all 89 private key constants, and all three data-loss migrations shipped under a green `npm run check`.
11. **Near-zero test coverage of the persistence contract.** `dedupedStorage`, `appearanceMirror` and `layoutStore` have tests; the three store-rehydrate tests exist. Nothing tests: quota exhaustion, storage-disabled, a corrupt value, a version-mismatched doc, or the mirror's fresh-profile hydrate against a *populated* backend.

## The missing gate

**Signal.** The identifiers `localStorage` / `sessionStorage` / `window.localStorage` in `src/**/*.{ts,tsx}` — **430 lines, 433 occurrences, 123 files (103 non-test, 20 test)**. Precision is near-perfect: outside a dedicated storage layer there is no legitimate reason to touch the Web Storage API. The secondary signal is a **string literal in a storage-key argument position**, which is what makes the 89 private constants and 8 prefixes machine-visible.

**Mechanism — three parts, because one won't hold this.**

1. **`custom/no-raw-web-storage`** (new ESLint rule). Flags any member access on `localStorage`/`sessionStorage`, and any string-literal argument to `getItem`/`setItem`/`removeItem`. `error` in `src/stores/**` and `src/features/**`, `warn` elsewhere. The auto-fix message names `@/lib/storage` and `defineKey`.
2. **A frozen baseline that only ratchets down.** 123 files is too many to fix in one pass, so `scripts/storage-baseline.json` records the current per-file counts (precedent: `scripts/bundle-baseline.json`). A file not on the list with any violation → fail. A listed file above its count → fail. A listed file **below** its count → **also fail**, with "baseline stale, run `npm run gen:storage-baseline`". Without that third rule the baseline drifts up as fast as it drifts down.
3. **`scripts/check-storage-keys.mjs`** in `npm run check` — the two-sided parity check this leaf actually needs. Every key in `src/lib/storage/keys.ts` tagged `mirrored` or `backend` must have a matching constant in `settings_keys.rs`'s `ALLOWED_KEYS`, and vice versa for every `app_settings` key the frontend writes. This is the only mechanism that can catch a half-shipped mirror — the failure that produced all three data-loss migrations. Precedent: `check-event-registry.mjs`, `check-command-contract.mjs`.

**Allowlist — the legitimate exceptions, named.**

- `src/lib/storage/**` and `src/stores/util/dedupedStorage.ts`, `src/lib/throttledStorage.ts` — the storage layer itself.
- `src/main.tsx:36,93,151,163` — pre-mount synchronous reads. These run before React and before the store module graph loads; they genuinely cannot call an async or store-dependent primitive. **Annotated in the allowlist with that reason**, not silently skipped.
- `src/lib/utils/crashPersistence.ts` — the crash path must not depend on a module that may itself be what crashed.
- `**/*.test.ts`, `**/__tests__/**` — fixtures legitimately poke storage directly.

Everything else — including all 30 hand-rolled wrapper files — is a violation, not an exception.

**How it fails loudly when its own precondition is absent.** *(Evaluator correction, 2026-08-13: this section originally cited `scripts/check-event-registry.mjs` as a live example of a gate that prints `Event registry OK (0 Rust events, ...)` and exits 0 when its Rust regex matches nothing. **That is false and was verified false.** If `rustEvents` is empty, `missingInRust` becomes every TypeScript event and the script `process.exit(1)`s at `:50`. It fails correctly. Real examples of the pattern in this repo are `ci.yml:258` — `cargo test` without `--workspace`, so an entire crate's suite never runs — and `scripts/secret-scan.mjs`, which exits 0 when gitleaks is absent. The requirements below stand on their own merits; only the cited precedent was wrong.)* The storage gate must not inherit that shape:

- **Assert non-zero extraction on both sides before comparing.** Zero keys parsed from `keys.ts`, or zero entries parsed from `ALLOWED_KEYS`, is `exit 1` with "extractor matched nothing — the file moved or its shape changed". Never "OK".
- **A missing or unparseable `storage-baseline.json` is `exit 1`,** not "nothing to compare against".
- **The ESLint rule ships with a fixture test** asserting it fires on `localStorage.getItem('x')` and on `window.localStorage.setItem(K, v)`. If an ESLint major changes the AST shape and the rule stops matching, the fixture fails — rather than the rule quietly passing all 430 sites.
- **`check:storage` runs as its own CI step,** not appended to an `&&` chain where an earlier failure masks whether it ran at all.

**Sequencing.** Parts 1 and 2 are shippable today against the current corpus. Part 3 requires Gap #2 (the key registry) to exist first — which is the right order anyway, since the registry is what turns "430 scattered references" into something a machine can reason about at all.
