---
name: reflect-me
description: Distill the operator's captured decisions (Decision Mirror ledger) into a behavioral profile — trait vector, escalation boundary, level-of-thought map, values ledger — for Athena and future sessions to consume
allowed-tools: Bash(node *), Read, Write, Glob, Grep
argument-hint: [--all] [--dry-run]
---

# Reflect-me — Operator Decision Distillation

Sibling of `/reflect`: that skill analyzes the **agent's** behavior across
sessions; this one analyzes the **operator's** decisions from the Decision
Mirror ledger and maintains their behavioral profile. Design, schema and the
five-phase roadmap live in `docs/concepts/decision-mirror.md` — read it first
if anything below is ambiguous.

**Privacy invariant: the ledger and `profile.md` are gitignored personal
data. Never quote their content into committed files, commit messages,
memory files, the Obsidian vault, or subagent prompts — a subagent that
needs ledger data reads the files from disk itself.**

## Layout it owns

```
.claude/decision-ledger/
  events-YYYY-MM.jsonl      # DECISION capture (hook + corrections) — append-only, never edited
  prose-YYYY-MM.jsonl       # PROSE capture (prompt + turn_outcome pairs) — append-only
  archive/                  # processed raw files move here (same name)
  profile.md                # THE OUTPUT — six artifacts, updated in place
  profile-changelog.md      # one line per run: date, events processed, what changed
  state.json                # {"last_processed_ts": "...", "last_prose_ts": "...", "runs": N}
```

**Two streams, one profile.** Decisions say what he chose; prose says how he
frames, asks and reacts. They answer different questions and must not be
averaged: a decision event is an explicit act, a prose event is behavior. Keep
their evidence citations distinguishable (`event`/`prompt`) in every claim.

## Phase 0 — Load

1. Read `state.json` (missing → first run; `last_processed_ts` and
   `last_prose_ts` = epoch).
2. Collect decision events from `events-*.jsonl` with `ts > last_processed_ts`,
   and prose events from `prose-*.jsonl` with `ts > last_prose_ts` (`--all`
   reprocesses everything; then rebuild `profile.md` from scratch).
3. Join each prose `kind:"prompt"` to its `kind:"turn_outcome"` on
   `outcome.ref === prompt.id`. An unmatched prompt is normal (turn still
   running, or a crashed session) — keep it, just without outcome fields.
4. **Cold-start rule:** with fewer than ~20 total decision events, the profile is
   written as *observations* ("early signal: …"), never conclusions. §5/§6 have
   their own floor: fewer than ~100 prompts means style claims are provisional.
   Say so in the profile header.
5. If zero new events in BOTH streams: report "nothing new" and stop (no churn
   commits to the changelog).

## Phase 1 — Enrich (best-effort, never blocking)

For each select/multiselect event with a `transcript_path` that still exists:

- Locate the `AskUserQuestion` tool_use in the transcript (match on the
  question text) and derive **latency** — the wall-clock gap between the tool
  call and the following user/tool-result timestamp. Tag the event
  `latency_s`; unparseable → leave null.
- Derive a one-line **session intent** from the transcript's first user
  message (truncate hard). Tag `session_intent`.

Latency is load-bearing downstream: **fast ≈ habit, slow ≈ deliberation** —
it decides what may ever be automated. When it's unavailable, say so in the
profile rather than guessing.

## Phase 1b — Measure the prose (mechanical, before reading it)

Compute these from the joined prose pairs and put the numbers in the header.
Measure first, interpret second: an impression formed while reading 300 messages
will over-weight whichever ones were memorable.

- **Length distribution** (p25/p50/p75/p90/max chars) and its trend over time.
- **Opening move**: for the first prompt of each session, classify into
  {directive, question, context-dump, correction, resume}. This is the framing
  habit and it is the single most predictive prose feature.
- **Imperative density**: share of prompts opening with a bare verb
  ("Lets…", "Check…", "Build…", "Find…") vs a hedge or a question.
- **Reference density**: prompts carrying an explicit file path, context name,
  or line reference. High density means he pre-scopes; low means he expects the
  session to locate the work.
- **Enumeration habit**: prompts containing a numbered list, and their mean item
  count. Numbered prompts are batched intent and usually mean "all of these".
- **Turn-outcome coupling**: for each prompt, the outcome's `tool_calls`,
  `files_touched`, `duration_s`, `subagents`. Bucket by prompt length to see how
  much work a short prompt is expected to license.
- **Reaction pairs**: where a prompt is followed in the same session by another
  prompt within a short gap, or by a `correction` event in `events-*.jsonl`,
  mark the first as a **redirect trigger**. These pairs are the highest-value
  prose signal: they show which of my behaviors cost him a message to fix.

## Phase 2 — Distill into `profile.md`

Update the four artifacts **in place** (stable section headings; edit, never
append duplicates). Every claim carries: confidence (low/med/high), event
count, dates of newest/oldest supporting evidence, and 1-3 example event
digests (question → choice, ≤1 line each).

**Evidence floor:** every trait/boundary claim cites **≥2 ledger events** by
`ts`/date, corrections weighted highest (correction + select clears the
floor; two selects is weaker). A single-event claim is still written but
prefixed `provisional:` with confidence capped at low — the watchlist for
the next run, never silently dropped.

```markdown
# Operator profile — Decision Mirror
> Generated by /reflect-me. N events (H hook / C corrections), last run DATE.
> Cold-start: yes/no. Latency coverage: X%.

## 1. Trait vector
| Axis | Value | Domain | Confidence | Evidence |
(axes: scope appetite · risk posture · evidence demand · sequencing
 philosophy · pragmatism · reversibility sensitivity · novelty preference —
 add axes when the data insists, don't force sparse ones)

## 2. Escalation boundary
- NEVER ASK: … (learned classes with evidence)
- ALWAYS ASK: …
- ASK IN CONTEXT: … (rule + the contexts)

## 3. Level-of-thought map
| Situation class | Observed level (L1 reflex / L2 tradeoff / L3 strategic / L4 values) | Evidence |
(consumers must MIRROR the level: L1/L2 may automate after calibration;
 L3/L4 stay escalated regardless of predictability)

## 4. Values ledger
- "<near-verbatim stated principle>" — where expressed, date, domain.

## 5. Communication profile
> From N prompts (M with turn outcomes). Median length, opening-move mix, etc.
| Feature | Observed | Confidence | Evidence |
(register · length habit · opening move · imperative vs interrogative ·
 reference density · enumeration habit · how approval is expressed · how
 dissatisfaction is expressed · what he consistently omits and expects inferred)

**Writing back to him:** the concrete implications for how a session should
reply — length, structure, what to lead with, what to never pad with. State
these as directives, not observations, because that is how they get used.

## 6. Cognitive profile
| Move | Description | Confidence | Evidence |
(framing moves · decomposition style · abstraction altitude he opens at ·
 what he treats as self-evident · recurring conceptual vocabulary and what
 each term means to him · what makes him halt work · redirect triggers)

**Redirect triggers** get their own list: the behaviors that have cost him a
message to correct, each with the prompt pair that showed it. This is the
actionable core of §6 — it is a list of my failure modes, in his words.
```

Distillation rules (from the concept doc — enforce all):

- **Only `provenance: human` events feed traits.**
- **Corrections weigh ~10× a select.** A correction that contradicts an
  existing trait triggers *retirement*: move the old claim to a
  `## Retired` section with the contradicting evidence — never average a
  contradiction.
- **Drift is signal — never silently overwrite.** When new evidence
  contradicts the profile, show old claim (with dates) vs new evidence side
  by side — in the `## Retired` entry AND as a "drift" bullet in the run
  report. The operator changing over time is the point; overwriting erases it.
- **Recency-weight** everything; note when a trait's newest evidence is >60
  days old ("stale — reconfirm").
- **Domain separation:** a trait observed only in experimental repos must not
  be stated repo-neutrally. Tag every claim with its domain.
- **Rejected options are evidence too** — what the operator consistently does
  NOT pick (lenses, scopes, option positions) becomes negative-preference
  claims.
- **Annotations are reasoning** — quote them (they're already the operator's
  own words) as the primary evidence for L3/L4 classifications.
- **Prose is behavior, not testimony.** §5/§6 claims describe observed habits.
  Never promote a prose observation into §1-§4 (a trait, boundary, level or
  value) on prose alone — those four sections drive autonomy decisions and
  require an explicit act (a select or a correction). Prose may *corroborate* a
  §1-§4 claim; cite it as supporting, never as the floor-clearing evidence.
- **Quote sparingly and never flatteringly.** §5/§6 exist to make sessions more
  useful to him, not to characterize him. If a claim would be uncomfortable to
  show him, it is either wrong or badly worded — fix it, don't drop it.

## Phase 3 — Archive & record

1. Move fully-processed `events-*.jsonl` and `prose-*.jsonl` files (months
   strictly older than the current month) into `archive/`; the current month's
   files stay in place.
2. Update `state.json` (`last_processed_ts` = newest processed decision event,
   `last_prose_ts` = newest processed prose event).
3. Append one changelog line: `- DATE · +N events · <what changed in one
   clause, e.g. "risk-posture confidence med→high; retired 'always-thorough'
   (correction 07-24)">`.
4. Report to the user: events processed, artifact-level changes, drift
   surfaced, and the single most interesting new signal.

## Phase 3 seam (do not build yet — keep stable for it)

The next roadmap phase generates the fleet decision-policy paragraph (today
a hand-written constant in `fleet_bridge.rs::drain_assessment_batch`) from
`profile.md`. It will consume: **§2 Escalation boundary** (primary) and
**§3 Level-of-thought map** (L1/L2 rows only — L3/L4 never auto-fire); the
header's event count + cold-start flag (to refuse generation cold); and
`provisional:` prefixes + confidence values (to exclude weak claims).
Therefore the six numbered headings, header format, `provisional:` prefix,
and `## Retired` name are **API** — rename nothing; extend only by adding
rows/bullets.

**§5 and §6 are describe-only, by operator decision (2026-08-06).** They are
read by sessions and by Athena as context — to mirror his level, anticipate his
framing, and avoid known redirect triggers. They do NOT generate her system
prompt, her register, or any policy. A distillation error in §1-§4 costs a bad
recommendation; a distillation error wired into voice would cost her being
herself. Do not add a generator over §5/§6 without a new explicit decision.

## Guardrails

- `--dry-run`: run everything, print the would-be profile diff, write nothing.
- Never invent events; never backfill from memory of conversations — the
  ledger is the only source. (If the ledger is obviously missing something a
  session should have journaled, note it as a capture gap in the report.)
- This skill never edits code, never commits, never pushes.
- The profile is consumed downstream — see "Phase 3 seam" above for what is
  frozen.
