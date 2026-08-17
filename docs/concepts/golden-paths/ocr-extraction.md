# OCR extraction

> Situation node: `integrations-security / external-and-host-surfaces /
> ocr-extraction` · [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 2` · `risk: medium` · `convergence: "converged"`.
> Dimensions: **function · cost · ui · resilience**.
> Spine `why`: *"Text out of an image or PDF through a selectable backend, then
> preview and save."*
>
> **Short form** (Mode 2 tiering: `risk: medium`, recurrence < 9). Prose is
> dropped; measurement is not.
>
> Composed 2026-08-17 against `master @ f81e2c1df`. Sweep:
> `src-tauri/src/commands/ocr/mod.rs` (676 lines, 8 `#[tauri::command]`),
> `src-tauri/core/src/models/ocr.rs`, `src-tauri/db/src/repos/resources/ocr.rs`,
> `src-tauri/engine/src/path_safety.rs`, `src-tauri/src/ipc_auth.rs`,
> `src-tauri/src/lib.rs`'s `generate_handler!` block,
> `src/features/plugins/drive/ocr/{DriveOcrDrawer.tsx,useOcr.ts}`,
> `src/api/{ocr/index.ts,drive.ts}`, plus a whole-tree spawn-site census over
> 963 `.rs` files with two independent matchers, and row counts replayed against
> the 2026-08-17 purge backup.

---

## §0 — Headline

**Two OCR backends. One can be cancelled. The other spawns a Claude CLI child
that keeps consuming the user's subscription after the drawer is closed — and
the reason the cancellable one exists, written in its own comment, is "instead
of letting the user pay for tokens on a closed drawer."** The mitigation was
built, reasoned about, and applied to exactly one of the two paths.

The asymmetry runs the whole length of the contract:

| | Gemini (`run_gemini_ocr`, `ocr/mod.rs:182`) | Claude CLI (`run_claude_ocr`, `ocr/mod.rs:476`) |
| --- | --- | --- |
| `operation_id` parameter | ✅ both commands | ❌ neither |
| cancellable mid-flight | ✅ `tokio::select!` on both the send and the body read | ❌ no token, no `kill_on_drop`, no child handle retained |
| cost recorded | ✅ `token_count` from `usageMetadata` | ❌ `token_count: None`, always |
| provider error visible | ✅ non-2xx → `AppError::Internal` with status + body | ⚠️ non-zero exit → stderr; **exit 0 with empty stdout → silently stored as a successful empty extraction** |
| refusal / truncation visible | ❌ `finishReason` is not deserialized at all | ❌ n/a |
| raw response retained | ✅ `raw_response: Some(resp_text)` | ❌ `None` |

And the surface as a whole has never run: **`ocr_documents` holds 0 rows in the
2026-08-17 purge backup**, and `ocr_documents` was not in the purge cascade — so
this is not purge damage, it is a fully-built, four-command, two-backend feature
with zero recorded use. That matters for how you read every deviation below:
**none of them has been shaken out by a user**, and three of them are the kind
that only appear on the unhappy path.

The second headline, and it is the one that generalises: **every OCR run writes
a row to `ocr_documents` that nothing can ever read.** `list_ocr_documents`,
`get_ocr_document` and `delete_ocr_document` are declared `#[tauri::command]`
(`ocr/mod.rs:658`, `:664`, `:673`) and are **absent from `generate_handler!`** —
`lib.rs:2726-2731` registers five of the eight. `commandNames.generated.ts`
carries five OCR names and none of the three CRUD ones. The repository (`db/src/repos/resources/ocr.rs`,
`list_documents`/`get_document`/`delete_document`) is written, tested by the
type system, and unreachable. The table is write-only from the app's side.

---

## §2 — The one way (compact)

**Treat OCR as a billed, cancellable, failable subprocess whose output is
attacker-controlled text, and make every backend satisfy the same contract
before you add the second one.** Concretely:

(a) **One core, one contract, backends as an enum.** `run_gemini_ocr` and
`run_claude_ocr` are two cores with two contracts; the drawer branches on a
`Backend` string and passes different arguments to each
(`DriveOcrDrawer.tsx:90-102`). Make the backend a parameter of one function
whose signature demands `operation_id`, so a new backend cannot be added
without a cancellation identity. **Withholding beats requiring** (doctrine Q5):
do not offer a `run_x(..., operation_id: Option<String>)` that a caller may
leave `None` — take a `CancelToken` by value and let the *only* constructor be
the registry.

(b) **Check the binary before you build the prompt, and use what you resolved.**
`run_claude_ocr` does resolve the binary (`which::which` under
`#[cfg(any(feature = "desktop", feature = "test-automation"))]`, a hand-rolled
`PATH`+`PATHEXT` walk otherwise) and returns a clean *"Claude Code CLI not found
in PATH"* — that half is right and is the answer to *"is the binary's presence
checked before use?"*: **yes**. Then it throws the answer away on Windows:
`binary.to_str().unwrap_or("claude")`. A resolved path that is not valid UTF-8
silently degrades to the bare name and re-enters `PATH` resolution inside
`cmd.exe`. Resolve once, pass the `OsStr`.

(c) **A successful exit is not a successful extraction.** Both backends can
produce `extracted_text: ""` and persist it as a completed document: Gemini via
`.and_then(…).unwrap_or_default()` on the candidates chain (`ocr/mod.rs:286-294`),
Claude via `String::from_utf8_lossy(&output.stdout).trim()` on an exit-0 run
with no stdout. **A manufactured default must never reach a place that cannot
tell it apart from a real answer** — that is
[`structured-output-extraction`](./structured-output-extraction.md) §2, and
this is the same defect on an image instead of a JSON reply. Return
`Err(AppError::Validation("no text extracted"))` and let the caller decide,
rather than storing a row that says the OCR worked.

(d) **Deserialize the field that says why it stopped.** `GeminiCandidate`
(`ocr/mod.rs:104-107`) has exactly one field: `content`. There is no
`finishReason`, so a `SAFETY` block, a `RECITATION` block and a `MAX_TOKENS`
truncation are all indistinguishable from an empty page. Add the field, and
treat a non-`STOP` finish as an error carrying its reason.

(e) **Treat the extracted text as untrusted, because it is.** The image came
from outside; its text is attacker-influenced. Today `run_claude_ocr` builds its
prompt with `format!` and interpolates the **file name** and the caller's
**prompt** directly into instructions it then pipes to a model
(`"I have a file named '{}' (type: {})… Instructions: {}…"`). The repo owns a
real structural fence — `sanitize_runtime_variable`
(`engine/src/prompt/runtime_safety.rs:90`: truncation with an announced marker,
zero-width stripping, non-BMP stripping, section-delimiter stripping, role-line
removal, dangerous-tag removal, backtick and heading escaping, `{{var}}`
neutralisation) — and OCR cannot call it, because it is `pub(super)` to
`engine::prompt`. **Export a fence and route this through it.** The output side
needs the same treatment wherever the extracted text later reaches a model or a
markdown renderer.

(f) **Mirror nothing by hand.** `isOcrEligible` (`useOcr.ts`) is a second copy
of `ALLOWED_OCR_EXTENSIONS` (`path_safety.rs:333`), and
`DriveOcrDrawer.tsx:239` is a second copy of `DEFAULT_GEMINI_MODEL`
(`ocr/mod.rs:26`). Generate both from the Rust side, or accept that a test on
either side is a third copy and not a check (doctrine §2).

**If you can only do one thing: wire an `operation_id` through the Claude path
and kill the child on cancel.** It is the only item here that spends the user's
money while they are looking at a closed drawer.

---

## §7 — Deviations

**7.1 — The Claude backend cannot be cancelled, and the code says so.**
`DriveOcrDrawer.tsx:100-102`: *"Claude CLI path: no operation_id wired (cancel
would need to kill the spawned child; deferred to a follow-up if it bites)."*
`cancelInFlight()` is called from `handleClose` and from an unmount effect, and
does nothing when the backend is `claude`. `run_claude_ocr` retains no child
handle, sets no `kill_on_drop`, and `wait_with_output()` runs to completion.
The prompt it is chewing on contains a base64-encoded file of up to 20 MB.

**7.2 — Cancellation is detected by substring-matching an English string.**
`DriveOcrDrawer.tsx:110-113`: `if (!msg.includes("OCR cancelled"))`. The
producer is `AppError::Internal("OCR cancelled".into())`, twice
(`ocr/mod.rs`, the two `tokio::select!` arms). A control-flow decision keyed on
display copy, in a 14-locale app, with no shared constant between the two sides.
Reword the Rust string and the cancel path starts raising an error toast at the
user for an action they took deliberately.

**7.3 — All eight OCR commands are unauthenticated at both layers.** `grep -n
ocr src-tauri/src/ipc_auth.rs` returns **nothing**, so none is in
`PRIVILEGED_COMMANDS`; the in-body guard is `require_auth_sync`, which is
`pub fn require_auth_sync(_state) -> Result<(), AppError> { Ok(()) }`
(`ipc_auth.rs:477-479`) — a literal no-op. Among them, `ocr_with_gemini` takes
**`api_key: String` as a parameter from the renderer**, which is a raw
credential crossing the IPC boundary into a Public-tier command. Mitigating
facts, both verified: the frontend has **zero** call sites for `ocr_with_gemini`
or `ocr_with_claude` (only the two `ocr_drive_file_*` wrappers are in
`src/api/drive.ts`), and the drive wrappers resolve the key server-side from the
vault (`useOcr.ts` documents this deliberately: *"The decrypted API key is never
held on the frontend"*). So the design intent is right and the legacy door is
still open. Same family as deferred fix **#32**; recorded here because the
`api_key`-as-parameter shape is specific to this leaf.

**7.4 — Three of eight commands are unreachable.** `list_ocr_documents`,
`get_ocr_document`, `delete_ocr_document` carry `#[tauri::command]` and appear
in neither `generate_handler!` (`lib.rs:2726-2731` registers five) nor
`commandNames.generated.ts` (five OCR names, none of them these). Their
repository layer (`db/src/repos/resources/ocr.rs`) is fully written. Net effect:
`repo::insert_document` runs on every OCR completion and nothing in the product
can list, open or delete what it wrote.

**7.5 — `mime_from_path` and the extension allowlist can disagree.**
`ALLOWED_OCR_EXTENSIONS` (`path_safety.rs:333`) admits nine extensions;
`mime_from_path` (`ocr/mod.rs:126`) maps eight of them and falls through to
`application/octet-stream`. Today the sets align (`tif` and `tiff` both map), so
the fallthrough is unreachable — but it is reachable *by adding one extension to
the allowlist*, and the failure would be a 20 MB base64 blob POSTed to Gemini
labelled `application/octet-stream`.

**7.6 — The client eligibility check is a superset of the server's.**
`isOcrEligible(mime, ext)` returns `true` for **any** `mime.startsWith("image/")`
before it consults its extension list. `ocr_drive_file_gemini` /
`ocr_drive_file_claude` reject anything outside the nine-entry
`ALLOWED_OCR_EXTENSIONS`. So an `.svg`, `.avif`, `.heic` or `.ico` entry whose
mime is `image/*` shows an enabled *"Extract text"* affordance that the backend
refuses. This is the `client-rule-mirroring` shape: the two ladders agree on
the nine extensions and diverge on a branch only one of them has.

**7.7 — `binary.to_str().unwrap_or("claude")`.** The Windows spawn arm
(`ocr/mod.rs:579`) discards the path it just resolved if it is not valid UTF-8,
and hands `cmd /c` the bare name instead. A verification whose result is
conditionally thrown away is worse than no verification, because the error
message still says the binary was found.

**7.8 — The 20 MB cap is on the file, not the payload.**
`MAX_OCR_FILE_BYTES = 20 * 1024 * 1024` (`ocr/mod.rs:36`) is checked against
`metadata().len()`, and the comment says it *"matches Gemini's documented
inline-data ceiling"*. The bytes actually sent are base64 — 4/3 inflation — so a
19.9 MB file produces a ~26.5 MB `inlineData` field. The Claude path is worse:
the same base64 is interpolated into a `String` prompt and written to a child's
stdin, so peak memory is roughly 3× the file (bytes + base64 + prompt).

**7.9 — Two silent no-op paths in the cancellation registry.**
`cancel_ocr_operation` returns `Ok(false)` when no token is registered
(correct, and documented as idempotent), and `register_cancel_token` is only
called when `operation_id.is_some()`. So *"cancel returned false"* conflates
*already finished*, *never started*, *already cancelled*, and *this backend has
no cancellation at all*. The drawer discards the boolean
(`cancelOcrOperation(id).catch(silentCatch(...))`) so no caller could tell them
apart anyway. **Credit where due:** the registry itself is exemplary — a
monotonic `OCR_CANCEL_HANDLE_SEQ`, an identity-guarded `CancelGuard` whose
`Drop` only evicts its own registration, and a comment explaining precisely the
reused-`operation_id` race it defends against. That is better than most of this
repo's process registries; it just guards one backend.

**7.10 — The Gemini key is sent as a header, deliberately, and the reason is
worth preserving.** `ocr/mod.rs` uses `x-goog-api-key` rather than `?key=`,
with the comment: *"reqwest's error Display includes the request URL on
connect/timeout/request failures, so a key in the URL would leak into
`AppError::Internal` → toasts, console, and Sentry breadcrumbs."* Not a
deviation — recorded because it is the correct answer to a mistake this leaf
invites, and because [`secret-and-pii-redaction`](./secret-and-pii-redaction.md)
§2's *"redact at the boundary the value crosses"* is exactly what it implements.

---

## §9 — Decline, with numbers

**No census rule.** The one countable defect shape in this leaf — the spawn — is
**already matched by three published rules**, and the doctrine's precedent is
that an 83 % file overlap is grounds to decline. Here it is 100 % site overlap.

I ran the six candidate rules against 963 `.rs` files in a private scratch
registry (never the full registry). The OCR spawn sites are:

| rule | goldenPath | hits on `commands/ocr/mod.rs` |
| --- | --- | ---: |
| `unbound-child-lifetime` | `spawning-a-cli-subprocess` | **`:579`, `:596`** (2 of its 13 matches) |
| `shell-vehicle-nonliteral-arg` | `spawning-a-cli-subprocess` | **`:579`** (1 of its 8) |
| `unpinned-billing-account-spawn` | `billing-account-auth` | **`:596`** (1 of its 5) |

Both constructions are covered; one is covered twice. A fourth rule keyed on the
same lines would ratchet nothing new and would drift in lockstep with three
existing baselines.

**The two conditions this leaf adds that no rule can express**, stated so the
next composer does not re-derive them:

1. **"A sibling backend lacks the mitigation its twin has."** This is a
   *relational* property of two functions, not a pattern in either. The signal
   would have to be *"`run_x_ocr` takes `operation_id` and `run_y_ocr` does
   not"*, which is an absence on one side of a pair the census has no notion of.
   The right instrument is a **contract test over the backend enum** — one
   `#[test]` asserting that every `Backend` variant's entry point takes a
   cancellation identity — which fails to compile the day someone adds a third
   backend. That is a type-adjacent gate and it is strictly better than counting.

2. **"An empty extraction stored as a success."** Countable in principle
   (`unwrap_or_default()` on a model-reply chain), and
   `model-reply-parser-without-a-reason` (published by
   `structured-output-extraction`) already covers 34 sites in 22 `.rs` files for
   exactly this defect class. It does **not** currently match
   `run_gemini_ocr` — its anchor is `fn parse_*`/`extract_*` and this extraction
   is an inline `and_then` chain inside the request function. That is a **recall
   gap in a published rule**, not a new rule; §12.3 files it upstream.

**A census rule I explicitly considered and rejected on population, with the
number:** `feature-gated-cleanup-door` (built for the sibling
`vector-kb-ingestion` leaf) returns **3 matches in 2 files** against a positive
control of **230 in 137**. A 3-site ratchet in the subsystem its own document
describes is a comment with a runner attached. Recorded so the partition
(3 of 233 cleanup doors are behind a cargo feature) survives without the rule.

---

## §12 — Corrections

**12.1 — To my brief, on the spawn-site count, and the correction is large.**
The brief carried an inherited claim of *"6 real spawn sites in this tree, 2 of
them OCR"* and warned me not to trust it. Measured with two independent
implementations over all 963 `.rs` files:

| pass | result |
| --- | --- |
| A — line-scan for `Command::new(` incl. `TokioCommand`/path-qualified | **139 raw line matches** |
| B — bespoke: brace-matched `#[cfg(test)]` ranges + preceding-attribute scan | **135 constructions** + 4 skipped as comment/string |

The two reconcile exactly (139 = 135 + 4). Breakdown of the 135: **10** inside
`#[cfg(test)]`, **20** inside a platform-gated arm, **105** unconditional. Since
platform arms are mutually exclusive, **any single build contains ~115
production spawn sites**, not 6. The inherited figure is off by ~19×.

*(B's first version returned 120 and disagreed with A by 19. The cause was mine:
`\bCommand::new` does not match `TokioCommand::new`, because the boundary
between `o` and `C` is not a word boundary. Nine files' worth of `ffmpeg`,
`blender` and `whisper` spawns were invisible. Two implementations disagreeing
is what surfaced it — a single pass would have published 120 with confidence.)*

**12.2 — And the "2 of them OCR" half is a platform double-count of one site.**
Both matchers agree the OCR module contributes exactly two constructions,
`ocr/mod.rs:579` and `:596` — and they are the two arms of one
`#[cfg(target_os = "windows")]` / `#[cfg(not(target_os = "windows"))]` pair
inside a single `let output = { … }` block. **No build ever contains both.** So
OCR has **one** logical spawn site, and an audit that counts static occurrences
inflates by the number of supported platforms. Generalisation worth carrying:
*a static spawn census over-counts every `cfg(target_os)` pair by exactly one,
and the over-count is invisible because both arms are real code.* Tree-wide the
effect is **20 constructions → 10 sites**, i.e. ~7 % of the production total.

**12.3 — To [`structured-output-extraction`](./structured-output-extraction.md):
a recall gap in `model-reply-parser-without-a-reason`.** Its §2 is exactly
right for this leaf (*"never let a manufactured default reach a place that
cannot tell it apart from a real answer"*) and `run_gemini_ocr`'s
`.unwrap_or_default()` is a textbook instance — but its rule anchors on
`fn parse_*` / `extract_*` signatures and this extraction is an inline
`and_then` chain inside the HTTP request function. 34 matches in 22 files, none
of them `commands/ocr/mod.rs`. Same shape as the gap
`external-operation-explorer` §12.4 reports against `schema-driven-form`:
**a rule anchored on a naming convention is blind to the same defect written
inline**, and inline is where the newest code puts it.

**12.4 — To the spine: `convergence: "converged"` is contradicted, and the
direction is inverted.** I swept all five siblings (`personas-web` 1,088 files,
`brainiac` 1,071, `personas-cloud` 48, `vibeman` 2,060, `ascent` 950) for
`\bocr\b`. Result: **0 of 5 implement OCR.** `personas-web`'s 17 hits are
marketing copy *about this app's Gemini connector*
(`src/data/connectors.ts`, `src/data/guide/content/triggers.ts`) — a dependent
describing its upstream, not a witness (doctrine §5). So the label points at a
**5/5 silence**, and its direction is backwards in the same way
`embedded-terminal-session` found: Personas is the only repo in the cohort with
the problem, and it therefore owns the fleet's best *and* worst answer to it —
best being the identity-guarded cancellation registry (§7.9), worst being that
the registry serves one of two backends. **Fourteenth tested `convergence`
label; fourteenth failure.** Add it to the doctrine's ledger.

**12.5 — To my brief, on `ocr_documents` row counts.** The brief did not ask,
but the answer changes how §7 should be read: `ocr_documents` holds **0 rows in
the 2026-08-17 purge backup**, and that table was not among the 25 the purge
cascade touched. The surface has never run. Per the campaign's standing warning
I am not reporting any defect here as extinct or converged — the opposite: **an
untested unhappy path is where these defects are, and zero rows is why they are
still there.**

**12.6 — On `sides: "client"`.** Contradicted, and in the *inverted* form rather
than the "it was both" form (doctrine §5's seventh-contradiction shape). Every
deviation in §7 except 7.2 and 7.6 is server-side Rust; the client contributes a
substring match on an English error string and an eligibility predicate that is
too permissive. The frontend drawer is, on the whole, the better-written half —
it has an unmount-cancel effect, `announce()` calls for screen readers on
running/done/error, and a comment explaining why the done phase needs one. A
client-scoped brief would have found the two smallest findings in this document.
