> Context: stores
> Total: 7
> Critical: 0  High: 0  Medium: 3  Low: 4

## 1. systemStore omits `error`/`isLoading` from its initial state, violating the CoreState contract

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/systemStore.ts:32-34 (vs storeTypes.ts:175-182)
- **Scenario**: `SystemStore = CoreState & …`, and `CoreState` declares `error: string | null` and `isLoading: boolean` as **non-optional**. Every sibling domain store initializes all four core fields (`agentStore.ts:25-28`, `overviewStore.ts:24-27`, `pipelineStore.ts:13-16`, `vaultStore.ts:14-17` all set `error: null, errorKind: null, isLoading: false, sliceErrors: {}`). systemStore's initializer sets only `errorKind: null` and `sliceErrors: {}`. No system slice supplies `error`/`isLoading` (verified by grep — none of the system slices initialize them). So `useSystemStore.getState().error` and `.isLoading` are `undefined`, not `null`/`false`.
- **Root cause**: hand-duplicated core-state boilerplate in each domain store; systemStore's copy drifted and dropped two fields. `partialize` doesn't persist them either, so rehydrate can't fill the gap.
- **Impact**: type-lie — any consumer trusting the `boolean`/`string|null` contract (`if (isLoading)` is only accidentally safe; `error` compared/rendered assuming `string|null`) sees `undefined`. Latent; would surface if a system slice ever reads `get().isLoading` before setting it.
- **Fix sketch**: add `error: null, isLoading: false` to the systemStore initializer — better, extract a shared `createCoreState()` (see finding #6) so this can't drift again.

## 2. toastStore evicts by recency, so a burst of low-priority toasts can drop an unseen critical healing toast

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/toastStore.ts:120-122, 145-149
- **Scenario**: both `addToast` and `addHealingToast` cap state with `[...s.toasts, toast].slice(-MAX_TOASTS)` (MAX_TOASTS=10). `slice(-10)` keeps the 10 **most recent** regardless of `priority`. If a healing `critical` toast (priority 40, meant to be the most important signal a persona is failing) is queued and then ≥10 lower-priority `success`/`info` toasts arrive before the user acts, the critical healing toast is silently evicted from state even though `priority` exists specifically to rank it above everything.
- **Root cause**: `priority` is used only for render ordering (`MAX_VISIBLE_TOASTS`), never for overflow eviction; eviction is purely FIFO-by-age.
- **Impact**: UX / trust — the highest-severity notifications are the ones most likely to be dropped under load, the opposite of intent.
- **Fix sketch**: when over capacity, drop the lowest-`priority` (then oldest) toast rather than blindly `slice(-MAX_TOASTS)`; or exempt `kind:'healing'` critical/high from age-based eviction.

## 3. authStore defines a private `extractError` that duplicates — and is inferior to — `errMsg` in storeTypes

- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/stores/authStore.ts:15-20 (vs storeTypes.ts:66-72)
- **Scenario**: `authStore.extractError` reimplements the exact Tauri-IPC error-message extraction (`Error.message` → `{error}` → `String(err)`) already exported as `errMsg(err, fallback)` from `storeTypes.ts`. The local copy is a strict subset: it does **not** call `isTauriError(err)`, so for a structured `TauriError` it may fall through to the loose `"error" in err` branch and never captures `err.kind`. Verified `errMsg`/`errKind` are the canonical shared helpers used by every slice's `reportError`.
- **Root cause**: authStore predates / bypasses the shared error helpers.
- **Impact**: maintainability + subtle behavior drift — auth error strings can diverge from the rest of the app; the structured `kind` is lost for auth failures.
- **Fix sketch**: `import { errMsg } from './storeTypes'` and replace both `extractError(err)` calls with `errMsg(err, <fallback>)`; delete the local helper.

## 4. Concurrent approve/reject clears a shared `busyId`, prematurely un-gating another in-flight command's buttons

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/stores/remoteCommandStore.ts:23-62
- **Scenario**: `busyId` is a single scalar. `approve(a)` sets `busyId=a`; before it resolves the user (or a re-render) triggers `approve(b)`/`reject(b)`, setting `busyId=b`. When the slower call `a` resolves it runs `set(s => ({ queue: …, busyId: null }))`, clearing the busy marker for `b` while `b` is still awaiting the backend. Command `b`'s approve/reject buttons re-enable mid-flight, allowing a double-submit.
- **Root cause**: one boolean-ish `busyId` models what is really per-command in-flight state across an async gap.
- **Impact**: UX / double-submit of a remote-command decision (backend is presumably idempotent, so bounded).
- **Fix sketch**: track a `Set<string>` of busy ids (or only clear `busyId` when it still equals the id this call owns: `busyId: s.busyId === id ? null : s.busyId`).

## 5. i18nStore's single global `fontReady` flag races across rapid language switches, causing FOUC

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/stores/i18nStore.ts:29-71
- **Scenario**: `fontReady` is one global boolean, but font loads are per-language and async. Switch to `zh` (font not loaded) → `applyLangAttributes` sets `fontReady=false` and starts loading the SC font. Before it finishes, switch to `ja` → sets `fontReady=false`, starts the JP font. When the **zh** `link.onload` fires it sets `fontReady=true` even though the active language is now `ja` and its font isn't ready → text renders in a fallback face (flash of unstyled text). Also, a font that 404s marks its lang permanently in `loadedFonts`, so returning to it never retries.
- **Root cause**: readiness is tracked globally instead of per active language / per URL; onload handlers don't check they still correspond to the current language.
- **Impact**: UX — brief wrong-font flash on fast locale toggling; failed fonts never retried.
- **Fix sketch**: in each `onload`/`onerror`, only set `fontReady=true` if `useI18nStore.getState().language === lang`; drop `lang` from `loadedFonts` on error so a later switch can retry.

## 6. Core-state initializer boilerplate is copy-pasted across all five domain stores

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/agentStore.ts:25-28, overviewStore.ts:24-27, pipelineStore.ts:13-16, vaultStore.ts:14-17, systemStore.ts:33-34
- **Scenario**: the same four-field `CoreState` seed (`error/errorKind/isLoading/sliceErrors`) is hand-written in every domain store. Four copies are identical; the fifth (systemStore) has already drifted and lost two fields (finding #1) — the classic "duplication hides a bug" case.
- **Root cause**: no shared constructor for the `CoreState` portion that `storeTypes.ts` defines.
- **Impact**: maintainability — divergence risk realized in systemStore; any future core field must be added in five places.
- **Fix sketch**: export `const createCoreState = (): CoreState => ({ error: null, errorKind: null, isLoading: false, sliceErrors: {} })` from `storeTypes.ts` and spread `...createCoreState()` in each store.

## 7. `unreadCount` recomputation is duplicated four times in notificationCenterStore

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/stores/notificationCenterStore.ts:114, 125, 151, 159, 171
- **Scenario**: the expression `updated.filter((x) => !x.read).length` (and the equivalent at store init) appears in five spots (`addNotification`, `addProcessNotification`, `markRead`, `dismiss`, plus the initial `initial.filter(...)`). Each mutator must remember to both `saveNotifications(updated)` and recompute `unreadCount` the same way; missing one silently desyncs the badge.
- **Root cause**: `unreadCount` is derived state stored redundantly with no single derivation point.
- **Impact**: maintainability — easy to forget the recompute in a new mutator, desyncing the unread badge.
- **Fix sketch**: extract `const countUnread = (ns: PipelineNotification[]) => ns.filter(n => !n.read).length;` and call it in one place — or fold save+set into a single `commit(updated)` helper that always does both.
