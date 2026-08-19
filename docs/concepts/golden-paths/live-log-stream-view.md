# Golden path — Live log stream view

> Situation node: `backend-runtime/subprocess-and-io/live-log-stream-view` ·
> [situation spine](../situation-spine.md) · recurrence 33 · risk **medium** ·
> sides: **client** · `twoSided: true` · convergence: **mixed** ·
> dimensions: **ui · performance · function**
> merged from *Log tail viewer*, *Live log stream surface*, *Streaming CLI output*,
> *Streaming output rendering*.
> Composed 2026-08-16 against `master` @ `17d059b1f`.
>
> **Sweep size.** All **4,829** `src/**/*.{ts,tsx}` files (the census walk's own
> count, matching [`shared-facts.json`](../shared-facts.json) `frontend.tsFiles`
> + generated) and **963** `src-tauri/**/*.rs`. Every one of the **26**
> line-bearing Tauri event channels enumerated from `eventRegistry.ts`'s payload
> map and traced to its subscribers on both sides. `executionSink.ts`,
> `useCorrelatedCliStream.ts`, `terminal/TerminalBody.tsx`,
> `progress/TerminalBody.tsx`, `background_job.rs`, `fleet/registry.rs`'s
> `OutputRing`, `fleet/pty.rs`'s reader loop, `engine/src/parser.rs` and the
> `runner/mod.rs` stream loop read in full. All **19** `scrollTop = scrollHeight`
> pins in the tree opened and hand-read.
>
> **Measured by execution, not by reading.** The operator's real corpus —
> **2,998 execution log files / 430,731,004 bytes (410.8 MB)** — was walked
> line by line **three times**: once for shape, once through a **faithful
> transliteration of `parse_stream_line`'s display arm** (so every byte the live
> view would have received was reconstructed), and once through a second,
> independently-written classifier that never parses JSON. The two disagreed on
> **1,403 of 268,482 bodies (0.52%)** and chasing that disagreement found a real
> defect in the shipping parser *and* a defect in my own instrument (§12). The
> silence structure of every run was reconstructed from the log timestamps.
> A **read-only copy** of `personas.db` (347 MB) supplied the 2,188 execution
> rows; it was deleted afterwards. The §9 rule and its positive control were
> validated through the real census runner in a scratch registry unique to this
> composer, then **re-extracted from this finished document and re-run** —
> identical. Five sibling checkouts swept for convergence.
>
> **`cargo` was not run.** **No secret value, prefix, or partial appears anywhere
> in this document** — every credential finding is reported as shape, count and
> file count only.
>
> **Adjacent leaves — cross-reference, do not absorb.**
> [`long-running-job-progress`](./long-running-job-progress.md) owns the job's
> **status, snapshot and staleness** — `BackgroundJobManager`'s four sweeping
> readers, the `live: bool` fusion, `emit_line` vs `record_line` as a *progress*
> decision. This path owns the **bytes**: the ring they land in, the clamp, the
> render, the scroll, and what the reader sees at the end.
> [`backend-to-frontend-events`](./backend-to-frontend-events.md) owns the
> **channel** — the name, the payload struct, the subscription primitive, the
> `execution_id` discriminator. This path owns what you do with the payload after
> the discriminator check passes. §6 records a **collision** between its
> prescription and this one.
> [`page-loading`](./page-loading.md) owns a surface fetching a finite result;
> a stream has no "loaded" state, which is why its empty states are different.
> [`secret-and-pii-redaction`](./secret-and-pii-redaction.md) owns which sinks
> are masked. It measured the *disk* sink and the *read* command. **This path
> measured the third one, which neither it nor anything else has looked at.**
> [`terminal-state-and-recovery`](./terminal-state-and-recovery.md) owns what
> the row says when the run dies. This path owns what the *viewport* says.

> **Post-publication note — 2026-08-17: this leaf's rule has an unstated recall limit.**
> `unconsulted-tail-pin` anchors on `.scrollTop = .scrollHeight` and therefore cannot see
> the equivalent written as `scrollTo({ top: …scrollHeight })`.
> `useAutomationSetup.ts:238-241` is exactly that shape and is **unguarded** —
> hand-verified by the `streaming-chat-transcript` composer, whose independent pass found
> 22 pins of which 14 are unguarded. The baseline (13) is **not wrong**; it is the count
> of one spelling. Stated rather than silently widened: changing the anchor is a pattern
> change that owes a full re-validation and a fresh precision figure, and a rule whose
> recall limit is written down is honest, while one that is quietly widened between waves
> is not reproducible.

---

## The headline: every cap in this design is 25× to 230× too large to have ever fired, and the one thing that actually reaches the user's screen is the one thing nothing masks

Replaying the real corpus — 2,998 runs, 268,482 stream lines, reconstructed
through the exact display arm the backend uses:

| the mechanism | the constant | the corpus's actual worst case | headroom |
| --- | ---: | ---: | ---: |
| `executionSink` byte budget → truncation banner + tail mode | **10 MB** | **44,612 chars** in the largest run | **230×** |
| `executionSink` ring (drop-oldest) | **10,000 lines** | **401** display lines | **25×** |
| `useCorrelatedCliStream` ring | **5,000 lines** | 401 | 12× |
| backend `MAX_OUTPUT_BYTES` → `[output truncated]` | **10 MB** | **1,227,235 bytes** (largest log file) | **8.5×** |
| `background_job.rs` ring | 500 lines | 401 | 1.25× |
| **`executionSink` per-line clamp** | **4,096 chars** | **19,433** | **fires on 2,394 lines (1.82%)** |

**Zero of 2,998 runs tripped the byte budget. Zero tripped either line ring. The
`[RUNNER] stdout truncated` marker appears in zero log files.** The truncation
banner, `formatTruncationNotice`, the 200-line `tailRing`, the 500 ms
`TAIL_FLUSH_INTERVAL_MS` throttle, the frozen-ring hand-off — an entire second
operating mode of the sink — has never run outside a unit test.

The cap that *does* fire is the per-line one, and it fires on the wrong axis:
**p99 of a display line is 6,764 characters**, so the 99th-percentile assistant
message is cut at 4,096 with `...[truncated]` and there is no way to see the rest
in the live view. Meanwhile **27.62% of emitted "lines" (36,251) contain embedded
newlines** — one event is many visual rows — so "10,000 lines" was never a bound
on anything the user can see.

### 1 — the live stream is the only one of the three log paths with no redactor

Three paths carry the same subprocess output. Two were hardened. The third is
the one a human actually watches.

| path | site | masked? |
| --- | --- | --- |
| **to disk** | `engine/src/logger.rs:61` `sanitize_secrets(msg)` | **yes** — landed 2026-08-14, doc comment `:36-57` states the measurement |
| **read back from disk** | `commands/execution/executions.rs:658`, `:703`, `:716` | **yes** — and `:646-657` is a nine-line comment naming *the copy button* as the reachable path |
| **the live stream** | `engine/runner/mod.rs:2179-2188` | **no. Nothing.** |

The three statements are 15 lines apart:

```rust
// src-tauri/src/engine/runner/mod.rs:2173-2188
logger.log(&format!("[STDOUT] {}", line.trim()));          // ← masks ITS OWN copy
let (line_type, display) = cli_provider.parse_stream_line(&line);   // ← the RAW line
if let Some(ref display_text) = display {
    emit_to(&*emitter, event_name::EXECUTION_OUTPUT,
        &ExecutionOutputEvent { execution_id: …, line: display_text.clone() });  // ← unmasked
}
```

`sanitize_secrets` returns a new `String`; `line` is untouched. The emitted
display text is derived from the unsanitized line **in every case**.

Replayed over the corpus, the display text that reached the screen carries:

| shape | matches in display text | files |
| --- | ---: | ---: |
| Windows user path (`C:\Users\<name>`) | **8,379** | 1,850 |
| POSIX home path | **6,230** | 1,635 |
| email address | **698** | 345 |
| labelled `key = <16+ chars>` assignment | **44** | 35 |
| Google-API-shaped | **9** | 9 |
| GitHub-PAT-shaped | **2** | 2 |
| PEM `BEGIN … PRIVATE KEY` header | **1** | 1 |

**15,363 sensitive matches reached the live terminal unmasked**, and these are a
**lower bound**: they were recovered from log files that have been sanitized on
write since 2026-08-14, whereas the emit path never was.

And it does not stop at the screen. **`ExecutionTerminal.tsx:42` is
`copyToClipboard(lines.join('\n'))`** — the whole live buffer, verbatim — and
`ExecutionMiniPlayer.tsx:62` is the same call on the same buffer. That is the
identical affordance whose existence is written down as the *reason* the read
command was hardened, sitting on the one source that was not.

### 2 — `log_truncated` records a different event from the one it names, and both are zero

`runner/mod.rs:2759` is `let log_truncated = logger.had_write_errors();` — an
**I/O error** flag. `ExecutionLogViewer.tsx:13-15` documents it as "the backend
flagged this log file as possibly incomplete (dropped output due to a write
error)", which is honest, and `:96-101` renders a warning banner from it.

Measured on the live database: **`log_truncated = 0` on all 2,188 rows.**

The real cut-off is 40 lines away at `runner/mod.rs:2154-2166`, sets a **local
`bool` that is never read again** (`output_truncated`, declared `:2013`,
assigned `:2156`, read nowhere), and writes a line into the log file prefixed
`[RUNNER]`. It has fired **zero times in 2,998 runs**. And if it ever did, the
notice would be invisible after a reload — see (3).

The frontend's *own* 10 MB cut-off (`executionSink.ts:20`) is a third,
independent truncation event that reaches no column, no event and no row.
**Three truncation mechanisms, one column, and the column is wired to the one
that is not truncation.**

### 3 — reload replays the ordinary output and drops exactly the exceptional output

`get_execution_log_lines` (`executions.rs:672-727`) is the reload path.
Its filter is `line.find("[STDOUT] ")` at `:702` and `:715`.

Measured over the corpus: **347,145 log lines, 268,482 (77.34%) contain
`[STDOUT] `. 78,663 lines — 22.66% — are dropped by the replay.** They are
dropped by *class*, not at random:

| prefix | lines in corpus | survives reload? |
| --- | ---: | --- |
| `[STDOUT]` | 268,482 | yes |
| *(no prefix — `Process exited with code:`, `Duration:`, …)* | 59,489 | **no** |
| `[MEMORY]` / `[EVENT]` / `[MESSAGE]` / `[FLOW]` / `[KNOWLEDGE]` / `[LEARNING]` / `[REVIEW]` | 18,624 | **no** |
| `[TIMEOUT]` | 18 | **no** |
| `[CANCELLED]` | 2 | **no** |
| `[RUNNER] stdout truncated` | 0 | **no** |

Every one of those is emitted to `EXECUTION_OUTPUT` while the run is live and
shown in the terminal. After F5 they are gone. **The stderr line
(`runner/mod.rs:2615-2624`, emitted as `[ERROR] …`, logged as `[STDERR] …`), the
timeout line (`:2628-2637`), and the truncation notice are precisely the three
things a user reloads a failed run to read**, and the replay filter is keyed to
exclude all three. The `[QUEUE]` lines (`usePersonaExecution.ts:219,222`) are
frontend-authored and never reach the file at all.

### 4 — the app can tell "still working" from "stalled", and 60% of runs need it, and nothing renders it

`useActivityMonitor.ts` consumes `EXECUTION_HEARTBEAT` and returns
`staleLevel: 'active' | 'waiting' | 'stuck'` at 30 s / 120 s of silence. The
backend feeds it properly — `runner/mod.rs:2081` sets a 30 s interval, and
`:2142-2147` deliberately re-emits from the *read* branch because `biased;`
starves the tick during heavy output (the comment cites the bug).

**`useActivityMonitor` has zero call sites. `staleLevel` and `silenceMs` appear
nowhere outside the file that defines them.** It is exported from
`hooks/index.ts:41` and never imported.

Reconstructed from the log timestamps of 2,982 runs:

| | value |
| --- | ---: |
| inter-line gap p50 / p90 / p99 / p99.9 | 0.36 s / 4.91 s / 27.78 s / 67.31 s |
| **per-run maximum silence, p50** | **33.1 s** |
| runs with ≥1 silence > 30 s (`waiting`) | **1,790 of 2,982 — 60.03%** |
| runs with ≥1 silence > 120 s (`stuck`) | 64 — 2.15% |
| longest silence inside a run that then resumed | **2,813.9 s (47 min)** |

**The median run crosses the app's own `waiting` threshold at least once.** What
the user sees during those 33 seconds is `TerminalBody`'s blinking `> _` cursor
(`:154-164`), which is driven by `isRunning` and looks identical at second 1 and
at minute 47.

### 5 — half the line-bearing channels have no reader

26 event channels in `eventRegistry.ts` carry a `line`/`chunk`/`text` payload.
Cross-checked twice (by `EventName` constant and by wire string, over both
trees): **13 of 26 have zero frontend subscriber, and the backend emits all 13** —
`template-adopt-output`, `credential-design-output`,
`credential-negotiation-progress`, `nl-query-output`, `schema-proposal-output`,
`idea-scan-output`, `kpi-scan-output`, `kpi-compose-output`,
`use-case-scan-output`, `divergence-scan-output`, `verify-scan-output`,
`twin-studio-output`, `media-export-output`.

This is not free. Every `app.emit` in this repo is a **global broadcast**
([`backend-to-frontend-events`](./backend-to-frontend-events.md) §2), so each of
those lines is serialized and crosses the IPC boundary into the WebView to be
dropped by zero handlers. `BackgroundJobManager` already has the correct answer
to this and it is one token away: `record_line` (`background_job.rs:339`) keeps
the line in the ring and never emits. **Measured: 166 `emit_line` call sites
against 13 record-only ones (10 `record_line` + 3 `record_streamed`)** — a
12.8 : 1 ratio in favour of crossing the boundary, on channels where half the
destinations do not exist.

---

## 1 Trigger

- "I need to show the output of this thing while it runs."
- "Tail the log / stream the CLI / show me what the agent is doing right now."
- "Where do I put the lines coming off this event?"
- "It should scroll as new output arrives."
- "The terminal gets slow on long runs — I'll cap it at N lines."
- "The output is truncated; where's the rest?"
- "It's been quiet for a while — is it stuck?"
- "The panel is blank after a refresh even though the run is still going."

**If you are about to type** `listen(` next to a payload with a `line` or `chunk`
field, `setLines(prev => [...prev, line])`, `.slice(-500)`, `scrollTop =
scrollHeight`, `{lines.map(`, `emit_line`, `VecDeque` + a line cap, or a constant
named `MAX_LINES` / `MAX_OUTPUT_BYTES` / `TAIL_*` — **you are in this situation.**

You are also in it, and this is the case people miss, if you are about to put a
**copy button** on a live output panel, or to decide what the panel shows when
the output ends.

**Not this path:** the event's *name and payload struct* is
[backend-to-frontend-events](./backend-to-frontend-events.md); the job's
*status, snapshot and staleness* is
[long-running-job-progress](./long-running-job-progress.md); spawning the child
is [spawning-a-cli-subprocess](./spawning-a-cli-subprocess.md); turning the
child's output into a *value your program uses* is
[structured-output-extraction](./structured-output-extraction.md); what the
*row* says when the process dies is
[terminal-state-and-recovery](./terminal-state-and-recovery.md); what happens to
the log *file* afterwards is [retention-and-pruning](./retention-and-pruning.md).

## 2 The one way

**Bound the stream at the producer, replay it on attach, and never move the
viewport the user is holding.** Concretely: (a) **the producer owns a bounded
ring and the ring is the source of truth** — push every chunk into it
unconditionally so the child's pipe never blocks, clamp each line to a byte
ceiling *at the push*, and drop oldest; `fleet/registry.rs`'s `OutputRing` and
`background_job.rs`'s `push_ring` are the two implementations and neither should
be re-derived. (b) **Forward over IPC only what someone is watching** — a
`subscribed` flag (`pty.rs:653-656`) or the `emit_line`/`record_line` split
(`background_job.rs:318`/`:339`); a broadcast nobody reads still pays full
serialization and WebView crossing, and 13 of this app's 26 line channels are
doing exactly that. (c) **Serve a snapshot of the ring on (re)subscribe**, so a
remount, a reload or a late-opened panel paints warm instead of blank — this is
the single most converged clause in the fleet (4 of 5 siblings reinvented it
independently, §6) and it is the half Personas' flagship stream is missing.
(d) **Redact on the emit, not only on the write** — the display string is a
different string from the one you logged, so masking the log masks nothing the
user sees; and if you put a copy button on the panel you have created a clipboard
sink for whatever the child printed. (e) **On the client, one subscription per
channel feeding one buffer** — bound it by *bytes* as well as lines, because
27.62% of this app's stream events contain embedded newlines and a line count is
not a memory bound. (f) **Size every constant against the producer's own
ceiling, not against a round number** — `useTraceData.ts:20-26` sets its buffer
to the backend tracer's `MAX_SPANS` and says why; every other cap in this repo is
a power of ten chosen by hand, and the corpus says they are 25×–230× too large to
have ever fired while a 4,096-char clamp silently cuts the 99th-percentile
message. (g) **Auto-scroll only while the user is already at the bottom** —
compute distance-from-bottom in an `onScroll` handler, store it in a ref, gate
the pin on it, and surface an explicit "N new lines below" affordance when they
are not; `terminal/TerminalBody.tsx:75-93,260-274` is the whole contract in
twenty lines. (h) **Make the ending legible**: a stream has three ends —
finished, truncated, and *quiet* — and they must not render identically. Bind
the silence signal you already emit, say how much output was dropped when you
drop it, and never let a blinking cursor be the only difference between second 1
and minute 47.

If you must get one right first: **(g)**. It is the only one whose failure the
user experiences as the app fighting them, it is converged across the fleet, and
it is 13 lines from correct at every one of the 13 sites that get it wrong.

## 3 Mandated primitives

**Exist today — use them.**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/commands/fleet/registry.rs:33,41` `OutputRing` / `OUTPUT_RING_CAP` | **the best streaming buffer in the tree**: 512 KiB byte-accounted drop-oldest ring, a `subscribed` flag so the reader always pushes but only forwards when watched, `snapshot()` (`:133`) replayed on attach (`:1015`), a `rev` change-cursor, a `watch` channel so waiters block instead of poll, and an incrementally-fed `vt100` screen model |
| `src-tauri/src/background_job.rs:300` `push_ring` | "the single chokepoint where EVERY background-job line is size- and count-bounded" — 500-line tail ring + `clamp_line` (`:44`) to 4 KB with an **honest** `…[+N bytes truncated]` marker |
| `background_job.rs:318` `emit_line` **vs** `:339` `record_line` | the stream/record split. Milestones cross IPC; noisy per-token output stays in the ring. Reserve `emit_line` for what a user must see with no panel open |
| `engine/src/cli_process.rs:24,191` `MAX_LINE_BYTES` / `read_line_limited` | the first clamp, at the pipe: 64 KB per line, `...[truncated]`, so one runaway line cannot own the reader |
| `src/lib/execution/executionSink.ts:104` `ExecutionSink` | client-side ring + **byte** budget + microtask batching + throttled store push (100 ms) + a `generation` counter that makes a stale flush inert + `subscribeDocumentVisibility` so a hidden window does not flush. The right *shape*; §7 disputes its constants |
| `src/hooks/execution/useCorrelatedCliStream.ts:34` | correlation by run id as the **first statement**, payload validation, per-line clamp, consecutive-duplicate suppression, teardown on unmount. The one hook to reach for when you own a CLI run |
| `src/features/shared/components/terminal/TerminalBody.tsx` | **the view.** `@tanstack/react-virtual` virtualization with `measureElement`, sticky-bottom detection at 10 px (`:86-93`), unseen-line counter + jump-to-latest FAB (`:260-274`), four context-aware empty states (`:112-146`), filter-by-**dimming** so the viewport does not jump (`:249`) |
| `src/features/agents/sub_executions/components/runner/ExecutionTerminal.tsx` | the composed surface: header + search + body + resize + fullscreen. Compose this, do not rebuild it |
| `src/hooks/utility/useTerminalClassification.ts` | per-line classification on a **Web Worker** with an rAF-scheduled post and a synchronous fallback |
| `src/features/plugins/companion/useChatScroll.ts` | the stickiness contract written down: `NEAR_BOTTOM_PX = 80`, an `atBottom` state **and** a ref, `maybeAutoScroll`, and a docstring naming the exact defect ("yanked the user back down") |
| `src/features/agents/sub_executions/detail/inspector/useTraceData.ts:20-26` | the only buffer in the repo whose bound is **derived from the producer's own ceiling**, with the reasoning in the comment |
| `scripts/census/` | the ratchet mechanism. §9 |

**Do not exist — this path names them.**

- **A shared stickiness hook.** There are **five** implementations at **four**
  thresholds (10 px ×3, 40 px, 80 px) and **13 sites with none**. The best one
  (`useChatScroll`) lives under `features/plugins/companion/` where nothing else
  can see it.
- **A server-side ring for `EXECUTION_OUTPUT`.** The app's flagship stream is the
  one stream with no producer buffer and no snapshot; its "replay" is a lossy
  re-read of the log file (§ headline 3).
- **Any redaction on any live stream path**, in this repo or in any of the five
  siblings (§6 — a 6/6 silence).
- **A truncation signal that survives the process.** Three truncation mechanisms,
  one column, wired to a fourth thing.
- **A rendered stall indicator.** The producer exists and is good; the consumer
  has zero call sites.
- **A second `TerminalBody`.** There are two components with that exact name —
  `shared/components/terminal/TerminalBody.tsx` (virtualized, sticky, FAB) and
  `shared/components/progress/TerminalBody.tsx` (plain `.map`, its own
  `useTerminalScroll`). Importing "TerminalBody" is currently a coin flip.

## 4 Steps

1. **Name the producer's ceiling before you pick any client constant.** How many
   lines can this thing emit, how large is one, and what is the natural unit —
   bytes or lines? Write the answer in the comment next to the constant, the way
   `useTraceData.ts:20-26` does. Every hand-picked power of ten in this repo is
   off by 25×–230× in one direction and 0× in the other.
2. **Put the ring on the producer.** `OutputRing` for a byte stream (PTY,
   raw stdout), `BackgroundJobManager` for a line stream. Push unconditionally so
   the child's pipe never fills; clamp at the push.
3. **Decide, per line, `emit_line` or `record_line`.** If no panel is open, does
   the user need this line? If the answer is no, it must not cross IPC.
4. **Serve the ring on subscribe.** The attach command returns `snapshot()`; the
   client hydrates from it and only then splices in live chunks
   (`fleetTerminalManager.ts:208-213` shows the hydrating/pendingLive splice).
   This is the step that makes a remount paint warm — and the step everyone in
   the fleet independently discovered they needed (§6).
5. **Redact the emitted string.** Not the string you logged — the string you
   emit. They are different strings. Compose the pass named in
   [secret-and-pii-redaction](./secret-and-pii-redaction.md) §2; if you are
   holding literals, subtract them first.
6. **On the client, subscribe once.** `useCorrelatedCliStream` if you own the
   run; otherwise the primitive
   [backend-to-frontend-events](./backend-to-frontend-events.md) §2 names for
   your lifetime — **but read §6's collision note first if the channel is a log
   stream**, because `createSingletonListener`'s early buffer drops past 50.
   Filter on the run id as the **first statement** of the handler.
7. **Feed one buffer.** Bound it by bytes *and* lines. Batch on a microtask,
   throttle the store push, and hold a `generation` counter so a flush belonging
   to the previous run cannot land — `executionSink.ts:135-139,229` is the model.
8. **Render through `TerminalBody`, and pass `enableUnseenCounter`.** It is
   opt-in and defaults to `false`; **2 of its 5 call sites pass it.** Then stop —
   do not add your own scroll effect, your own classifier, your own empty state
   or your own `.map`.
9. **Make the three endings distinguishable.** Finished (a summary line),
   truncated (a notice that says *how much* was dropped), quiet (bind
   `useActivityMonitor`, or render an elapsed clock — see ascent in §6). A
   blinking cursor is not a stall indicator.
10. **Then stop.** No second stickiness hook. No second ring. No `scrollTop =
    scrollHeight` in an effect. No copy button over an unredacted buffer.

## 5 Anti-patterns

- **`el.scrollTop = el.scrollHeight` in an effect keyed on the line count.**
  *Failure mode:* the user scrolls up to read something, the next chunk arrives
  ~360 ms later (corpus p50 inter-line gap: **0.36 s**), and the viewport is
  yanked to the bottom mid-sentence. There is no way to read a running log.
  **Measured: 13 sites do this; 6 sites guard it correctly; the guarded ones
  reinvented the same three-part shape in 2 sibling repos independently (§6).**
  The worst placement is `shared/components/terminal/TerminalStrip.tsx:57-61`
  (shared) and `autoCredErrorConfig.ts:17-21`, which is a **reusable hook**
  (`useAutoScrollRef`) that hands the defect to every future caller.
- **Choosing a buffer bound by rounding.** *Failure mode:* the cap is either
  unreachable (dead code that looks like a safety net) or bites the wrong axis.
  **Measured: 10 MB against a 44,612-char worst case (230×); 10,000 lines against
  401 (25×); and simultaneously a 4,096-char per-line clamp that cuts 1.82% of
  emitted lines including the entire top percentile.**
- **Counting lines as if they were rows.** *Failure mode:* one event renders as
  fifty visual rows, the virtualizer's `estimateSize` of 22 px is wrong by 50×,
  and the "line" budget bounds neither DOM nodes nor memory.
  **Measured: 36,251 of 131,264 emitted display strings (27.62%) contain a
  newline; the longest is 19,433 characters.**
- **Masking the sink and not the stream.** *Failure mode:* the file on disk is
  clean, the read-back command is clean, the reviewer sees two redactors, and the
  screen — plus the copy button one line away — has never been masked at all.
  **Measured: 15,363 credential- and PII-shaped matches reconstructed in the text
  that reached the live view; `ExecutionTerminal.tsx:42` copies it verbatim.**
- **Recording a truncation you never surface.** *Failure mode:* the user sees
  output stop and cannot tell whether the process ended or the buffer did.
  **Measured: `output_truncated` (`runner/mod.rs:2013,2156`) is assigned and
  never read; `log_truncated` is `logger.had_write_errors()` and is `0` on all
  2,188 rows; `executionSink`'s banner has never rendered.**
- **Replaying with a filter narrower than the emit.** *Failure mode:* reload
  restores the boring lines and drops the errors — the exact inversion of why
  anyone reloads. **Measured: 22.66% of logged lines (78,663) fail the
  `[STDOUT] ` filter, including 100% of `[TIMEOUT]`, `[CANCELLED]`, `[STDERR]`
  and the truncation notice.**
- **Emitting into a channel with no subscriber.** *Failure mode:* full
  serialization plus a WebView crossing per line, for nobody, on a global
  broadcast. **Measured: 13 of 26 line-bearing channels.** `record_line` exists
  and is one token away.
- **Building the stall detector and not rendering it.** *Failure mode:* the app
  knows the run has been silent for 47 minutes and shows the same blinking cursor
  it shows at one second. **Measured: `useActivityMonitor` — 0 call sites;
  `staleLevel` — 0 references outside its own file; 60.03% of runs contain a
  silence long enough to trip it.**
- **A spinner as the pre-first-line state.** *Failure mode:* `LoadingSpinner`
  renders `null` (`feedback/LoadingSpinner.tsx:12-20`), so the "live narration"
  header at `RevitalizeProgress.tsx:26` renders nothing at all. The doctrine is
  already written: a spinner is banned for a surface. **A stream's empty state is
  not a ghost either** — there is no known shape to ghost — it is a *named
  waiting state*, which is what `TerminalBody`'s `emptyState` union
  (`idle | connecting | queued | failed`) exists to express. Use it.
- **A raw `listen()` per consumer on the same stream.** *Failure mode:* N IPC
  subscriptions for one channel and N appends per line into a shared sink with no
  dedupe. **Measured: 4 independent subscribers on `EXECUTION_OUTPUT`
  (`usePersonaExecution.ts:142`, `chatSlice.ts:482`, `backgroundChatSlice.ts:364`,
  `useActivityMonitor.ts:53`); 2 of them call `appendExecutionOutput` into the
  same singleton sink; and `useCorrelatedCliStream`'s consecutive-duplicate
  suppression sits inside `if (bufferLinesRef.current)` (`:90`), which
  `usePersonaExecution` sets to `false` — so the one dedupe in the design is
  disabled at the main call site.**
- **Accumulating a stream into a plain array because "it isn't rendered".**
  *Failure mode:* an unbounded buffer in the same repo that ships a ring for the
  same event. **Measured: `backgroundChatSlice.ts:366` `outputLines.push(...)` —
  no cap, no clamp, held for the whole run.**

## 6 Evidence

**The ONE site to copy: `src-tauri/src/commands/fleet/registry.rs` `OutputRing`
(`:33,41-140`) together with its reader loop at
`src-tauri/src/commands/fleet/pty.rs:602-665`.** It is the only implementation in
this repo that answers all four of this leaf's questions at once. The reader
*always* pushes into the bounded ring so the child never blocks on a full pipe;
it takes the subscription check and the push **under one short lock**
(`pty.rs:653-656`) and forwards over IPC only when subscribed; `snapshot()`
(`registry.rs:133`) is replayed on attach (`:1015`) so a re-focused terminal
hydrates from the ring rather than a re-streamed history; the bound is in
**bytes** (512 KiB), which is the honest unit for a stream whose "lines" are ANSI
chunks; and it carries a `rev` cursor plus a `watch` channel so readers compare
or block instead of polling. Copy it — and unlike the flagship stream, **keep the
snapshot**.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `background_job.rs:300-316` | one `push_ring` chokepoint for clamp *and* count, and `emit_line` returning the clamped line so the IPC payload cannot diverge from the ring |
| `background_job.rs:44-53` `clamp_line` | truncation that **says how much it dropped** (`…[+N bytes truncated]`), on a char boundary |
| `terminal/TerminalBody.tsx:75-93` + `:260-274` | the complete stickiness contract: threshold, ref, `onScroll`, unseen counter, jump-to-latest — twenty lines, nothing else needed |
| `terminal/TerminalBody.tsx:249` | filtering a live log by **dimming** non-matches (`opacity-20`) instead of removing them, so the viewport does not jump under an active filter |
| `executionSink.ts:135-139` + `:229` | microtask batching plus a `generation` counter that makes a previous run's in-flight flush inert — the cleanest stale-write guard in the repo |
| `executionSink.ts:280-291,323-332` | deferring the flush while `document` is hidden and resuming on visibility, instead of burning frames behind a hidden window |
| `useCorrelatedCliStream.ts:80` | the run-id check as the handler's **first statement**, before validation, before anything |
| `useTraceData.ts:20-26` | a client buffer bound **derived from the producer's own ceiling**, with the derivation written down |
| `useChatScroll.ts:9-28` | a docstring that states the defect it exists to prevent, in the words a user would use |
| `useTerminalClassification.ts:58-76` | per-line work moved to a Worker with an rAF-scheduled post, a request-id guard, and a synchronous fallback when `Worker` is unavailable |
| `fleetTerminalManager.ts:204-216` | **one** app-wide listener dispatching into a registry map — O(1) per chunk regardless of terminal count — with the hydrating/pendingLive splice that closes the attach race |

### The replay — two independent implementations, and the disagreement that mattered

Every `[STDOUT] ` body in 2,998 files was run through **(A)** a faithful,
arm-by-arm transliteration of `engine/src/parser.rs::parse_stream_line`'s display
half, and **(B)** an independently-written classifier that never calls
`JSON.parse`.

| | A (transliteration) | B (regex classifier) |
| --- | ---: | ---: |
| bodies | 268,482 | 268,482 |
| would emit to the view | **131,264 (48.89%)** | 131,276 (48.90%) |
| suppressed (`display = None`) | 137,218 | 137,206 |

They first disagreed on **1,403 bodies (0.52%)**, and the classification of the
disagreement is where the value was:

| cause | n | verdict |
| --- | ---: | --- |
| subagent `tool_result` blocks | **1,281** | **my instrument was wrong** — see §12(a) |
| B's crude non-JSON test | 67 | B approximating |
| B's `tool_result` regex missing a key order | 55 | B approximating |

After correcting A, the two agree to **12 bodies in 268,482 (0.004%)**, all in
B's approximations. **Agreement was not what made this trustworthy — chasing the
disagreement was**, and it caught an error that would have published a false
defect against `parser.rs`.

### The corpus, measured

| | value |
| --- | ---: |
| execution log files / bytes | **2,998 / 430,731,004 (410.8 MB)** |
| log file size p50 / p90 / p99 / max | 116,389 / 301,258 / 600,425 / **1,227,235** |
| total log lines / `[STDOUT] ` lines | 347,145 / **268,482 (77.34%)** |
| raw lines > 4,096 chars / > 64 KB / max | 22,909 / **16** / 65,597 |
| display strings emitted | **131,264** |
| display length p50 / p90 / p99 / max | 52 / 218 / **6,764** / **19,433** |
| display strings > 4,096 chars (clamped) | **2,394 (1.82%)** |
| display strings containing `\n` | **36,251 (27.62%)** |
| per-run display lines p50 / p90 / p99 / max | 34 / 96 / 186 / **401** |
| per-run display chars, max | **44,612** (budget: 10,485,760) |
| runs tripping the byte budget / either line ring | **0 / 0** |
| executions rows / `log_truncated = 1` | 2,188 / **0** |
| rows with a `log_file_path` / dangling (file gone) | 2,074 / **595** |
| log files not referenced by any row / with no row at all | **1,519** / 1,448 |
| run duration p50 / p90 / p99 / max (s) | 216.8 / 485.4 / 3,157.9 / 20,525.4 |

**One instrument caveat worth carrying forward.** The `C:\Users\<name>` shape
matched **8,379** times in the reconstructed display text and **0** times in the
same bodies on disk — not because it is absent from disk, but because on disk it
is JSON-escaped (`C:\\Users\\`). **Any redactor that runs on the raw stream line —
which is exactly what `ExecutionLogger::log`'s `sanitize_secrets` sees — is
reading escaped text, so a pattern containing a backslash cannot match it.** That
is a property of masking before parsing, and it belongs to whoever next touches
the disk redactor.

### Convergence — five siblings, run 2026-08-16

All five checkouts exist and were read. Nothing is reported by omission.

| clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| a live stream view exists | ✔ | **✗ none at all** | producer only | ✔ ×5 | ✔ (progress) | 3/5 + 1 producer |
| **bounded producer buffer** | ✔ 500 lines | n/a | ✔ **64 KB bytes** | ✔ 500 server / **✗ client** | ✔ | **4/5 — physics** |
| per-line clamp | ✗ | n/a | ✗ | ✔ 200/150/80 | ✗ | 1/5 — **Personas is ahead (3 clamps)** |
| **guarded scroll-follow** | **2 guarded / 4 unguarded** | n/a | n/a | **3 guarded / 2 unguarded** | n/a (never follows) | **converged where a tail exists** |
| **replay / snapshot on attach** | ✔ offset | ✗ | ✔ **`init` frame carries the tail** | ✔ subscribe-then-flush | ✔ **peek before connect** | **4/5 — physics** |
| **redaction on the live path** | **✗** | **✗** | **✗** | **✗** | **✗** | **SILENCE 5/5 — and 6/6 with Personas** |
| stall / silence signal | transport keepalive only | ✗ | **✗ (none)** | ✔ richest | ✔ **in-view** | 3/5, only 1 in-view |
| a truncation notice **in the view** | ✗ | ✗ | ✗ (computes it, ships it, renders nothing) | ✗ | ✗ | **SILENCE 5/5** |

**Four results this document rests on.**

**(a) Replay-on-attach is physics, and it is the half Personas' flagship stream
is missing.** Four repos reinvented it with no shared code and four different
mechanisms: `personas-cloud` stuffs the entire tail buffer into an `init` frame
before any live frame (`packages/orchestrator/src/httpApi.ts:1723-1730`);
`vibeman` subscribes *then* flushes from a saved index to close the race
(`src/app/api/claude-terminal/stream/route.ts:219-230`); `ascent` fetches a
persisted snapshot **before** it opens the stream at all
(`src/components/report/useReportScan.ts:118-144`); `personas-web` carries a byte
offset (`src/hooks/useExecutionPolling.ts:28,53`). Personas has it twice —
`OutputRing::snapshot` and `BackgroundJobManager`'s snapshot readers — and does
**not** have it for `EXECUTION_OUTPUT`, which instead re-reads a file through a
filter that drops 22.66% of what it showed.

**(b) The guarded scroll-follow is physics, down to its shape.** `personas-web`
and `vibeman` independently arrived at the same three parts: a
distance-from-bottom threshold (24 px vs 50 px), a sticky flag flipped by the
scroll handler, and a jump-to-latest affordance gated on `!atBottom`
(`ExecutionOutput.tsx:53-56,125-141` vs `CompactTerminal.tsx:244-249,1074-1086`).
That is `terminal/TerminalBody.tsx` with different numbers. **This is not a house
convention** — which is why §9 gates it. `personas-web`'s four unguarded pins are
all marketing/demo simulators carrying no real process output; `vibeman`'s two
are real.

**(c) Nothing in six codebases redacts a streamed chunk.** This is the most
replicated silence in the sample, and it is not a capability gap: every repo
already owns a redactor and wired it into error reporting or JSON responses —
`vibeman/src/lib/api-helpers/errorSanitizer.ts:27-38` (with **zero** call sites
under its own `claude-terminal/` tree),
`personas-cloud`'s `redactDeployment` (`httpApi.ts:1422`), `personas-web`'s
`captureExceptionScrubbed` (`src/app/error.tsx:25`). All six masked the report
and none masked the terminal. **A 6/6 silence is not permission; it is a
fleet-wide blind spot**, and Personas is the one repo where the asymmetry is
*visible in its own source*, because its read path carries a nine-line comment
explaining exactly why masking there was necessary.

**(d) Personas is ahead on clamping and behind on saying so.** Three per-line
clamps (64 KB at the pipe, 4 KB in `background_job`, 4,096 chars in the sink)
against 1 in five siblings — and it is the only repo that even *has* a
truncation notice (`executionSink.ts:28`), which has never rendered.
`personas-cloud` computes `totalOutputLines` and ships `tailBufferLines` over the
wire (`dispatcher.ts:970`, `httpApi.ts:1674`) and no consumer renders it either.
**Six codebases evict output and none tells the user.**

**Two techniques worth importing wholesale.** `vibeman` virtualizes its live log
above a 50-entry threshold and batches flushes on rAF
(`src/components/cli/CompactTerminal.tsx:70-71,219-236,274-297`) — Personas
virtualizes but re-clones the entire buffer to the classifier Worker on every
flush. And `ascent` is the only repo in six with an **in-view** still-working
signal: a mount-anchored elapsed clock ticking every 250 ms, a progress bar
floored on elapsed time so a silent stage still advances, and escalating
expectation copy inside `role="status" aria-live="polite"`
(`src/components/report/ReportClientStatus.tsx:78-101,192-195`). That is the
missing consumer for the heartbeat Personas already emits.

**The clause the oracle inverted.** I expected to prescribe *"cap the client
buffer"* as the load-bearing rule, since every repo has one and it is the first
thing anyone reaches for. The corpus says the cap has never fired here and the
convergence says the *replay* is what everyone independently discovered they
could not live without. **The bound is table stakes; the snapshot is the
prescription.** §2 is ordered accordingly.

### A collision with a neighbour's prescription

[`backend-to-frontend-events`](./backend-to-frontend-events.md) §2 says: *"a
stream many components watch at once uses `createSingletonListener` so N
consumers share one underlying subscription and one per-frame flush."* That is
correct for its concern and `EXECUTION_OUTPUT` — 4 raw `listen()` calls — is
exactly its target.

`createSingletonListener.ts:32,94-99` buffers events that arrive before the first
subscriber registers, **caps that buffer at `MAX_BUFFER = 50`, and drops the
rest** with one `console.warn` and a silent counter thereafter. For a status
channel that is right: the newest state wins. For a **log stream** it is line
loss during precisely the window that matters — process start, when a CLI emits
its init banner and first tool calls faster than a lazy route can mount. The
sibling channel `EXECUTION_EVENT` already runs through it
(`useStructuredStream.ts:40`), feeding `useReasoningTrace` and the inspector.

Both prescriptions are right about their own concern; the composition drops
lines. The fix belongs to neither path: `createSingletonListener` needs the
early-buffer policy to be a **parameter** (`{ earlyBuffer: 'latest' | 'all' | n }`),
because "drop the oldest 50" and "never drop" are different products and one
constant cannot serve both. Recorded here rather than filed against either rule.

## 7 Deviations

Every entry is live on `master` @ `17d059b1f`.

> **Second pass — what is upstream of all of this.** Every item below reduces to
> one fact: **this app streams to a viewport it has never watched fill up.** The
> caps were chosen against an imagined workload two orders of magnitude larger
> than the real one, the truncation banner and the tail ring were built for a
> case that has not occurred in 2,998 runs, and the two mechanisms that the real
> workload *does* exercise every day — the 4,096-char clamp and the 33-second
> median silence — have no user-facing expression at all. **The fix that closes
> the most entries is not a smaller constant; it is binding the signals that
> already exist to the view: the silence, the clamp, and the snapshot.**

### P0 — the live stream reaches the screen, and the clipboard, unredacted

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/engine/runner/mod.rs:2179-2188` | `emit_to(… line: display_text.clone())` — the display string is derived from the **raw** line at `:2176`; the `sanitize_secrets` at `:2173` masks only the logger's own copy. |
| `src/features/agents/sub_executions/components/runner/ExecutionTerminal.tsx:42` | `copyToClipboard(lines.join('\n'))` over the unredacted live buffer. |
| `src/features/agents/executionPlayer/ExecutionMiniPlayer.tsx:62` | `copy(executionOutput.join('\n'))` — same buffer, second door. |
| `src-tauri/src/engine/runner/mod.rs:2615-2624` | the whole of stderr emitted as one `[ERROR] …` event, unmasked and unclamped. |
| `src-tauri/src/background_job.rs` | zero occurrences of `sanitize`/`redact`/`scrub` — all 19 `BackgroundJobManager` families emit unmasked too. |

**Measured: 15,363 credential- and PII-shaped matches reconstructed in text that
reached the live view** (8,379 Windows user paths, 6,230 POSIX home paths, 698
emails, 44 labelled assignments, 9 Google-API shapes, 2 GitHub-PAT shapes, 1 PEM
header), across ~1,850 of 2,998 runs. A lower bound, since the corpus it was
recovered from has been masked on write since 2026-08-14 and the emit never was.

**Fix — one line, at the chokepoint.** Apply the composed pass from
[secret-and-pii-redaction](./secret-and-pii-redaction.md) §2 to `display_text`
before the emit, and to the line inside `push_ring` (`background_job.rs:300`) so
all 19 job families are covered by one edit. Note the ordering constraint from §6:
redact the **parsed display string**, not the raw JSON line, because the raw line
is escaped and a backslash-bearing pattern cannot match it.
*This is a security-behaviour change on a path the operator watches live; it
should be reviewed by a human, not merged by a wave.*

### P0 — 13 sites pin the viewport without asking where the user is

| Path | What's wrong |
| --- | --- |
| `src/features/shared/components/terminal/TerminalStrip.tsx:57-61` | a **shared** component; `if (isExpanded && scrollRef.current)` is not an at-bottom check. |
| `.../autoCred/helpers/autoCredErrorConfig.ts:17-21` | `useAutoScrollRef(dep)` — a **reusable hook** whose entire body is the unguarded pin. |
| `src/features/agents/executionPlayer/ExecutionMiniPlayer.tsx:180-183` | guarded on `miniPlayerExpanded`. |
| `src/features/onboarding/components/ExecutionStep.tsx:37-40` · `.../AiHealingStreamOverlay.tsx:104-107` · `.../CreativeStudioPanel.tsx:269-272` · `.../ScanOverlay.tsx:22-25` · `.../TaskOutputPanel.tsx:15-18` · `.../gitlab/components/JobRow.tsx:18-21` · `.../RevitalizeProgress.tsx:18-21` · `.../commandCenterParts.tsx:35-38` · `.../AutoCredBrowser.tsx:49-52` · `.../vault/sub_databases/tabs/ChatTab.tsx:49-52` | unconditional. |

**Fix:** extract `useChatScroll` (`features/plugins/companion/useChatScroll.ts`)
into `src/features/shared/components/terminal/` and route all 13 through it. It
already returns `atBottom` for the jump-to-latest affordance. §9 ratchets this
until that lands, and the rule is designed to reach zero and be deleted.

### P0 — `enableUnseenCounter` is opt-in and off at 3 of 5 `TerminalBody` call sites

`terminal/TerminalBody.tsx:53` defaults it to `false`. Passed by
`ExecutionTerminal.tsx:74` and `TemplatePreviewModal.tsx:159`; **not** passed by
`AnalysisModeView.tsx`, `TransformModeView.tsx`, `CliOutputPanel.tsx`. Those
three keep the stickiness guard (it is unconditional in the component) but lose
the "N new lines below" affordance — so a user who scrolls up gets a viewport
that correctly stays put and **no indication that the stream is still moving**.

**Fix — this is the contract's fifth failure mode, and the answer is the
default.** Flip `enableUnseenCounter` to default `true`. One edit corrects three
call sites; no ratchet would move one.

### P1 — the stall signal has a producer, a threshold table, and no consumer

| Path | What's wrong |
| --- | --- |
| `src/hooks/execution/useActivityMonitor.ts` | **0 call sites.** `staleLevel` / `silenceMs` have 0 references outside this file. |
| `src-tauri/src/engine/runner/mod.rs:2081,2142-2147,2577-2582` | the producer is correct and carefully built, including the biased-select fix. |
| `src/features/shared/components/terminal/TerminalBody.tsx:154-164` | the cursor row is driven by `isRunning` alone. |

**Measured: 60.03% of runs (1,790 of 2,982) contain at least one silence longer
than 30 s; the median run's longest silence is 33.1 s; the longest silence inside
a run that then resumed is 47 minutes.**

**Fix:** call `useActivityMonitor(activeExecutionId, isRunning)` in
`ExecutionTerminal` and pass `staleLevel` into `TerminalBody`; render `waiting` /
`stuck` on the cursor row. Port `ascent`'s elapsed clock
(`ReportClientStatus.tsx:78-92`) as the zero-heartbeat fallback, and put it in
`role="status" aria-live="polite"` as they did.

### P1 — the reload replay drops every non-`[STDOUT]` line

`commands/execution/executions.rs:702,715` filter on `[STDOUT] `.
**78,663 of 347,145 corpus lines (22.66%) fail it**, including all 18 `[TIMEOUT]`
lines, both `[CANCELLED]` lines, every `[STDERR]` line, the `[RUNNER]`
truncation notice, and all 18,624 `[MEMORY]`/`[EVENT]`/`[MESSAGE]`/`[FLOW]`/
`[KNOWLEDGE]`/`[LEARNING]`/`[REVIEW]` lines the terminal showed live.

**Fix:** the filter is a *display-channel* decision encoded as a string prefix.
Log the display text under a stable marker (or record the emitted line in a
server-side ring, which is the P2 fix and subsumes this), and replay by marker
rather than by re-deriving. Until then, widen the filter to the set the runner
actually emits — the prefixes are enumerable from `dispatch.rs` and
`runner/mod.rs` and there are 15 of them.

### P1 — three truncation mechanisms, one column, wired to a fourth thing

| Path | What's wrong |
| --- | --- |
| `runner/mod.rs:2759` | `let log_truncated = logger.had_write_errors();` — an I/O-error flag. **0 of 2,188 rows.** |
| `runner/mod.rs:2013,2156` | `output_truncated` — the real 10 MB cut-off. Assigned once, **never read**. |
| `src/lib/execution/executionSink.ts:20,28,232-238` | a third, client-side 10 MB cut-off that reaches no column, no event, no row. |
| `ExecutionLogViewer.tsx:13-15,96-101` | the banner, correctly documented, driven by the wrong flag. |

**Fix:** make `output_truncated` a real outcome — thread it into
`ExecutionResult` beside `log_truncated`, rename the existing column to what it
is (`log_write_failed`), and add `output_bytes_dropped: i64` so the banner can
say *how much*. That is the notice **6 of 6 codebases are missing** (§6 d).

### P2 — the flagship stream is the one stream with no producer ring and no snapshot

`EXECUTION_OUTPUT` has no server-side buffer at all. `OutputRing` (fleet) and
`push_ring` (background jobs) both exist, both replay on attach, and the persona
runner uses neither. Its recovery is `getExecutionLogLines` from disk with the
lossy filter above, guarded by a `recoveryAttemptedRef` that fires **once per
mount** (`usePersonaExecution.ts:154-162`) and a counted-set dedupe (`:168-185`)
that exists only because the replay races the live stream.

**Fix:** give the runner a `BackgroundJobManager`-shaped ring keyed by
`execution_id`, return `snapshot()` from a `get_execution_output_snapshot`
command, and hydrate from it on mount. That is the converged answer (§6 a), it
deletes the file-filter bug, the dedupe, and the once-per-mount guard together.

### P2 — 13 of 26 line-bearing channels are broadcast to nobody

`template-adopt-output`, `credential-design-output`,
`credential-negotiation-progress`, `nl-query-output`, `schema-proposal-output`,
`idea-scan-output`, `kpi-scan-output`, `kpi-compose-output`,
`use-case-scan-output`, `divergence-scan-output`, `verify-scan-output`,
`twin-studio-output`, `media-export-output`. Every one has a live Rust emitter
and zero frontend subscribers, by both the `EventName` constant and the wire
string. **Fix:** `emit_line` → `record_line` at those job families. The line
stays in the ring and stays available to the snapshot poll; it stops crossing IPC.

### P2 — two different components are named `TerminalBody`

`shared/components/terminal/TerminalBody.tsx` (virtualized, sticky, unseen
counter, four empty states) and `shared/components/progress/TerminalBody.tsx`
(plain `{lines.map(...)}` at `:57`, its own `useTerminalScroll` at `:28-48`).
Both are under `shared/components/`. **Fix:** delete the `progress/` one, or
rename it and have it delegate; keep `useTerminalScroll` only if it becomes the
one extracted stickiness hook.

### P3 — unbounded accumulation beside a ring for the same event

`src/stores/slices/agents/backgroundChatSlice.ts:366` — `outputLines.push(...)`
for the whole run, no cap, no clamp. Not rendered, so it is memory only; it is
still an unbounded buffer for the exact event that has a 10,000-line ring
15 files away.

### P3 — the classifier re-clones the whole buffer on every flush

`useTerminalClassification.ts:59-61` posts the **entire** `lines` array to the
Worker on each change. At the sink's 100 ms flush cadence and a 10,000-line ring
that is a 10k-string structured clone ten times a second. The corpus says the
real maximum is 401 lines, so it has never bitten — which is the same class of
mis-sizing as everything else here. `vibeman` solved the general case with a
50-entry virtualization threshold and rAF-batched flush
(`CompactTerminal.tsx:70-71,274-297`).

### Structural

- **Every deviation above shipped under a green `npm run check`.** No lint rule,
  test, script or CI job in this repo has any opinion about buffer bounds, scroll
  stickiness, replay coverage, or whether a streamed chunk is masked. **Zero of
  the 128 census rules key on scroll geometry** (verified by scanning every
  `signal.pattern` in the registry; the single `bottom` hit is inside a
  CSS-property lookbehind in `locale-blind-percent`).
- **`ci.yml` remains red on pre-existing failures**, so §9 does not depend on it.

## 8 Gaps — what the primitives genuinely cannot do

1. **A ring cannot know which line mattered.** Drop-oldest is the only policy any
   of the six codebases implements, and it is exactly wrong for the case people
   care about: a run that fails at minute 40 after 500 lines of directory noise.
   `background_job.rs:20-24` argues the tail is what a late poll needs, and that
   is right for polling and wrong for diagnosis. Nothing here — or in five
   siblings — keeps a *head* sample alongside the tail.
2. **The producer cannot bound the render.** 27.62% of emitted strings contain
   newlines, so a line-counted ring bounds neither DOM nodes nor layout cost. A
   correct bound is bytes at the producer *and* rows at the renderer, and only
   the virtualizer can see the second one.
3. **A snapshot cannot be replayed into a stream that has no idle boundary.**
   The hydrate/live splice (`fleetTerminalManager.ts:208-213`) works because PTY
   bytes are position-addressable. A parsed display stream has no offset, which
   is why the persona runner ended up re-reading a file instead — and why P2's
   fix has to add a sequence number, not just a buffer.
4. **Redaction on a stream is irreversible and the user is watching their own
   output.** [secret-and-pii-redaction](./secret-and-pii-redaction.md) §8 Gap 2
   makes exactly this argument for why `redact.rs` is applied at persistence and
   not at emission. It is correct in the general case and it is **not** an
   argument for the current state, because the copy button, the DOM and the
   devtools are not "the user's own terminal" — they are four more sinks.
5. **The census can count a statement; it cannot assert a bound is right-sized.**
   "This cap has never fired", "this channel has no subscriber", "the replay
   filter is narrower than the emit" are all relationships between two things or
   between code and a workload. Each was found by **running** something — the
   corpus replay, the channel cross-check, the timestamp reconstruction — and
   each must be **re-run**, not ratcheted.
6. **No type reaches a constant.** `MAX_TERMINAL_LINES = 10_000` is correct
   TypeScript. Nothing in any type system distinguishes a bound derived from a
   producer's ceiling from one chosen by rounding; only the comment
   `useTraceData.ts:20-26` does, and comments are not gates.

## Prefer a type over a gate — the answer for this leaf

Held against all seven qualifications. **The obvious candidate is a
`BoundedLineBuffer` type that views must accept. My answer is that it constrains
the half that has never failed, and the type that actually helps is a smaller
one: the scroll container must not be handed to a component that can set
`scrollTop` without also owning `onScroll`.**

**Q1 — a required type carries only what it encodes.** `BoundedLineBuffer`
encodes *"someone picked a cap"*. It does not encode whether the cap is
reachable, and that is the entire defect: `executionSink`'s 10,000-line cap and
`background_job`'s 500-line cap would both satisfy it, and the corpus says one is
25× too large and the other is 1.25×. Test it against this document: it prevents
none of P0, none of P1, none of the truncation confusion.

**Q2 — requiredness is orthogonal to closedness.** Making a view's `lines` prop
`BoundedLineBuffer` makes it required. It does not close the set of things that
can produce one — with 22 buffer constants across 15 `src` files that is the live problem —
and no signature deletes a producer.

**Q3 — a type nobody constructs constrains nothing.** Counted: `TerminalBody`
(the good one) has **5** call sites in 4,829 files. A type that only it demands
reaches 5 of the 19 scroll pins and 0 of the 13 violating ones, because none of
them render through it.

**Q4 — a type anyone can construct authenticates nothing.** The live analogue is
already in the tree: `useCorrelatedCliStream`'s `bufferLines` is a `boolean` that
silently disables the consecutive-duplicate suppression, and the app's main call
site passes `false` (`usePersonaExecution.ts:150`). A safety property behind an
optional boolean is a comment.

**Q5 — withholding beats requiring.** This is where the answer is. The dangerous
capability is **a writable `scrollTop` on an element whose `onScroll` nobody
reads**. Withhold the ref. A `useStickyBottom()` hook that returns
`{ containerProps, atBottom, scrollToBottom }` — where `containerProps` carries
both the `ref` *and* the `onScroll` — makes the unguarded pin unwriteable,
because the caller never holds a bare element to assign to. All 13 sites in
§7 P0 vanish; so does the fifth stickiness threshold.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*assigning the scroll position*. The **answer** the feature needs is *"follow the
tail"*, and taking that away breaks the product. So the cut is: the hook keeps
`scrollToBottom()` as an explicit, user-initiated act (the jump-to-latest button)
and performs the automatic pin itself, gated on its own measurement. That is
`useChatScroll` promoted to `shared/`, plus the `ref`/`onScroll` pairing that
makes forgetting the handler impossible.

**Q7 — withholding a requirement only helps when the requirement forced the bad
value.** ✔, and it keeps scope honest. Nobody is forced to pin the scroll; 13
call sites do it voluntarily because a bare `useRef<HTMLDivElement>` is sitting
there. So relaxing a signature is inert, and it is the *construction* of a
free-floating scroll ref that must be withheld.

**And the honest limit.** No type reaches the unredacted emit (a missing function
call), the unbound stall indicator (a missing call site), the replay filter (a
string literal), the mis-sized constants (arithmetic against a workload), or the
13 unread channels (a fact about another tree). **Recommended, in order:**
(1) redact `display_text` and `push_ring`'s line — two edits, both chokepoints,
covering every stream in the app; (2) default `enableUnseenCounter` to `true` —
one edit, three call sites; (3) bind `useActivityMonitor` — one edit, the whole
60% case; (4) extract `useStickyBottom` per Q5 and migrate the 13; (5) the
producer ring + snapshot for `EXECUTION_OUTPUT` (P2), which subsumes the replay
filter; (6) keep §9's ratchet until (4) lands, then **delete** the rule.

## 9 The missing gate

### The condition, stack-free

> **A view moves the reader's viewport to the newest content on every arrival,
> without first measuring whether the reader was at the newest content.**

The give-away is that the act of following the stream and the act of measuring
the reader's position are written in two different places, or the second one is
not written at all. Wherever that is true, the stream is unreadable while it
runs: any attempt to read back is undone by the next chunk, and the interval
between chunks is short enough (corpus p50: **0.36 s**) that the user never
completes a sentence. There is no runtime signal — a correctly-following view and
a viewport-stealing one look identical whenever the reader happens to be at the
bottom, which is most of the time in a demo and never in an incident.

**The proxy, for this stack:** a React effect that assigns `scrollTop =
scrollHeight` with no stickiness identifier anywhere between the effect's opening
brace and the assignment. It is a proxy, not the condition — an adopting repo
should re-derive one against its own idiom (a Svelte `afterUpdate`, a Vue
`watch`, an `IntersectionObserver`-less `scrollIntoView` on a bottom sentinel, a
terminal library's `scrollToBottom()` call).

### Existing rules checked first

I read all **125** rules in `scripts/census/rules.json` before authoring (a
parallel session added three during composition; re-checked at **128**, same
result). **Zero of them key on scroll geometry** — a scan of every
`signal.pattern` for `scroll|scrollTop|scrollHeight|clientHeight` returns
**0 of 128**; widening to `|bottom` returns exactly one, `locale-blind-percent`,
where `bottom` appears inside a CSS-property lookbehind. Six were checked by name:

- **`unmanaged-tauri-subscription`** (`backend-to-frontend-events.md`, 45 files /
  68, `roots: ["src"]`) — a raw `listen()` without lifecycle management.
  **Adjacent and important**: it is the rule that would route
  `EXECUTION_OUTPUT`'s four subscribers into `createSingletonListener`, whose
  early-buffer cap this path shows drops lines (§6). Different anchor
  (a call expression vs an effect body + a scroll assignment); **1 of my 13 files
  overlaps**, with zero match overlap.
- **`unverified-clipboard-write`** (`copy-to-clipboard.md`, 22/32) — very
  adjacent given P0's clipboard finding, but it gates *whether the write was
  verified*, not what was in it. **1 of 13 files.**
- **`hand-rolled-spinner`** (`inline-busy-state.md`, 182/248, `roots:
  ["src/features"]`) — adjacent because a stream's empty state is often a
  spinner. Different anchor. **1 of 13 files** (the same file as above).
- **`render-time-redaction-toggle`** (`secret-and-pii-redaction.md`, 3/5) —
  **0 of 13.**
- **`hand-rolled-stale-token`** (`stale-response-guard.md`, 36/42) — **0 of 13.**
- **`unswept-job-registry-read`** (`long-running-job-progress.md`, 6/9,
  `roots: ["src-tauri"]`) — disjoint by root.

Running all 125 signals against my 13 files, the largest file-level co-occurrence
is **6/13 with `native-title-tooltip`** — which matches 571 files (12% of the
tree), so that is incidental co-location, not conceptual overlap. Highest
conceptual overlap is **1/13**.

### The rule

```json
{
  "id": "unconsulted-tail-pin",
  "goldenPath": "docs/concepts/golden-paths/live-log-stream-view.md",
  "title": "An effect pins a scroll container to the bottom on every new chunk without consulting whether the reader was at the bottom — so reading back through a running log yanks the viewport away mid-sentence.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "useEffect\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{(?:(?!shouldAutoScroll|atBottomRef|isAtBottom|AtBottomRef|userScrolledUp|stuckToBottom|stickToBottom|nearBottom|followTail)[\\s\\S]){0,400}?[\\w$.?]+\\.scrollTop\\s*=\\s*[\\w$.?]+\\.scrollHeight",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A React effect body that reaches an `x.scrollTop = y.scrollHeight` assignment without any stickiness identifier appearing between the effect's opening brace and the assignment. PROXY FOR the stack-free condition: 'a view moves the reader's viewport to the newest content on every arrival, without first measuring whether the reader was at the newest content.' MEASURED 2026-08-16 at 17d059b1f: 13 files / 13 matches, ALL THIRTEEN HAND-READ (precision 13/13) — the guards present at these sites are `miniPlayerExpanded` (ExecutionMiniPlayer.tsx:181), `isExpanded` (TerminalStrip.tsx:58) and a bare `if (ref.current)` at the other eleven, none of which is a position measurement. Sites: src/features/agents/executionPlayer/ExecutionMiniPlayer.tsx:180; src/features/onboarding/components/ExecutionStep.tsx:37; src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx:104; src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:269; src/features/plugins/dev-tools/sub_context/ScanOverlay.tsx:22; src/features/plugins/dev-tools/sub_runner/TaskOutputPanel.tsx:15; src/features/plugins/gitlab/components/JobRow.tsx:18; src/features/plugins/obsidian-brain/sub_revitalize/RevitalizeProgress.tsx:18; src/features/shared/components/terminal/TerminalStrip.tsx:57 (a SHARED component); src/features/templates/sub_generated/adoption/chronology/commandCenterParts.tsx:35; src/features/vault/sub_catalog/components/autoCred/helpers/autoCredErrorConfig.ts:19 (useAutoScrollRef — a REUSABLE HOOK whose whole body is the defect); src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowser.tsx:49; src/features/vault/sub_databases/tabs/ChatTab.tsx:49. WHY IT IS A DEFECT AND NOT A PREFERENCE: measured over the operator's real corpus of 2,998 runs, the median gap between consecutive stream lines is 0.36 s and p90 is 4.91 s, so a reader who scrolls up to re-read is returned to the bottom before finishing a sentence; the running log is unreadable by construction. CONVERGENCE: this is physics, not house taste — personas-web (ExecutionOutput.tsx:53-56,125-141, 24 px threshold) and vibeman (CompactTerminal.tsx:244-249,1074-1086, 50 px) independently arrived at the identical three-part shape this repo already has in src/features/shared/components/terminal/TerminalBody.tsx:86-93,260-274 (10 px + a sticky ref + a jump-to-latest affordance). LEGAL FIX: promote src/features/plugins/companion/useChatScroll.ts into shared/ as a `useStickyBottom()` that returns containerProps carrying BOTH the ref and the onScroll handler, so the bare element is never handed out and the unguarded pin becomes unwriteable. DO NOT silence a match by moving the assignment into a helper function outside the effect, by renaming the stickiness ref, or by adding an unrelated `if` — all three preserve the defect exactly; the honest fix always adds a distance-from-bottom measurement read at the assignment. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN — DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-16 @ 17d059b1f — 4,829 files walked; validated standalone in a scratch registry unique to this composer (rules-live-log-stream-view-probe.json), then re-extracted from this finished document and re-run through the real runner: 13/13 both times; 0.718 s for rule and control together."
  },
  "baseline": { "files": 13, "matches": 13 },
  "floor": 3000
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "unconsulted-tail-pin-positive-control",
  "goldenPath": "docs/concepts/golden-paths/live-log-stream-view.md",
  "title": "POSITIVE CONTROL — not a gate. The same tail pin, in the same effect shape, GUARDED by a stickiness measurement: the compliant form the rule must never report.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "useEffect\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{[\\s\\S]{0,400}?(?:shouldAutoScroll|atBottomRef|isAtBottom|userScrolledUp|stuckToBottom|stickToBottom|nearBottom|followTail)[\\s\\S]{0,200}?[\\w$.?]+\\.scrollTop\\s*=\\s*[\\w$.?]+\\.scrollHeight",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — the shape-discrimination control for unconsulted-tail-pin, and it carries no baseline by design. Same root, same extensions, same file walk, SAME EFFECT ANCHOR and SAME ASSIGNMENT; the only difference is whether a stickiness identifier appears between the effect's opening brace and the assignment. THE TWO POPULATIONS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION and, measured, share ZERO FILES — not merely zero matches. MEASURED 2026-08-16 at 17d059b1f: 4 files / 5 matches versus the rule's 13 / 13. Control sites: src/features/templates/sub_generated/generation/runner/DesignReviewTerminal.tsx:30,36 (a shouldAutoScroll ref, plus a ResizeObserver arm that re-checks it); src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx:129 (stuckToBottomRef, additionally gated on the list having actually grown); src/features/shared/components/layout/ReasoningTrace.tsx:161 (userScrolledUp, set by an onScroll handler at a 40 px threshold); src/features/shared/components/progress/TerminalBody.tsx:33 (useTerminalScroll — shouldAutoScroll at 10 px). A fifth compliant implementation, src/features/plugins/companion/useChatScroll.ts:61-63 (NEAR_BOTTOM_PX = 80), is deliberately outside BOTH patterns because it lives in a useCallback rather than a useEffect — a pin the caller invokes is not an automatic one, and the rule is about automatic pins only. If the rule were keying on the assignment alone rather than on the ABSENCE of a measurement, it would light up all four of these files too and report the repo's four correct implementations as violating; it reports none of them. Run both together whenever the rule's pattern is edited: if this control's count collapses, the walk or the anchor broke rather than the codebase being fixed. It is expected to RISE as the 13 violating sites are migrated onto a shared stickiness hook, which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ 17d059b1f — 4 files / 5 matches via the real runner; 0 file-level overlap with the rule."
  },
  "floor": 3000
}
```

### Verification of this gate's own preconditions

- **`floor: 3000`** against **4,829** files actually walked under `src`, matching
  the `raw-select` / `unverified-clipboard-write` / `render-time-redaction-toggle`
  precedent for this root — rules over one root must not hold different opinions
  about what "the tree is intact" means. A typo'd root walks 0 files and trips
  both `floor` and the zero-match structural failure.
- **Backtracking checked by execution, not assumed.** The pattern is a *bounded*
  tempered dot (`{0,400}?`, lazy, one character per step, one lookahead per step)
  behind a rare literal anchor (`useEffect(() => {`), so the expensive region is
  entered only at that anchor and is linear in the bound. **Real-runner wall time
  over 4,829 files: 0.718 s for rule and control together.** No nested unbounded
  quantifier, no variable-length lookbehind.
- **Not portable to the `regex` crate verbatim** — the tempered dot uses a
  negative lookahead, which Rust's `regex` does not support. That is acceptable:
  the signal is TypeScript-only by construction (`roots: ["src"]`, `.ts`/`.tsx`),
  and the census engine is JavaScript. Stated here so nobody discovers it while
  porting.
- **Precision is 13/13 by hand-reading, not by sampling.** Every match was opened
  and its guard read (the dump is in §7 P0). The control's 5 matches were read
  the same way.
- **No `exclude` entries.** All 13 matches are true positives, so there is no
  legitimate exemption and no stale suppression can accumulate. The four
  compliant files are excluded *by the pattern*, not by a list — which is the
  difference between a discriminating signal and a maintained allowlist.
- **The rule must reach zero and then be DELETED**, not baselined at 0. The
  census cannot express "must be zero", and a rule pinned at 0 can never fail.
  The `useStickyBottom` extraction in "Prefer a type over a gate" removes all 13
  at once.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.
- **Where it runs:** the **`golden-path-census` pre-push job**
  (`lefthook.yml:74-75`, `npm run census:check`) and inside `npm run check`
  (`package.json:52`). **Not CI** — `ci.yml` is red on pre-existing failures, so
  a gate that only ran there would run nowhere.

### Gates I rejected, with numbers

| candidate | violating | compliant control | why rejected |
| --- | ---: | ---: | --- |
| **an unbounded `.map` over a stream-ish array in JSX** (`{lines.map(`, `{output.map(`, …) | 15 files / 15 | 8 files / 8 (`X.slice(-N)`) | The partition looks clean and the precision is not: hand-reading the 15 found `SectionEditor.tsx`, `ConflictDiffView.tsx`, `NoteLayer.tsx`, `SinceYouLeftBriefing.tsx` and `LogExcerptWidget.tsx` are **not live streams** — they map a finite array that happens to be called `lines`. Roughly 60% precision, and the name `lines` is doing all the work. **A gate that fires on correct content is worse than no gate.** |
| **an emitted stream chunk with no redactor** (`ExecutionOutputEvent { line: … }` not wrapped in `sanitize_secrets`) | **12 construction sites in 3 files, 12 unredacted** | **0** | The cleanest *finding* in this document and an unusable gate: the compliant population is **empty**, so the control returns zero and the pattern is not discriminating on what it claims. This is the same failure the `secret-and-pii-redaction` path recorded for its mask-marker candidate. Carried as §7 P0 instead — **two edits at two chokepoints correct every stream in the app, and no ratchet would move one of them.** |
| **a line-bearing event with no frontend subscriber** | 13 of 26 channels | 13 | Not expressible: it is a relationship between two trees (a Rust emit and the absence of a TypeScript subscribe), and the census matches a pattern *within* a file. The honest instrument is a **different** one — a parity checker in the shape of `scripts/check-event-registry.mjs`, extended to assert that every payload carrying a `line`/`chunk` field has at least one subscriber. Specified here, not built. |
| **a hand-picked buffer constant** (`MAX_*LINES`, `*_CAP`, `MAX_*BYTES`) | **22 stream-buffer constants across 15 files** | **1** (`useTraceData.ts:26`) | The condition is *"this number was chosen by rounding rather than derived from the producer's ceiling"*, and that is unreadable from the statement — `MAX_LINES = 500` and `MAX_BUFFERED_SPAN_EVENTS = 10_000` are syntactically identical and only one has a derivation, in a comment. A 1-match control is a control returning ~0. The instrument that actually settles it is the corpus replay in §6, which must be **re-run**, not ratcheted. |
| **`useActivityMonitor` / stall-indicator absence** | 1 (zero call sites) | — | The census cannot assert an absence, and a rule with one match is a rule that fails structurally the moment the hook is deleted. Carried as §7 P1. |

The general limit worth restating: **the census can ratchet a condition present in
a statement, and can say nothing about a condition that is a relationship between
code and a workload.** Every headline in this document is the second kind — a cap
against the traffic it will actually see, a filter against the emit it is meant
to mirror, a signal against the consumer it never got — and each was found by
**executing something**: replaying 268,482 real stream lines through the app's own
display arm, reconstructing the silence structure of 2,982 runs from their
timestamps, and cross-checking 26 event channels against both trees.

## 12 Corrections to the brief

The brief primed five leads and asked four questions. **Three leads survive
intact, one is materially wrong in the app's favour, one is understated, and the
biggest finding was in none of them.**

**1. "2,999 log files / 419 MB on disk, plus 1,512 orphans and 595 dangling
paths." — CONFIRMED, with three small corrections.** Measured: **2,998 `.log`
files** (the 2,999th directory entry is not a log) totalling **430,731,004 bytes
= 410.8 MB of content** (418 MB of on-disk allocation — `du` and `wc -c` disagree
by block overhead, and the brief quoted the allocation). **Dangling: 595 —
exact.** **Orphans: 1,519** by the definition "on disk, referenced by no row's
`log_file_path`" (1,448 by the stricter "no execution row exists with that id");
the brief's 1,512 is within the drift of a live database. Nothing prunes them —
that belongs to [retention-and-pruning](./retention-and-pruning.md).

**2. "Those files contain credential shapes… the historical files are
unsanitized." — CONFIRMED, and the important half is the other direction.** The
brief pointed at the *files*. The files are the sink the 2026-08-14 fix covered.
**What nobody had measured is that the same bytes were on the screen first, and
that path has no redactor at all** — §"headline 1", with `file:line` and 15,363
reconstructed matches. The brief's own framing contained the clue and pointed the
opposite way: the disk redactor exists precisely *because* the stream is
unfiltered, and the emit sits 15 lines from the `sanitize_secrets` call.

**3. "The log-reading commands mask on READ — measure whether the stream path
does the same." — MEASURED. It does not.** `executions.rs:658,703,716` mask;
`runner/mod.rs:2179-2188` does not, and `background_job.rs` contains zero
redaction of any kind, covering 19 more streams. The read command's own comment
(`:646-657`) names `ExecutionLogViewer.tsx`'s copy button as the reason it was
hardened — and **`ExecutionTerminal.tsx:42` is the same button over the
unhardened source.**

**4. "`log_truncated` is assigned `logger.had_write_errors()`, is 0 on all 2,188
rows, and the real 10 MB cut-off writes nothing." — CONFIRMED on all three
clauses, and there is a third truncation mechanism the brief did not name.**
`log_truncated = 0` on 2,188/2,188 rows, verified on a read-only copy.
`output_truncated` is assigned at `runner/mod.rs:2156` and **never read**.
The third is `executionSink.ts:20,232-238`, a client-side 10 MB budget that
reaches no column, no event and no row. **And the correction that matters: the
real cut-off has never fired.** Zero of 2,998 log files exceed 10 MB (largest:
1,227,235 bytes) and zero carry the `[RUNNER] stdout truncated` marker. The
column is wired to the wrong event *and* the right event has never occurred.

**5. "Loading doctrine: a spinner is banned for a surface; `LoadingSpinner`
renders `null`." — CONFIRMED and extended.** `feedback/LoadingSpinner.tsx:12-20`
renders `null` without a `label`, and `RevitalizeProgress.tsx:26` — the header of
a *live narration* panel — calls it with no label, so the "running" affordance is
nothing. **But the doctrine needs a clause for this leaf that it does not have:
a ghost is also wrong for a stream.** `docs/design/overview-loading.md`'s
prescription is a geometry-matched skeleton under permanent chrome, which
presumes a known result shape. A stream has none — it is empty until the process
speaks, and it may stay empty legitimately for 33 seconds (corpus median maximum
silence). The correct third form is a **named waiting state**, which
`terminal/TerminalBody.tsx:112-146` already implements as a four-arm union
(`idle | connecting | queued | failed`) and which nothing in the loading doctrine
mentions. Offered upward.

**The four questions the brief asked, answered.** *How does output reach the
view* — a global Tauri broadcast, per line, at 26 channels, of which 13 have no
reader; never a poll, never a file tail (the file tail is only the reload path,
and it is lossy). *Is the buffer bounded and what happens when it fills* — bounded
three times over, and **it has never filled**: 230× headroom on bytes, 25× on
lines, in 2,998 real runs; what actually fires is the per-line clamp, on 1.82% of
emitted lines including the entire top percentile. *Does scroll-follow fight the
user* — at 13 of 19 sites, yes, and the app already contains four correct
implementations and a fifth in a plugin folder. *Is a stream that ends
distinguishable from one that stalled* — **no**, and the machinery to make it so
exists, is correct, and has zero call sites, while 60.03% of runs contain a
silence long enough to trip it.

**Three corrections to my own work.**

**(a) My replay instrument understated the emitted-line count by 1,281 and I
nearly published it as a defect in `parser.rs`.** My transliteration of
`subagent_message` handled `text` and `tool_use` blocks and dropped `tool_result`
on the floor — so I measured "subagent tool results are silently dropped from the
live view", which would have been a good finding if it were true. The shipping
code has the arm (`parser.rs:56-60`, `tool_name = Some("tool_result")`), and my
second implementation — the crude one, which I expected to be the wrong one —
was right. Corrected: **131,264 emitted, not 129,983.** *The doctrine's rule is
that agreement is not soundness; the corollary this run earned is that the
cruder implementation is not automatically the wrong one, and "my faithful
transliteration disagrees with my rough check" is not evidence about which is
faithful.*

**(b) My first scroll-pin classifier was wrong in both directions and its word
list is why.** It reported 11 unguarded / 8 guarded. Hand-reading all 19 gave
**13 / 6**. It called `ReplayTerminalPanel.tsx:135` unguarded because its list
had `stick` and the code says `stuckToBottomRef`; it called
`ExecutionMiniPlayer`, `RevitalizeProgress` and `useAutoScrollRef` guarded
because `pinned`, the word "Pin" **in a comment**, and the substring `AutoScroll`
inside `useAutoScrollRef` all matched. **Three of four false positives came from
matching prose or a function's own name rather than a guard.** This is the
doctrine's "a vocabulary-based signal's recall is bounded by its author's word
list" — and the new half is that its *precision* is bounded by the same list
matching things that are not code. The shipped rule keys on the **absence** of an
exact identifier and was validated by hand-reading every match, not by trusting
the word list.

**(c) I expected the headline to be "the buffers are unbounded".** It is the
opposite. There are **22 stream-buffer constants across 15 client files** plus
three server rings, three per-line clamps, a byte budget, a tail ring, a
truncation notice, a Web Worker classifier and a virtualizer — and
**the workload is 25× to 230× smaller than any of it.** Nobody had run the numbers
against the corpus, so the app has an elaborate, correct, well-commented answer
to a problem it does not have, and no answer at all to the two it has every day:
the 4,096-character clamp that cuts the 99th-percentile message, and the
33-second median silence that looks exactly like a crash. **A composer who had
only checked "is it bounded?" would have written "well handled, minor gaps" and
missed the subject of the leaf entirely.**
