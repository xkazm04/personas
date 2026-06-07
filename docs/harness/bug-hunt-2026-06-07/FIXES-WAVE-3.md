# Bug Hunter Fix Wave 3 — Trust-boundary input validation

> 6 commits, 6 findings closed (2 Critical, 3 High, 1 Medium) across `mcp-…`, `creative-…`, `companion-athena` reports.
> Baseline preserved: `cargo check --features desktop` 0 errors → 0 errors; new unit tests (3 CTE + 2 WAV) pass.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `0937e4c20` | mcp #1 CTE-wrapped write bypass | Critical | `engine/db_query.rs` |
| 2 | `324041162` | creative #2 vault-listing path traversal | Critical | `commands/obsidian_brain/mod.rs` |
| 3 | `85f3aed0d` | creative #3 `resolve_safe` symlink escape | High | `commands/drive.rs` |
| 4 | `58479b7ae` | creative #5 `artist_read_image_base64` arbitrary read + OOM | High | `commands/artist/mod.rs` |
| 5 | `0c1a76a70` | mcp #5 gateway `::` separator | High | `commands/credentials/mcp_gateways.rs` |
| 6 | `62d41e77c` | companion #6 STT accepts any blob | Medium | `companion/stt/mod.rs` + `commands/companion/stt.rs` |

## What was fixed (grouped)

**Injection / classifier bypass (#1)**
1. **Data-modifying CTEs are now mutations.** `is_mutation`/`is_sqlite_read` keyed off the leading keyword, both listing `WITH` as read-only, so `WITH d AS (DELETE … RETURNING *) SELECT * FROM d` passed the safe-mode guard and SQLite/Neon/PlanetScale executed the embedded write — safe mode fully bypassable, including from AI-generated SQL. Now detects mutation verbs in a `WITH` body at the Rust enforcement boundary, with string-literal stripping and token-exact matching to avoid false positives. 3 regression tests.

**Path traversal / sandboxing (#2, #3, #5)**
2. **Vault listing confined to the vault.** `obsidian_brain_list_vault_files` joined the caller path verbatim (absolute/`..` honoured by `Path::join`) and returned absolute paths — arbitrary directory enumeration. Extracted the read command's guard into one shared `resolve_vault_subpath` helper used by both commands; the lister skips symlinked dirs and returns vault-relative paths.
3. **Drive symlink escape closed.** `resolve_safe`'s not-exists branch canonicalised only the deepest existing ancestor and re-appended the tail textually, so a symlinked tail component redirected writes outside the managed root. Now rejects any path component that traverses a symlink.
4. **Artist image read sandboxed.** `artist_read_image_base64` did `fs::read(any_path)` with no validation or size cap (secret exfiltration + OOM). Now: absolute + no `..`, image-extension allowlist, confined to `~/Personas`, 64 MB cap via `metadata` before reading.

**Composed-key & contract validation (#5, #6)**
5. **Gateway member `::` forbidden.** Gateway tools are routed by splitting on the first `::` in `"{display_name}::{tool}"`; an unvalidated `display_name` containing `::` made tools uncallable or routed calls to the wrong member. Now trimmed and rejected if it contains `::`.
6. **STT enforces the WAV contract.** `companion_stt_transcribe` validated only byte length, so a partial/non-WAV blob reached whisper and silently produced empty/garbage transcripts. Added bounds-checked `validate_wav_format` (RIFF/WAVE, PCM, mono, 16 kHz, 16-bit, non-trivial data). 2 tests.

## Verification

| Check | Result |
|---|---|
| `cargo check --features desktop` errors | 0 (baseline 0) |
| New unit tests | `db_query` CTE 3/3, `stt` WAV 2/2 pass |
| `tsc --noEmit` | 0 (no TS touched) |
| Files modified | 7 |

> Same `--features desktop` / no-vitest caveats as Wave 1. The `drive.rs` symlink walk and `artist` confinement use `std::fs::symlink_metadata` / `canonicalize`, compiled and checked on this host.

## Cumulative status (waves 1 + 3)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Crypto — make the vault fail closed | 5 (2C / 3H) |
| 3 | Trust-boundary input validation | 6 (2C / 3H / 1M) |

**11 of 73 findings closed** (4 Critical, 6 High, 1 Medium). Remaining: 13 Critical, 24 High, 23 Medium across waves 2, 4, 5, 6, 7.

## Patterns established (catalogue items 6–10)

6. **Leading-keyword-only SQL classification** — a safety gate that reads only the first keyword misses data-modifying CTEs (`WITH … DELETE`) and similar. Classify by behaviour (`sqlite3_stmt_readonly` / scan the body), not the first token, and enforce at the backend boundary — the frontend check is only UX. *Grep:* `is_mutation`/`extract_first_keyword`/safe-mode allowlists that include `WITH`.
7. **Sibling-command guard divergence** — two commands act on the same resource but only one validates the caller path (the lister shipped without the reader's checks). Factor the guard into one shared helper every entry point calls. *Grep:* repeated `Path::join(<user input>)` / `vault_base.join` / `root.join(rel)` across commands.
8. **Canonicalize-ancestor-then-append-tail** — resolvers that canonicalise only the existing prefix and textually append the non-existent tail leave tail symlinks unresolved before the containment check. Reject symlink components (`symlink_metadata`) or re-canonicalise per segment. *Grep:* `canonicalize(` followed by `.join(tail)`.
9. **Unbounded/unsandboxed file-read IPC** — `fs::read(<user path>)` with no extension allowlist, no managed-root confinement, and no size cap is an arbitrary-read + OOM primitive. Every file IPC needs all three. *Grep:* `fs::read(` / `read_to_string(` on a command parameter without a preceding size/root check.
10. **Unvalidated separator in a composed key** — building a routing/wire key by string concatenation (`a::b`) without forbidding the separator in its inputs makes parsing ambiguous (uncallable, or misrouted). Enforce the separator invariant at the write boundary or use a structured key. *Grep:* `format!("{}::{}")` / `split_once("::")`.

## What remains

Open themes (per INDEX): Wave 2 P2P/remote-control auth, Wave 4 atomicity/TOCTOU, Wave 5 sync data-loss, Wave 6 panics/integrity, Wave 7 autonomous control/success-theater.
