# Ambiguity Audit — Fix Wave 4: Validation / security gates

> 6 commits, 6 critical findings closed (Theme D).
> Baseline preserved (modulo a pre-existing test regression introduced by a merge between waves 3 and 4 — see "Test baseline note" below).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `fde22641` | `triggers-schedules.md` #1 (replay) | critical | `features/triggers/hooks/useTriggerHistory.ts` |
| 2 | `ec3614ee` | `external-integrations.md` #1 (gitlabTier) | critical | `features/gitlab/components/GitLabPanel.tsx` |
| 3 | `7ce7a125` | `external-integrations.md` #3 (signing) | critical | `api/signing/index.ts` |
| 4 | `1e237dea` | `health-validation-network.md` #12 (AUTO_MATCH) | critical | `features/agents/health/useApplyHealthFix.ts` |
| 5 | `11357494` | `deployment-sharing-plugins.md` #2 (dangerConfirmed) | critical | `features/sharing/components/BundlePreviewContent.tsx`, `BundleImportDialog.tsx` |
| 6 | `557eafcf` | `onboarding-home.md` #1 (setup stepper) | critical | `features/home/components/SetupCards.tsx` |

## What was fixed (grouped by sub-pattern)

1. **Replay path bypassed the validation gate `testFire` enforces.** `useTriggerHistory.replay` called `api.executePersona` directly, never running `validateTrigger`. A user could replay a webhook execution whose secret was rotated, a polling trigger whose endpoint went 404, a file-watcher whose path no longer exists — silently spawning doomed executions instead of seeing the inline failure message a normal Test Fire would surface. Worst case, replay re-fired a paused (`enabled=false`) trigger. Routed `replay` through `validateTrigger` first; on failure populate the existing `replayResult` toast shape with the joined failure messages ("Replay blocked — {check}: {message}; ...") so the failure remains visible for the existing 6 s display window.

2. **`gitlabTier` hardcoded to `'free'` silently locked paying users out.** `GitLabDeployModal` was mounted with the literal string `gitlabTier="free"` with no comment, and the user's actual GitLab tier was never fetched anywhere. Premium/Ultimate templates appeared locked to paying users — but the gating was a UX-only hint anyway, since GitLab itself rejects unauthorised template use server-side. Default to `"ultimate"` so the UI doesn't lie to paying users while the tier-detection wiring is missing, with a TODO referencing the two GitLab API endpoints (`/license` or `/namespaces/:id`) that would populate it. Net effect: paying users see all templates, GitLab enforces what's actually allowed, and free-tier users see the GitLab error message instead of a frontend pretend-lock.

3. **Sensitive-path signing guard was claimed "defense in depth" but was actually the only gate.** `SENSITIVE_PATH_PATTERNS` blocked obvious credential files (`.ssh`, `.aws/credentials`, `id_rsa`, etc.) before invoking the Tauri `sign_document` command, with a comment claiming the backend allowlists too. The audit could not verify any backend allowlist exists (Rust out of scope this run), and any future persona tool that calls `invoke("sign_document", …)` directly bypasses the frontend guard entirely. Replaced the comment with a trust statement explicitly marking this as the PRIMARY gate until backend enforcement is verified, and tightened the over-broad `[/\\]private[_-]?key/i` regex (previously matched `Documents/private_key_lecture_notes.md`) to require the path end with `private_key` either bare OR with a key-bearing extension.

4. **`AUTO_MATCH_CREDENTIALS` silently picked one of N credentials by array order.** When the user had two credentials of the same `service_type` (work + personal Google), the executor walked the list and linked the first match — deciding "which identity does this agent act as" by iteration order, no audit trail, no preview. Group the supplied credentials by `service_type`; if any group has more than one credential AND that connector is not already linked, throw a clear error naming the ambiguous service types. The outer try/catch surfaces this as a failure toast; single-credential service types continue to auto-match unchanged.

5. **`dangerConfirmed` shared between two semantically different bundle-import danger paths.** `BundlePreviewContent` rendered two warnings — "trusted peer with bad signature" (tamper) and "unknown signer" (cannot verify) — and bound both checkboxes to the same boolean. The two warnings are mutually exclusive at render time, but `signer_trusted` is server-derived and can flip between preview re-fetches, so consent for warning A could silently re-apply to warning B. Replaced the boolean with a discriminated `DangerConfirmKind = 'tamper' | 'unknown' | null`. Each checkbox sets its own kind; the footer "Import Anyway" button enables only when the consent's kind matches the warning the current preview surfaces. Added a `useEffect` that resets the consent whenever the preview's danger context changes (`bundle_hash`, `signer_trusted`, or `signature_valid`).

6. **Setup stepper had asymmetric save semantics — two of three steps committed instantly, one buffered.** `RoleStep` and `ToolStep` called `setSetupRole` / `setSetupTool` instantly inside `onSelect`, committing to the persisted store the moment the user clicked a card. Only `goalDraft` buffered. A user who opened the stepper to compare options, picked a different role, then dismissed via X / escape silently corrupted their saved profile — no Cancel semantics, no undo. Worse, `SetupCards` self-hides when `setupCompleted === true`, leaving users with a half-edit and no UI surface to fix it. Added `roleDraft` and `toolDraft` state alongside `goalDraft`, initialised from the store, with re-sync `useEffect`s for external store changes; commit all three drafts atomically only on Finish (Step 2). The X / escape / dismiss path now discards the drafts as expected.

## Verification table (before / after)

| Counter | Before Wave 4 | After Wave 4 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (broad set: stores + agents + settings + sharing + home + triggers + gitlab + api) | 409 / 410 ¹ | 409 / 410 ¹ |
| Code paths firing privileged actions without validating | 1 (replay) | 0 |
| Frontend-only enforcement gates with unverified backend pair | 1 (signDocument) | 0 (now explicitly marked primary gate) |
| UI surfaces that lie about tier-locked premium features | 1 (GitLab) | 0 |
| Auto-match paths that silently disambiguate by array order | 1 (AUTO_MATCH_CREDENTIALS) | 0 |
| Shared boolean consents covering distinct danger kinds | 1 (dangerConfirmed) | 0 |
| Persisted-store steps that commit instantly with no Cancel | 2 (RoleStep, ToolStep) | 0 |

> ¹ The single failing test (`useMatrixBuild.test.ts > handleAnswer > calls session.answerQuestion with cellKey and answer`) is **pre-existing** and unrelated to Wave 4. It was introduced by commit `2cd9da86` (`C7 increment 2026-04-28 — auto_triage / dry-run / reference / webhook in build, ...`) which landed via merge `237c17a7` between the Wave 3 summary and the Wave 4 fixes — the change extended the `answerQuestion` call to four arguments (`cellKey, answer, reference, webhookSource`) but the test still expects two. None of Wave 4's commits touch `useMatrixBuild.ts`, the matrix slice's answer handler, or the test file. Verified by checking out commit `737688c0` (Wave 3 summary) and confirming the test passed there with 20/20.

## Cumulative status (waves so far)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 |
| 2 | Silent failure / lying state | 6 critical (+1 already-fixed) | 6 + 1 docs | +114 / -342 |
| 3 | Cross-entity scoping | 4 critical | 4 | +109 / -20 |
| 4 | Validation / security gates | 6 critical | 6 | +154 / -36 |
| 5 | State / cache invalidation | (pending) | — | — |
| 6 | Sanitization & cross-boundary contracts | (pending) | — | — |

## Patterns established (additions to the catalogue, items 13-17)

13. **Symmetric privileged-action paths must validate symmetrically** — when a feature exposes more than one entry point that performs the same privileged action (e.g. `testFire` and `replay` both fire a trigger), every path must run the same validation gate. Skipping validation on a "secondary" path because the primary one validates is a real foot-gun; the user can reach the same effect through both.

14. **Frontend-only enforcement deserves an explicit trust statement** — a defense-in-depth comment that claims backend enforcement without a verifiable reference is worse than a comment that says "this is the only gate, do not bypass". The honest claim guides callers; the optimistic claim invites future direct-IPC calls that bypass the frontend.

15. **Don't pretend to enforce policies the system can't enforce** — when a UI gates a feature on a value the system has no authoritative source for (e.g. tier detection), default to the *permissive* side and let the authoritative system reject. Defaulting to the *restrictive* side hurts paying users and provides false security since the gate isn't load-bearing anyway.

16. **Auto-match policies must refuse on ambiguity** — when a "do the obvious thing" action has multiple equally-valid candidates, refuse and ask. Silently picking by iteration order — credential by `service_type`, persona by name, file by glob order — turns invisible state into a security-trust decision. Pair with a clear error message naming the ambiguous keys.

17. **One consent per warning kind, reset on context change** — a single shared confirmation flag covering multiple distinct danger paths is a carry-over bug waiting to happen. Tag the consent with the kind of warning it acknowledges, and reset it whenever the surrounding context changes (signer trust, hash, validation result). Telemetry/audit logs should always be able to answer "which warning was confirmed".

## What remains

- **Wave 5** (Theme E — state / cache invalidation) — 4 fixes: `cachedPublicKey` forever, `globalExecutionsTotal` synthetic, `successRate` faked from fleet-wide, `registerSave` during render.
- **Wave 6** (Theme F — sanitization & cross-boundary contracts) — 4 fixes: `escapeSqlStringLiteral` broken regex, Redis SCAN injection, `ROLE_PRESETS` no contract, `auth_variants` cast no validation.
