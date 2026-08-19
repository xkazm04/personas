# Local model install

> Situation node: `product-surfaces/canvas-and-media/local-model-install` · situation
> spine `sides: client` · `twoSided: true` · recurrence 3 · risk **medium** · spine label
> `convergence: mixed`. Dimensions: function · resilience · ui · performance. Spine's own
> framing: *"Downloading an on-device model or sidecar with progress, cancel and
> verification."*
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0, §2,
> §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** Every path by which this app puts a file it fetched onto disk and later
> loads or executes it, read in full: `companion/stt/{downloader,installer,catalog,whisper,mod}.rs`,
> `companion/tts/{sherpa_engine,kokoro_installer,pocket_installer,kokoro,pocket,mod}.rs`,
> `commands/infrastructure/setup.rs`, `db/src/embedder.rs`, `src-tauri/Cargo.toml`'s
> `ml` feature graph, plus the frontend install surfaces
> (`sub_voice/{SttPanel,voiceEngineShared,KokoroVoicePanel,PocketVoicePanel}`).
> **Population established by two independent detectors** (a shared-instrument
> function-body pass and a bespoke file-level co-occurrence pass) whose *disagreement*
> found two channels I had missed by reading. The on-disk result of every install was
> enumerated — `~/.personas/companion-tts`, `~/.personas/companion-stt`, and
> `%APPDATA%\com.personas.desktop\models\onnx` — **names and sizes only**. Convergence
> oracle: all five sibling checkouts swept read-only.
>
> **The `ml` feature only compiles under `desktop-full`, and `cargo` was not available in
> this session.** Nothing here was compiled. The `ml` claims are read off the tree and
> off the artifacts that feature already produced on this machine.

---

## §0 — The headline

**Four channels put downloaded bytes on this machine and later load or execute them.
Not one verifies a digest. The single length check in the tree is written
`if let Some(expected) = total`, so it is skipped in exactly the case it exists for —
and "installed" is defined everywhere as `is_file()`, which is a claim about the
filesystem, not about the file.**

The channels, and what each actually checks:

| channel | staged + renamed | length verified | digest | arch | cancel |
|---|:--:|:--:|:--:|:--:|:--:|
| `companion/stt/downloader.rs` — whisper `ggml-*.bin` | **yes** (`.partial` → `rename`) | **conditionally** | no | n/a | no |
| `companion/tts/sherpa_engine.rs` — sherpa sidecar + Kokoro/Pocket models | no | no | no | **yes** (`cfg(target_arch)`) | no |
| `companion/stt/installer.rs` — whisper.cpp binary (via `sherpa_engine::download_to_file`) | no | no | no | **no — `win-x64` hardcoded** | no |
| `commands/infrastructure/setup.rs` — Node.js `.msi` / `.pkg` | no | no | no | yes (runtime) | **yes** |
| `db/src/embedder.rs` — fastembed / ONNX MiniLM (`ml` feature) | opaque | opaque | opaque | opaque | no |

Three things follow, and each is worse than the row above it.

**One.** `setup.rs::download_file` (`:256-315`) streams a Node.js installer to
`%TEMP%\personas-setup\node-installer.msi` with no length check and no digest, then hands
it to `msiexec /i <path> /qn /norestart` (`:487-495`) — and on macOS to
`sudo installer -pkg <path> -target /` (`:614-621`). `total_size` is read on `:277` and
used **only** to compute a progress percentage (`:301`). A connection that drops at 90%
produces a truncated MSI that is executed. nodejs.org publishes `SHASUMS256.txt` beside
every release; nothing fetches it.

**Two.** `stt/downloader.rs` is the one channel that got the shape right — `.partial`,
atomic `rename`, a per-model inflight guard, and a truncation check whose comment
(`:201-205`) records exactly the bug it prevents: *"the truncated file is promoted to the
final name and `is_model_downloaded` reports true forever."* But the check is
`if let Some(expected) = total { if downloaded != expected { … } }` (`:206-212`). `total`
is `resp.content_length()`, which is `None` for any chunked-transfer response. **The
guard is skipped precisely when the server declines to say how long the body is** — and
the truncated file is then renamed into place and reported installed, which is the
failure the comment above it describes.

**Three, and this is the general form.** Every readiness predicate in the stack is
existence:

- `stt/downloader.rs:78` — `model_path(id).map(|p| p.is_file())`
- `tts/kokoro.rs:135-140` — `p.model.is_file() && p.voices.is_file() && p.tokens.is_file() && p.espeak_data.is_dir()`
- `tts/pocket.rs:104-107` — `MODEL_FILES.iter().all(|f| dir.join(f).is_file())`
- `tts/kokoro.rs:81-95` — `candidate.is_file()`

Not one reads a byte. A 325,630,829-byte `model.onnx` and a zero-byte `model.onnx` are
the same answer. The installers' post-install verification (*"never report success on a
half-extracted tree"*, `kokoro_installer.rs:150-161`) calls these same predicates, so it
verifies that extraction created paths — which is what extraction does.

The repository already contains the correct answer, applied to the one artifact it did
not download. `tts/pocket.rs::import_voice` (`:133-161`) takes a user-supplied voice
recording and checks a size cap, then **reads the bytes and verifies the format claim**
(`&wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE"`), then writes through
`.partial` and renames — with the comment *"so a mid-write crash can't leave a truncated
wav that the sidecar would then feed to the encoder."* That is the whole prescription, in
one function, for a file a human handed over. Nothing that arrives over HTTP gets any of
it.

---

## §2 — The one way

**Treat every declared property of a downloaded artifact — its length, its format, its
architecture, its identity — as a claim by the party that sent it, and check each claim
against something that party does not control. Then make "installed" a statement about
bytes, not about paths.** In order:

1. **Pin the digest beside the URL, in the same constant block.** Not the size, not the
   version — the digest. A pinned URL fixes *which* bytes you asked for; a pinned digest
   is the only thing that establishes which bytes you got. Where the publisher offers one
   (nodejs.org's `SHASUMS256.txt`, Hugging Face's ETag, every GitHub release's asset
   digest), fetch it once, record it in the source, and never fetch it again at install
   time — a digest fetched from the host you are verifying is not a verification.
2. **Verify the digest before the artifact leaves staging**, and delete the staging file
   on mismatch. This subsumes the length check: a truncation is a digest mismatch, so the
   `Content-Length`-conditional guard stops being load-bearing.
3. **Never write to the destination path.** Stream to `<dest>.partial` (or a
   uuid-suffixed temp on the same volume), verify, then `rename`. Rename is atomic on
   both platforms this ships to, and it is the only construction where a crash cannot
   leave a path that a later `is_file()` will call an install.
4. **Extract to a staging directory and rename the directory**, for anything that
   unpacks. This is the step every archive-based installer here skips:
   `sherpa_engine::extract_engine` and `extract_selected` unpack entry by entry
   **directly into the live bin/model directory**, so a failure partway through leaves
   real files under real names, and the next launch's existence checks read them as an
   install. Stage, verify, swap.
5. **Verify the artifact's own bytes say what the name says.** A magic-number or header
   check, on the way in. This is the leaf's version of the law
   [`bundling-native-assets`](./bundling-native-assets.md) earned — *a vendored
   artifact's declared architecture is a claim, not a fact* — generalised past
   architecture: for an ONNX model check the protobuf header, for a zip the local file
   header, for a WAV the RIFF/WAVE tag exactly as `pocket.rs:141-145` already does.
6. **Choose architecture from the compiled target, never from the environment.** `cfg!(target_arch)`,
   as `sherpa_engine.rs:211-214` does, with a unit test asserting the URL and the target
   agree (`:269-283`). The shell's `PROCESSOR_ARCHITECTURE` is wrong under emulation and
   that is not hypothetical — on this machine `rustc` reports host
   `aarch64-pc-windows-msvc` while the environment reports `AMD64`.
7. **Define "ready" as "verified", and persist the verdict.** Write a sidecar
   (`<artifact>.verified` holding the digest and the version that produced it) at the
   moment of the successful check, and let the readiness predicate read *that*. An
   existence check cannot distinguish a good install, a truncated one, and one from a
   previous incompatible release.
8. **Give every download a cancel and a resume, and thread the cancel through the chunk
   loop.** `setup.rs:292-295` is the shape: an `AtomicBool` checked per chunk. Two of the
   three in-repo channels do not have one, and they are the two that pull hundreds of
   megabytes — a 466 MB whisper model and a 325 MB Kokoro package.
9. **Own the download, or own the decision not to.** A library that downloads for you
   (`fastembed`) takes the progress, the cancel, the retry, the destination and the
   verification with it. Either wrap it so those exist, or make the install an explicit,
   documented user step — but do not ship an app whose 23 MB first-use download is
   invisible to every mechanism the rest of the app has for downloads.

---

## §7 — Deviations

### 7.A — P0: an installer is downloaded without verification and executed, once with `sudo`

`commands/infrastructure/setup.rs` — `download_file` (`:256-315`), consumed at `:458`
(Windows, `msiexec /i … /qn /norestart`) and `:583` (macOS,
`sudo installer -pkg … -target /`).

- no digest, no signature check
- no length check — `total_size` (`:277`) feeds only the progress percentage (`:301`)
- writes straight to `%TEMP%\personas-setup\<filename>`, no staging, no rename
- the URL is assembled from a version fetched at runtime from
  `https://nodejs.org/dist/index.json` (`:322-350`), so the *filename* is not fixed either

Transport is HTTPS to `nodejs.org`, which is the only thing standing between this and
arbitrary code execution as Administrator/root. That is a real control and it is the only
one. **Not applied** — it changes an install flow the operator may run, and adding a
verification step that can fail changes whether setup succeeds. → **deferred-fixes
register.**

### 7.B — P1: the one truncation check is disabled by a missing header

`companion/stt/downloader.rs:206-212`.

```rust
if let Some(expected) = total {
    if downloaded != expected { return Err(… "truncated" …) }
}
```

`total` is `resp.content_length()` (`:161`). For a chunked response it is `None` and the
whole check is skipped, after which `:214` renames the partial into place. The comment
directly above (`:201-205`) describes the resulting failure — *"every transcription then
fails with an opaque 'whisper exited with …'"* — so the code documents the bug the code
permits. A digest (§2 step 2) removes the dependency on the header entirely.

### 7.C — P1: the whisper installer pins an x64 asset on a host that is not x64

`companion/stt/installer.rs:50-51`:

```rust
const ENGINE_ARCHIVE_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
```

gated only on `cfg!(target_os = "windows")` (`:66`). Its own header says it mirrors the
Kokoro installer *"exactly … the pinned asset below is a win-x64 build"* — **and that
statement about the Kokoro installer is no longer true.** `sherpa_engine.rs:204-214`
selects `win-arm64` or `win-x64` from `cfg(target_arch)` and carries a test
(`:269-283`) asserting the URL matches the compiled target, with a comment explaining
that the shell's `PROCESSOR_ARCHITECTURE` is untrustworthy under emulation. The whisper
installer copied the *older* version of its sibling and kept a comment pointing at it.

Measured on this machine: `rustc -vV` reports host **`aarch64-pc-windows-msvc`**, while
the shell reports `PROCESSOR_ARCHITECTURE=AMD64` — a live instance of the exact confusion
`sherpa_engine`'s comment warns about. So "Install Whisper" here fetches an x64 build for
an arm64 app. It will run under emulation, slowly, and nothing will say why.
`~/.personas/companion-stt` does not exist on this machine, so nobody has clicked it.
**Not applied** (changes what a button downloads). → **deferred-fixes register.**

### 7.D — P1: archives extract into the live directory, so a failed install leaves a resolvable one

`sherpa_engine::extract_engine` (`:222-262`) unpacks each wanted entry directly to
`bin_dir.join(&fname)`; `extract_selected` (`:128-202`) likewise to `dest_dir.join(rel)`;
`stt/installer.rs::extract_engine` (`:166-214`) likewise. Each has a sentinel check
(`found_exe` / `found_sentinel` / `extracted == 0`) that fires **after** the loop.

So an archive whose exe unpacks first and whose DLL fails midway returns `Err`, the UI
shows `Failed` — and `kokoro::engine_binary_path()` now returns `Some`, because the exe
is on disk. Every subsequent launch reports the engine installed and every synthesis
fails at load time. The extraction produced a state the readiness predicate cannot
distinguish from success. Both halves of §2 (stage-then-swap, and readiness-as-verified)
close this.

### 7.E — P2: the `ml` download channel has none of the app's download machinery

`db/src/embedder.rs:134-143` — `TextEmbedding::try_new(InitOptions::new(AllMiniLML6V2Q).with_cache_dir(cache_dir))`.
The comment on `:102` says *"Downloads on first use (~23MB)"*. That download is entirely
inside `fastembed`: no `InstallProgress` event, no phase, no cancel, no
inflight guard, no length or digest check this repo can see or add, and a failure surfaces
only as a `poisoned` flag that permanently disables embeddings for the session
(`:105-109`).

Enumerated on disk at `%APPDATA%\com.personas.desktop\models\onnx\models--Xenova--all-MiniLM-L6-v2\`:
**11 files** — 5 blobs (22,972,370 · 711,661 · 650 · 366 · 125 B) each with a
zero-byte `.lock` sidecar, plus `refs/main` (40 B). **The blobs are named by their content
digest** — the 22.9 MB one carries a 64-hex name, the others 40-hex — because that is the
Hugging Face cache layout. *The digest this repo never checks is sitting in the filename
of the file it never checks.* Nothing in 963 `.rs` files reads it.

Two second-order notes. This directory is inside `$APPDATA/**`, so it is published by the
asset protocol — see [`media-viewer.md`](./media-viewer.md) §7.A. And per
[`vector-kb-ingestion.md`](./vector-kb-ingestion.md)'s correction, **name the store**: this
is the *embedding-model cache*, not the vector store, and its presence says nothing about
whether any vector table has rows.

### 7.F — P2: no download in the model/sidecar stack can be cancelled

`stt/downloader.rs::stream_to_file` and `sherpa_engine::download_to_file` both loop
`while let Some(chunk) = stream.next().await` with no cancellation token. The only exits
are completion, a chunk error, and the 20-minute client timeout
(`DOWNLOAD_TIMEOUT`, `stt/downloader.rs:31`, `kokoro_installer.rs:42`,
`pocket_installer.rs:37`). The frontend has no cancel command to call — the `cancelled`
flags in `SttPanel.tsx:192`, `voiceEngineShared.tsx:162` and `PocketVoicePanel.tsx:223`
are effect-teardown guards for the **event listener**, not for the download. Grepping
`src-tauri/src/commands/companion/` for a download-cancel command returns nothing.

The artifacts are 466 MB (`small` whisper), 325,630,829 B (`kokoro/model.onnx`) and
76,341,079 B (`pocket/lm_main.int8.onnx`). The spine's own framing for this leaf names
cancel as one of three requirements; **1 of 3 channels has it, and it is the one that
installs Node.js.**

### 7.G — Checked and cleared, and worth copying

- **`pocket.rs::import_voice` (`:133-161`)** — size cap, magic-number format check,
  `.partial` + rename. The best artifact-write in the tree; §2 steps 3 and 5 are simply
  this function generalised.
- **`live_roadmap.rs:383-396`** — temp + rename with a **per-call uuid suffix**, and a
  comment explaining that it prevents two concurrent writers clobbering each other's temp
  file. That is strictly better than `stt/downloader.rs`'s fixed `.partial` name, whose
  own comment (`:131-133`) records the concurrent-partial bug from the other direction.
- **Curated-catalog allowlists.** `stt/catalog.rs::find_model_by_id` gates download,
  delete and transcribe, with a test asserting `"../etc/passwd"` resolves to `None`
  (`:106`). Path traversal via model id is closed.
- **Archive traversal.** `stt/installer.rs` uses `ZipFile::enclosed_name()` and skips
  `None`; `sherpa_engine::extract_selected:168-178` rejects any non-`Normal` component
  with a comment explaining that `tar::Entry::unpack` does no sanitisation of its own.
  Both have tests. Correct, and better than most of what this sweep found.
- **`ENGINE_VERSION` consolidation.** `sherpa_engine.rs:1-20` records a real incident —
  two installers pinning the shared binary independently, one downgrading the other and
  silently breaking voice cloning — and fixes it by making one constant own it.

**The pattern is present, reinvented, and absent where it matters.** A staging-named
write (`tmp` / `temp` / `partial` / `staging`) appears at **8 sites across 7 files**;
non-staged writes at 98 sites across 64 files. Most of those 98 are correct — a settings
file, an export the user asked for. The point is narrower: of the **3 in-repo channels
that download an artifact and later load or execute it, 1 stages and 2 do not**, and the
2 that do not are the two that write an executable.

---

## §9 — The gate

### Declined — the condition is an absence, and the census cannot assert an absence

The defect is *"this artifact is installed without anything having verified it"*. That is
a missing check, and per §4 of the doctrine the census ratchets a count of something
present; it cannot say "no code verifies this download". I tried the two lexical proxies
anyway and measured both.

**Proxy 1 — a file write whose destination is not a staging name.** Over 963 `.rs` files
(shared `stripComments` + `stripCfgTest`):

| pattern | files | matches |
|---|---:|---:|
| anchor — `File::create` / `fs::write` with a named destination | 70 | 106 |
| "violating" — destination identifier not named `tmp`/`temp`/`partial`/`staging`/`scratch` | 64 | 98 |
| "compliant" — destination identifier is a staging name | 7 | 8 |

**Precision would be ~3%.** The 98 are overwhelmingly correct code — writing
`CLAUDE.md`, an MCP settings file, a user-requested export. The 3 sites this path cares
about are lost in them, and a gate that fires on correct content is worse than no gate.
Cost was also disqualifying: ~14 s per pattern over the tree.

**Proxy 2 — `bytes_stream()` as the download population.** This is the instrument
[`outbound-http-call.md`](./outbound-http-call.md) §7.F uses, and it is **wrong in both
directions for this leaf**. Re-measured: 7 sites, and opening all 7 —

| site | writes to disk | installs a runnable artifact |
|---|:--:|:--:|
| `engine/src/ollama.rs:193` | no | no |
| `commands/core/persona_icon_gen.rs:426` | no (in-memory, capped) | no |
| `commands/infrastructure/setup.rs:289` | **yes** | **yes** |
| `companion/stt/downloader.rs:171` | **yes** | **yes** |
| `companion/tts/sherpa_engine.rs:92` | **yes** | **yes** |
| `engine/http_engine/openai.rs:125` | no (SSE) | no |
| `engine/smee_relay.rs:322` | no (SSE) | no |

**3 of 7**, not 7 — the other four are streaming response bodies, which have no integrity
question. And it **misses the `ml` channel entirely** (7.E), because that download happens
inside `fastembed` and contains no `bytes_stream()` this repo can see. A rule on this
anchor would over-report by 4 and under-report by 1, and the one it misses is the one
with no controls at all.

**Site-level overlap:** the declined Proxy-2 anchor shares **2 of 3** disk-writing sites
with `outbound-http-call`'s §7.F citation set, which is a second reason not to ship it.

### The instrument that would work is an inventory, not a ratchet

The doctrine's own precedent is `check-csp-hosts.mjs`, which exists because an
allowlist-covers-a-set condition cannot live in the census. The same shape applies here:

> **`scripts/check-download-integrity.mjs`** — walk `src-tauri/**/*.rs` for URL string
> literals whose host is a release/artifact host (`github.com/*/releases/download/`,
> `huggingface.co/*/resolve/`, `nodejs.org/dist/`), and require each to appear in a
> committed `download-manifest.json` carrying `{url, sha256, arch, addedAt}`. **Exit 2
> if it finds zero URLs** — the precondition assertion, without which it becomes another
> gate that measures nothing and passes forever.

That is an inventory of what *should* exist compared against a registry — the doctrine's
item 4 under "where types cannot reach" — and it is the only instrument that can see
7.A, 7.C and 7.E at once. Specified here, not shipped: it needs a manifest whose digests
must be established by fetching the artifacts, which this session cannot do honestly.

### Prefer a type over a gate — one applies, and it is narrow

Steps 3 and 7 of §2 are a **Q5 (withholding)** case for one function.
`sherpa_engine::download_to_file(client, url, dest, …)` takes the caller's *final*
destination and returns `Result<()>`. Every caller then uses the path it already had.
Change it to withhold the destination:

```rust
/// Streams `url` to a staging file, verifies `expect_sha256`, and renames into
/// place. Returns the verified path; there is no way to obtain an unverified one.
pub async fn download_verified(
    client: &reqwest::Client, url: &str, dest: &Path,
    expect_sha256: &str, app: &AppHandle, event: &str, phase: InstallPhase,
) -> Result<VerifiedArtifact, AppError>;
```

with `VerifiedArtifact(PathBuf)` holding a **private** field (Q4 — a newtype with a public
field is a comment) and the extract functions taking `&VerifiedArtifact` rather than
`&Path`. Then "extract something that was never verified" stops compiling.

**Q3 check** — construction sites: `download_to_file` has 4 callers
(`kokoro_installer:107, :118`, `pocket_installer:107, :118`) plus
`stt/installer.rs:121`; `extract_engine`/`extract_selected` have 5. Small enough to
migrate in one change, so the type is not aspirational.

**Where it does not reach, stated plainly:** it cannot touch `setup.rs` (which has its own
private `download_file`, and would need the same treatment) and it cannot touch
`fastembed` at all — the download happens across a **crate boundary** inside a dependency,
which is the sixth place in the doctrine's list where types do not reach, in its temporal
form: by the time this repo has a path, the fetch is over and everything the library knew
and did not record is gone.

---

## §12 — Corrections

### 12.1 — To my brief

**"The analogous claims are size, hash and format."** Correct as a frame, and the sweep
found a fourth that dominates: **identity of the destination**. The three checks are
downstream of a prior question — *is the thing at this path the thing this path is named
after* — and because every readiness predicate in the stack is `is_file()`, that question
is never asked. `stt/downloader.rs` verifies size and still cannot answer it (7.B);
`kokoro_installer` verifies neither and answers it with `is_file()` (7.D).

**"Whether a failed install leaves a half-written file that the next run treats as
present."** — It does, and by two different mechanisms, only one of which I expected.
The one I expected (a truncated download promoted to the final name) is **guarded** in
`stt/downloader.rs` — with the hole at 7.B. The one I did not expect is 7.D: the archive
installers extract into the **live directory**, so a failure *after* the exe unpacks
leaves an engine that `engine_binary_path()` resolves, while the UI shows `Failed`. The
brief's framing pointed at the download; the durable half-state comes from the
**extraction**.

**"Code nobody compiles is where a defect sits longest."** Partly borne out and partly
inverted. The `ml` path is indeed the least-controlled channel (7.E) — but not because it
is unreviewed. It is uncontrolled because the download was **delegated to a dependency**,
and that would be equally true if it compiled on every machine. The `ml`-gating hid it
from *my instrument*, not from its author; `bytes_stream()` — the anchor the neighbouring
path uses for exactly this question — cannot see it either. The lesson is about the
instrument, not the feature flag.

### 12.2 — To `outbound-http-call.md` §7.F and its §5 gap table

That path records *"Seven `bytes_stream()` sites, zero checksums"* and *"7 downloads have
no integrity check"*. **The zero-checksums half is exactly right and I confirm it
independently** — `sha256_hex` exists in `companion/util` and is used throughout the brain
layer for content hashing of memories, and appears nowhere near any download.

**The "7 downloads" half conflates two populations.** Opened one by one (table in §9):
**3 of the 7 write to disk; the other 4 are streaming response bodies** (Ollama, an
OpenAI-compatible SSE stream, the Smee relay) and one in-memory capped image fetch, none
of which has an integrity question at all. And the count **misses a channel**:
`db/src/embedder.rs`'s fastembed download uses no `bytes_stream()`, so an instrument keyed
on it reports 7 downloads while the number of *install channels* is at least 4 and the
number that install a runnable artifact is 3.

Both are refinements rather than refutations — the conclusion ("no integrity check
anywhere") stands and is if anything understated, since the missed channel is the one with
no progress, no cancel and no visibility. Per the doctrine's rule on conjoined headlines,
the fix is to split it: *"3 downloads install a runnable artifact; 0 verify a digest"* is
one checkable claim, and *"144 response reads, 142 unbounded"* is another.

### 12.3 — The spine's `convergence: mixed` label — **contradicted; a 5/5 silence, with one inversion**

Cohort established for this leaf: **0 of 5 siblings download and install an artifact at
runtime.** `brainiac` — `reqwest` usage is entirely LLM-provider API calls, no
`tempfile`, no `fs::write`+`reqwest` pairing. `personas-cloud` —
`facade/services/claude_release_checker.py` polls the GitHub releases API and stores
release *metadata*; it never fetches the asset. `personas-web` —
`src/app/api/download/route.ts:68-78` issues an HTTP redirect to an allowlisted host and
handles no bytes. `ascent` — `src/lib/net/logo-fetch.ts` fetches with SSRF guards, a
2 MB cap and a content-type allowlist, and returns a `data:` URI held in memory; nothing
reaches disk.

`vibeman` is the informative one, and it is an **inversion — the strongest oracle class,
and one shared authorship does not explain away.** It faced this exact decision for a
local embedding model and declined it. `src/lib/brain/embeddings.ts:20`:

> `/** Local Ollama embedding model. Pull with: `ollama pull nomic-embed-text`. */`

A documented manual step instead of an in-app download. Given the doctrine's standing
instruction to treat `vibeman` as this repo's ancestor, the direction reads as: the
ancestor did not own the download, and Personas took it on — acquiring progress, cancel,
verification, staging, architecture and resume as new obligations, and discharging one of
them (progress) across the board.

So `mixed` is wrong in the way the doctrine's ledger predicts. There is no external answer
to adopt, because **Personas is the only repository in the cohort with the problem** —
which also means §2 above is engineering judgment, not a distillation of fleet practice,
and should be read as such. Stated as self-comparison: this repo is ahead of the fleet by
virtue of having the problem at all, and its own best answer to it
(`pocket.rs::import_voice`) is applied to the one artifact that arrives by hand.

### 12.4 — What I got wrong on the way, and what caught it

I established the install-channel population by **reading**, and got 3. Two independent
detectors then disagreed with each other — a function-body pass (HTTP + a file write in
one `fn`) returned 16 fn bodies, a file-level pass (a body-reader + a file write in one
file) returned 7 — and **the disagreement is what found what I had missed**. Only in
detector B: `companion/tts/pocket.rs:152`, which turned out to be `import_voice`, the
best-shaped artifact write in the tree and now the anchor of §2; and
`commands/live_roadmap.rs:395`, the uuid-suffixed atomic write in §7.G. Only in detector
A: `connector_use.rs:1247 elevenlabs_generate_tts`, a TTS write into the managed drive
whose destination comes from **a model's tool arguments** and is resolved through
`resolve_within_root` — a fourth path-containment site, and a lead for a neighbouring
leaf rather than this one.

Neither detector's *count* was the finding; both counts are noisy. **The membership
difference was the finding**, and reading alone would have produced a document whose §2
had no exemplar in it. The doctrine says two implementations exist so disagreement can
surface; this is the case where the disagreement was not about a number at all.
