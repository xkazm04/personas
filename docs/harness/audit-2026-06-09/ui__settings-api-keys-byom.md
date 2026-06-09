# UI Perfectionist — settings-api-keys-byom
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. BYOM secret fields reinvent the masked-input primitive — no copy, weak masking, missing a11y
- **Severity**: critical
- **Category**: visual-consistency
- **File**: src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:82-87, 315-375
- **Scenario**: On BYOM → Keys the Ollama / LiteLLM master-key fields render as a click-to-edit pill with a hand-rolled `maskValue()` star-mask and an Eye/EyeOff toggle. Right next door (Portability → Credential Vault, Export/Import passphrases) the *same kind of secret* uses the shared `PasswordToggleField`, which masks via real `type="password"`, auto-reverts after 8s, and exposes `aria-label`/`aria-pressed`. Two different secret experiences inside one settings surface.
- **Root cause**: `ByomApiKeyManager` predates / ignores `src/features/shared/components/forms/PasswordToggleField.tsx`. Its editor uses `type={isUrl ? 'url' : 'text'}` (line 318) — secrets are typed in a plain text input, so the OS/screen-reader never treats them as passwords; the masked *display* is a separate read-only `<span>` with `maskValue()`, and the reveal `<button>` (line 363-372) has only a `title`, no `aria-label`/`aria-pressed`. There is also no copy-to-clipboard affordance, even though every other secret/identifier in scope (CreatedKeyDialog token, McpServerInfoPanel URL) offers copy.
- **Impact**: inconsistent · inaccessible — secrets entered as plain text, reveal toggle invisible to AT, and the user cannot copy a stored key back out.
- **Fix sketch**: Replace the bespoke display/editor with `PasswordToggleField` (it already covers reveal, auto-mask, aria, `pr-10`). Add a Copy button next to it mirroring `McpServerInfoPanel`'s copy treatment (Copy → Check swap). Drop `maskValue()` and the manual Eye button entirely.

## 2. Three different save/saved models across one settings hub
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/settings/sub_engine/components/EngineSettings.tsx:96-108; src/features/settings/sub_byom/components/ByomSettings.tsx:57-88; src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:280, 384-415
- **Scenario**: Engine matrix toggles persist the moment you click a cell with **zero** confirmation. BYOM *policy* uses a header dirty-badge + explicit Save/Reset buttons. BYOM *keys* auto-save per row and show a neutral "stored" badge. API Keys auto-saves with no confirmation. The user cannot form one mental model of "did my change stick?".
- **Root cause**: Each sub-area invented its own persistence-feedback convention; there's no shared "setting saved" affordance (toast or inline pulse) wired into the hub.
- **Impact**: confusion · error-blind — silent Engine writes are the worst case: a toggled capability gives no success signal, so a failed write is indistinguishable from a successful one.
- **Fix sketch**: Pick one convention for auto-save areas (Engine, API Keys, BYOM keys): a transient inline "Saved" pulse near the changed control or a single shared toast on success/failure. Keep the explicit Save/Reset model only where edits are batched (BYOM policy). Reuse the existing `stored`/`error` badge vocabulary from `ConnectionBadge`.

## 3. EngineSettings has no error state; BYOM key load silently swallows failures
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/settings/sub_engine/components/EngineSettings.tsx:21-37; src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:109-131
- **Scenario**: If provider capability detection fails, `EngineSettings` only ever gates on `loaded` — it will sit on the "Detecting providers…" body or render an empty matrix, never an error. In `ByomApiKeyManager`, the bulk load `.catch(() => ({}))` swallows any IPC failure into an empty map, so a backend error renders as "no keys configured" with no retry — the opposite of `ApiKeysSettings.tsx:155-168`, which shows a proper red banner with a Retry button.
- **Root cause**: Both lean on a binary loaded/loading flag and lack an `error` branch; the BYOM catch discards the error rather than surfacing it.
- **Impact**: error-blind — failures masquerade as empty/normal states, and the in-scope sibling (`ApiKeysSettings`) already proves the correct pattern exists in this codebase.
- **Fix sketch**: Add an `error` state to both. Reuse the `ApiKeysSettings` error-banner markup (AlertTriangle + message + RefreshCw Retry) so all three API-surface areas fail the same way. For BYOM keys, capture the error in state instead of `() => ({})`.

## 4. API key rows expose a key prefix with no copy affordance
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:277-294
- **Scenario**: Each existing key shows `{key_prefix}…` as bare `<code>` with no way to copy it. Yet the same page's `CreatedKeyDialog` and `McpServerInfoPanel` both give every identifier a polished Copy→Check control. The prefix is the only handle a user has to match a row against a client config, and it can't be copied.
- **Root cause**: The row was built as display-only; the copy affordance established elsewhere on the page wasn't carried into the list rows.
- **Impact**: unpolished · inconsistency — copy is a first-class affordance everywhere else on this exact page but absent on the rows users interact with most.
- **Fix sketch**: Add a small copy-prefix button to `ApiKeyRow` using the shared copy pattern (`copyText` + Copy/Check swap from `McpServerInfoPanel`). Keep it ghost-weight so it doesn't compete with Revoke/Delete.

## 5. Repeated setting-card and export-button markup begs extraction
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/settings/sub_byom/components/ByomProviderList.tsx:213,250,277; src/features/settings/sub_engine/components/EngineSettings.tsx:51,113,138; src/features/settings/sub_portability/components/ExportSection.tsx:57-117; src/features/settings/sub_portability/components/CredentialPortability.tsx:84-152
- **Scenario**: The card shell `rounded-modal border border-primary/10 bg-card-bg p-4|p-6 space-y-3|4` is hand-typed ~12+ times across BYOM, Engine and Portability — and the values already drift (p-4 vs p-6, space-y-3 vs space-y-4), so sections don't sit on a consistent rhythm. Separately, the "button that morphs between idle / loading-spinner / success-check with a passphrase reveal" is duplicated nearly verbatim three times between `ExportSection` (export + import) and `CredentialPortability` (export + import).
- **Root cause**: No `SettingsCard` wrapper and no shared `ImportExportButton`/`PassphraseAction` component; each section re-implements the structure inline.
- **Impact**: inconsistency · unpolished — divergent padding/spacing makes the sub-areas not feel like one surface, and four copies of the status-morph button is where future drift will land.
- **Fix sketch**: Extract a `SettingsCard` (fixed padding + spacing) used by every section, and a `StatusActionButton` encapsulating the idle/loading/success icon+label swap. Collapse the four export/import button instances onto it.

## 6. Destructive actions carry inconsistent visual weight across the surface
- **Severity**: high
- **Category**: visual-hierarchy
- **File**: src/features/settings/sub_portability/components/CredentialPortability.tsx:173-192; src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:309-339; src/features/settings/sub_engine/components/EngineSettings.tsx:55-62; src/features/settings/sub_byom/components/ByomSettings.tsx:63-68
- **Scenario**: "Replace" in the credential-conflict resolver — which **overwrites** an existing credential — renders as a soft amber pill, visually lighter than the blue "Keep both"; nothing flags it as destructive. Meanwhile deleting an API key (`ApiKeyRow`) requires a deliberate two-click red confirm. So the more dangerous operation (silent overwrite of a secret) is the *less* guarded one. Reset buttons also disagree in weight: Engine's "Reset defaults" is ghost-text, BYOM's "Reset" is a bordered button.
- **Root cause**: No shared severity scale for destructive vs neutral actions; each section colors buttons ad hoc.
- **Impact**: confusion — destructive weight doesn't track actual risk; users can overwrite a stored credential with less friction than deleting a key.
- **Fix sketch**: Give "Replace" the red destructive treatment (matching the API-key delete confirm) and consider a confirm step, since it overwrites a secret. Standardize Reset buttons to one weight (ghost) across Engine and BYOM so resets read identically.
