# Dev Experience Fix Waves 4 + 5 — Shared primitives + race-condition consolidation

> 2 atomic refactor commits — one Wave-4 demo (copy-to-clipboard dedup) plus one Wave-5 demo (persona-switch race guard extraction). This is a starter pass on each wave, not a complete close-out: the primitives now exist and have first consumers, but the bulk of the migrations are queued for follow-up sessions.
> Baseline preserved: tsc 0 → 0 errors (in dev-experience-touched files; 3 unrelated errors exist in a concurrent-process test file `credentialGraph.test.ts` that is outside this wave's scope).

## Commits

| # | Commit | Findings touched | Severity | Files |
|---|---|---|---|---:|
| 1 | `9ca6bc30` refactor(execution): use shared useCopyToClipboard in ExecutionMiniPlayer | execution-engine.md "duplicated copy-to-clipboard" + INDEX theme 4 | High | 1 modified, -21 LOC net |
| 2 | (snapshot `bb9d91f7`)† useCopyToClipboard.ts unmount cleanup added | (hook hardening) | — | 1 modified, +13 LOC |
| 3 | `3664e7ac` refactor(personas): extract capturePersonaToken util for persona-switch race guards | agent-editor-config.md #12 + INDEX theme 6 | Low | 1 created (personaToken.ts), 2 migrated (ModelABCompare, useEditorSave) |

† Commit 2 was bundled into a "snapshot concurrent WIP" sweep by the post-commit hook running in this repo. The `useCopyToClipboard.ts` hook change is in git but the explicit dev-experience attribution is in this doc.

## What was fixed

### Wave 4 — Shared primitives extraction (W4.1: copy-to-clipboard)

**Pattern:** the existing `src/hooks/utility/interaction/useCopyToClipboard.ts` hook was already shipped, but **36+ components inline the same `setCopied + setTimeout + writeText` pattern** rather than using it. The grep was 37 hits on `setCopied|copiedState|copied.*setTimeout` after excluding the hook itself.

**This commit:**
1. **Hardened the hook** — added a useEffect unmount cleanup so a fast unmount-after-copy can't fire `setCopied(false)` on an unmounted component. The inline ExecutionMiniPlayer version had this defense; the hook didn't. By bringing the cleanup into the hook, every consumer now inherits it.
2. **Migrated the first consumer** — `ExecutionMiniPlayer.SimpleExecutionView` dropped its 26-line inline implementation (state + ref + cleanup useEffect + clipboard.writeText handler) for `const { copied, copy } = useCopyToClipboard();` plus a one-line `copy(...)` call.

**What's left (queued):** 35 more inline implementations across `features/agents/sub_chat/ChatBubbles.tsx`, `features/vault/sub_credentials/...`, `features/sharing/components/...`, `features/triggers/...`, `features/overview/sub_events/...`, `features/recipes/sub_playground/...`, etc. Each is a near-mechanical drop-in once a developer reads the live consumer's pattern. Roughly 5–7 migrations per future Wave-4 session.

### Wave 5 — Race-condition consolidation (W5.1: persona-switch race guard)

**Pattern:** three files in the editor surface hand-rolled the same async-resolution race guard (snapshot persona id at the start of an async op; abort/cancel the resolution if the persona changed before it landed). Each carried a comment explaining the concrete bug it prevented:

- **`ModelABCompare.tsx:56-67`** — captured `startedFor = selectedPersona.id`, then after `startArena()` resolved, did `useAgentStore.getState().selectedPersona?.id` check; if mismatched, called `cancelArena(runId)` and returned. Bug it prevented: cancel-button-on-the-wrong-persona.
- **`useEditorSave.ts:48-73 (makeUndoEntry)`** — captured `capturedPersonaId` and built a closure `stillForCapturedPersona()` used inside `restore`/`reapply` async callbacks fired much later. Bug it prevented: Ctrl+Z after persona switch writing persona A's old field values into persona B's draft+baseline.
- **`useDesignTabState.ts:73-95`** — used `let cancelled = false; return () => { cancelled = true; };` cleanup-flag pattern with `if (cancelled) return;` after each await. Bug it prevented: multi-minute LLM compile firing for persona A after the user switched to B.

**This commit:**
1. **Extracted `src/lib/personas/personaToken.ts`** with `capturePersonaToken(id): PersonaToken` returning `{ personaId, isStillCurrent() }`. Documented the bug class via JSDoc with a worked example.
2. **Migrated `ModelABCompare.tsx`** — replaced the inline capture + getState check with `const token = capturePersonaToken(selectedPersona.id); ... if (!token.isStillCurrent()) { void cancelArena(runId); return; }`.
3. **Migrated `useEditorSave.makeUndoEntry`** — replaced the inline capturedPersonaId + closure pattern with `const token = capturePersonaToken(selectedPersona?.id ?? null);` plus `token.isStillCurrent()` checks inside restore/reapply.

**What was deliberately NOT migrated:** `useDesignTabState.ts`'s `let cancelled = false` pattern. That's not actually the "isStillCurrent" idiom — it's the canonical useEffect cleanup, and the flag flips on **any** effect re-run (persona change OR phase change OR autoStartDesignInstruction change). Replacing it with `token.isStillCurrent()` would be a regression: it would only catch persona changes, not phase or instruction changes. The audit's framing of "three sites with three subtly different shapes" was right that they're different; wrong that all three should be one hook.

**What's left (queued):** other features may have similar hand-rolled race guards. Worth doing a `grep -rn 'let cancelled\|capturedPersonaId\|isStillCurrent\|stillForCaptured'` sweep in a future Wave-5 session and migrating any closure-based sites discovered.

## Verification table (before / after counters)

| Metric | Before W4+W5 | After W4+W5 | Delta |
|---|---:|---:|---:|
| tsc errors in dev-experience scope | 0 | 0 | — |
| Inline `useCopyToClipboard`-style impls | 37 | 36 | -1 |
| Hand-rolled persona-switch race guards | 3 | 1 (intentionally retained) | -2 |
| Shared race-guard primitive | 0 | 1 (`capturePersonaToken`) | +1 |
| Hook unmount-cleanup robustness | weak | strong | hardened |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Deferred |
|---|---|---:|---:|
| 1 | Dead trees & duplicates | 5 (of 9 in theme) | 4 (W1.2 sub_executions migration, W1.6 home/i18n, W1.7 overview dead trees, plus the 2 stat-tile/replay-viewer sub-theme items folded into W4) |
| 4 | Shared primitives extraction (starter) | 1 (copy-to-clipboard hook hardened + 1st consumer migrated) | 35 inline copy-to-clipboard sites; KpiTile extraction; 3-replay-viewer shortcut hook; mapOverallStatus dedup; usePickerFilters factory |
| 5 | Race-condition consolidation (starter) | 1 (capturePersonaToken extracted + 2 migrations) | sweep for other closure-based race-guard sites in features outside the editor surface |

**Overall scan progress so far:** 6 of 17 critical findings closed. ~30 highs and mediums also touched indirectly (the patterns established by this session apply broadly).

## Patterns established (additions to the catalogue, items 5–7)

5. **Harden the primitive before the first migration, not after.** The existing `useCopyToClipboard` hook was missing an unmount cleanup that the first inline migration source had. Bringing the cleanup INTO the hook before the migration means every later consumer inherits it — the alternative is "primitive plus 36 patches." Always promote any defensive behavior the migration source had into the primitive before using it.

6. **Don't force three different patterns into one shared utility just because the audit named them together.** The audit grouped three persona-switch race guards as "the same pattern with three different shapes," but on read, two were closure-based "isStillCurrent" checks and one was a useEffect cleanup-flag pattern with semantically different cancellation conditions (any-effect-rerun vs persona-change-only). Migrating only the two that match preserves correctness and produces a sharper hook signature.

7. **Concurrent post-commit hook bundling has now happened in 4+ commits this session.** The hook in this repo sweeps unstaged-but-touched files into "snapshot concurrent WIP" commits between dev-experience commits. Strategy: stage and commit each file group as soon as the change is complete; expect occasional bundling and record actual commit hashes (including snapshot ones) in the wave summary for traceability. Don't fight the hook with `--no-verify`.

## What remains across the whole scan

| Wave | Status | Next step |
|---|---|---|
| 1 (dead trees) | 5 closed, 4 deferred | Pick W1.2 (sub_executions) or W1.7 (overview) for a dedicated next session — see `docs/harness/followups-2026-04-28.md` |
| 2 (test infra + first-tests) | not started | Recommended after W1 fully cleared, since deletion changes the surfaces tests would target |
| 3 (type drift + ts-rs codegen) | not started | High value: `escapeSqlStringLiteral` regex bug, OVERDUE_TRIGGERS_FIRED payload, AgentIR template cast, 9× `connector.metadata` parses |
| 4 (shared primitives) | starter pass done | Migrate 35 inline copy-to-clipboard sites; extract KpiTile + 4 replay-viewer hook + mapOverallStatus + usePickerFilters factory |
| 5 (race-condition consolidation) | starter pass done | Sweep for closure-based race guards outside the editor surface; consider extracting a useEffect-cancellation token (different shape from persona token) |
| 6 (mega-monolith decomposition + docs) | not started | matrixBuildSlice 1.3k LOC split + DesignTab prop-drill collapse + READMEs for `features/{execution,plugins,onboarding}` + `connector.metadata` schema doc |

The scan INDEX (`docs/harness/dev-experience-2026-04-27/INDEX.md`) is the canonical reference; it stays valid until a wave actually closes findings (then update its per-context table).
