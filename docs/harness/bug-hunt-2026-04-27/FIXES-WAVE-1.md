# Bug Hunt Fix Wave 1 — Security & Data Loss

> 11 commits, 12 findings closed (2 commits bundle related findings).
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Findings closed | Files |
|---:|---|---|---|
| 1 | `e0a172a6` fix(vault): FieldActionButtons hooks-rule violation + clipboard auto-clear for secrets | credentials-keys #1, #2 | 2 |
| 2 | `605d0c82` fix(settings): wrap BYOM API key IPC calls in try/catch to prevent secret leak | settings #2 | 1 |
| 3 | `d111eea3` fix(signing): block signDocument from signing sensitive credential paths | external-integrations (signing critical) | 1 |
| 4 | `bffa02bf` fix(sharing): auto-clear share-link bearer tokens and bundle bytes from clipboard | deployment-sharing-plugins (clipboard critical) | 1 |
| 5 | `73a22bf0` fix(vault): isMutationQuery detects CTE-wrapped DELETE/UPDATE/INSERT | vault-data-sources-dependencies #8 | 1 |
| 6 | `2b81caa9` fix(editor): debounced save no longer swallows keystrokes typed during in-flight save | agent-editor-configuration #1 | 1 |
| 7 | `18284d4b` fix(editor): A/B compare guards against cross-persona contamination | agent-editor-configuration #2 | 2 |
| 8 | `6c574baf` fix(editor): TwinBindingCard uses serialized design_context mutation queue | agent-editor-configuration #7 | 1 |
| 9 | `3a418967` fix(triggers): updateFrequency merges into existing config instead of replacing | triggers-schedules #14 | 1 |
| 10 | `4920ebcf` fix(templates): adoption seed handles failure with cleanup and retry | persona-templates-catalog #1 | 1 |
| 11 | `013334d7` fix(lab): handleLaunch failure path removes only its own build session | agent-lab-matrix-builder #2 | 1 |

---

## What was fixed (grouped by theme)

### Secret / token leak (5 fixes)

1. **Credentials FieldActionButtons hooks-rule violation** — A hooks-using helper was invoked as `FieldActionButtons({...})` instead of `<FieldActionButtons />`. Hooks therefore registered against the parent `FieldCaptureRow`'s slots; clicking the eye icon on row B could briefly reveal the secret in row A, and changing field count triggered the React "rendered more/less hooks" runtime crash. Lifted `isVisible` state into `FieldCaptureRow` and converted the helper to a real component.
2. **Credentials clipboard auto-clear for secrets** — Decrypted API keys and passwords lingered indefinitely on the OS clipboard after copy. Each secret-field copy now schedules a 30s clear timer that re-reads the clipboard and only wipes if the value still matches what we wrote (won't trample later copies).
3. **BYOM API key IPC error leak** — `setAppSetting`/`deleteAppSetting`/`getAppSetting` had no try/catch. Tauri IPC errors typically include the rejected payload in their message, so a malformed Ollama or LiteLLM key being saved could propagate uncaught to React's error boundary and Sentry. Each handler now catches the error and logs only the settings-key + error name.
4. **Sharing — share-link tokens and bundle bytes leak via OS clipboard** — Both `handleCopyToClipboard` (raw bundle base64) and `handleCreateShareLink` (24h single-use bearer URL) wrote sensitive payloads with no expiry, leaking via Apple Universal Clipboard and Windows Cloud Clipboard history. Same 30s self-wipe pattern as #2.
5. **`signDocument` arbitrary path forgery** — Frontend wrapper accepted any absolute path with no path constraint, letting a prompt-injected persona produce a sidecar JSON attesting that the user signed e.g. `~/.ssh/id_rsa`. Added a defense-in-depth blocklist of credential file patterns (`.ssh`, `.gnupg`, `.aws/credentials`, `*.pem`, `*.p12`, `*.pfx`, `*.key`, `id_rsa/ed25519/ecdsa/dsa`, `wallet.dat`, `.npmrc`, `.netrc`, etc.). Matched paths reject before the IPC layer with `SignDocumentRejectedError`.

### Validation gap at trust boundary (1 fix)

6. **`isMutationQuery` CTE-wrapped DELETE/UPDATE/INSERT bypass** — Single-keyword classification treated `WITH` as read-only, letting `WITH x AS (DELETE FROM ...) SELECT * FROM x` slip past the safe-mode confirmation dialog. Now: when the leading keyword is `WITH`, strip SQL literals (single-quoted, double-quoted identifiers, Postgres dollar-quoted) and scan the body for mutation verbs as whole words. Defaults to mutation if any verb is found.

### Data loss / silent corruption (5 fixes)

7. **"Save & Switch" dropped keystrokes during in-flight save** — `useDebouncedSaveGroup`'s post-await early-return compared `draftRef` against `baselineRef`. Because `setBaseline` is async (a render must commit before `baselineRef` is updated), there was a window where the guard wrongly reported "nothing changed" and returned without persisting keystrokes typed during the in-flight window. The user saw a green checkmark and the new persona; their last edits never reached disk. Now compares against `inFlightSnapshotRef` (captured synchronously) instead of the lagging baseline.
8. **A/B compare cross-persona contamination** — `handleStart` awaited `startArena` and unconditionally adopted the returned `runId` via `setActiveRunId`. If the user switched personas during the await, `runId` got attached to the new persona's UI — rendering persona A's prompts inside persona B's editor and letting B's Cancel button cancel a run B never started. Now: capture `selectedPersona.id` before the await; after, re-read via `useAgentStore.getState()`. If it changed, `cancelArena(runId)` and don't adopt. Applied to both copies of `ModelABCompare.tsx`.
9. **`design_context` whole-document overwrite** — `TwinBindingCard.handleChange` did a read-modify-write on the whole `design_context` blob, racing concurrent in-flight mutations from `DesignTab` files editor / useCases edit / credential link. The existing `applyDesignContextMutation` queue (a serialized write helper used by every other design_context caller) already exists; `TwinBindingCard` now uses it instead of its direct `applyPersonaOp` path.
10. **Triggers `updateFrequency` config-wipe** — Trigger config was rebuilt from scratch each time the user changed a frequency; only `type`/`cron`/`interval_seconds` were re-emitted. `active_window`, `rate_limit`, and any other persisted settings were silently wiped — a "business hours only" trigger could begin firing 24/7 with the user seeing nothing but a green "Updated schedule" toast. Now: fetch the current trigger via `listTriggers(personaId)`, parse its config JSON, spread it as the base, then overlay the new schedule fields (cron XOR interval_seconds — switching to one removes the other).

### Recovery / cleanup (2 fixes)

11. **Templates adoption — orphaned draft on backend failure** — `seedDone.current = true` was set BEFORE the async `createPersona` / `create_adoption_session` calls completed. If the backend failed, the catch only logged — the guard stayed true so the user couldn't retry, and the partially-created persona stayed orphaned. UI was permanently stuck at "Loading template…". Now: a separate `seedInFlight` ref blocks duplicate concurrent attempts; `seedDone` flips true only inside the success branch; on catch, the orphaned `createdPersonaId` is deleted (best-effort), `setPersonaId(null)`, a toast surfaces the error, and `seedDone=false` so the next render retries.
12. **Lab handleLaunch failure wiped wrong session** — Failure-rollback called `setDraftPersonaId(null)`, which calls `resetBuildSession()` unconditionally — that pops whichever session is currently active in the global map. If the user had a different persona's build session active (from another tab or restored via hydration), a failed launch for persona A silently nuked persona B's in-progress draft, cellStates, pendingQuestions, and answers. Now: find the `buildSessions` entry whose `personaId` matches this failed launch's persona and `removeBuildSession(sessionId)` only that one. Other active sessions are untouched.

---

## Verification

| Gate | Before wave | After wave |
|---|---|---|
| TypeScript errors | 0 | 0 |
| Tests passing | 870 / 870 | 870 / 870 |
| Lint errors | 0 (12,799 warnings) | 0 (12,799 warnings) |
| Files modified | — | 13 unique files across 11 commits |

Each commit was atomic, references its source finding(s) in `docs/harness/bug-hunt-2026-04-27/`, and includes a non-trivial body explaining the why so future readers can recover the context without re-running the bug hunt.

---

## What remains

From the original 25 critical findings in `INDEX.md`, this wave closed 12 (the security + data-loss group). Still pending in subsequent waves:

- **Stream / execution lifecycle (4 criticals)** — items 13–16 in INDEX. Same theme (persona-switch staleness + ChatTab watchdog + processEnded prefix bug). One focused session should unlock most of them with one shared mental model.
- **Secondary criticals (9 more)** — items 17–25 in INDEX (Lab `loadRuns` during render, ErrorBoundary `require()` not resolving in Vite ESM, `useStatusPageData` permanent stale snapshot, AutoCred schema-mismatch silent save, etc.).
- **High-severity items (100)** and **medium/low (110)** — see INDEX.md theme breakdown for the suggested remaining 5 fix waves.
