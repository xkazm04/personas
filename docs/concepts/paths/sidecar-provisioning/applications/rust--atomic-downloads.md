---
layer: application
subject: sidecar-provisioning
technique: atomic-downloads
stack: rust
---

# Atomic downloads in the companion STT model manager

`src-tauri/src/companion/stt/downloader.rs` is the technique's cleanest
witness in this repo: one file that streams a curated speech-model binary
(up to ~466 MB, `:30`) into the managed directory and implements stage,
guard, throttle, verify, and scoped cleanup in under 300 lines. Its sibling
plumbing (`src-tauri/src/companion/tts/sherpa_engine.rs`, shared by
`kokoro_installer.rs` and `pocket_installer.rs`) applies the same shape to
multi-file archive installs.

## Stage, verify, rename

- **Partial staging:** bytes stream into `ggml-<id>.bin.partial`
  (`stream_to_file`, `:163-166`), never the final name. Consumers check
  presence via `is_model_downloaded` (`:77-79`), which only ever sees the
  published name.
- **Transport success is not completeness — asserted:** the comment at
  `:201-205` is the standard's lesson verbatim from production: "A stream
  that ends early is not an error at the HTTP layer, so without this the
  truncated file is promoted to the final name and `is_model_downloaded`
  reports true forever — every transcription then fails with an opaque
  'whisper exited with …'". The fix compares `downloaded` against the
  advertised `content_length` and fails loudly (`:206-212`) — run *before*
  publication.
- **Atomic publication:** `tokio::fs::rename(&partial_path, final_path)`
  (`:214-216`) is the single instant a consumer can observe the artifact.

Deviation, reported not hidden: there is **no digest rung** — verification
stops at advertised-length equality (and, on the archive side, sentinel-file
checks after extraction, `sherpa_engine.rs:124,:191-198`). The catalog carries
no digests, so a corrupted-but-complete or substituted payload would
publish. The standard keeps the digest rung.

## The in-flight guard

A process-wide `InflightGuard` keyed per model id (`DOWNLOAD_INFLIGHT`,
`:37`; acquired at `:111-113`) makes concurrent requests for one model
produce one transfer. Deviation from the standard's join semantics: the
second caller is *rejected* with "already downloading" (`:112`) rather than
subscribed to the in-flight transfer's progress and completion. The
installer side uses the same primitive for whole-install exclusion
(`kokoro_installer.rs:44`).

## Progress at human rate

Throttling happens at the source with **both** floors the technique names:
a time floor (`PROGRESS_EVENT_INTERVAL`, 250 ms, `:33`) and a byte-delta
floor (1 MiB, `:34`), whichever trips first (`:180-193`). Terminal events —
`Completed` / `Failed` with the error string — are emitted unthrottled and
unconditionally (`:135`, `:139`). Progress carries identity
(`DownloadProgress.model_id`, `:50-56`), so two models downloading
concurrently render as two bars.

## The reaper, scoped by name

`cleanup_partial` (`:222-231`) removes exactly one artifact's partial on
failure, and the comment at `:130-134` records the earned scoping lesson:
"sweeping every `*.partial` in the shared dir destroyed the other
download's in-flight file" — the guard is keyed per model precisely so two
models can stream concurrently, and cleanup must respect the same grain. A
locked, undeletable partial is logged rather than swallowed (`:227-230`),
because it "poisons the next attempt silently". Restart, not resume, is the
stated recovery policy: the partial is removed on failure and the next
attempt begins clean.

## The doors the catalog guards

Every operation validates the model id against the curated catalog before
touching the filesystem: download (`:100-104`) and — the underappreciated
one — deletion (`delete_model`, `:83-95`), where the comment names it
"belt-and-suspenders against path traversal". The pinned source is a
hard-coded base URL (`HF_BASE`, `:25-27`) "so the manager can't be
redirected at another repo". Managed-directory residency honors the
app-wide home override (`PERSONAS_HOME`, `:60-69`), and all of it is
unit-tested including override handling and idempotent deletion
(`:258-282`).
