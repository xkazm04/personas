# APPLY pass, intake-voicebox-0903 — personas

2026-09-03. Registry commit dfd7570. No product code changed; no branch cut.

Why no `code` row: `src-tauri/` carries foreign uncommitted work across 12 files
in 4 crates (another session), and `cargo` here is cold — a bare `ls target/`
did not return inside 120 s. Both of `code` mode's preconditions fail, so every
Rust seam below is walked as a simulation instead of built.

---

## 1. permission-gate-vector — BETTER

Seam: `src-tauri/src/commands/design/connector_readiness.rs:186` (`PersonaSetup.blockers`)

A: every not-ready connector becomes a `SetupBlocker` in one flat `Vec`, and the
coarse `personas.setup_status` string gates execution over the whole list.
B: each connector declared killer or degrader per persona; killers gate,
degraders raise a notice on the stage they cost.

**Case 1 — the CLI-auth fallback (`connector_readiness.rs:20-38`).** A persona
declaring `vercel` alongside `codebase` is un-runnable while the user has not run
`vercel login`, even when the run's product is a code review that never deploys.
Under B, `vercel` is a degrader for that persona and the run proceeds with a
notice. Predicts: strictly more personas reach a first successful run.

**Case 2 — the divergence the file was written to end.** Its own header records
that `vault_missing_connectors` and `check_persona_runnability` "used to
disagree, so a persona could pass adoption and then fail promote." B adds a
second derived product (the notice list) off the same declared vector rather
than a fourth conjunction — the file's existing one-authority discipline holds.

**Case 3 — `CliProbeResult` (`:140-158`).** Three states, `Absent` distinct from
`Unauthed`, already exactly the technique's "the query has three answers, not
two". B changes nothing here; this case corroborates rather than moves.

Falsifier: if the connector set a persona declares is in practice always the set
it actually uses, the killer/degrader split is empty and B is ceremony. Test it
by counting, over `personas.setup_detail` rows, how many blocked personas were
blocked by a connector no execution ever touched.

Separate, smaller finding under the same technique: the probe cache is a 5-minute
TTL (`:170-180`), not a recheck-on-focus. `vercel login` happens in a terminal —
out of band — and the technique's "recheck on the window regaining focus" is the
right event. A user who authenticates and returns waits up to 5 minutes for the
notice to clear. Falsifier: if the Tauri focus event fires often enough on this
app to make the probe spawn a process per focus, the TTL is the correct design
and the technique's rule does not survive a desktop shell's focus churn.

---

## 2. capability-presence-contract — BETTER

Seam: `src-tauri/src/companion/tts/sherpa_engine.rs:208-211`

A: `ENGINE_ARCHIVE_URL` is selected by `#[cfg(target_arch = "aarch64")]` /
`#[cfg(not(...))]` — two arms, both **Windows** archive URLs. On macOS aarch64
the constant compiles to `sherpa-onnx-v1.13.4-win-arm64-...tar.bz2`.
B: one declared presence matrix, read by the constant, the gate and the checklist.

**Case 1 — four authorities for one host predicate.** `kokoro.rs:182` and
`pocket.rs:303` each compute `can_auto_install: cfg!(target_os = "windows")`;
`kokoro_installer.rs:50` and `pocket_installer.rs:50` each re-test the same thing
as a runtime refusal; `sherpa_engine.rs:208` keys the download URL on
`target_arch` and never on `target_os` at all. Five sites, four of which agree by
coincidence. This is the technique's named failure — "deriving them from
scattered host checks at the call sites means the checklist and the gate can
disagree, and they will."

**Case 2 — the class does reach the surface, and correctly.**
`KokoroVoicePanel.tsx:140` `showAutoInstall = !!status?.canAutoInstall && !fullyInstalled`
— the class-4 control is not rendered on a host that cannot run
it. Class 4 is satisfied today. B does not change this; it changes where the bool
comes from.

**Case 3 — the refusal carries its reason in message text.**
`kokoro_installer.rs:51-53` returns a `Validation` error reading "Automatic
Kokoro install is Windows-only for now — install the sidecar + model manually".
The class survives as prose; only `canAutoInstall` survives as a typed value, and
the two are computed independently. Predicts: adding a fifth site (a Linux
sidecar build) changes three of the five and leaves `sherpa_engine.rs` lying.

Falsifier: if personas is in practice a Windows-only product — the manifest
declares `repo.languages: [typescript]` and every auto-install path is
Windows-gated — then the matrix has one row and the technique's own "the product
ships to one host" exclusion applies. Test: does any release asset actually get
installed on a non-Windows machine? `release.yml` builds darwin and linux
bundles, so the answer is currently yes.

---

## 3. unattended-caller-attribution — BETTER

Seam: `src-tauri/src/local_http/mod.rs:86` (`build_app`'s single `layer`)

The second door is open, documented and already used by an automated caller.
`~/.personas/local-http.json` publishes `{pid, port, token}`
(`local_http/mod.rs:159-171`), and the file's own doc comment says
`.claude/skills/project-populate/references/bridge.md` "tells a terminal session
to read `.port` and `.token` out of this file." An unhosted coding assistant
holds a bearer token to this process. Confirmed live on this box: that file
currently carries a real pid, port 17400, and a token.

A: `build_app` attaches exactly **one** policy axis over the whole tree —
`auth::guard`, authentication. Nothing anywhere distinguishes a route that
returns a project list from a route that would make the machine speak. TTS is
absent from the door by accident of which routers were registered, not by a rule.
B: the door carries an effect class per mount; an audio-producing effect is
admitted only behind a synchronous attribution surface, and never headless.

**Case 1 — `browser_bridge/mod.rs:220-221` mounts `/ws` and `/mcp`.** An MCP
transport is already on the second door. Adding `companion_tts` to the MCP tool
list (`mcp_server/tools.rs`, today 33 tools including `personas_execute` and
`post_message`) is a one-entry change that would make an unattended caller able
to produce sound, and no line in `build_app` would object.

**Case 2 — `voice.rs:40` `require_auth(&state).await?`.** Every TTS command's
only admission check is the same auth call the IPC surface uses. It answers "is
this the app", never "is a human present". Under B this is where the
hosted/unhosted discriminator lands.

**Case 3 — autonomous speech already exists on the hosted side.**
`athenaChatVoice.ts:139` `playProgress(beat)` fires from a store subscription on
model-authored `PROGRESS:` lines, and `athenaChatAudio.ts:8` names "an autonomous
beat" as a first-class case. The product already speaks without a gesture; the
only thing keeping that attributable is that a React panel is mounted. A caller
on the second door supplies no such surface.

Falsifier: if the local HTTP door's admission were in practice restricted to
routers that cannot cause a physical effect, policy A would be sound and B
premature. It is not — dev-tools' `/scan-codebase` (`mod.rs:275-278`) already
starts real work. Predicted outcome: the first request for headless speech
arrives before the surface exists, exactly as the technique says.

---

## 4. caller-scoped-voice-binding — BETTER

Seam: `src-tauri/src/companion/tts/pocket.rs:350-356`

The two engines behind one dispatcher implement opposite answers to the
technique's load-bearing arm.

A (Kokoro, `kokoro.rs:190-195`): explicit voice, lookup misses → **error**
naming what was asked for. Correct, and the technique's rule verbatim.
A (Pocket, `pocket.rs:350-356`): `if sidecar_ready() { if let Some(wav) =
voice_wav_path(request.voice_id) { return synthesize_sidecar(...) } }` then
`synthesize_service(request).await`. Explicit voice, local reference wav missing
→ **falls through** to the HTTP service, which resolves the name against a
different catalog.

**Case 1 — the stale reference is reachable by a normal user action.**
`companion_tts_pocket_delete_voice` (`voice.rs:140`) removes a cloned voice's
`.wav`. Nothing clears `companionPocketVoiceId` (`useTtsVoiceSelection.ts:37,41`),
and `configured: !!pocketVoiceId` stays true. The next reply routes to the
service with a voice id the service does not have.

**Case 2 — the voice is a clone of a real person.** `pocket.rs` is the zero-shot
cloning engine; `import_voice` (`:132`) stores a ~30 s reference recording. A
fall-through here does not merely pick a different timbre — it speaks in
whichever voice the service defaults to, after the caller named a specific
person's clone. This is the technique's "confident speech in the wrong person's
voice, and the caller's logs say the request succeeded."

**Case 3 — the frontend's terminal arm is a silent return, not an error.**
`athenaChatAudio.ts:64,91` `if (!voiceActive || !voiceId) return;`. When
resolution produces nothing, nothing is spoken and nothing is said about it —
the chain's last arm is a no-op where the technique requires an error naming
where a default is set. Personas has no global default voice at all; there are
only two per-engine stored preferences.

Predicted outcome of B (terminate the chain at Pocket, and surface the null case):
the delete-then-speak sequence produces a named error instead of speech in an
unrequested voice. Falsifier: if `synthesize_service` already rejects unknown
voice ids with a distinguishable error, the fall-through is harmless and only the
frontend's silent arm is a real defect. That is checkable — start the Pocket
service and POST a nonexistent voice id.

---

## 5. change-rate-partitioning — BETTER

Seam: `src-tauri/src/companion/tts/kokoro_installer.rs:86` (`install_inner`)

The payload is **already cut on the right seam** and carries none of the identity
the cut requires. Engine: `sherpa-onnx v1.13.4` (`sherpa_engine.rs:208`), on the
upstream toolchain's clock. Model: `kokoro-multi-lang-v1_0`
(`kokoro_installer.rs:38`), on the tts-models clock. Different clocks, and the
large part (325 MB `model.onnx` + 27 MB `voices.bin`, measured on disk) is on the
slow one — all three of the technique's cut conditions hold.

**Case 1 — both staleness predicates are presence, not version.**
`kokoro::engine_binary_path().is_none()` and `kokoro::is_model_installed()`
(`kokoro_installer.rs:161-170`) ask whether files exist. Nothing records which
version is on disk. Bumping `ENGINE_ARCHIVE_URL` to v1.13.5 in a routine release
changes nothing for any existing install, silently and forever.

**Case 2 — the model version is a documented correctness dependency.**
`kokoro_installer.rs:36-37`: "v1_0 specifically — the catalog's sids are verified
against it; v1_1 may reorder speakers." So a model marker is not hygiene here;
without it, a hand-installed v1_1 speaks the wrong voice for every `--sid` in
`kokoro_catalog.rs` and `is_model_installed()` reports green.

**Case 3 — two acquisition paths, two guards, one shared directory.**
`kokoro_installer.rs:44` and `pocket_installer.rs:39` each hold their own
`InflightGuard`, keyed `"kokoro-install"` and `"pocket-install"`. Both call
`engine_dir()` (`mod.rs:36`) and both extract the **same** `ENGINE_ARCHIVE_URL`
via `sherpa_engine::extract_engine` into `~/.personas/companion-tts/bin/`.
Concurrent one-click installs run two blocking tasks writing the same
`onnxruntime.dll`. This is precisely the technique's warning that with two
acquisition paths the in-flight guard must become a named mutual-exclusion
primitive over the *part*, not over the *installer*.

Predicted outcome of B: a marker file per part; the engine part fetched once and
skipped by the second installer; the race closed by keying the guard on the part.
Falsifier: if a user can only ever run one installer (the UI disabling the other
while one runs) the race is unreachable. Checked — `KokoroVoicePanel.tsx:140` and
`PocketVoicePanel.tsx:379` compute `showAutoInstall` independently, in two panels,
from two `status` calls. Nothing coordinates them.

---

## 6. native-owned-stream — NOT-BETTER

Seam: `src/features/agents/sub_deployment/hooks/useCloudHealthMonitor.ts:84`
(`attemptReconnect`)

Personas already satisfies the technique's thesis by construction and has no
seam left for it. There is no `new EventSource(`, no `new WebSocket(`, and no
`ReadableStream` reader anywhere in `src/`; every long-lived producer is owned by
the Rust process and fanned out over the Tauri bus —
`companion/session/events.rs:247` `app.emit(STREAM_EVENT, &ev)` plus the 14
channels in `companion/session/turn.rs`. The view is already a pure renderer.

The only frontend loop with backoff is this one, and applying the technique's
rules to it is a category error.

**Case 1 — it is a poll, not a stream.** `HEALTH_POLL_INTERVAL = 30_000` (`:7`),
one `cloudGetConfig()` per tick. The technique's "reset the backoff only on a
round that produced a frame" exists because a stream can connect and then go
quiet with no error. A poll's round *is* its frame: `config?.is_connected` at
`:93` is the productive signal, and the reset at `:98` is already conditioned on
it, not on the call having returned.

**Case 2 — the failure the technique guards is not reachable here.** There is no
producer heartbeat to derive an idle timeout from, and none is needed: a poll
that gets no answer throws, and `:105` catches it. The technique's own exclusion
applies — "the event is rare and pollable."

**Case 3 — the repo already found and fixed the real defect on this line, and it
was a different one.** The comment at `:119-131` records that until 2026-08-16
`Math.min` bounded the *index* into the backoff schedule and not the *attempt
count*: "5s, 10s, 20s, 60s, then 60s forever, at 63 attempts an hour." That is an
unbounded-retry defect, owned by `retry-with-backoff`, not by this technique.

Verdict not-better, with the condition: `native-owned-stream` holds for a stream
whose silence is indistinguishable from health. It has nothing to say about a
poll, and a product that has already relocated ownership natively has spent the
technique. Falsifier: if a host throttles the Tauri bus itself to a hidden
webview — the asymmetry the technique tells you to *verify* rather than assume —
then personas' whole architecture inherits the defect and this verdict inverts.
That is measurable: minimise the window and count `STREAM_EVENT` arrivals.

---

## 7. signing-and-trust (amendment: attestation does not nest) — BETTER

Seam: `.github/workflows/release.yml:480-497`

A: the release's only cryptographic coverage is the minisign updater signature
over the **updater artifacts**. `tauri.conf.json:82` `"signingIdentity": null`
and `:99` `"certificateThumbprint": null` — nothing is code-signed or notarized.
B: the enumeration covers every wrapper the bundler produced, not the subset the
updater consumes.

**Case 1 — the gate enumerates payloads and skips wrappers.**
`release.yml:459-467` matches `\.app\.tar\.gz$`, `(\.nsis\.zip|\.msi\.zip)$`,
`\.AppImage\.tar\.gz$`. `tauri.conf.json:71` is `"targets": "all"`, so the same
run also publishes the `.dmg`, the `.msi` and the NSIS `.exe` — the assets a
first-time user actually downloads. Not one of them is matched, signed or
checked. An attested payload inside an un-attested wrapper is an un-attested
download, and here the wrapper is the only artifact most users ever touch.

**Case 2 — the amendment's hard-fail rule is already implemented, for the wrong
set.** `release.yml:480-497` refuses to publish `latest.json` when any platform's
bundle or `.sig` is missing, with a comment explaining that an empty url "doesn't
degrade gracefully." That is exactly the amendment's fourth property — zero
inputs is an error, and say which path you looked in. The mechanism exists; its
input list is the payloads.

**Case 3 — the identity trap, avoided.** `release.yml:381-385` notes the job runs
on a path where "updater artifacts are only signed and uploaded on the publish
path", and the tag is read from the release lookup rather than from the trigger
ref — the amendment's stated trap, already handled. So B is not a redesign: it is
widening one `grep -iE` list and adding a verification call.

Predicted outcome: the widened enumeration fails the first release it runs on,
because `.dmg`/`.msi` have no signature to find. Falsifier: if the release
process deliberately ships unsigned wrappers and says so, the finding is a
disclosure gap rather than a gate gap — but nothing in `release.yml` or
`tauri.conf.json` says so, and `pubkey` at `tauri.conf.json:62` implies to a
reader that downloads are verified.

---

## 8. render-acceptance — NOT-BETTER (experiment, see `results.txt`)

Seam: `src-tauri/src/companion/tts/kokoro.rs:288-296`

A: the sidecar exits 0, `tokio::fs::read` returns bytes, `TtsAudio` is
constructed. No property of the artifact is asserted — not even non-zero length.
B: the technique's detector — bounded internal silence enclosed on both sides by
speech — between the adapter's return and acceptance.

Ran B's detector (`detect.py`, 40 lines, no dependency) over six real renders
produced by reproducing `kokoro.rs`'s exact sidecar invocation. Zero product
code changed. Corpus spans the product's whole content range: a 1.6 s
`PROGRESS:` beat, a typical 7.7 s reply, the technique's named false-positive
case (a paced list), the 1195-char ceiling `validate_text` accepts, and two
degenerate inputs.

**Longest internal gap across the entire corpus: 160 ms.** Any bound tuned from
the legitimate side — the technique's own instruction — lands at 300 ms or above
and rejects nothing. B fires zero times, true or false, including on a 65.75 s
render 40x longer than a typical utterance.

The reason is structural and is the condition the technique gains: Kokoro is a
duration-predictor model. It has no stop condition to miss, so the degenerate
mode the detector hunts is not in its failure space at all — the technique's own
"the engine is not generative in the relevant sense" exclusion, met.

Worse for B, the two degenerate outputs personas *can* actually reach both pass
cleanly: `f_ellipsis` (text `"..."` → 0.17 s, 7980 bytes) and `e_nonphonetic`
(text `"###"` → 0.97 s of the model reading the hashes aloud). Both would be
marked `completed` and played under A and under B alike. `validate_text`
(`mod.rs:110`) accepts both.

Return condition: personas' *other* engine, Pocket TTS (kyutai, `pocket.rs`), is
autoregressive and is the one that can miss a stop condition. Re-run this
detector against a Pocket corpus and the verdict may invert — the technique is
per-engine, and this run establishes which of the two engines it is for.
