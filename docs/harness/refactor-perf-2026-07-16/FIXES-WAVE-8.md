# Refactor+Perf Fix Wave 8 (C2) — IPC chattiness, Rust command/repo shape

> 7 commits, 8 findings closed + 1 deferred-with-reason. Theme C now closed (C1+C2 = 17/18 fixed, 1 deferred).
> Gates: cargo check --features desktop,ml clean; tsc 0; vitest 2304/2304 (0 regressions); eslint clean per-commit.

## Commits

| Commit | Finding | What |
|---|---|---|
| `8e0ff5200` | tauri-commands-misc #1 | ffmpeg discovery (WinGet walk + PATH walk + subprocess fallbacks) cached for the process lifetime; `artist_check_ffmpeg` re-scans and refreshes. |
| `9cfb6017e` | tauri-engine-1-10 #1 | quota_cooldown_active: 30s shared memo across the ~10 autonomy loops. NOTE: the datetime(created_at) wrapper is a deliberate prior bug-fix (mixed formats) and is index-backed by Wave 3's expression index — verified before "optimizing" it away. |
| `21eb3d7b3` | tauri-commands-core #1 | Export stats: 4 scalar COUNTs replace 200+ per-persona queries and 500KB scenario-blob hydration. |
| `6694cb22c` | tauri-commands-companion-1-2 #4 | Episode list reads 512-byte file heads instead of 200 full markdown bodies per viewer open. |
| `93ee0b826` | tauri-commands-design-2-2 #1 + tauri-db-repos-4-6 #1 | Conversation list ships `messages='[]'` summaries (resume fetches the one adopted conversation); append echo is metadata-only (frontend applies the append locally, mirroring its offline fallback). |
| `6b4a28c8f` | tauri-commands-obsidian-brain #1 | 30s Arc'd vault-index cache keyed by vault root; the existing file watcher invalidates on any .md change. |
| `c0753096b` | api #1 | drive_read returns tauri::ipc::Response (raw bytes → ArrayBuffer): a 3MB image no longer becomes ~10-12MB of JSON per thumbnail/lightbox read. drive_write raw-body upload = follow-up. |

## Deferred with reason — memories write-path dedup (tauri-db-repos-1-6 #1)

The correct fix is a stored `content_norm` column + Rust-side backfill + index, with every content-writing path updated. That is a schema change on the fragile migration chain (see Wave 3's load-bearing-re-execution discovery) and normalize_for_dedup cannot be expressed in SQL — schedule it together with the migration-chain-reorder session.

## Patterns established (catalogue items 25–27)

25. **Before making a "non-sargable" predicate raw, check whether it was a deliberate format-normalizing bug-fix — and whether an expression index already covers it.** (This wave's quota probe: both were true.)
26. **Frontmatter/metadata extraction must never read whole files** — cap reads at a few hundred bytes (`File::open` + fixed buffer).
27. **When an echo payload is the problem, make the client authoritative** — return metadata (count/timestamp/truncated) and let the client apply the mutation it already knows about locally.

## Cumulative status (waves 1–8)

63 findings closed (1 Critical + 62 High) in 60 fix commits + 8 summaries across 8 waves. Remaining C+H: F render churn (26), H dead code (23), I duplication (19) + 2 deferred (migration stamp, memories content_norm). Mediums/Lows: 926 backlog.
