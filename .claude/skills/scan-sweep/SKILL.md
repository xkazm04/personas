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
- **No context argument → pick the least lens-covered context yourself.** Read
  `context-map.json` and `.claude/scan-history/scan-sweep.jsonl` (if present).
  Choose, in this order: the first context in map order with NO snapshot at all;
  else the context whose snapshots' `lens_keys` union is SMALLEST (fewest lenses
  ever applied); tie → the one whose latest snapshot is oldest. State the choice
  and why in the report header ("never swept" / "lens coverage 4/22, oldest
  <date>") so coverage rotation is auditable.

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

## 3. Pick the lens package

- If `--lenses key1,key2,...` was passed, use exactly those keys.
- Otherwise the package is **ALL lenses in `references/lenses.md`**, ordered
  matched-first: lenses whose `Match` regex hits the context's name,
  description, keywords, tech stack, API surface, or file paths go first (they
  get the deepest attention); the remaining lenses follow as a lighter pass —
  most will honestly report "nothing real", and that clean verdict is itself
  coverage worth recording.
- If prior snapshots for this context already carry `lens_keys`, put the
  never-applied lenses first within each tier — the package's job is to close
  lens coverage, not re-walk the covered ones.
- List matched vs. remaining lens keys in the report header.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST — form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter,
   existing script) and reconcile; deterministic findings belong to those tools,
   not to this sweep — do not restate them as findings.
3. Then walk the lens package **sequentially**. Per lens: at most **3**
   findings, each grounded in `file:line` evidence. Zero findings is a valid
   and common result — say "nothing real" and move on. Prefer one deep finding
   over three shallow ones.
4. **Budget: at most 30 findings per context, lifetime.** Before emitting,
   subtract what prior snapshots already reported for this scope (`findings`
   counts) and never re-emit a finding already reported in a prior run or
   present in the backlog digest. When the remaining budget is smaller than
   what you found, keep the highest-impact items and say what was cut.

## 5. Size classes — large items are triaged, not dumped

Classify every candidate finding:

- **S** — localized: one file, one mechanism (a rename, a guard, an attribute).
- **M** — a few files or one subsystem seam; a normal PR.
- **L** — structural / moonshot: architecture-grade work spanning modules
  (the kind an architect pass would propose: new layers, protocol redesigns,
  cross-cutting migrations).

S and M items flow straight to the outbox. **L items are a decision, not a
drive-by**: if an operator is present (interactive terminal run), present the
L candidates with a one-line pitch each and ask which to emit before writing
them. Unattended (Fleet/app dispatch), emit them with `"size":"L"` and
effort ≥ 8 so the app's backlog triage gates them — never silently promote an
L item into work.

## 6. Report

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

## 7. Emit structured findings (memory outbox)

Append to `.personas/memory-outbox.jsonl` (create `.personas/` if needed),
ONE JSON object per line, nothing else on the line:

Each reported finding:

```json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","title":"<finding title>","body":"<what + why + recommendation, condensed>","evidence":"<file:line — one-line proof>","size":"S|M|L","effort":3,"impact":7,"risk":2}
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

Keep the outbox lean — the ingest caps at 200 lines / 512 KB and accepts at
most 30 finding lines per pass; a full-package sweep emits ≤30 findings plus
one coverage node per evaluated lens (a clean lens still gets its node — that
IS the per-lens coverage record). The Personas app ingests and DELETES this
file when a Fleet session exits or the Skills Manager opens; findings land in
the project backlog deduped against everything already known.

## 8. Persist a snapshot

Append one line to `.claude/scan-history/scan-sweep.jsonl` (create the
directory if needed). `lens_keys` = every lens actually evaluated this run —
it is the per-context lens-coverage ledger the no-arg picker and the
package-ordering rule read:

```json
{"at":"<ISO-8601>","scope":"<context>","lens_keys":["<key>","<key>"],"lenses":<n>,"findings":<n>,"escalations":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
```

If prior lines exist for the SAME scope, add a trend line to the report
("Trend for <context>: 12 → 7 → 9 findings"); otherwise say "first sweep of
this context, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     Single-lens scan-* skills remain the focused deep-dive form. -->
