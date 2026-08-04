---
name: scan-sweep
description: "Context sweep: reads one feature-area's code once and evaluates it through every scan lens matched to it (of the 22 in references/lenses.md), reporting only grounded findings. The efficient default over running single-lens scan-* skills one by one. Emits structured findings to the Personas memory outbox for backlog ingestion, plus an escalation signal when a lens deserves a focused deep pass."
argument-hint: "[--lenses key1,key2] [context]"
category: Development
contexts: tracked
memory: project
---
# Context Sweep 🧭

You are running a **multi-lens sweep** over ONE context (feature area). The
expensive part of any scan is reading the code; do it once, then judge what you
read through each relevant lens. Depth beats breadth: a lens with nothing real
to say returns nothing.

## 1. Resolve scope

- The **final argument** is the context name. Read `context-map.json` at the
  project root, find the context, and stay inside its `filePaths`.
- **No context argument → pick an unswept context yourself.** Read
  `context-map.json` and `.claude/scan-history/scan-sweep.jsonl` (if present)
  and choose the first context, in map order, that has NO prior sweep snapshot
  (`scope` field). If every context has been swept, take the one whose latest
  snapshot is OLDEST. State the chosen context and why in the report header
  ("never swept" or "oldest sweep: <date>") so coverage rotation is auditable.

## 2. Load shared awareness (do this BEFORE reading code)

- `.personas/backlog-digest.json` (if present) — the project's live backlog
  memory: pending / accepted / rejected idea titles. **Never re-propose
  anything on those lists, including rephrasings of rejected titles.** A
  rejected title is a durable human "no".
- `.claude/conventions.json` (if present) — the repo's hard gates. A finding
  that violates a declared gate is a defect you are about to introduce, not a
  finding.
- `.claude/scan-history/scan-sweep.jsonl` (if present) — prior sweep
  snapshots for the trend line.

## 3. Pick the lens bundle

- If `--lenses key1,key2,...` was passed, use exactly those keys.
- Otherwise match lenses yourself: apply each lens's `Match` regex from
  `references/lenses.md` to the context's name, description, keywords, tech
  stack, API surface, and file paths. Fewer than 2 matches → fall back to
  `architecture-analyst` + `code-optimizer`.
- List the chosen lens keys in the report header.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST — form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter,
   existing script) and reconcile; deterministic findings belong to those tools,
   not to this sweep — do not restate them as findings.
3. Then walk the lens bundle **sequentially**. Per lens: at most **3** findings,
   each grounded in `file:line` evidence. Zero findings is a valid and common
   result — say "nothing real" and move on. Prefer one deep finding over three
   shallow ones.

## 5. Report

Header first:

- `Method: full (context: <name>, lenses: <keys>)` — or
  `⚠️ DEGRADED: <what was skipped and why>` if you sampled, skipped a lens, or
  hit a limit. A degraded sweep reported as complete is worse than no sweep.

Then per lens with findings, a short section per finding:
- **Title** — concise and actionable.
- **Finding** — what and why it matters, with `file:line` evidence.
- **Recommendation** — the concrete change.
- **Scores** — effort / impact / risk, each 1–10.

End with a one-line summary (N findings across M lenses, highest impact first).

## 6. Emit structured findings (memory outbox)

Append to `.personas/memory-outbox.jsonl` (create `.personas/` if needed),
ONE JSON object per line, nothing else on the line:

Each reported finding:

```json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","title":"<finding title>","body":"<what + why + recommendation, condensed>","evidence":"<file:line — one-line proof>","effort":3,"impact":7,"risk":2}
```

Escalation — emit at most one per lens, ONLY when that lens produced a
critical finding (impact ≥ 8) or 3 real findings in this context:

```json
{"type":"escalation","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","reason":"<≤120 chars: what the deep pass should chase>"}
```

Coverage — one node line per lens you actually evaluated (found something or
not), plus one for the sweep itself:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Sweep pass: <lens-key> over <context>","body":"<n> findings; <one-line gist or 'clean'>"}
{"type":"node","kind":"progress","skill":"scan-sweep","context":"<context name>","title":"Sweep of <context>","body":"<lenses evaluated>; <total> findings, <e> escalations"}
```

Keep the outbox lean — the ingest caps at 200 lines / 512 KB; a sweep should
emit well under 40 lines. The Personas app ingests and DELETES this file when a
Fleet session exits or the Skills Manager opens; findings land in the project
backlog deduped against everything already known.

## 7. Persist a snapshot

Append one line to `.claude/scan-history/scan-sweep.jsonl` (create the
directory if needed):

```json
{"at":"<ISO-8601>","scope":"<context>","lenses":<n>,"findings":<n>,"escalations":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
```

If prior lines exist for the SAME scope, add a trend line to the report
("Trend for <context>: 12 → 7 → 9 findings"); otherwise say "first sweep of
this context, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     Single-lens scan-* skills remain the focused deep-dive form. -->
