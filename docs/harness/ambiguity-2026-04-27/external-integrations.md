# Ambiguity Audit — External Integrations

> Total: 12 findings (2 critical, 4 high, 4 medium, 2 low)
> Files read: ~17
> Scope: TS/React shells for GitLab, Drive, Obsidian Brain, OCR, signing, artist, twin, researchLab — frontend-only audit.

## 1. `gitlabTier` is hard-coded to `'free'`, silently locking premium/ultimate templates

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/features/gitlab/components/GitLabPanel.tsx:162
- **Scenario**: `GitLabDeployModal` is mounted with `gitlabTier="free"` as a literal string. The CiCdTemplatesPicker uses this to gate Security Scan (premium) and Deployment Validator (ultimate). Nowhere in the panel, store, or connection flow is the user's actual GitLab tier ever fetched. There's also no comment explaining why this was hardcoded — it looks like a placeholder that ships as production behavior.
- **Root cause**: A TODO that was never landed: tier detection requires hitting the GitLab `/license` or namespace API, but the prop wiring exists as if it were dynamic, hiding that nothing populates it.
- **Impact**: Every paying user (Premium/Ultimate) sees premium templates as locked, looks broken, and probably files a bug. Conversely, if anyone copy-pastes `'premium'` here, no actual gating happens because GitLab itself isn't validated.
- **Fix sketch**:
  - Add a `// TODO: detect tier from GitLab` block + comment near the literal, OR
  - Wire `gitlabTier` to a store field populated on connect (`/api/v4/namespaces/:id`) — even a "best-effort" fetch is better than a lie.
  - Until then, default to `'ultimate'` so users aren't locked out of templates the gating can't actually enforce.

## 2. `usePipelineNotifications` first-render skip hides the very first transition after a hot-reload / tab return

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/gitlab/hooks/usePipelineNotifications.ts:102-147
- **Scenario**: The effect tracks status by `id` in a `useRef` Map. On first render `prev.size === 0` so notifications are intentionally skipped to avoid notifying on initial fetch. But the same condition fires after any remount (tab switch, route change, HMR, error boundary reset), wiping the snapshot — so a pipeline that transitioned to `failed` while the component was unmounted is silently swallowed.
- **Root cause**: "First render" is conflated with "initial load." There's no persistent across-mount snapshot (e.g. localStorage, store-level lastSeen), and the effect treats every fresh mount as a clean slate.
- **Impact**: A pipeline that fails while the user is in another tab and the component re-mounts on return generates no notification at all — the user thinks GitLab is fine. Easy to repro by opening DevTools and remounting the component.
- **Fix sketch**:
  - Move the prev-status snapshot into the Zustand store (`gitlabLastSeenStatuses`) so it survives mount/unmount.
  - Or: gate the "skip first render" on a session-scoped flag, not local ref state.
  - Document explicitly that this hook only catches transitions while the viewer is mounted (current behavior, but undocumented).

## 3. `signDocument` sensitive-path regex is a frontend-only allowlist with no backend equivalent claim

- **Severity**: critical
- **Category**: trade-off-hidden
- **File**: src/api/signing/index.ts:47-77
- **Scenario**: The `SENSITIVE_PATH_PATTERNS` array refuses to sign `.ssh`, `.aws/credentials`, `id_rsa`, `*.pem`, etc. The comment says "not a substitute for backend path allowlisting" — but the audit-scope explicitly excludes Rust, so we cannot verify any backend allowlist exists. Every other persona tool that calls `invoke("sign_document", ...)` directly bypasses this check entirely.
- **Root cause**: Defense-in-depth comment doesn't tell us whether the backend allowlist is implemented, planned, or fictional. There's also no test asserting the patterns match the documented threats, and the regex `[/\\]private[_-]?key/i` is so broad it catches innocuous paths like `Documents/private_key_lecture_notes.md`.
- **Impact**: If the backend has no path allowlist, a future persona-tool author who calls `invoke("sign_document", ...)` directly (skipping `signDocument`) can sign and exfiltrate `.ssh/id_rsa` content as a "signed document." Worse, the hash + signature gives the attacker a portable credential proof.
- **Fix sketch**:
  - Pin a contract test that asserts each pattern blocks the documented threat.
  - Replace the comment with an explicit claim: either "backend `sign_document` enforces the same allowlist at command_X.rs:N" or "TODO: backend enforcement missing — frontend is the only gate, do NOT call invoke directly."
  - Consider moving the regex into a single chokepoint (`@/lib/signing/guard.ts`) and forbidding direct `invoke('sign_document', …)` via lint.

## 4. `obsidianGraphAppendDailyNote` "first occurrence only" rule is silent for multi-section notes

- **Severity**: high
- **Category**: edge-case
- **File**: src/api/obsidianBrain/index.ts:285-310
- **Scenario**: The contract is documented (case c: multiple `## <section>` headings → append under the first), but the `DailyNoteRef` returned has no field signalling "I appended under one of N duplicate sections." A user who has accidentally split a daily note into two `## Notes` headings will see appends going to the wrong (first/older) one with zero feedback.
- **Root cause**: The contract was pinned at the API surface but the return shape doesn't expose ambiguity. Comments document the trade-off but the runtime swallows it.
- **Impact**: Silent data placement: notes appended under stale/closed sections. The user perceives "my notes are missing." Hard to debug because the call returned success.
- **Fix sketch**:
  - Add an optional `duplicateSectionCount?: number` to `DailyNoteRef` populated when the backend detects >1 heading.
  - Surface a one-time toast when this is observed in the UI layer (Brain feature shell).
  - Or: refuse the append when ambiguous and require a `force` flag.

## 5. `obsidianBrainPushSync` empty-array guard is correct, but the fall-through to backend on `undefined` is unbounded

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/api/obsidianBrain/index.ts:99-117
- **Scenario**: The contract carefully separates `[]` (sync nothing) from `undefined` (sync ALL). But "sync all" has no documented upper bound — if the persona DB has 5,000 entries, this single call materializes all of them on the Rust side with no batching, no progress, and (per the Tauri invoke timeout default) a hard cap.
- **Root cause**: The "all" branch is treated as a single atomic call, presumably because the original use case had ≤50 personas. No documented scaling limit.
- **Impact**: First-time users with large vaults will see the call time out and get an unhelpful error. The UI also has no progress indicator because the call is one round-trip.
- **Fix sketch**:
  - Document the soft cap ("`undefined` is intended for vaults < N personas; otherwise paginate") in the JSDoc.
  - Or: extend the contract — `undefined` means "the backend chooses pagination" and emit progress events.

## 6. `ocrDriveFileGemini` model pinned to `gemini-3-flash-preview` with no version-bump signal path

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/api/drive.ts:97-118
- **Scenario**: The JSDoc says the model is "pinned to gemini-3-flash-preview in the backend." When Google sunsets the preview (preview models historically have ~6 month lifecycles), every OCR call will fail with no indication in the frontend that it's a model-availability problem, because the error path bubbles a generic Tauri error.
- **Root cause**: The pin is hidden in Rust; the TS layer can't introspect or surface it. There's no "model unavailable" error type.
- **Impact**: When Google deprecates the preview, every OCR failure looks like a generic backend error. Users (and bug triage) will chase phantom credential / network issues.
- **Fix sketch**:
  - Type the error union: `OcrError = { kind: "model_deprecated", model: string } | { kind: "credential_invalid" } | …`.
  - Surface the pinned model name in the UI (small subtitle "via gemini-3-flash-preview") so users can see what's running.
  - Add a calendar-pinned TODO + a date check to fail loud well before Google does.

## 7. `usePipelineNotifications` requests OS permission unconditionally on first mount

- **Severity**: high
- **Category**: requirements-unclear
- **File**: src/features/gitlab/hooks/usePipelineNotifications.ts:87-100
- **Scenario**: The mount-effect calls `requestPermission()` if not already granted. There's no user-visible explanation, no defer-until-first-actual-need, and no preference-respecting check (the user might have toggled `prefs.enabled = false`). Worse: this fires the moment the user navigates to the GitLab tab, before they've connected, set preferences, or even seen what notifications are about.
- **Root cause**: The hook conflates "user opened the GitLab panel" with "user wants OS notifications." OS-level permission prompts are a one-shot — a denied prompt cannot be re-requested without user navigating to system settings.
- **Impact**: User opens panel exploratively, dismisses an unexplained "X wants to send notifications" prompt, then later enables `prefs.enabled` in the prefs panel — and notifications silently never arrive. Permission is now stuck off.
- **Fix sketch**:
  - Defer `requestPermission()` until the first time `prefs.enabled` flips true OR the first time a real terminal-status transition would fire.
  - Add a deliberate "Enable OS notifications" button in `PipelineNotificationPrefs` that does the request explicitly — current code makes that button impossible to write usefully.
  - Track `permissionGrantedRef` in the store, not a per-mount ref, so prefs UI can show "OS denied — click to re-enable in settings."

## 8. `GitLabConnectionForm` accepts ANY user-typed `instanceUrl` with no validation

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/gitlab/components/GitLabConnectionForm.tsx:96-110
- **Scenario**: The instance-URL `<input type="url">` is sent verbatim to `connectFromVault(credId, instanceUrl)`. There is no client-side check for protocol (`https`), trailing slashes, embedded paths (`/api/v4`), or even non-URL strings. A typo like `gitlab.example.com` (no scheme) silently fails further down the stack with a vague error.
- **Root cause**: The UX assumes users know to paste a clean origin. Nothing in the form copy clarifies this; placeholder/help text comes from i18n strings that may or may not say so.
- **Impact**: First-time users see opaque connection errors. Worse, if the credential is bound to one instance and the user types a different origin, the auth call fails with an authorization error that points at the credential, not the URL mismatch.
- **Fix sketch**:
  - Trim, lowercase, strip path; require `https://` or default it; show inline validation BEFORE submit.
  - When the credential has an associated instance hint, prefill it and warn if the user changes it.

## 9. `researchLab.isCommandNotFound` regex carries a load-bearing comment but no test fixture

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/api/researchLab/researchLab.ts:181-218
- **Scenario**: The detailed comment block describes a real prior bug (substring-`"not found"` match swallowed all real not-found errors) and pins a fix using a regex matching Tauri's canonical error shape. But the regex is a one-shot — if Tauri ever changes the wording (`Command "X" is not registered`), every research-lab list call silently turns into an empty array again, reproducing the original bug with no test to catch it.
- **Root cause**: The contract is captured in prose, not a test. There's no upgrade-time signal that Tauri changed the message format.
- **Impact**: A future Tauri major version bump silently breaks the not-found detection. Same dashboard-shows-zero bug, with the comment claiming it's fixed.
- **Fix sketch**:
  - Add a unit test that imports the regex and asserts a fixture string from the current Tauri version matches.
  - Pin the Tauri version at the top of this file's comment ("verified against tauri@2.x"). Lint or CI breaks when bumped without re-verifying.
  - Consider expanding to also accept `kind: "ipc_command_not_registered"` if the AppError vocabulary grows.

## 10. `ocrDriveFileClaude` has 5-minute timeout but no cancellation surface

- **Severity**: medium
- **Category**: edge-case
- **File**: src/api/drive.ts:120-133, src/api/ocr/index.ts:33-39
- **Scenario**: `ocrDriveFileGemini` (drive) has an `operationId` parameter that pairs with `cancelOcrOperation` to abort in flight. `ocrDriveFileClaude` does NOT take an operation ID and has no cancel. With a 5-minute timeout and no UI cancel, a user who triggers Claude OCR by mistake on a large doc must wait 5 minutes (or kill the app) to recover.
- **Root cause**: Asymmetric API surface. The Claude path was added later and didn't follow the cancel-token convention the Gemini path established.
- **Impact**: Bad UX, plus the slot is held — a second OCR call may queue or contend depending on the backend implementation (which isn't visible from TS).
- **Fix sketch**:
  - Add `operationId` to `ocrDriveFileClaude` mirroring the Gemini path.
  - Or document explicitly in the JSDoc: "no cancellation; waits for CLI to finish or 5-minute hard cap."

## 11. `formatTimestamp` in NotificationCenter and `formatRelativeTime` in others diverge silently

- **Severity**: low
- **Category**: undocumented-decision
- **File**: src/features/gitlab/components/NotificationCenter.tsx:14-23
- **Scenario**: `NotificationCenter` rolls its own `formatTimestamp` (just-now / Nm / Nh / yesterday / Nd) while `PipelineRow` and `DeploymentHistoryTab` use `formatRelativeTime` from `@/lib/utils/formatters` with `dateFallbackDays: 30`. Same notification can appear with two different relative-time formats depending on where it surfaces.
- **Root cause**: Local helper added to avoid an import; nobody ever consolidated.
- **Impact**: Minor UX inconsistency. More importantly: the local version has no `dateFallbackDays` so a 60-day-old notification displays as "60d ago" while the same record in the timeline says "Mar 1, 2026."
- **Fix sketch**: Delete the local function, import the shared formatter, pass appropriate options.

## 12. `cicdTemplates` system prompts contain hard-coded thresholds with no extraction point

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/gitlab/data/cicdTemplates.ts:144, 178
- **Scenario**: The persona-eval prompt says "regressions that exceed the threshold (>5% drop in any category)" and the A/B router prompt says "p < 0.05." These values are baked into prose inside the prompt and not exposed as configurable. A future Persona Eval team change to 3% (or a stricter p-value) requires editing the system prompt string — easy to miss when the user has already cloned the persona.
- **Root cause**: Prompts treated as static copy, but they contain operational policy that may need to change.
- **Impact**: Cloned personas drift from the platform's official threshold over time. No way to query "what threshold is this persona running with."
- **Fix sketch**:
  - Promote thresholds to template metadata (`thresholds: { regressionPct: 5, abTestPValue: 0.05 }`), and inject into prompt at create time with a marker the persona can echo back.
  - Or at minimum, add a comment at top of each prompt block saying "edit threshold here" so future maintainers find it.
