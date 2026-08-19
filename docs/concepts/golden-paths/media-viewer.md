# Media viewer

> Situation node: `product-surfaces/canvas-and-media/media-viewer` · situation spine
> `sides: client` · `twoSided: true` · recurrence 5 · risk **low** · spine label
> `convergence: mixed`. Dimensions: ui · performance · function. Spine's own framing:
> *"Full-screen image/video/PDF viewing and a transport clock that doesn't thrash
> React."* Merged from two earlier leaves, *"Media lightbox viewer"* and *"Playback
> transport engine"*.
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0,
> §2, §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** Every path by which a local file's bytes reach a rendered element in this
> app, read in full: `commands/drive.rs` (55 KB — `resolve_safe`, `read_bytes_capped`,
> `managed_root`), `engine/src/path_safety.rs` (853 lines, all four resolvers),
> `DriveImageLightbox.tsx`, `useLazyImageThumb.ts`, `CompositionPreview.tsx`,
> `useTimelinePlayback.ts`, `BeatSidebar.tsx`, `ThreeViewer.tsx`, `ImageLane.tsx`,
> `useAudioWaveform.ts`, `useVideoThumbnails.ts`, `customIconStore.ts`,
> `src-tauri/tauri.conf.json`, `@tauri-apps/api/core.js`'s own `convertFileSrc`.
> Measured with **two independent implementations** of every count (a shared-instrument
> pass over `scripts/census/lib/instruments/stripComments.mjs`, and a bespoke
> character-level scanner with its own string/comment state machine) plus a full
> hand-verification of all 9 media tags in the tree. `$APPDATA` was enumerated on
> disk — **sizes and names only, never contents**. Convergence oracle: all five sibling
> checkouts swept read-only.
>
> **`cargo` was not available in this session.** No Rust was compiled. Every Rust claim
> is read off the tree.

---

## §0 — The headline

**This app has two doors onto local media and they enforce opposite policies. The
careful one is a subdirectory of the careless one, which makes its care decorative.**

Door 1 is IPC: `drive_read` → `resolve_safe(root, rel)` (`commands/drive.rs:377`),
which refuses an absolute path, refuses `..`, canonicalises to defeat symlinks, and
caps the read at 50 MB. It is a good resolver. `DriveImageLightbox` — the app's actual
lightbox, and the only surface that renders images, video *and* PDF — uses it.

Door 2 is the Tauri asset protocol, scoped in `tauri.conf.json:31-38` to `$APPDATA/**`.
On this machine `$APPDATA` = `%APPDATA%\com.personas.desktop`, and **the managed drive
root is `$APPDATA\com.personas.desktop\drive`** — `managed_root` joins `RELEASE_SUBDIR`
onto `app_data_dir()` in every non-debug build (`commands/drive.rs:355-359`). So door 1
spends a canonicalising, symlink-probing, cap-enforcing resolver proving that a caller
stays inside a directory **that door 2 publishes wholesale**, alongside `master.key`
(358 B) and `personas.db` (347,054,080 B).

That the scope is too wide is not a new finding — [`tauri-permissions-and-csp.md`
§7.B](./tauri-permissions-and-csp.md) established it and deferred the fix. What this
leaf adds is the part that is invisible from the config file:

1. **The exposure is not bounded by the app's own call sites.** That path's inventory
   table reads *"`convertFileSrc` call sites | **16** in 7 files"*. Measured twice here:
   **16 total occurrences in 6 files, of which 8 are calls, 6 are import bindings and 2
   are prose in comments.** More importantly the number does not mean what a reader will
   take it to mean. `convertFileSrc` is `window.__TAURI_INTERNALS__.convertFileSrc(...)`
   (`@tauri-apps/api/core.js:234-236`) — a synchronous **string formatter**. It performs
   no IPC, consults no scope, and validates nothing. The protocol handler serves the
   scope to anything in the renderer that can form a URL. Auditing 8 call sites audits
   the app's *usage*; it does not bound the *surface*.
2. **A containment guard is worth exactly the scope of the widest door onto the same
   bytes.** `resolve_safe` and `resolve_and_guard` are both correct and both are
   arguing about a directory the webview may already read by absolute path.
   `resolve_and_guard` (`path_safety.rs:244-251`) explicitly **blocks the app-data
   directory on the canonicalised path**; `assetProtocol.scope` explicitly **allows it**.
   Two security controls in one repository, on one directory, pointing opposite ways.

The transport half of this leaf has its own inversion, and it is cleaner. `useTimelinePlayback`
is a genuinely good imperative clock — 60 Hz in a ref, a subscribe fan-out, a stable
engine identity, `useLayoutEffect` ref alignment for React 19 concurrent rendering. Its
docstring states the contract: *"storing it in state would trigger a full re-render on
every rAF tick (≈60/s), which made the original media studio unusably laggy … Each
consumer then decides whether to touch the DOM directly … or call a local `setState`
scoped just to itself."* Of its four subscribers, three honour it.
**`CompositionPreview.tsx:59` is `useEffect(() => engine.subscribe(setCurrentTime), [engine])`**
— the raw 60 Hz clock piped straight into component state, in the one component that
renders the `<video>`, every `<audio>`, every image overlay and every text overlay. The
engine exists to prevent that exact line, and the largest consumer is the line.

---

## §2 — The one way

**Serve media through a protocol handler scoped to the one subdirectory the feature
owns, and never through a general-purpose byte-reading IPC command. Then key the
element by the identity of what it is showing, and keep the transport clock out of
React.** In order:

1. **Pick the door by what media needs, not by what is convenient.** A byte-returning
   IPC command (`drive_read` → `Blob` → `URL.createObjectURL`) buffers the whole file in
   the renderer, cannot answer a `Range` request, and therefore cannot seek, cannot
   start before the last byte lands, and must be capped — this repo caps it at 50 MB
   (`drive.rs:37`), so its own lightbox refuses any video larger than that. A protocol
   handler streams and answers ranges, which is what `<video controls>` requires. **The
   protocol handler is the right door for media.** The blob door is right for small,
   whole-file, non-seekable content (a thumbnail, a PDF you are handing to a sandboxed
   frame) and nothing else.
2. **Scope the handler to the feature's own subdirectory, and make the subdirectory
   exist for that purpose.** `"$DOCUMENT/Personas Media Studio/**"` is the one entry in
   this app's scope done right. `"$APPDATA/**"` is not a scope, it is the absence of
   one: it names the process's own private state directory, whose contents are chosen by
   every other feature in the app and grow without anyone re-reading the media policy.
   **A scope must name a directory whose entire future contents you are willing to
   publish.** If you cannot say that sentence about a path, it is not a scope entry.
3. **Do not let a containment resolver guard a subtree of a published root.** Before
   writing `resolve_within_root`-style code, enumerate every *other* door onto the same
   bytes. If a wider one exists, the resolver is documentation, not enforcement — fix
   the wider door first. This is the media analogue of the doctrine's
   serialization-boundary rule: a check downstream of where the value already escaped
   authenticates nothing.
4. **Key every media element by the identity of the media, not by its position.**
   `<video key={entry.path} src={url}>`. An `<img>` swaps its bitmap cleanly when `src`
   changes; `<video>`, `<audio>` and `<iframe>` do not — they keep buffered ranges,
   `currentTime`, `readyState` and paused state across a `src` change, so the user gets
   the previous clip's transport state under the new clip's bytes.
   `DriveImageLightbox.tsx:453-455` documents the symptom precisely and fixes it with a
   `key`; that is the site to copy.
5. **Revoke every object URL you create, keyed by the URL you created.** Not by a
   boolean. The revoke must be conditional on *this* URL still being the installed one
   (`if (urlRef.current !== url) return;`), and the effect that created it must revoke it
   in cleanup. `useLazyImageThumb` and `DriveImageLightbox:215-218` both do this.
6. **Keep the playback clock in a ref and let each consumer choose its own render
   granularity.** A 60 Hz value must never be component state in a component that
   renders media elements. Subscribe imperatively; write the DOM directly (a playhead's
   `transform`, a `<video>`'s `currentTime`), or `setState` only a *derived* value that
   changes rarely — `BeatSidebar.tsx:39-45` sets state only when the *active beat id*
   changes, which is the pattern.
7. **A viewer that fetches must have all three states and a cancel.** loading (a calm
   ghost, never a spinner), failed (a real message), ready — plus a `cancelled` flag
   checked after the await so navigating away mid-fetch does not paint the wrong file.
   `DriveImageLightbox:190-219` is complete on this and is the site to copy.

**Where the two halves meet:** the element `key` from step 4 and the clock from step 6
are the same discipline applied at two frequencies. Both say: identity changes force a
remount; value changes must not.

---

## §7 — Deviations

### 7.A — P0: the guarded door guards a subdirectory of the unguarded one

| | |
|---|---|
| **Where** | `src-tauri/tauri.conf.json:31-38` (scope) vs `src-tauri/src/commands/drive.rs:344-360` (root) |
| **Defect** | In every release build the managed drive root is `app_data_dir()/drive`, inside `assetProtocol.scope`'s `$APPDATA/**`. Every containment guarantee `resolve_safe` provides is available to the renderer by absolute path without it. |
| **Measured** | `$APPDATA\com.personas.desktop` holds **17 top-level entries**, including `master.key` (358 B), `personas.db` (347,054,080 B), `personas_data.db` (17,502,208 B), two `personas-cleanbak-*.db` (44,322,816 B and 30,126,080 B), `purge-backup-2026-08-17/`, `drive/`, `models/`, `logs/`, `crash_logs/`, `skill_scratchpads/`. Sizes and names read; **no contents opened**. |
| **Note** | In `debug_assertions` builds the root is `.dev-drive/` at the repo root, i.e. **outside** the scope — so the dev build does not exhibit this and the release build does. |

**Not applied.** This is a security control whose current setting may be deliberate and
whose change alters what the WebView may load — the runbook's own "note, do not apply"
list names both. The fix is already specified in `tauri-permissions-and-csp.md` §7.B
(replace `$APPDATA/**` with `$APPDATA/persona-icons/**`, `$APPDATA/media-studio/**`,
`$APPDATA/drive/**`); this leaf's contribution is that `$APPDATA/drive/**` is not a
nicety — it is the entry that makes `resolve_safe` mean something.

### 7.B — P1: three media elements rebind `src` with no remount key

Measured by census rule (below), **3 violating / 5 compliant — an exact partition of the
8 JSX media tags in the tree that bind `src` to an expression**. All 8 hand-opened.

| Site | Element | Why the src changes under it |
|---|---|---|
| `overview/sub_manual-review/components/FocusedDecisionCard.tsx:79` | `<video src={url}>` | the card is reused as the reviewer advances through decisions |
| `overview/sub_manual-review/components/ReviewFocusFlow.tsx:458` | `<video src={galleryImage}>` | the flow steps through gallery items in place |
| `artist/sub_media_studio/CompositionPreview.tsx:366` | `<video src={videoSrc}>` | `videoSrc` is recomputed every time the playhead crosses a clip boundary (`:99-103`) |

The third is the severe one: it is a *timeline* preview, so the src changes on an
ordinary playthrough, many times per composition, and each change lands on an element
still holding the previous clip's `currentTime`, `playbackRate`, `muted` and buffer.
`:120-151` then runs a threshold-based `currentTime` correction against that stale
element, so the visible symptom is a seek jump rather than an obvious break — which is
why it has survived.

`RadioFooter.tsx:583` is deliberately outside this population: it renders `<audio ref>`
with **no `src` prop at all** and assigns the stream imperatively. That is a legitimate
third answer and the rule correctly does not match it.

### 7.C — P1: the transport engine's one rule, broken by its largest consumer

`useTimelinePlayback.ts:6-12` states the contract. Four subscribers:

| Consumer | What it does with the 60 Hz callback | Verdict |
|---|---|---|
| `BeatSidebar.tsx:39-45` | derives the active beat id, `setActiveId(prev => prev === active ? prev : active)` | compliant — state changes only on a beat boundary |
| `PlaybackControls.tsx:41` | subscribes, local scope | compliant |
| `TimelinePanel.tsx:208` | `engine.subscribe(apply)` — imperative DOM write | compliant, and the best of the four |
| **`CompositionPreview.tsx:59`** | **`engine.subscribe(setCurrentTime)`** | **violating** |

`CompositionPreview` then derives eight `useMemo`s from `currentTime` (`:92`, `:99`,
`:106`, `:112`, `:249`, `:309`, `:317`, `:354`) and re-renders the `<video>`, the
`dedicatedTracks.map()` of `<audio>` elements, the image-overlay map and the text-overlay
map — at rAF rate. The engine's docstring names this exact regression ("made the original
media studio unusably laggy") as the reason it exists.

**Not applied.** The fix is a real refactor of a live surface (split the timecode readout
into its own subscriber, drive `<video>.currentTime`/opacity imperatively — `:164-168`
already writes `style.opacity` imperatively and shows the shape), not a one-line change,
and it changes what a surface the operator uses renders. Recorded, not applied.

### 7.D — P2: the blob door's cap is a functional ceiling nobody surfaces

`read_bytes_capped` (`drive.rs:919-931`) rejects any file over `MAX_READ_BYTES = 50 MB`
with a `Validation` error. `DriveImageLightbox` catches it into `state = "failed"` and
renders `t.plugins.drive.lightbox_failed` — one generic string. So a 60 MB video in the
managed drive is indistinguishable, to the user, from a corrupt file or a permissions
error. This is the cost of choosing the blob door for video (§2 step 1) and it is paid
silently.

### 7.E — P2: `ThreeViewer` and the media-studio hooks pass a path straight through

`ThreeViewer.tsx:126`, `useAudioWaveform.ts:42`, `useVideoThumbnails.ts:50`,
`ImageLane.tsx:108`, `CompositionPreview.tsx:102/406/485` all call
`convertFileSrc(<caller-supplied path>)` with no check of any kind. This is **not** a
defect on its own — `convertFileSrc` validates nothing anywhere, and cannot, so a check
at the call site would be theatre. It is listed because it is the deviation people will
*try* to fix, and fixing it accomplishes nothing: the guard has to be the scope (7.A).

`customIconStore.ts:80-85` is the contrasting site and the one to copy — it builds the
path from an app-owned root plus a content-hash id plus a fixed extension, so there is
no caller-supplied path to validate. That is withholding rather than checking.

### 7.F — Checked and cleared

- **Blob lifecycle.** `DriveImageLightbox:190-219` and `useLazyImageThumb:40-42` both
  revoke on cleanup and both re-check before installing. No leak found.
- **PDF isolation.** `DriveImageLightbox:472` renders the PDF frame with
  `sandbox="allow-same-origin"` — scripts, forms and popups blocked, with a comment
  saying why. Correct.
- **Keyboard scope.** The lightbox binds `keydown` on `document` and gates `+ - 0 R` on
  `kind === "image"` (`:151-180`); arrows and Escape are unconditional. Correct.
- **Filmstrip cost.** Thumbnails lazy-load and free their bytes on scroll-out
  (`useLazyImageThumb`), so a large folder does not hold N blobs. Correct.

---

## §9 — The gate

### Published: `media-element-src-without-remount-key`

**Condition the signal is a proxy for:** *a stateful media element is rebound to
different media without being torn down, so the previous media's transport state
survives underneath the new bytes.* An adopting repo must re-derive its own proxy —
this one keys on JSX attribute order and a React `key`, both of which are local idiom.

```json
{
  "id": "media-element-src-without-remount-key",
  "goldenPath": "docs/concepts/golden-paths/media-viewer.md",
  "title": "A <video>/<audio>/<iframe> bound to a changing src with no key to force a remount",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<(?:video|audio|iframe)(?:(?!\\bkey\\s*=)(?:=>|[^<>])){0,600}?\\bsrc\\s*=\\s*\\{(?:(?!\\bkey\\s*=)(?:=>|[^<>])){0,600}?[^=<>\\s]\\s*>",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a <video>/<audio>/<iframe> opening tag that binds src to an expression and carries no key= anywhere in the same tag. PROXY FOR: a stateful media element rebound to different media without a teardown, so currentTime / readyState / buffered ranges / paused state from the previous file survive under the new one. <img> is deliberately absent from the tag list: it holds no transport state and swaps its bitmap cleanly, so including it would flood the rule with correct code. TAG BOUNDARY: the tempered unit (?:=>|[^<>]) keeps the match inside one opening tag while tolerating an arrow function in an inline ref/handler (CompositionPreview.tsx:479 has ref={(el) => {...}} in the tag), and the terminator is [^=<>\\s]\\s*> rather than a bare > for the reason stateless-disclosure-control records: a bare > is satisfied by the > of an arrow. The key= exclusion is tempered on BOTH sides of src= so attribute order does not matter, though in this tree every compliant site happens to put key first. PARTITION: violating (3) + positive control (5) = 8 = every JSX media tag in the tree that binds src to an expression; the 9th media tag, RadioFooter.tsx:583, has no src prop at all (the stream is assigned imperatively to a ref) and is correctly outside both. Precision 3/3, every match hand-opened and confirmed to rebind src on an element that stays mounted.",
    "$comment": "Recall is deliberately partial: it cannot see a media element whose src is assigned imperatively through a ref (RadioFooter), nor one whose tag is generated by a wrapper component. Both are stated in the golden path rather than papered over."
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 1000
}
```

```json
{
  "id": "media-element-src-without-remount-key-positive-control",
  "goldenPath": "docs/concepts/golden-paths/media-viewer.md",
  "title": "POSITIVE CONTROL — the same media tags that DO carry a remount key",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<(?:video|audio|iframe)(?:=>|[^<>]){0,600}?\\bkey\\s*=\\s*\\{(?:=>|[^<>]){0,600}?\\bsrc\\s*=\\s*\\{",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "the compliant form — a key= on the same media tag that binds src. Anchors identically to the violating rule. Returns 5 matches across 4 files (DriveImageLightbox.tsx:451 and :464, CompositionPreview.tsx:479, AthenaAvatar.tsx:221, StudioPage.tsx:233), which with the 3 violating matches accounts for the whole population — so a zero here would mean the pattern broke, not that the codebase is clean."
  },
  "floor": 1000
}
```

**Validation.** Run standalone in a private scratch registry (`cmmedia-private-rules.json`),
**never** the full registry: `census OK — 2 rule(s), 4166 file-visits`, 2,083 `.tsx`
files walked against a floor of 1,000. Violating: 3 files / 3 matches. Control: 4 files
/ 5 matches. Both counts reproduced from the fences above after the document was
written.

**Hand-verified precision: 3/3.** I opened all three and confirmed in each that the
`src` expression is derived from state that changes while the element stays mounted
(`url` from the reviewed decision; `galleryImage` from the flow's current item;
`videoSrc` from `activeVideo`, recomputed on every playhead crossing). I also opened all
five control matches and the excluded `RadioFooter.tsx:583`.

**Site-level overlap against the FINAL pattern: 0.** Every `.tsx`-scanning rule in the
registry (95 of them) was run against the three violating files and no existing rule
matched within ±3 lines of any of the three sites. The nearest conceptual neighbour is
`unresettable-error-boundary` (`error-recovery`), which also treats *a missing `key`* as
the defect — for `<*ErrorBoundary>`. Two paths reached "a missing remount key is the
bug" independently, for two disjoint element classes. Disjoint anchors, zero shared
sites; worth naming so a later composer does not read them as duplicates.

**How it fails loudly.** Inherited from the runner: a walk under `floor: 1000` fails; a
rule matching zero files anywhere fails; a silent drop fails. The specific hazard here is
that a drop could mean *deletion* rather than a fix — the `sub_canvas` precedent. If this
baseline moves down, say which of the three causes it was in the commit **and here**.

### Declined: a gate on the asset-protocol exposure (7.A)

Already reasoned and declined by `tauri-permissions-and-csp.md` §9 — *"A rule could count
`$APPDATA/**`-shaped entries, but the defect is the relationship between the scope and
what is published."* I re-derived the same conclusion from this leaf's side and add one
number to it: **counting `convertFileSrc` call sites cannot be the gate either**, because
the function is a string formatter with no privilege. A rule over its 8 call sites would
report a clean codebase while the scope is unchanged — the contract's fifth failure mode,
a gate pointing at a destination that is not the problem. The census cannot express this
condition at all: it is a relationship between a config value and a directory listing,
i.e. an *absence* (nothing in the scope that should not be published), and the census
cannot assert an absence.

### Declined: a gate on the transport-clock rule (7.C)

The condition is *"a 60 Hz subscription writes component state in a component that
renders media"* — three facts in three places (`engine.subscribe`, a `setState` identity,
and what the component's JSX contains). The one lexical proxy that works,
`engine.subscribe(setSomething)`, has a population of **1** in this tree. A census rule
matching one site cannot ratchet, and at zero the runner fails it as broken. The honest
instrument is a code review rule, or `PlaybackEngine.subscribe`'s own signature —
see below.

### Prefer a type over a gate — and here one is available

7.C is a **Q5 (withholding beats requiring)** case and the fix is small.
`subscribe(cb: (time: number) => void)` hands every consumer the raw 60 Hz value and
trusts it to decide what to do with it. Three of four consumers decide correctly; one
does not, and it is the expensive one. Withhold the raw stream:

```ts
subscribeDerived<T>(select: (t: number) => T, cb: (v: T) => void): () => void;
```

`subscribeDerived` compares the selected value and only calls back on change. Then
`BeatSidebar`'s hand-written `setActiveId(prev => prev === active ? prev : active)`
becomes the framework's job, and `engine.subscribe(setCurrentTime)` becomes
unspellable — you cannot select `currentTime` itself into a per-frame `setState` without
writing the identity selector, which is visible in review in a way that
`subscribe(setCurrentTime)` is not. Keep raw `subscribe` for the imperative DOM writers
(`TimelinePanel`), which genuinely need every frame.

That is the fix. The census rule above is on 7.B, which has no type answer — React
gives no way to make a `key`-less remount unrepresentable on a host element.

---

## §12 — Corrections

### 12.1 — To my brief, and to `tauri-permissions-and-csp.md`

**The brief asked whether "the viewer has the same guard [as `resolve_and_guard`] or
assumes the scope is safe". Neither.** The app's actual lightbox does not use the asset
protocol at all — it reads bytes over IPC through `resolve_safe` and wraps them in a
blob. The surfaces that *do* use the asset protocol are the artist gallery and media
studio, and they are not lightboxes. Framing the question as "does the viewer guard its
path" presumes one viewer and one door; there are two of each, and **the finding is that
the guarded door's boundary lives inside the unguarded door's scope**, which no
per-call-site audit would have surfaced.

**Correction owed to [`tauri-permissions-and-csp.md`](./tauri-permissions-and-csp.md), §7.B
and the §0.5 inventory table.** Its row reads:

> `convertFileSrc` call sites | **16** in 7 files | all media/icon; none needs `$APPDATA`

Measured here twice, independently:

| | shared-instrument pass | bespoke scanner | published |
|---|---:|---:|---:|
| call sites (`convertFileSrc(`) | **8** | **8** | 16 |
| total occurrences | 14 (post comment-strip) | **16** (calls 8 + imports 6 + comments 2) | 16 |
| files | **6** | **6** | 7 |

So **16 is the occurrence count, not the call-site count**, and the file count is 6, not
7. The two implementations agree on 8/6 and reconcile the 14-vs-16 difference exactly
(the shared pass strips the 2 comment mentions before counting; the bespoke scanner
classifies them). The qualitative half of that row — *"all media/icon; none needs
`$APPDATA`"* — is confirmed: of the 8, seven are gallery/media-studio paths under
`$DOCUMENT`/`$PICTURE`/`$VIDEO`, and the eighth (`customIconStore.ts:82`) reads
`$APPDATA/persona-icons/`, which is why the fix that path proposes works.

**The second correction is the one that matters.** That row invites the reading that 16
(or 8) is the size of the exposure. It is not. `convertFileSrc` is
`window.__TAURI_INTERNALS__.convertFileSrc(filePath, protocol)` — verified by opening
`node_modules/@tauri-apps/api/core.js:234-236` — a synchronous string formatter with no
IPC, no scope consultation and no validation. **The number of call sites is a measure of
the app's own usage and is unrelated to what the scope permits.** Both halves of this
correction should land in that path's inventory table; the count is cosmetic, the
semantics are not.

### 12.2 — The spine's `convergence: mixed` label — **contradicted, and inverted**

Tested against all five sibling checkouts. Result: **1 of 5 has a local-media viewer at
all**, and its finding is not agreement but a *cost/failure* result — the strongest class
the oracle produces:

> **`vibeman`** renders local images through a lightbox/preview
> (`src/app/features/Context/sub_ContextPreview/components/PreviewDisplay.tsx`,
> `Goals/sub_ScreenCatalog/ScreenThumbnail.tsx`). Its **web** door is guarded —
> `src/app/api/disk/file/route.ts:62` calls `validatePathWithinAllowedRoots(fullPath,
> getAllowedRoots())` (`src/lib/pathSecurity.ts:70`) after `validateFilePath()`. Its
> **Tauri** door doing the identical job is not: `src-tauri/src/commands/fs_cmds.rs`
> `read_file` (:56-64), `write_file` (:66-75) and `batch_read_files` (:98-119) take a raw
> path, check `exists()`, and read — no canonicalise, no allowlist, no containment. The
> file's own header says these commands **replace** `/api/disk/file`.

That is my §0, in another codebase, reached by the same transition: **the containment
check did not survive the move from the web door to the native door.** Two independent
sightings of one mechanism.

The honest weighting, per the doctrine: `vibeman` is this repo's **ancestor** (dated
twice, on two prior leaves), so the standing instruction is to treat a shared shape as
possibly *inherited* rather than convergent. I did not date these specific files, so this
is at most a second sighting and at least a shared inheritance. **Either reading supports
the same prescription** (§2 step 3), which is why it is worth reporting despite the
ambiguity — and it is evidence about the transition, not about the answer's popularity.

The other four are silence: `brainiac` (0 sites), `personas-cloud` (no UI package at
all), `ascent` (generates PDFs server-side; renders no local file), `personas-web` (no
viewer). So `mixed` is wrong in the way the doctrine's ledger predicts — the cohort with
the condition is **1**, not 5, and "mixed" describes a spread that does not exist.

### 12.3 — `sides: client` — **contradicted**

The headline defect is a **server-side** config value (`tauri.conf.json`'s
`assetProtocol.scope`) interacting with a **server-side** path decision
(`managed_root`'s `RELEASE_SUBDIR`). Neither is client code and no client change fixes
either. `twoSided: true` is correct; `sides: "client"` names the half that carries the
*published census rule* (7.B, all React) and none of the half that carries the P0. This
is the eighth `sides: "client"` contradiction on the ledger; the mechanism here is that
**the client chooses which door to use, but the server decides what each door permits**,
so a client-scoped brief finds the call sites and never the scope.

### 12.4 — What I got wrong on the way, and what caught it

My first pass at the media-tag census rule tried to partition using two *separately
written* patterns for "guarded" and "unguarded". They overlapped: three sites
(`useUnifiedTriage.ts:506`, `useLayeredList.ts:126` and `:152`, on an earlier
`.then()`-based candidate) matched **both**, and anchor ≠ guarded + violating
(13 ≠ 7 + 8). A partition that does not add up is not a partition, and I would have
published a "precision" figure computed over overlapping sets. The fix was to derive the
control from the violating pattern by inverting one tempered negation, so the two are
complementary by construction rather than by hope — which is what produced the exact
3 + 5 = 8 above. **If your compliant and violating patterns were written independently,
check that they sum to the anchor before you trust either.**
