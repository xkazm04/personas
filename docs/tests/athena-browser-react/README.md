# Athena browser-page reaction test

> Design record for the measured use case "the user looks at a page in the Browser
> webview, asks Athena what she thinks, and she either answers at once from her own
> knowledge or dispatches background research while the conversation stays open".
> Written 2026-09-18 before the build; the harness result lands beside it.

## The question the test answers

Two scenarios over one static page, per Athena tier setup (engine, model, effort):

| Scenario | The user's ask | Expected shape | What is measured |
|---|---|---|---|
| A. Immediate reaction | "What do you think about this page?" | One turn, answered from the page block plus her own knowledge, no job | spawn-to-first-visible-token, turn total, no `research` job |
| B. Research dispatched | "Research whether the claims on this page hold up, then tell me what you think." | A short first reply that dispatches a `research` job; later a proactive follow-up turn in the same conversation with the findings | first token of the interim reply, job started/completed, follow-up turn latency |
| B2. Responsive while researching | Sent while the B job runs: "Meanwhile, what is the capital of Australia?" | Answered at once from default knowledge; the research job keeps running | first token and total of the second turn, proof the job was still running when it was answered |

Per tier setup the harness records, in `.planning/athena-browser-react/results.jsonl`, one row per turn with the tier that served it and the timings, and writes a report per setup.

## The page

`docs/tests/athena-browser-react/fixture/index.html`: a one-screen static product page for a
fictional device, the "Lumen Desk Lamp Pro", written so that

- a reaction from general knowledge is possible (ergonomics, blue light, pricing tiers), and
- three concrete claims invite checking against the live web (a named IEEE standard for
  flicker, a cited 2026 study, a competitor comparison) so a "research the claims" ask has
  something to fetch.

It carries no scripts and no external assets, so its text is stable across runs. The harness
serves the fixture directory over HTTP on a local port (the webview refuses `file://` twice:
the whitelist writer and the navigation gate), and makes sure a whitelist row covers that
origin (`http://localhost:3000` is seeded; any other port gets an exact-origin row through the
site commands).

## What Athena sees: the focused-page block

A plain chat turn carried no page content before this work. The turn now composes a
`# What you are looking at (Browser)` block when the Browser webview has a focused tab:
the tab's URL, its title and up to 8,000 characters of the page's visible text, extracted
through the webview host, plus one line naming that the text is a capture and may be
truncated. The block is dynamic context: on a warm session it travels in the user line's
`# Context for this turn`, on a cold spawn in the composed prompt, so the cached prefix is
untouched. No tab focused, no block. The constitution and the chat core teach the block:
react to what is there, quote what you quote, never claim to have read what the capture cut.

## The research lane

A new op, `research` (auto, read-only, no approval): `OP: {"op":"research","question":
"...", "context": "..."}`. The dispatcher enqueues a `research` background job in the
conversation; the job runs a headless ASIDE-tier turn (the calibrated Sonnet tier) with only
`WebSearch` and `WebFetch` allowed and a bounded turn count, writes the findings as the job
result, and then spawns a proactive follow-up turn in the SAME conversation
(`TurnOrigin::Proactive { trigger_kind: "job_completed" }`) that reads the findings and answers.
That follow-up waits for the conversation lock like a user turn does, so a question the user
sends while the job runs is answered first and the findings arrive after it. The conversation
never blocks on research: the job worker holds no turn lock.

## Timing doors

- `companion_turn.first_text_ms` (spawn or user-line write to the first visible token),
  `duration_ms`, `engine`, `tier_class`, `model`, `origin`, `conversation_id`, read from
  `personas_data.db` with `node:sqlite`.
- `companion_background_job.created_at / started_at / completed_at` for the research job.
- Stream timestamps captured in the page through the test-automation server (`/eval` installs
  a `companion://stream` listener that stamps `performance.now()` per event and exposes them
  on `window.__athenaBench`), so the first visible token is also measured from the UI side.
- The tier is set per run through `companion_set_engine_settings` over the bridge.

## Running it

```
npm run tauri:dev:test            # the app with the test-automation server on :17320
node scripts/e2e/athena-browser-react.mjs --setups main:claude:claude-opus-5:low,main:claude:claude-sonnet-5:low,main:grok:grok-4.6:low --reps 2
node scripts/e2e/athena-browser-react.mjs --report
```

The run is serial per setup (one conversation per setup per rep, created fresh), and every
row carries the setup that served it. A setup whose engine is not installed is recorded as
skipped, not as a failure. The operator runs it; it is never part of a gate.

## Results

**Not yet run.** The harness was built and unit-tested against the app's real command
names; no live run has been made and `.planning/athena-browser-react/` holds no rows.

### Running it (confirmed against the harness flags)

```
npm run tauri:dev:test                                   # the app + test-automation server on :17320
node scripts/e2e/athena-browser-react.mjs --dry-run      # app up, engines probed, fixture served + opened; nothing sent
node scripts/e2e/athena-browser-react.mjs                # default: main:claude:claude-opus-5:low,main:claude:claude-sonnet-5:low, 1 rep, A+B
node scripts/e2e/athena-browser-react.mjs --setups main:claude:claude-opus-5:low,main:grok:grok-4.6:low --reps 2 --scenarios A,B
node scripts/e2e/athena-browser-react.mjs --report       # -> .planning/athena-browser-react/report.md
```

Flags: `--setups main:<engine>:<model>:<effort>,...` (an empty effort is the tier's calibrated
default; only the MAIN tier is driven, aside and micro keep their current values), `--reps N`
(default 1), `--scenarios A,B`, `--port` (test-automation, default `PERSONAS_TEST_PORT` or
17320; `PERSONAS_BASE` overrides the whole base URL), `--fixture-port` (default 3000, the
seeded whitelist origin), `--timeout <s>` per turn and per wait (default 300), `--fresh`
(ignore recorded rows), `--dry-run`, `--report`, `--help`. `PERSONAS_DB_DIR` points at the
directory holding `personas_data.db` (default `%APPDATA%/com.personas.desktop`). Exit codes:
0 done, 1 harness error, 2 app not reachable.

Resume: a key `(setup, rep, scenario, turn)` that already has a clean row (no `error`, no
`timedOut`) is skipped; errored and timed-out keys are re-run. An engine reported
`installed: false` by `companion_probe_engines` records `skipped` rows and moves on.

### What the harness drives (command names verified by grep)

`companion_probe_engines`, `companion_get_engine_settings`, `companion_set_engine_settings`,
`companion_create_conversation`, `companion_send_message` (through `window.__TEST__.invokeCommand`
in a fire-and-forget `/eval`, outcome read back from a DOM node with `/query`, because the
`/bridge-exec` dispatcher caps a method at 25 s and a turn runs minutes), `browser_sites_list`,
`browser_sites_upsert`, `browser_sites_set_enabled`, `browser_webview_list`,
`browser_webview_open`, `browser_webview_navigate`, `browser_webview_focus`; the test-automation
routes `/health`, `/navigate` (`teams`), `/click-testid` (`teams-webview-nav`), `/eval`,
`/query`, `/bridge-exec`; and the bridge method `athenaStreamTimeline` (`install` | `read` |
`drain` | `clear`), which stamps every `companion://stream` event with `performance.now()` and
`Date.now()` on `window.__athenaBench`, classifies `cli` lines (`text_delta`, `thinking_delta`,
`tool_use` with the tool name, `result`), and accumulates the visible text per turn id.

Ledger reads (`node:sqlite`, read-only, `personas_data.db`): `companion_turn` by
`assistant_episode_id` for `first_text_ms`, `duration_ms`, `engine`, `tier_class`, `model`;
`companion_background_job` by `conversation_id` for the `research` job; the proactive follow-up
through `companion_turn.origin = 'proactive'` joined to `companion_node.session_id` (the ledger
row carries no conversation column of its own; the stream's `sessionId` is the conversation id).

### Row schema (`.planning/athena-browser-react/results.jsonl`, one row per turn)

`ts, setup, engine, model, effort, rep, scenario (A|B), turn (A|B|B2|B_followup), conversationId,
message, uiFirstTextMs, ledgerFirstTextMs, durationMs, toolsUsed[], researchDispatched,
jobCreatedAt, jobStartedAt, jobCompletedAt, jobStillRunningAtSend, jobStillRunningAtFirstToken,
followupLatencyMs, turnText (first 1200 chars), error, timedOut, skipped, note`, plus the
diagnostics `turnId, ledgerTurnId, uiFirstChunkMs, uiFirstChunkKind, uiFinishedMs,
firstTextWallMs, sendWallMs, assistantEpisodeId, ledgerEngine, ledgerModel, ledgerTierClass,
jobId, ledgerTriggerKind`.

Two first-token series, never pooled: `uiFirstTextMs` is the first `text_delta` stamp minus
the page-side send stamp (what the user waits); `ledgerFirstTextMs` is the backend's
`first_text_ms`. `followupLatencyMs` is the follow-up's first `text_delta` wall stamp minus
the job's `completed_at`; when the stream missed it, the ledger approximation
(`created_at - duration_ms + first_text_ms - completed_at`, second resolution) is used and the
row's `note` says so.

### What the app does not expose, and how the harness stands in

- Document load in the webview: `browser_webview_list` reports `focused`, which the harness
  waits on (up to 15 s), but nothing reports "loaded"; it then waits a fixed 1,500 ms and
  writes that into the row notes.
- Research not yet in the build: when no `research` job appears within 20 s of the B send,
  the B row records `researchDispatched: false` with the turn's tool names (the pre-work
  in-turn WebSearch/WebFetch behaviour); B2 is still sent and measured; no follow-up is waited
  for. The harness runs against today's build as well as the one with the research lane.
- Stream events carry no timestamp; the UI-side stamp is taken at receipt in the page.

### Report (`--report`)

Per setup x scenario: attempts / ok / skipped / timed out / errors, p50 and p90 UI first
text (with n), p50 and p90 ledger first text, p50 and p90 total, tools seen, research dispatch
rate (B), B2-answered-while-the-job-ran rate (B), p50 B2 first text, follow-up latency p50 and
p90 (B); then the harness notes and the error list.

## Out of scope

Voice; the Extension and Playwright backends (the webview host is the fixture's home); a
multi-page browse by Athena during research (the research turn has the web tools, not the
webview); judging answer quality (the rows keep the turn text for an offline judge pass).
