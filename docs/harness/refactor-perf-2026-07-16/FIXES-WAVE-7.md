# Refactor+Perf Fix Wave 7 (C1) — IPC chattiness, frontend callers

> 8 commits, 9 findings closed (all High). Theme C split: C1 (frontend callers, this wave) done; C2 (Rust command/repo shape: brain.rs 200 file reads, export stats, memories dedup scan, quota LIKE scan, drive byte-array payload, design-conversation full-blob ×2, ffmpeg discovery cache, obsidian vault cache) remains open — 9 findings.
> Gates: tsc 0; cargo check --features desktop,ml clean; vitest **2304/2304** (0 regressions); eslint clean per-commit.

## Commits

| Commit | Finding(s) | What |
|---|---|---|
| `115bc30ea` | fleet-monitor #1 + agents-misc #1 | Quick Answer popover mounted usePendingInteractions twice (4 polling loops ×2) → single mount + pure QuickAnswerBodyView. |
| `0f593c0ce` | plugins-dev-tools-2-3 #4 | MonMatrix re-mounted useMonitoringPinpoints (vault + Sentry chain ×2 per tab open) → monCreds prop from the parent instance. |
| `3a11c081f` | agents-use-cases-1-2 #4 | ~2N listener-count IPCs per keystroke in the rename modal → 300ms debounce + per-row staleness discard (counts feed a destructive warning). |
| `c4fdb2e02` | schedules-misc #1 | 1+N cron_fire_times_in_range IPCs per keystroke; raw array dep defeated the sig guard → debounce + entries via ref, keyed on sig. |
| `61254d563` | plugins-drive #2 | 3-fetch refresh cascade per moved item across 5 bulk callers → moveMany via runBulk(8) + one refresh; also added the missing ancestor-guard to the list-view drop. |
| `931a27d62` | plugins-companion-3-4 #1 | Full assignment-detail fetch per step event → per-assignment 300ms debounce + non-Athena verdict Set. |
| `b9fdc3b45` | overview-components #2 | Health panel fetched 6 sections but rendered 3 → all six render (also un-hides the Ollama/LiteLLM configure buttons and fixes invisible-warning hasIssues). |
| `1031c3c9e` | plugins-companion-1-4 #1 | Brain Viewer type picker fetched full lists of 13 kinds for counts → new `companion_count_brain_items` (reuses the list dispatch via extracted `list_brain_items_impl`, ships only lengths, one IPC). |

## Patterns established (catalogue items 22–24)

22. **One data-hook mount per surface** — a header that needs one derived number must not re-mount the whole polling data layer; pass the instance (or the number) down.
23. **Keystroke-keyed effects that do I/O need a debounce AND per-item staleness discard** — debounce alone still lets late responses overwrite fresher text's results.
24. **Counts are not lists** — when a UI needs only N, add a count endpoint that reuses the list dispatch server-side; never ship rows to .length() them.

## Cumulative status (waves 1–7)

55 findings closed (1 Critical + 54 High) in 53 fix commits + 7 summaries across 7 waves. Remaining C+H: C2 Rust chattiness (9), F render churn (26), H dead code (23), I duplication (19) + migration-stamp follow-up.
