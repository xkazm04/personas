# Voice input and playback

> Situation node: `product-surfaces/canvas-and-media/voice-input-and-playback` ·
> situation spine `sides: client` · `twoSided: true` · recurrence 6 · risk **medium** ·
> spine label `convergence: mixed`. Dimensions: function · security · ui · performance.
> Spine's own framing: *"Speech to text through the chosen engine and spoken responses
> back."*
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0,
> §2, §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** Every speech-in and speech-out path in the tree, read in full:
> `voicePlayback.ts`, `chat/athenaChatAudio.ts`, `chat/athenaChatVoice.ts`,
> `useDictation.ts`, `useLocalDictation.ts`, `useSpeechInput.ts`, `useHoldToTalk.ts`,
> `Composer.tsx`, `orb/OrbQuickInputBar.tsx`, `orb/AthenaOrbLayer.tsx`,
> `CompanionFooterIcon.tsx`, `onboarding/components/useTourNarration.ts`,
> `sub_voice/{VoicePanel,KokoroVoicePanel,PocketVoicePanel,SttPanel,voiceEngineShared}`,
> and on the Rust side `companion/tts/{mod,kokoro,pocket,sherpa_engine}.rs`,
> `companion/stt/{mod,whisper,catalog}.rs`, `companion/jobs/connector_use.rs`.
> **Both channel implementations were executed, not read**: `athenaChatAudio`'s
> `playMain`/`playProgress` and `useTourNarration`'s `speak` were transcribed verbatim
> into two Node harnesses with instrumented fakes for `HTMLAudioElement` and
> `URL.createObjectURL`, and driven through the same five scenarios. Static counts have
> two independent implementations. Convergence oracle: all five sibling checkouts swept
> read-only.

---

## §0 — The headline

**`athenaChatAudio.ts` opens with the sentence "Two exclusive audio channels, so Athena
can never talk over herself." Executed against its own code, she does — in 2 of 5
scenarios — and the clip left speaking is the stale one, with no handle left that can
stop it. The correct implementation is 40 lines away in the same repository, calling the
same two functions.**

Both channels guard exclusivity by holding an `HTMLAudioElement` in a ref and pausing it
before starting the next clip. That guard is sound while the element exists. It does not
exist during synthesis — the `synthesizeTts()` IPC round-trip to a local Kokoro or
Pocket sidecar — and every teardown path in the file runs through the same
`audioRef.current?.pause()`, which is a no-op against a request that has not resolved.

Replaying the file's own logic:

| scenario | max concurrent clips | audio live at end |
|---|---:|---|
| S1 — A finishes, then B is requested | 1 | — |
| **S2 — two `playMain` inside the synthesis window** | **2** | **2** |
| **S3 — two `playProgress` inside the synthesis window** | **2** | **2** |
| S4 — progress in flight, reply lands (`pendingPlayback` set) | 0 | 0 |
| **S5 — panel unmounts during synthesis** | 1 | **1** |

S2 is not a hypothetical: the file's own header names *"back-to-back turns (a
non-blocking composer send, an autonomous beat)"* as the situation it was written for.
S3 is worse than an edge case — `athenaChatVoice.ts:126-140` fires `playProgress(beat)`
inside a `for` loop with **no await**, so two `PROGRESS:` lines completing in one
streaming tick dispatch microseconds apart, both land in the same synthesis window every
time. And in both, the ordering is inverted: the **later** request resolves first and
plays, then the **earlier** one starts on top of it — and because the finally-guard is
`if (mainUrlRef.current !== url) return;`, the element that is still making sound is
precisely the one whose blob URL is never revoked and whose handle nothing holds.
`stopMain()` can no longer reach it. S5 is the same defect wearing a worse costume:
Athena begins speaking *after* the panel closed and cannot be stopped for the rest of
the clip.

S4 is the tell. It passes because `playProgress` re-checks a token **after** the await
(`if (useCompanionStore.getState().pendingPlayback)`, `:70`). One of the four
continuations in the file does the right thing; the author knew the shape and applied it
once, to the cross-channel case, and not to either same-channel case.

The answer already exists here. `onboarding/components/useTourNarration.ts` imports
`synthesize` and `play` from the same `voicePlayback.ts`, and takes a monotonic
generation token (`const gen = ++genRef.current`, `:96`), re-checks it before
constructing the element (`if (gen !== genRef.current) return;`, `:101`), and increments
it in **all three** teardown paths — the effect's silent branch (`:153`), the unmount
cleanup (`:166`) and mute (`:174`). Driven through the identical harness, the identical
five scenarios:

| | `athenaChatAudio` | `useTourNarration` |
|---|---:|---:|
| scenarios with overlapping playback | **2 / 5** | **0 / 5** |
| teardown scenarios leaving audio live | **2 / 2** | **0 / 2** |

Same primitives, same file dependency, same author, opposite outcome — and the surface
that promises exclusivity in its header is the one that does not have it.

---

## §2 — The one way

**Own the channel, not the element. Take a monotonic token before the first await, check
it after every await and before installing anything, and bump it in every path that
means "stop". Then never hand a caller a raw media element.** In order:

1. **One channel object per concurrent stream, and name the streams.** This app has
   exactly two — filler and reply — and that decomposition is right. What must be per
   channel is not a ref but a *token plus a ref*: `genRef`, `audioRef`, `urlRef`.
2. **Claim the token synchronously, at the top of the entry function**, before any
   `await` or `.then`. `const gen = ++genRef.current;` This is what makes the second
   caller win by construction rather than by luck of latency.
3. **Re-check the token immediately after every await, before touching anything.**
   `if (gen !== genRef.current) { URL.revokeObjectURL(url); return; }` — revoke on the
   discard path too, or a superseded synthesis leaks its blob forever. An element handle
   is not a substitute: it does not exist during the window it would have to cover.
4. **Bump the token in every path that means "stop"** — a supersede, an explicit stop, a
   mute, a route change, and the unmount cleanup. Enumerate the teardown paths and
   verify each one increments; a stop that only pauses the element is a stop that fails
   exactly when a request is in flight.
5. **Do not return a raw `HTMLAudioElement` to a caller.** `voicePlayback.play(url)`
   returns `{ audio, done }` "so callers can pause it", and that handoff is the whole
   defect: it makes every caller responsible for a race across an await, and only one of
   this repo's two callers gets it right. Return a channel with `speak(text)` /
   `stop()`, own the token inside, and the mistake is unspellable. **Withhold the
   dangerous freedom (the element across the gap), not the answer (whether it is
   speaking).**
6. **Speech input: guard the permission prompt as an async gap too.** `getUserMedia`
   opens an OS dialog; a second trigger during it acquires a second `MediaStream` and
   overwrites the first ref, leaving a live microphone with no owner. Hold a
   `pendingStart` flag to reject re-entry and an `abortStart` flag so a release or
   unmount during the prompt stops the stream the moment it arrives.
   `useLocalDictation.ts:129-135, 168-225` is the site to copy.
7. **A denied microphone is a user-facing error on the surface the user pressed.** Not a
   console line, not an amber tint on a button they are not looking at, and never
   `reset()`. Route it to the same error door as everything else (`toastCatch` for the
   user, Sentry for you) — the doctrine's measured **760 try/catch bodies that reach no
   error door at all** is what "it's handled, there's a state field" turns into.
8. **Say where the audio goes.** Browser `SpeechRecognition` on WebView2 ships the user's
   speech to a cloud endpoint owned by the browser vendor. `useDictation.ts:9-14`
   documents this and requires an explicit click — keep that, and surface it in the UI
   next to the engine picker, not only in a docstring.

**Interaction with a neighbour's prescription.** `athenaChatVoice.ts` follows the
structured-progress pattern (fire a beat as soon as its line completes) and this path
says every `play` must claim a token. Followed together they are consistent — but the
beat loop must claim the token *per beat inside the loop*, not once before it, or the
last beat silently wins and the earlier ones are discarded rather than queued. If beats
are meant to be heard in order, that is a queue, not a supersede, and the channel needs
to say which it is. Today it is neither: they overlap.

---

## §7 — Deviations

### 7.A — P0: the two audio channels overlap across the synthesis gap

`src/features/plugins/companion/chat/athenaChatAudio.ts` — `playMain` (`:89-113`) and
`playProgress` (`:62-87`).

| continuation | re-checks after the await? | result |
|---|---|---|
| `playProgress` → `pendingPlayback` (`:70`) | **yes** | S4 passes |
| `playProgress` → its own supersede | no | **S3: two clips** |
| `playMain` → its own supersede | no | **S2: two clips** |
| unmount cleanup (`:116-119`) | n/a — pauses a null ref | **S5: audio starts after unmount** |

1 of 4 guarded. Measured by execution (harness output above), and confirmed statically:
`athenaChatAudio.ts:68` and `:95` are 2 of the **11 unguarded** `.then()` continuations
that install into a ref, out of 20 in the tree (see §9).

**Not applied.** Changing when Athena speaks changes a live surface the operator uses
daily. → **deferred-fixes register.**

### 7.B — P1: `voicePlayback.play()` hands out the element, on purpose, with a stale reason

`voicePlayback.ts:41-78`. The docstring justifies a fresh element per call —
*"so browsers don't reject `play()` calls on rapid successive triggers due to their
'media element already playing' guard"* — and that reasoning is about **element reuse**,
which nobody proposed. It does not address exclusivity, and the function returns the
element specifically so callers can enforce exclusivity themselves. It is the shared
primitive for both consumers and it pushes the hardest part of the problem onto each of
them independently. See the type proposal in §9.

### 7.C — P1: three of four voice-input surfaces discard the microphone error

There are four surfaces that can arm the microphone:

| surface | hook | reads `error`? |
|---|---|---|
| `Composer.tsx:322-350` (panel composer mic) | `useSpeechInput` | **yes** — amber tint + `title={t.plugins.companion.dictate_error}` |
| `orb/OrbQuickInputBar.tsx:42` | `useSpeechInput` | no — reads `supported`, `listening`, `finalText`, `interimText` only |
| `orb/AthenaOrbLayer.tsx:49` (the floating orb) | `useHoldToTalk` | **cannot** — `HoldToTalk` has no `error` member; the string `error` appears **0 times** in `useHoldToTalk.ts` |
| `CompanionFooterIcon.tsx:123` (footer mic) | `useHoldToTalk` | **cannot**, same |

**1 of 4.** And the two that cannot are the always-available ones — the affordances a
user reaches without opening the panel. Worse, `useHoldToTalk.stop()` (`:65-73`) takes
its `else` branch precisely when the mic never went live (the permission-denied case) and
calls `dictation.reset()`, which sets `error` to `null` in both engines
(`useDictation.ts:148`, `useLocalDictation.ts:289`). **The orb path does not merely fail
to show the error; it erases it.** The user presses and holds, nothing happens, nothing
is said, and nothing is recorded.

Reporting to Sentry splits by engine, and the default is the worse half:
`useLocalDictation` calls `silentCatch('useLocalDictation.start.getUserMedia')` (`:218`)
so a denial reaches Sentry; `useDictation`'s `r.onerror` (`:115-117`) only calls
`setError` — the default browser engine's `not-allowed` reaches **no error door at all**.

**Partially applicable.** Widening `HoldToTalk` to expose `error` is additive and
type-only; rendering it changes a live surface. → **deferred-fixes register**, with the
type widening called out as the safe half.

### 7.D — P2: `useTourNarration` never revokes its cached URLs

`useTourNarration.ts:84, 136` caches one object URL per tour step in `urlCacheRef` so
replay does not re-hit the engine — a good decision — and there is no unmount path that
revokes them. A full narrated tour holds one blob per step for the life of the document.
Small (`voicePlayback.ts:22` puts a clip at ~50-300 KB) and bounded by step count, so
P2, but it is the one thing this otherwise-exemplary file gets wrong and it should not
be copied along with the rest.

### 7.E — Checked and cleared, and worth copying

- **`useLocalDictation` is the strongest async-lifecycle code in this feature.**
  `pendingStartRef`/`abortStartRef` cover the permission-prompt window in both
  directions (`:189-224`), and `transcribeIdRef` (`:144, :257, :261, :265, :287`) is
  exactly the monotonic token `athenaChatAudio` is missing — applied to the
  *transcription* gap by the same author who left the *synthesis* gap open.
- **`useSpeechInput.ts:20-41`** force-stops the now-inactive engine when the user
  switches engines mid-capture, with a written explanation of the leak it prevents.
  Correct, and unusual.
- **The 16 kHz contract** (`useLocalDictation.ts:28-65`) is resampled client-side rather
  than assumed, because WebKit ignores `new AudioContext({ sampleRate })`. The Rust
  validator hard-rejects anything else. A claimed format checked on both sides.
- **Cloud disclosure** for the browser STT engine is written down at `useDictation.ts:9-14`
  and the mic is never armed on mount.

---

## §9 — The gate

### Declined, with numbers

The condition is *"a resource captured across an async gap is installed without
re-checking that the request is still current"*. I built the instrument, measured the
population twice, and it does not support a census rule.

**Population.** Over 4,801 non-test `.ts`/`.tsx` files: **20 `.then()` continuations that
write a `*Ref.current`**, of which **9 carry a staleness re-check before the write and 11
do not** (implementation 1 — shared `stripComments` + a balanced-paren continuation
extractor). The 11 include both `athenaChatAudio` sites, and also
`useLayeredList.ts:126` and `:152` (a pagination cursor overwritten by a stale page) and
`useByomSettings.ts:101` — so the condition is real and not local to voice.

**Why it cannot be a census rule.** Implementation 2 wrote the compliant and violating
forms as two separate regexes and ran them through the census engine's own semantics:

| pattern | files | matches |
|---|---:|---:|
| anchor (any then-continuation installing into a ref) | 11 | 13 |
| "unguarded" | 7 | 8 |
| "guarded" | 6 | 7 |

**8 + 7 = 15 ≠ 13**, and three sites (`useUnifiedTriage.ts:506`,
`useLayeredList.ts:126`, `:152`) matched **both**. The two patterns are not
complementary, so neither count is a partition of the anchor and any "precision" figure
over them is arithmetic on overlapping sets. Beyond that:

- **Precision would be poor even if the partition held.** `useCopyToClipboard.ts:42` and
  `useKeyedCopyFlag.ts:35` write a `timerRef` after an await — correct code, and a gate
  that fires on correct content is worse than no gate.
- **Recall is bounded by a hand-written guard vocabulary** (`cancelled`, `alive`,
  `aborted`, `reqId`, `generation`, …). The doctrine's earning case for that hazard is
  exactly this shape, and my own instrument demonstrated it: it classified
  `useLocalDictation.ts:193` as unguarded because the guard (`if (abortStartRef.current)`)
  sits *after* the first ref write rather than before it. That site is compliant, and the
  instrument said otherwise.
- **The three-fact structure is AST-shaped.** "A token was claimed before the await" is
  not visible from the continuation alone; it lives in the enclosing function.

**Cost was measured too:** each candidate pattern took ~8 s over the tree, three times
what the registry's heaviest existing rule needs, for a signal that cannot partition.

Per §4 of the doctrine, refusing to gate is a first-class outcome and these are the
numbers that produced the refusal. **The right instrument here is an ESLint rule with
`RuleTester` fixtures** — it can see the enclosing function, so it can key on the real
condition ("a `Ref.current` assignment inside a promise continuation whose enclosing
function claims no token") instead of on a vocabulary. That is a specification, not a
rule I am shipping.

### Prefer a type over a gate — and here it is the whole answer

7.A and 7.B are one **Q5 (withholding beats requiring)** case, and Q5's earning case in
the doctrine is the closest possible analogue: three sibling doors on one axis, where
withholding the dangerous value scored 8/8 and handing it back scored 0/2.

Today `play(url): { audio: HTMLAudioElement; done: Promise<void> }` **hands back** the
element. Two callers; **1 of 2 correct**. That is a better ratio than the doctrine's
hand-back case and it is still a coin flip, and the correct one is the tour, not the
chat.

Withhold it:

```ts
// voicePlayback.ts
export interface SpeechChannel {
  /** Supersedes anything this channel is doing, including an in-flight synthesis. */
  speak(text: string, opts: SynthOpts): Promise<void>;
  /** Stops and invalidates everything in flight. Idempotent. */
  stop(): void;
}
export function createSpeechChannel(): SpeechChannel;
```

`createSpeechChannel` owns `genRef`, `audioRef` and `urlRef`; `speak` claims the token
before its first await and re-checks after; `stop` bumps it. Callers never see an
`HTMLAudioElement`, so S2, S3 and S5 stop being expressible — and `useTourNarration`'s
hand-rolled generation logic and `athenaChatAudio`'s two channels both collapse into two
`createSpeechChannel()` calls. **Q6 check** (withhold the dangerous freedom, not the
answer): callers keep everything they actually use — "is it speaking", "stop it", "tell
me when it ends". What they lose is the ability to hold an element across an await, which
is the only thing either of them got wrong.

**Q3 check** (a type nobody constructs constrains nothing): there are exactly 2
construction sites and both would be migrated in the same change, so the type is not
aspirational.

The census rule that would ratchet this while it lands does not exist, for the reasons
above — so this fix has no ratchet, and that is stated rather than papered over.

---

## §12 — Corrections

### 12.1 — To my brief: all three questions had an answer, and two of them had the wrong shape

**"What happens when playback is interrupted mid-utterance?"** — Two different things,
and the brief's phrasing presumes one. Interrupted *while a clip is playing*: correct —
`stopMain`/`stopProgress` pause the element and revoke the URL. Interrupted *while the
clip is being synthesised*: the interrupt is a **no-op**, and the clip begins playing
after the interrupt, with nothing left holding it (S5). The window is not small: it is a
local sidecar synthesis, hundreds of milliseconds to seconds.

**"Whether a second play call stops the first or overlaps it."** — **Both, and which one
you get depends on latency.** Sequentially it stops (S1). Inside the synthesis window it
overlaps, and the surviving clip is the stale one (S2, S3). A question framed as "does
it stop or overlap" cannot be answered by reading the code, because the answer is a race;
it took executing the code to find that the *later* request wins the play and the
*earlier* one wins the survival.

**"Whether microphone permission failure is reported or swallowed."** — The brief warned
against assuming a failure surfaces, and that warning was correct but aimed one level too
low. The failure **is** captured — both engines set an `error` state, and one of the two
also reaches Sentry. It is **discarded one layer up**, by the hook the two most-used
surfaces consume, which does not expose the field at all and calls `reset()` on the exact
path a denial takes. The doctrine's *"760 try/catch bodies that reach no error door"* is
about catch bodies; this is a different and slightly worse shape — **a well-formed error
value that is deliberately not part of a hook's public interface**, which no catch-body
instrument can see.

### 12.2 — The spine's `convergence: mixed` label — **contradicted; the fleet converged on the disease**

Cohort established for this leaf, at measurement time: **1 of 5 siblings has spoken
output at all**; `brainiac`, `personas-cloud` (no frontend package), `ascent` and
`vibeman` return **0 sites**. (`vibeman`'s single grep hit,
`src/app/projects/ProjectAI/ScanIdeas/example.json:21`, is captured sample data from an
unrelated third-party project used as fixture input to its idea scanner — not executable
code, and correctly excluded.)

The one sibling that speaks, `personas-web` (`src/lib/review-voice.ts`), uses
`window.speechSynthesis` and has **no `speechSynthesis.cancel()` anywhere in the file**
and no generation token. Its only de-duplication is a `navigator.locks` request keyed by
review id (`:196-208`), which stops *another tab* re-speaking *the same* review and does
nothing about a different utterance in the same tab — consecutive calls queue in the
browser's native utterance queue. **Different mechanism, same omission.**

So the label is wrong in the mode the doctrine names as the one an agreement-counting
oracle reads backwards: **perfect agreement on an omission.** 1 of 1 siblings with the
condition also lacks the supersede guard. That is evidence the problem is easy to miss
and evidence *against* an external answer existing to adopt — not evidence that no answer
is needed.

**Stated as self-comparison:** Personas is ahead of the fleet here, and ahead of itself
in only one directory. `useTourNarration.ts` is the only correct implementation of
audio supersede-across-an-async-gap in six repositories. It should be the thing that is
copied, and today the codebase copies the other one.

### 12.3 — `sides: client` — **upheld**, and for a nameable reason

Ninth test of this value; the first two upholdings were leaves about the DOM. This is a
third structural reason and it is worth recording: **the client owns the media element
and the microphone, and the server has no representation of either.** The Rust side of
this leaf (`companion/tts/*.rs`, `companion/stt/*.rs`) is a request/response synthesiser
and transcriber — it is handed text and returns bytes, is handed a WAV and returns text,
and holds no notion of "currently speaking". There is nothing for it to supersede. Every
deviation in §7, the whole of §2, and the declined gate are client-side, and `twoSided:
true` is right only in the weak sense that both halves exist, not in the sense that the
contract between them carries any of the risk.

### 12.4 — A published claim I checked and did not overturn

`.claude/CLAUDE.md` names `executionSink`'s `generation` counter as the repo's best
answer to a stale-copy problem. It is the same mechanic as `useTourNarration`'s `genRef`
and `useLocalDictation`'s `transcribeIdRef`, applied to a third resource. **Three
independent reinventions of a monotonic-token supersede guard inside one repository**,
none of them sharing code, and the fourth site that needs it does not have it. That is
not a correction — it is the strongest available argument that §9's type belongs in
`voicePlayback.ts` rather than in a fourth hand-rolled copy.
