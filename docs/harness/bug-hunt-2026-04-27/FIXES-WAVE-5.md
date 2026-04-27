# Bug Hunt Fix Wave 5 — Silent-Success Theater Theme

> 6 commits, 7 findings closed (the SQL identifier commit closed both finding #6 and the closely-related #7 in the same file).
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Findings closed | Severity | Files |
|---:|---|---|---|---|
| 1 | `9598cfea` fix(editor): TwinBindingCard fetch retries on error + re-fetches on persona switch | agent-editor-configuration #6 | high | 1 |
| 2 | `a9050657` fix(chat): polling fallback no longer falsely claims experiment 'completed' | agent-chat-tool-runner #3 | high | 1 |
| 3 | `eb36630a` fix(vault): CodebaseProjectPicker distinguishes load failure from empty workspace | connector-catalog #4 | high | 1 |
| 4 | `eb82845a` fix(settings): BYOM 'connected' badge renamed to honest 'stored' | settings #3 | high | 1 |
| 5 | `03171a96` fix(vault): SQL identifier handling preserves table names with special chars | vault-data-sources-dependencies #6 + #7 | high + medium | 1 |
| 6 | `2703180c` fix(templates): adoption notifier clears stored context on terminal/dead snapshots | persona-templates-catalog #3 + #4 | high + high | 1 |

---

## What was fixed (grouped by sub-pattern)

The "silent-success theater" theme covers caught errors and fallbacks that lie to the user about success. They corrode trust in an agent platform — the user can't distinguish a working configuration from a broken one without trial-and-error. Six recurring sub-patterns showed up across the 7 fixes:

### Latch-before-await (1)

1. **TwinBindingCard fetch latches "no twins" forever on failure** — `loadedRef.current = true` was flipped synchronously BEFORE the fetch await. Any failure (offline, backend command not registered, network glitch) silently set the latch with empty `twinProfiles`, so the card displayed "No twins configured" forever. Worse, the orphan-detection check was gated on `twinProfiles.length > 0`, so a persona pinned to a deleted twin showed the harmless "No twins" message instead of the orphan banner — silent identity-binding drift. Fix: latch only inside the success branch; on error the next render or persona switch retries.

### Polling fallback claims success it can't prove (1)

2. **useExperimentBridge polling falsely claims "completed"** — When an experiment runId dropped from the active-progress list, the 30s poll unconditionally called `deliverExperimentResult(exp, "completed", ...)`. But "not active" conflates completed/failed/cancelled. The chat then displayed "Experiment Complete: ..." for runs the Lab tab clearly showed as failed. Fix: third phase `finished-unknown` honestly tells the user the run terminated but the realtime status event wasn't received — open the Lab tab to see the outcome.

### Empty list conflated with load failure (1)

3. **CodebaseProjectPicker shows "no projects" forever if `listProjects` throws** — IPC exception only logged to logger and set `loading=false`. The `projects=[]` state rendered the same "go to dev tools" empty-state UI as a genuinely empty workspace. Users clicked through to dev tools, saw their projects existed, came back, hit the same screen — and some duplicated projects they'd been told didn't exist. Fix: separate `loadError` state with a dedicated "Couldn't load projects + Retry" UI.

### Visual lies about backend health (1)

4. **BYOM "connected" badge was success theater** — `handleTest` re-read the key from local storage and showed a green emerald "connected" badge if the value was non-empty. Function name + Verify button label + green check icon all implied network authentication, but no HTTP probe was ever made. Users shipped broken BYOM configurations and got cryptic 401s on first execution. Fix: state renamed `'connected'` → `'stored'`; visual changed from emerald `bg-emerald-500/10` palette to neutral `bg-secondary/40` with a plain checkmark instead of the green-dot connectivity indicator. Honest about what was actually checked.

### Misguided "sanitisation" silently produces wrong query (1)

5. **SQL identifier handling lost table names with special characters** — `getListColumnsQuery` stripped `[^a-zA-Z0-9_]` from `tableName` before interpolating into a STRING-LITERAL match against the system catalog. `'My Table'` became `'MyTable'`, `'users-prod'` became `'usersprod'` — neither matched any real `table_name` in the catalog, so users saw "Loading columns…" → empty list with no error. Combined with the pin-table flow that caches columns, pinning recorded null hints, breaking AI query generation for those tables permanently. Fix (also closes finding #7): three escape helpers (`escapeSqlStringLiteral`, `escapePostgresIdent`, `escapeMysqlIdent`) all strip ASCII control chars then double the quote/backtick per SQL-92. Catalog lookups use the literal escape; identifier interpolation uses the appropriate quoted-identifier escape; default branch in `getSelectAllQuery` defaults to Postgres-style double-quoting.

### Stale state survives across sessions / dead backends (1)

6. **Adoption notifier — stale localStorage adoptId + silent backend-loss** — Two related bugs in the same poller. (a) localStorage entry never cleared, so when user A finished adoption and user B logged in, the stale adoptId triggered "Persona Ready" notifications for personas user B never created. (b) Empty catch on `getTemplateAdoptSnapshot` meant any backend GC'd-snapshot or Tauri-restart-induced session loss was invisible — the polling loop kept running every 5s on a dead session indefinitely. Fix: terminal snapshot states (completed/failed) clear stored context; malformed JSON also clears; consecutive fetch failures counted with a 5-attempt give-up that clears the context and logs telemetry.

---

## Verification

| Gate | Before wave 5 | After wave 5 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 6 unique |
| Cumulative findings closed (waves 1+2+3+4+5) | 32 | **39** |

---

## Cumulative status (waves 1+2+3+4+5)

**39 findings closed in 38 atomic commits across 5 themed waves.**

| Wave | Theme | Findings |
|---|---|---:|
| 1 | Security & data-loss criticals | 12 |
| 2 | Stream lifecycle + persona-switch staleness | 6 |
| 3 | Misc criticals (orchestration, recovery, React 19 hazards) | 7 |
| 4 | Cleanup-gap | 7 |
| 5 | Silent-success theater | 7 |
| | **Total** | **39** |

All 25 critical-rated findings remain closed (waves 1-3). Waves 4-5 added the highest-impact items in the cleanup-gap and silent-success themes — combined with the dedicated fixes from earlier waves these themes are now substantially mitigated, leaving mostly low-severity tail items.

---

## Patterns established (additions to the catalogue, now 16-20)

16. **Latch only inside the success branch** — When using a `loadedRef` (or any "did we initialize?" sentinel) to gate side effects, never set it before the async resolution. Set it inside the `try` after the await succeeds. Failure should leave the ref false so a subsequent render can retry. Bonus: depend on the relevant identifier (e.g. `selectedPersona?.id`) so context changes naturally re-fetch.

17. **"Not in active list" ≠ "succeeded"** — Polling fallbacks that infer terminal state from membership in a "currently active" list cannot distinguish completed/failed/cancelled. Either fetch the actual outcome, or surface an ambiguous "finished — open the source-of-truth UI" message. Never claim success you didn't verify.

18. **Distinguish "empty result" from "load failed"** — `[] === [] === [] === ...` collapses a successful empty-state and a thrown exception into the same UI. Track an `error` state separately; render an explicit error UI with Retry; reserve the empty-state UI for the genuine empty case.

19. **Honest visual treatment for honest claims** — A green checkmark + emerald palette signals "verified API connection". Don't use it for "we re-read a value from local storage". The visual must match the actual semantic of what was confirmed.

20. **Strip-and-interpolate is not sanitisation** — Removing characters from a string before SQL/path/HTML interpolation produces *valid-looking but wrong* output. Use proper context-specific escape (SQL string literal vs identifier; HTML entity vs attribute vs JS context). Strip only what would be a control-character injection; escape the rest.

The catalogue (now 20 items) is the durable artefact. New code reviewers should grep for these shapes before relying on bug-hunt re-scans.

---

## What remains

The bug-hunt's remaining themes after waves 1-5:

- **Race-window producing wrong result** (~18) — many already closed in waves 2-3; remaining items are seq-counter inconsistency in overview slices, time-window split bugs, etc.
- **Optimistic update without rollback** (~22) — recipes-pipelines #5/#8, vault scope picker, others. A focused wave introducing a `withRollback()` helper would close several at once.
- **Time / timezone / DST** (~12) — bounded; one focused session.
- **Empty-set / divide-by-zero / NaN propagation** (~15) — localised to overview/leaderboard.
- **Tail items per context** (~140) — predominantly low-severity.

Recommended next wave: **Time/timezone/DST** because it's bounded, has high blast-radius (cron schedules firing at wrong times), and benefits from introducing a shared tz helper that hardens the codebase against future regressions.
