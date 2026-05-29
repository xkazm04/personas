# Fleet-CICD package — status & handoff

**Run:** 2026-05-29, autonomous (~1h, user away). Target repo: **`xkazm04/xprize-ai-bookkeeper`** (the certified SDLC team).
**Decisions locked:** interleave Areas 1+2 · app-native release command · target an xprice repo · spec both 3a+3b.

This is the live status + the precise pickup plan for the parts that need a running app.

---

## ✅ Landed & committed (green: `cargo check` + `tsc` + hooks)

| Phase | What | Commit |
|---|---|---|
| 1 | **App-native GitHub release capability.** `github.rs`: `get_latest_release`, `compare_commits`, `create_release`, `bump_patch` (semver, +5 unit tests), and the `create_patch_release` orchestrator (no-op when the default branch hasn't advanced since the last release; `dry_run` supported). Tauri command `github_create_patch_release` + registered + command-name regen. | github.rs / github_platform.rs / lib.rs |
| — | **Fleet-analysis engine** (`scripts/test/fleet-analyze.mjs`) — the Phase-2 watcher *and* the data source the Athena skill will call. Read-only per-team: exec health, outcomes, cost, Director verdicts, goal progress, roster-validity, on-track flags. | fleet-analyze.mjs |
| 6 | **Team-engagement spec** (3a soft-motivation + 3b Product Critic), `docs/plans/team-engagement.md`. Ready for your review — leads with 3a (low-cost, recommended first). | team-engagement.md |

> The Phase-1 binding export (`GitHubRelease`, `PatchReleaseOutcome` → `src/lib/bindings/`) is committed once the `cargo test export_bindings` run completes green — see the run log; the Rust source is final.

---

## ▶ Live steps to run when you're back (need the running app)

Start the app once so the IPC + DB are live: `npm run tauri:dev:lite` (or `:test` for the bridge).

### A. Phase 1 — verify the release command (safe dry-run first)
From the app (DevTools console / test bridge), with the GitHub credential id that has the `repo` scope:
```js
// Dry run — reports what it WOULD do, creates nothing:
await invokeWithTimeout('github_create_patch_release', {
  credentialId: '<github-cred-id>', owner: 'xkazm04', repo: 'xprize-ai-bookkeeper',
  baseBranch: 'main',   // confirm the repo's default branch (main vs master)
  dryRun: true,
});
// → { created:false, previousTag, newTag, commitsSince, dryRun:true, reason }
```
Flip `dryRun:false` to actually cut the patch release once the dry-run looks right.

### B. Phase 0/2 — create the CICD goal + wire the trigger
```js
// 1. Find the ai-bookkeeper dev_project id, then create the goal:
const goal = await invokeWithTimeout('dev_tools_create_goal', {
  projectId: '<ai-bookkeeper-dev_project-id>',
  title: 'Automate CICD: merge → patch release on GitHub',
  description: 'On merge to the default branch, cut a patch release via github_create_patch_release.',
});
// 2. Add checklist items (dev_tools_create_goal_item) for: dry-run verified, trigger wired, first real release.
// 3. Link the team's assignment to the goal: set via the team-assignment flow (goal_id), so fleet-analyze tracks it.
```
**Trigger mechanism (no inbound webhook in a local-first app):** schedule a poll — a `PersonaTrigger` / scheduled run that calls `github_create_patch_release` on a cadence; the command itself is the guard (no-op unless the branch advanced). Simplest v1: a scheduled task or a persona use-case invoking the command every N hours.

### C. Watch it (the Phase-2 watcher, already shipped)
```bash
node scripts/test/fleet-analyze.mjs --team "ai-bookkeeper"          # health + on-track
node scripts/test/fleet-analyze.mjs --goal <goalId> --json fleet.json
```
Exit 1 = needs attention. This is exactly the "on track? only valid personas? reaching the goal?" check.

---

## ⏭ Deferred (precise pickup) — Athena `analyze_fleet` skill (Areas 2/Phase 3-5)

I deliberately did **not** push the Athena-action + proactive-turn integration unattended — it's the most intricate subsystem and a broken push would hurt. The engine (`fleet-analyze.mjs`) is done; what remains is wiring Athena to it. Exact plan:

1. **Action vocabulary** — add `"analyze_fleet"` to `ALLOWED_ACTIONS` in `src-tauri/src/companion/dispatcher.rs` (~line 138) + parse/validate (params: `{ team_id?, days? }`).
2. **Executor** — `execute_analyze_fleet(state, params)` in `src-tauri/src/commands/companion/approvals.rs` (model it on `execute_update_dev_goal`, line 832). It should gather the same data `fleet-analyze.mjs` computes (or shell out to it / port the queries into a Rust repo fn `fleet::analyze(team_id, days)`), then **spawn a `TurnOrigin::Proactive` turn** (see `companion/proactive/execution_review.rs:305` for the pattern) with the cert rubric as the directive, so Athena *reasons* over it rather than dumping data.
3. **Constitution** — teach the `analyze_fleet` OP grammar in `src-tauri/src/companion/templates/constitution.md` (~line 216-270, alongside the other action vocab).
4. **Graph-memory continuity (Phase 4)** — in the executor's turn directive, instruct Athena to `write_fact`/reflection a per-team timeline note; recall surfaces it next run. **Seed** her brain with the cert lessons: write the `docs/tests/autonomy-eval/runs/FINDINGS.md` distilled lessons as semantic facts (retry-chain, scope discipline, event-subscription wiring, memory-bloat→cost, model/effort discipline, portfolio balance) so she "remembers what we did".
5. **Side-panel button (Phase 5 UI)** — a "Analyze fleet" entry in `src/features/plugins/companion/**` that sends a message / emits the `analyze_fleet` op; optional cadence/threshold auto-fire.
6. **Live test (Phase 5)** — add `docs/tests/athena/fixtures/analyze-fleet.json` + scenario (mirror `scan-vs-build.json`); drive via `:17320` two-pass harness; judge against the quality rubric; point the first run at the CICD goal's team.

---

## Notes / safety
- No `git stash`/`reset --hard`/`clean` used. Untouched: in-flight **Leonardo** tooling (untracked) + 23 untracked run-dirs at `docs/test/runs/`.
- All commits additive + green; master stays 1:1-pushable.
- Re-verify live team/project state before B/C — the xprice-7-teams memory is from 2026-05-26 (pre-merge).
