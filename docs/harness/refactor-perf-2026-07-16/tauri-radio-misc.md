# tauri:radio (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 1 medium / 2 low)
> Context group: Core Libraries & State | Files read: 1 | Missing: 0

## 1. Full state re-serialized and written to disk every 5 seconds during YouTube playback
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: io-churn
- **File**: src-tauri/src/radio/service.rs:234 (persist), driven by src/features/plugins/radio/components/RadioFooter.tsx:493 and src-tauri/src/commands/radio.rs:162
- **Scenario**: While a `youtubeTracks` station plays, the renderer calls `radio_report_status` with a position every 5s (`POSITION_REPORT_EVERY_N_TICKS * PROGRESS_POLL_MS`). Each call pretty-serializes the whole `RadioState`, calls `create_dir_all` on the config dir, and rewrites `radio_state.json` — indefinitely, for the entire listening session.
- **Root cause**: `persist()` is invoked unconditionally by every command handler, including the periodic position heartbeat; there is no dirty-check or throttle, and `create_dir_all` is re-run on every persist even though the directory exists after the first write.
- **Impact**: A steady disk write every 5s on a hot background path — needless SSD wear and syscall churn for a value (`position_sec`) that only matters for resume-after-restart. Also holds the service mutex across the fs write, so a slow disk briefly blocks other radio commands.
- **Fix sketch**: In `radio_report_status`, skip `persist()` when only the position changed and instead persist positions on a coarser cadence (e.g. every N reports or ≥30s since last write, tracked via an `Instant` in the service), while still persisting immediately on status transitions. Hoist `create_dir_all` to `RadioService::new`. Optionally serialize with `to_vec` instead of `to_vec_pretty` and/or persist outside the mutex from a snapshot.

## 2. Duplicated `StationCursor` initialization in `set_station` and `advance_track`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/radio/service.rs:115-123 and 180-188
- **Scenario**: Both `set_station` and `advance_track` contain an identical 9-line `entry(...).or_insert_with(|| StationCursor { current_track_index: 0, position_sec: 0, shuffle_order: generate_shuffle(track_count) })` block.
- **Root cause**: Cursor bootstrap logic was inlined at both call sites instead of being factored into one helper.
- **Impact**: A future change to cursor defaults (e.g. resuming at a persisted index, adding a field) must be made in two places; drift here would produce subtle shuffle/resume inconsistencies.
- **Fix sketch**: Extract `fn ensure_cursor(&mut self, station_id: &str, track_count: u32) -> &mut StationCursor` that owns the `entry().or_insert_with()` and returns the cursor; call it from both sites.

## 3. Misleading "embedded fallback" comments — the stations catalog is always embedded, never loaded from disk
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: doc-drift
- **File**: src-tauri/src/radio/service.rs:30-32 (also src-tauri/src/radio/mod.rs:15)
- **Scenario**: The comment on `EMBEDDED_STATIONS_JSON` says it is a "fallback used when the JSON file is missing in dev builds", and `mod.rs` says curated stations are "loaded from src-tauri/data/radio_stations.json" — but `RadioService::new` only ever parses the compile-time `include_str!` blob; there is no runtime file-read path for the catalog at all.
- **Root cause**: The comments describe a load-from-disk-with-fallback design that was either never implemented or removed, leaving the docs claiming behavior the code doesn't have.
- **Impact**: A maintainer editing `data/radio_stations.json` on a deployed machine (or expecting dev hot-swap) would be misled — changes only take effect on rebuild. Small but real confusion cost in a file that is otherwise carefully documented.
- **Fix sketch**: Reword both comments to state the catalog is compiled in via `include_str!` and requires a rebuild to change; drop the "fallback" framing. Alternatively, if runtime override was intended, implement the file-read path — but the comment fix is the low-risk move.
