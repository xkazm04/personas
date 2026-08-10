// Practice-harvest dispatch — the ENGINE (mirrors kpiSimPrompt.ts). The Fleet
// session runs this prompt in a workspace member repo; the skill file is an
// engine-reference, this string is the source of truth. The OUTPUT_CONTRACT
// here and the `HarvestResult`/`HarvestItem` deserializer in
// commands/infrastructure/workspace_harvest.rs are TWO HALVES OF ONE CONTRACT —
// keep them byte-for-byte aligned.
//
// RUST TWIN (2026-08-10): Athena's `run_pattern_harvest` executor dispatches
// the SAME contract backend-side via `build_harvest_prompt` in
// commands/infrastructure/workspace_harvest.rs — a Rust port of this builder,
// pinned to the deserializer by `harvest_prompt_tests`. A contract change
// edits BOTH builders and the deserializer in one commit.
//
// SCOPED SINCE 2026-07-27. The first engine sent ONE agent at a whole
// repository with a ~15-item cap and the instruction "prefer a small number of
// high-signal practices over volume". On a large codebase that brief is
// satisfiable without reading the codebase: a measured run on the Personas repo
// spent ~11 tool calls over 8,568 files, returned 14 items, and every single
// one came from a root config file — nothing from the 236 mapped contexts of
// feature code. The agent was complying, not failing. So the cap is gone and
// each session now owns ONE named territory (see workspace_scopes.rs); volume
// is bounded by what the territory genuinely contains, and coverage is a
// recorded fact instead of an assumption.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';

/** The slice of a scope the dispatcher needs. Paths and context names are NOT
 *  duplicated here — they live in snapshot.json, which the agent reads. */
export interface HarvestScopeRef {
  id: string;
  label: string;
  fileCount?: number;
}

/** Fleet dedup key for a per-scope harvest session. The scope is part of the
 *  key: several territories of the same repo are meant to run concurrently, and
 *  a repo-level key would make them collide as duplicates of each other. */
export function harvestDispatchKey(
  workspaceId: string,
  projectId: string,
  scopeId?: string,
): string {
  const base = `workspace-harvest:${workspaceId}:${projectId}`;
  return scopeId ? `${base}:${scopeId}` : base;
}

const GROUND_TRUTH = `GROUND TRUTH — read \`practice-harvest/snapshot.json\` at the repo root FIRST. It carries the workspace name, this project's stack + standards, the sibling projects (name + stack), \`scopes\` (every territory in this repo, with its paths, contexts and when each was last harvested), the titles of practices already in the library (do NOT re-propose these), and rejected dedup keys (do NOT re-propose these either). Everything you output must be grounded in THIS repository's real files.`;

function scopeSection(scope: HarvestScopeRef): string {
  return `YOUR SCOPE — you are harvesting exactly ONE territory of this repo:

  scope id:    ${scope.id}
  scope label: ${scope.label}${scope.fileCount ? `\n  size:        ~${scope.fileCount} files` : ''}

Find this id in \`scopes\` in snapshot.json. It lists the \`paths\` you own and (when the repo has a context map) the named \`contexts\` inside them — that is your index into your own territory.

- **Read inside your scope, broadly.** Open a real sample of its files across its different paths, not one file per path. You are the only session assigned to this territory; whatever you do not read, nobody reads.
- **Do not harvest outside it.** Root configs, lint setup, CI, hooks and scripts belong to the \`repo-global\` scope and are another session's job. Unless your scope IS \`repo-global\`, an item sourced from them is out of bounds — this is the single most common way a harvest fakes coverage, because those files are the cheapest place to find something that looks like a "convention".
- If your scope turns out to be genuinely thin, say so in report.md and return few items. Reporting an empty territory honestly is worth more than padding it.`;
}

const WHAT_TO_MINE = `WHAT TO HARVEST — durable, reusable engineering practices worth sharing across the workspace, in these layers: design, code-quality, ui, performance, process. Inside your scope, mine what the code actually does: module and data boundaries, error and result handling, state and data-flow patterns, concurrency/cancellation/retry handling, API and IPC seams, persistence and migration patterns, test setup and fixtures, performance techniques, and the pitfalls the code visibly defends against (a guard, a workaround, or a comment explaining a past failure is prime material — those are the practices a sibling project would otherwise learn the hard way). A practice is worth harvesting only if a sibling project could plausibly adopt it.`;

const KINDS = `kind ∈ pattern | pitfall | decision | howto | fact.`;

// The topic vocabulary itself lives in Rust (db/repos/workspace_taxonomy.rs)
// and ships inside snapshot.json, so there is exactly one copy of it and this
// prompt cannot drift from what the ingest door enforces. Free-form topics are
// what fragmented the library: 13 parallel agents once produced 154 topics for
// 177 items. NOTE the closed taxonomy — not an item cap — is what solves that;
// conflating the two is what starved the library for a year.
const TOPIC = `TOPIC — the library uses a CLOSED, precedence-ordered vocabulary, shipped to you as \`taxonomy\` in snapshot.json. Read it before you write any item.
- A topic is EXACTLY two segments: \`area/cluster\`. Never one, never three.
- \`topic\` answers WHERE the practice lives (which concern or subsystem it governs). \`ftype\` separately answers what SHAPE it is — do not encode shape in the topic. A repository-behind-one-interface practice is \`data/store-boundary\`, not \`architecture/boundaries\`, even though it is boundary-shaped.
- Areas are PRECEDENCE-ORDERED. Most practices touch several at once. Walk the area list in the order given and take the FIRST that genuinely governs: if the practice would be meaningless without that concern, it governs. \`architecture\` is near the end on purpose — it means the codebase's own skeleton, so use it only when no subsystem area applies.
- Prefer a listed cluster. If none genuinely fits you MAY name a new one, but only under a listed area — never invent an area. An unrecognized area is quarantined on an \`unsorted/\` shelf for a human to file.
- Your scope does NOT dictate your topic. A territory contributes practices across several areas; classify each item on its own merits.`;

const OUTPUT_CONTRACT = `OUTPUT CONTRACT — write \`practice-harvest/runs/<YYYY-MM-DD-HHmm>-<scope-id>/result.json\` (and a short \`report.md\`). Put the scope id in the directory name so concurrent scope sessions never collide — replacing \`:\` with \`-\`, since a colon is not a legal path character on Windows. The \`scope\` FIELD below keeps the id verbatim; that is what stamps coverage. The app ingests result.json; you NEVER write any database. Exact shape:
{
  "scope": "<your scope id, exactly as given above>",   // REQUIRED: stamps coverage
  "items": [
    {
      "kind": "pattern",                         // ${'pattern|pitfall|decision|howto|fact'}
      "title": "Short imperative claim",          // required
      "statement": "The distilled practice a session should act on.", // required
      "detail_md": "Evidence: real code/config from THIS repo (markdown). Optional but strongly preferred.",
      "topic": "errors/degradation",               // REQUIRED: area/cluster from snapshot.json's taxonomy — see TOPIC above
      "abstraction": "meso",                       // macro | meso | micro — the altitude; prefer meso/macro design patterns over micro lint
      "ftype": "error-strategy",                   // REQUIRED: one value from \`ftypes\` in snapshot.json — a CLOSED list, same as the topic areas. Never coin one.
      "evidence_count": 4,                         // optional prevalence (how many sites)
      "applicability": { "layers": ["code-quality"], "languages": ["TypeScript"], "frameworks": ["React"] }, // optional object
      "dedup_key": "harvest:<stable-slug>",        // optional; the app derives one from the title if omitted
      "confidence": 0.7,                           // optional 0..1
      "extends": "<pattern-id>"                    // optional: the EXISTING pattern this item refines (id from existing_practices in snapshot.json). Use when your finding sharpens or specializes canon rather than proposing something new — it links your item to its parent and, on adoption, files it under the parent's topic.
    }
  ],
  "coverage": {                                    // REQUIRED — see COVERAGE below
    "files_read": 45,
    "files_total": 359,
    "estimated_pct": 13,
    "unread_pockets": ["src/features/teams/sub_goals", "src/features/teams/teamStudio"],
    "note": "Schedules and triggers read near-exhaustively; teams/ is the real gap."
  }
}`;

// The SHAPE axis is closed for exactly the reason the topic areas are. Left as
// a prompt comment it produced NINETY distinct values across 330 items in the
// 2026-07-27 scan — `guard`, `guardrail`, `trap`, `convention`, `policy`,
// `user-honesty` … — while the enforced `topic` axis held at 5.8 items/topic.
// A filter over a field where every writer coins their own value is not a
// filter. `durability` is gone from the contract entirely: the same scan
// returned `durable` for 330 of 330 items, because this prompt tells authors
// mechanical items don't belong here, so the axis can never discriminate.
const SHAPE = `FTYPE — \`ftype\` is a CLOSED vocabulary shipped as \`ftypes\` in snapshot.json. Pick the one that fits and never invent a value; an unrecognized ftype is filed on an \`unsorted\` shelf, which helps nobody. If your instinct is "guard" / "guardrail" / "trap" / "anti-pattern", the answer is \`error-strategy\`. Do NOT send \`durability\` — it is not an author's call.`;

// No item cap. The ingest door caps a single run at 120 candidates
// (MAX_INGEST_PER_RUN) and 1 MiB of JSON — those are the machine guards. A
// prompt-level cap does not improve quality, it just stops the reading early.
const BUDGET = `HOW MANY ITEMS — there is no cap. Report every practice your territory genuinely supports; for a scope of a few hundred files that is usually somewhere between 5 and 25. Two failure modes, both real:
- Stopping early because you have "enough" — you are the only pass over this territory, and what you skip is not covered by anyone else.
- Padding with generic advice this repo does not actually practise, or with lint-level mechanics that belong in a linter rather than a practice library. Quality still gates every individual item; it just no longer caps the count.`;

const COVERAGE = `COVERAGE — result.json MUST carry a \`coverage\` block (shape above). It is read by the app, not by a human: \`estimated_pct\` decides whether this territory still owes a pass, and \`unread_pockets\` is handed to the NEXT session assigned here so it starts where you stopped instead of re-reading your ground. Estimate honestly — under-reporting costs nothing, over-reporting silently retires a territory nobody finished. If you genuinely cannot estimate, omit the field rather than guessing.`;

const REPORT = `REPORT — \`report.md\` is a REQUIRED deliverable of this contract, not a courtesy summary: write it even if you would normally avoid writing report-style files. It must state, honestly: which paths inside your scope you actually read, which you did NOT get to, and anything you deliberately skipped and why. A harvest that read 10% of its territory and says so is useful; one that implies completeness is not. This is the only place a coverage gap can be recorded.`;

const RULES = `HARD RULES:
- Only write files under \`practice-harvest/runs/<id>/\`. Touch nothing else in the repo.
- Ground every item in real evidence from this repo — no generic advice that isn't actually practised here.
- Stay inside your scope (see YOUR SCOPE above).
- Skip anything whose title matches an existing_practice_title or whose dedup_key is in rejected_dedup_keys (from the snapshot).
- Items land as "observed" for human review — you are proposing, not adopting.`;

export function buildHarvestPrompt(
  workspace: DevWorkspace,
  project: DevProject,
  scope: HarvestScopeRef,
): string {
  return [
    `You are harvesting reusable best practices from the "${project.name}" repository for the "${workspace.name}" workspace's shared knowledge library.`,
    '',
    GROUND_TRUTH,
    '',
    scopeSection(scope),
    '',
    WHAT_TO_MINE,
    KINDS,
    '',
    TOPIC,
    '',
    OUTPUT_CONTRACT,
    '',
    SHAPE,
    '',
    BUDGET,
    '',
    COVERAGE,
    '',
    REPORT,
    '',
    RULES,
    '',
    `Check \`.claude/skills/\` for a \`practice-harvest\` skill and follow it if present; otherwise use the embedded procedure above — do NOT install anything.`,
  ].join('\n');
}
