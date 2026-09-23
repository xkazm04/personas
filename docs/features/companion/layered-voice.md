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
{"op":"show_report","title":"<=80 chars","summary":"<=240 chars, optional","body":"markdown <=12000 chars"}
```

Persisted as a `companion_chat_card` row with `kind:"report"`,
`config_json {"summary":…,"body":…}` and `status:"unread"|"read"`. It is read back through
`companion_get_report` and marked read through `companion_mark_report_read`.

Caps are defined in `src-tauri/src/companion/reports.rs` (`MAX_REPORT_TITLE_CHARS`,
`MAX_REPORT_SUMMARY_CHARS`, `MAX_REPORT_BODY_CHARS`).

### `adjust_register`

```json
{"op":"adjust_register","scope":"default"|"<topic>","sentences":1..8,"reason":"…"}
```

Writes one `companion_reply_register` row via `companion::register::upsert` with
`source = 'reflection'`.

## The reply register

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

## Files

- `src-tauri/src/companion/register.rs`: register constants, `list`, `upsert`, `effective`.
- `src-tauri/src/companion/reports.rs`: report and stats wire types, plus the read side.
- `src-tauri/src/commands/companion/layered_voice.rs`: the four commands.
- `src-tauri/db/src/lib.rs`: `companion_reply_register` DDL.
