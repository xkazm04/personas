# Layered voice

Athena's replies are layered. Layer one is a short reply of at most N sentences (base 3, adaptable
per scope). Where the detail lives elsewhere, it links there in natural language (a report,
decision, card, session, job or memory) rather than pasting raw ids or dumping the detail inline.
Layer two is where that detail lives: reports written for the purpose, and the existing records
the links resolve to.

This page is the wire contract. The prompt and register (WP1), the dispatcher (WP2) and the
frontend (WP3) all build against it.

## Why: the baseline

Measured on 535 live replies, 2026-09-23:

| Measure | Value |
| --- | --- |
| Median reply length | 835 chars / 133 words |
| p90 reply length | 1,592 chars |
| Replies longer than 600 chars | 56% |
| Replies containing at least 1 raw id | 29% |
| Replies containing 3 or more raw ids | 8% |
| Backticked tokens per reply | p50 1 / p90 5 |

## Reference links

Grammar:

```
[<phrase>](ref:<kind>/<handle>)
```

- `kind` is one of: `approval | card | decision | report | session | job | memory | goal | persona`.
- For `memory`, the handle is the full brain id including its prefix (`fact_…`, `goal_…`).
- `report/new` refers to the report emitted in the same reply. The dispatcher rewrites it to the
  minted id.
- An invalid or unknown link is replaced by the dispatcher with the plain `<phrase>`.
- Links inside code spans are not parsed.

## Ops

### `show_report`

```json
{"op":"propose_action","action":"show_report","params":{"title":"<=80 chars","summary":"<=240 chars, optional","body":"markdown <=12000 chars"},"rationale":"…"}
```

Both ops are taught in this canonical `propose_action` form, the one the generated op reference
prescribes. The dispatcher also accepts the bare spelling (`{"op":"show_report",…}`) so an
off-script line is not lost, but no prompt teaches it.

Persisted as a `companion_chat_card` row with `kind:"report"`,
`config_json {"summary":…,"body":…}` and `status:"unread"|"read"`. It is read back through
`companion_get_report` and marked read through `companion_mark_report_read`.

Caps are defined in `src-tauri/src/companion/reports.rs` (`MAX_REPORT_TITLE_CHARS`,
`MAX_REPORT_SUMMARY_CHARS`, `MAX_REPORT_BODY_CHARS`).

### `adjust_register`

```json
{"op":"propose_action","action":"adjust_register","params":{"scope":"default"|"<topic>","sentences":1..8,"reason":"…"},"rationale":"…"}
```

Writes one `companion_reply_register` row through `companion::register::apply_op`, the single
validator for both paths. The row's `source` is `operator` when Athena emits the op because he
asked in chat (it auto-fires, no card), and `reflection` when he approves a reflection proposal
(an `adjust_register` approval card, executed by `execute_adjust_register`; see
[Register](#register)).
`apply_op` takes `sentences` as the raw JSON integer (out of range is a `Validation` error, never a
wrap), normalises the scope (trimmed, lower-cased, inner whitespace collapsed) and returns the
stored row.

## Prompt

Layer one is taught once, as a `# Layer one` section, in both static cores:
`src-tauri/src/companion/templates/chat-core.md` (the chat family, MAIN tier) and
`templates/constitution.md` (the full family, every other tier; `CONSTITUTION_VERSION` 67). The
two copies carry the same text. It is written as checkable rules, each stating what happens when
it is broken, and taught by three before/after examples with made-up names:

- Every reply is layer one, what she would say aloud. Lead with the answer; never restate the
  question.
- At most N sentences, N from the per-turn flag (3 when absent). A list of up to 3 short items
  counts as one sentence. Past N the reply is folded.
- Longer is a report: `show_report`, linked as `[phrase](ref:report/new)`.
- No printed ids, hashes, session or job numbers, including in inline code. Names from context,
  or a ref link whose handle is copied verbatim; an invented handle degrades to plain words.
- A rendered card, approval or report is never described in prose.

What changed around it:

- The old length rules are gone: "a short paragraph or two by default" (chat core) and "two
  paragraphs" (constitution), and both cores stop putting ids in `inline code`.
- **The voice-only register is retired.** Layer one is the spoken register, so a voice-on turn no
  longer gets a second register. The dual-language display addendum and the `# VOICE PLAYBACK`
  TTS-emission addendum (`prompt/addenda.rs`) are deleted, and so is the constitution's "Spoken
  summaries (TTS replies)" section with its stale ElevenLabs line. Both families now carry the same
  short `# Voice is on for this turn` flag (`chat_family::voice_flag`), and `TTS:` is an optional
  escape for a reply whose visible form must differ from speech (a table, a snippet).
  `PROGRESS:` is unchanged.
- `adjust_register` is taught in the chat core's machine-line section and in the constitution's
  `## Adjusting the register`. Its exact params shape comes from the generated op reference.
- Injected directives point at layer one instead of restating a length. The fleet completion
  directive (`commands/companion/fleet_bridge.rs`) drops "in one or two sentences". The research
  follow-up (`jobs/research.rs`) drops "briefly" and asks for the verdict in layer one, with
  sources in a report. Every proactive turn that reaches the chat gets one suffix line
  (`session/turn.rs`, `PROACTIVE_LAYER_ONE_SUFFIX`): "Reply in layer one (see Layer one): link to
  the detail, do not restate it." The suppressed fleet-orchestration turn, whose `<id8>: OK:`
  output never reaches the chat, is left as it was.

### The per-turn flag

Every turn, in both families, carries one line in the `display` block (which held the retired
dual-language addendum):

```
Layer one this turn: at most 3 sentences. Topic overrides: fleet updates 5.
```

It is rendered by `register::layer_one_flag` from `register::effective(user_db)`
(`chat_family::layer_one_flag_for`). With no rows it reads `at most 3 sentences.` and has no
overrides clause. At most 8 overrides are rendered. The rules live in the static core and the
number lives in the flag, so a register change never invalidates the warm session's cached
prefix: the `display` block rides after identity, in the per-turn half. The bench
(`prompt/bench_render.rs`) has no database and renders the base flag.

## Register


Table `companion_reply_register` in the companion **user** database (`COMPANION_SCHEMA`,
`src-tauri/db/src/lib.rs`, next to `companion_chat_card`):

```sql
CREATE TABLE IF NOT EXISTS companion_reply_register (
  scope      TEXT PRIMARY KEY,
  sentences  INTEGER NOT NULL CHECK (sentences BETWEEN 1 AND 8),
  source     TEXT NOT NULL CHECK (source IN ('operator','reflection')),
  reason     TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `scope = 'default'` is the global register. Any other scope is a topic override.
- No `default` row means the base register, `LAYER_ONE_BASE_SENTENCES = 3`.
- `companion::register::effective(pool)` returns `{ default_sentences, overrides: [(scope, n)] }`.
  It never fails: an unreadable table degrades to the base register.

### Who moves it

- **He does, in chat.** "Shorter", or "more detail on fleet updates", makes Athena emit
  `adjust_register` (scope `default` or a short topic) and confirm in one sentence. The op
  auto-fires through `apply_op`.
- **Reflection may propose it, and he approves.** `register::propose_from_recent(pool)` reads the
  last 7 days (`SIGNAL_WINDOW_DAYS`) and returns `Option<RegisterProposal>`. It writes nothing.
  - *More* when at least 3 user messages match `more detail | tell me more | expand | explain
    more | go deeper` (case-insensitive), or when at least 3 reports exist and at least 80% of
    them were opened (`companion_chat_card` rows with `kind = 'report'` and `status = 'read'`).
  - *Less* when at least 3 user messages match `shorter | too long | tl;dr`.
  - A message counts only when it directly follows an assistant reply in the same conversation.
    An opener like "tell me more about X" asks for a topic and does not judge the previous reply.
    A message matching both families counts as neither.
  - Contradicting signals (more and less at once) produce no proposal. A proposal moves the
    `default` register one sentence and never past 1..=8.
  - `RegisterProposal::params()` is the op's own `{scope, sentences, reason}` shape, and
    `rationale` is the one sentence the approval card shows. The proposal goes through the existing
    approval path (`companion_approval`, action `adjust_register`). On approval the executor calls
    `apply_op`.
- **Where the proposal is raised.** `register::maybe_propose_register(user_db, sys_db, app)` runs
  on the proactive tick, from the same two call sites as `profile_synthesis::maybe_run_synthesis`
  (`commands/companion/mod.rs`, `commands/companion/proactive.rs`). At most once per 7 days
  (settings key `companion_register_reflection_last`, stamped when the pass runs) it calls
  `propose_from_recent`. When that returns a proposal it inserts ONE pending approval (action
  `adjust_register`, params `RegisterProposal::params()`, rationale `RegisterProposal::rationale`)
  and emits the approvals event, the same way `propose_identity_update` does. It files nothing
  while an `adjust_register` approval is still pending. It is not gated by the
  `companion_profile_synthesis` toggle: it makes no model call and only files a card he must
  approve. The sleep cycle is not involved.

## Turn measurement

`companion_turn.outcome_json` gains the keys `replyWords`, `replySentences`, `bareIds`, `refLinks`,
`refsDropped` and `reportEmitted`. These keys are absent on headless rows.

## Absent-value conventions

- **Absent means not measured, never 0.** A missing `outcome_json` key means the turn was not
  measured. It does not mean a count of zero.
- `ReplyShapeStats` measures (`medianWords`, `p90Words`, `idRate`, `refRate`, `reportsPerDay`) are
  `null` when no row in the window carries the underlying key. They are never `0`.
- `CompanionReport.summary` is `null` when the op omitted it or sent it blank.
- `ReplyRegisterRow.reason` is `null` when blank.

## IPC surface

| Command | Returns | Notes |
| --- | --- | --- |
| `companion_get_report(id)` | `CompanionReport` | `NotFound` if there is no such row or it is not a report |
| `companion_mark_report_read(id)` | `()` | Idempotent. `NotFound` as above |
| `companion_list_reply_register()` | `ReplyRegisterRow[]` | `default` first, then topics alphabetically |
| `companion_reply_shape_stats(days)` | `ReplyShapeStats` | `days` clamped to 1..365. Currently a stub: `turns` is real, every measure is `null` |

Frontend wrappers in `src/api/companion.ts`: `companionGetReport`, `companionMarkReportRead`,
`companionListReplyRegister` and `companionReplyShapeStats`.

Wire types (ts-rs, camelCase):

- `CompanionReport { id, title, summary: string | null, body, status, createdAt }`
- `ReplyRegisterRow { scope, sentences: number, source, reason: string | null, updatedAt }`
- `ReplyShapeStats { days, turns, medianWords, p90Words, idRate, refRate, reportsPerDay }`. Every
  field after `turns` is `number | null`.

## Measurement

Three instruments, all local, none of which ever prints episode or message text — only aggregate numbers.

### 1. Bench `replyShape` check (soft class)

`node scripts/test/athena-model-bench.mjs` scores every turn's cleaned display text against the layered-
voice contract in three ways, computed by `scripts/test/lib/reply-shape.mjs` (`countSentences`,
`countBareIds`, `scanRefLinks`):

- **sentence cap** — prose split on `[.!?]`; a markdown list of at most 3 consecutive items counts as ONE
  sentence (a longer list counts each item). Default cap is 3; a scenario can set
  `expect.replyShape.cap` to something tighter (e.g. `2` for a long-explanation reply, `1` for small talk).
- **bare ids == 0** — the id definition (amended by the Director 2026-09-23; this is the ONE definition the
  bench and `reply-stats.mjs` both use): a uuid, a 7-40 char hex run containing at least one digit and one
  letter, or an `(ep|op|sess|job|appr|goal|fact|doc|proc|bl|dec|card|task)_…` id, counted everywhere EXCEPT
  a ref-link handle or a FENCED code block. **An id inside inline code counts** — `` `appr_1a2b3c4d` `` is
  exactly as visible to the reader as `appr_1a2b3c4d` in plain prose, and today's pre-layer-one prompt
  (`chat-core.md`) explicitly wraps ids in inline code, so exempting inline code was measured to hide most
  of the very habit this feature exists to fix (see the baseline note below). A separate, stricter count
  that exempts ALL code spans (fenced + inline) is available as `bareIdsStrict` for comparison only — never
  what a check or a report scores against.
- **well-formed ref links** — every `[phrase](ref:kind/handle)` has a kind from the contract's 9-kind list
  and a non-empty handle and phrase; a `(ref:…)` parenthetical that never resolved to a well-formed link at
  all is also flagged.

This is a **soft** class by default: the check always reports its numbers per scenario (visible in
`--report`'s per-scenario check list and in `results.jsonl`), but only fails the scenario's `pass` when
that scenario sets `"hardShape": true`. Reasoning: layer one is a new prompt contract most of the existing
36-scenario corpus was never taught, so a hard gate here would fail every pre-layer-one cell on a rule it
doesn't know exists. As the prompt rolls out (WP1) and more of the corpus is written with layer one in
mind, more scenarios can flip to `hardShape: true` — today only `layer-one-smalltalk` does (small talk has
no report/register escape hatch, so a multi-sentence reply there is a real miss, not an untaught class).

A new predicate, `expect.reportCard`, checks the validator's `chatCards` array for a `kind:"report"` entry
— the structural evidence that a `show_report` op fired. It's used by 3 of the 8 new scenarios and reads
FAIL until WP2 wires the op (each such scenario's `_note` says so — that's expected, not a WP4 regression).

Run it:
```bash
node scripts/test/athena-model-bench.mjs --help                              # lists all classes incl. layer_one, no model/build
node scripts/test/athena-model-bench.mjs --self-test                         # unit-checks the counters on 5 fixtures, no model/build
node scripts/test/athena-model-bench.mjs --dry-run --scenarios layer_one     # schema + sample round-trips, builds the validator, no model
node scripts/test/athena-model-bench.mjs --cell s-low --scenarios layer_one --reps 3   # spawns the model
node scripts/test/athena-model-bench.mjs --report                            # aggregate report.md, per-scenario replyShape numbers included
```
The same counters back a vitest wrapper, `src/__tests__/companion/replyShapeCounters.test.ts` — `npm run
test -- --run src/__tests__/companion/replyShapeCounters.test.ts`.

### 2. The 8 `layer_one` fixture scenarios

`scripts/test/fixtures/athena-bench/scenarios.json` — `layer-one-daily-brief`,
`layer-one-fleet-status-4-sessions`, `layer-one-findings-list-7-items`, `layer-one-decision-waiting`,
`layer-one-what-changed-pumper-session`, `layer-one-long-explanation`, `layer-one-smalltalk`,
`layer-one-adjust-register-more-detail`. Each `_note` states what it exercises and any WP2-dependency
caveat (report emission and register adjustment have no structural predicate until WP2's ops land; two
scenarios carry hand-written `sample` texts using ref links so `--dry-run` demonstrates the id-exclusion
rule without spawning a model).

### 3. `npm run athena:reply-stats` — the live-brain baseline

`scripts/companion/reply-stats.mjs` walks `~/.personas/companion-brain/episodes/**` (frontmatter
`role`/`created` only), computes the same reply-shape numbers over every `role: assistant` episode, and
prints aggregates — reply count, date range, median/p90 words, median/p90 chars, `%` with >=1 bare id, `%`
with >=3, `%` with >=1 ref link, and reports/day (read from `companion_chat_card WHERE kind='report'` in
the user db, read-only; `n/a` if the db or table isn't reachable — never a crash). `--since <date>` scopes
the window, so a before/after comparison is `athena:reply-stats --since <day before WP1/WP2 ship>` run
twice, once before and once after, and diffed by hand.

`reply-stats.mjs` reports the same primary `bareIds` count section 1 defines above, plus one comparison
line, `bareIdsStrict` (all code spans exempt, not just fenced), labeled "strict" in the output — never a
second primary metric, just a "how much of this was backtick-wrapped" data point. Both counters live in
`scripts/test/lib/reply-shape.mjs` (`countBareIds` primary, `countBareIdsStrict` comparison-only), so the
bench and `reply-stats.mjs` never drift apart on what "bare id" means.

**Baseline, measured 2026-09-23** (this machine, all history: 2026-06-08 .. 2026-09-21; re-measured after
the Director's inline-code amendment — the numbers below are unchanged from the pre-amendment run because
this corpus has essentially no fenced code blocks, so primary and strict happened to coincide until now;
they will diverge once fenced code appears in a reply):

| metric | value |
|---|---|
| replies | 535 |
| median words | 133 |
| p90 words | 250 |
| median chars | 835 |
| p90 chars | 1,609 |
| >= 1 bare id (primary) | 29.3% (157/535) |
| >= 3 bare ids (primary) | 7.9% (42/535) |
| >= 1 bare id (strict, comparison only) | 8.6% (46/535) |
| >= 1 ref link | 0% (expected — pre-WP1/WP2, no ref links exist yet) |
| reports/day | 0 (expected — `companion_chat_card.kind` has zero distinct values today) |

Re-run after WP1/WP2 ship and compare: id rates should fall sharply, ref-link rate should rise from 0%, and
`reports/day` should go positive once `show_report` starts firing on brief/findings/long-explanation turns.

## Files

- `src-tauri/src/companion/register.rs`: register constants, `list`, `upsert`, `effective`,
  `apply_op`, `layer_one_flag`, the reflection signal detector (`propose_from_recent`) and its
  weekly hook (`maybe_propose_register`).
- `src-tauri/src/companion/templates/chat-core.md`, `templates/constitution.md`: the `# Layer one`
  section.
- `src-tauri/src/companion/prompt/chat_family.rs`: `voice_flag`, `layer_one_flag_for`.
- `src-tauri/src/companion/reports.rs`: report and stats wire types, plus the read side.
- `src-tauri/src/commands/companion/layered_voice.rs`: the four commands.
- `src-tauri/db/src/lib.rs`: `companion_reply_register` DDL.
