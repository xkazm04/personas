// Practice-harvest dispatch — the ENGINE (mirrors kpiSimPrompt.ts). The Fleet
// session runs this prompt in a workspace member repo; the skill file is an
// engine-reference, this string is the source of truth. The OUTPUT_CONTRACT
// here and the `HarvestResult`/`HarvestItem` deserializer in
// commands/infrastructure/workspace_harvest.rs are TWO HALVES OF ONE CONTRACT —
// keep them byte-for-byte aligned.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';

/** Fleet dedup key for a per-member harvest session. */
export function harvestDispatchKey(workspaceId: string, projectId: string): string {
  return `workspace-harvest:${workspaceId}:${projectId}`;
}

const GROUND_TRUTH = `GROUND TRUTH — read \`practice-harvest/snapshot.json\` at the repo root FIRST. It carries the workspace name, this project's stack + standards, the sibling projects (name + stack), the titles of practices already in the library (do NOT re-propose these), and rejected dedup keys (do NOT re-propose these either). Everything you output must be grounded in THIS repository's real files.`;

const WHAT_TO_MINE = `WHAT TO HARVEST — durable, reusable engineering practices worth sharing across the workspace, in these layers: design, code-quality, ui, performance, process. Mine the repo's real conventions: lint/format configs, design-token or theme systems, test setup + fixtures, CI/pre-commit gates, error-handling patterns, performance techniques, migration/IPC/build patterns. Prefer a small number of HIGH-SIGNAL practices over volume. A practice is worth harvesting only if a sibling project could plausibly adopt it.`;

const KINDS = `kind ∈ pattern | pitfall | decision | howto | fact.`;

// The topic vocabulary itself lives in Rust (db/repos/workspace_taxonomy.rs)
// and ships inside snapshot.json, so there is exactly one copy of it and this
// prompt cannot drift from what the ingest door enforces. Free-form topics are
// what fragmented the library: 13 parallel agents once produced 154 topics for
// 177 items.
const TOPIC = `TOPIC — the library uses a CLOSED, precedence-ordered vocabulary, shipped to you as \`taxonomy\` in snapshot.json. Read it before you write any item.
- A topic is EXACTLY two segments: \`area/cluster\`. Never one, never three.
- \`topic\` answers WHERE the practice lives (which concern or subsystem it governs). \`ftype\` separately answers what SHAPE it is — do not encode shape in the topic. A repository-behind-one-interface practice is \`data/store-boundary\`, not \`architecture/boundaries\`, even though it is boundary-shaped.
- Areas are PRECEDENCE-ORDERED. Most practices touch several at once. Walk the area list in the order given and take the FIRST that genuinely governs: if the practice would be meaningless without that concern, it governs. \`architecture\` is near the end on purpose — it means the codebase's own skeleton, so use it only when no subsystem area applies.
- Prefer a listed cluster. If none genuinely fits you MAY name a new one, but only under a listed area — never invent an area. An unrecognized area is quarantined on an \`unsorted/\` shelf for a human to file.`;

const OUTPUT_CONTRACT = `OUTPUT CONTRACT — write \`practice-harvest/runs/<YYYY-MM-DD-HHmm>/result.json\` (and a short \`report.md\`). The app ingests result.json; you NEVER write any database. Exact shape:
{
  "items": [
    {
      "kind": "pattern",                         // ${'pattern|pitfall|decision|howto|fact'}
      "title": "Short imperative claim",          // required
      "statement": "The distilled practice a session should act on.", // required
      "detail_md": "Evidence: real code/config from THIS repo (markdown). Optional but strongly preferred.",
      "topic": "errors/degradation",               // REQUIRED: area/cluster from snapshot.json's taxonomy — see TOPIC above
      "abstraction": "meso",                       // macro | meso | micro — the altitude; prefer meso/macro design patterns over micro lint
      "ftype": "error-strategy",                   // architecture | module-boundary | data-flow | extensibility | api-design | state-mgmt | error-strategy | concurrency-reliability | perf-strategy | micro-technique
      "durability": "durable",                     // durable | situational | mechanical (mechanical = belongs in the linter, not here)
      "evidence_count": 4,                         // optional prevalence (how many sites)
      "applicability": { "layers": ["code-quality"], "languages": ["TypeScript"], "frameworks": ["React"] }, // optional object
      "dedup_key": "harvest:<stable-slug>",        // optional; the app derives one from the title if omitted
      "confidence": 0.7                            // optional 0..1
    }
  ]
}`;

const RULES = `HARD RULES:
- Only write files under \`practice-harvest/runs/<id>/\`. Touch nothing else in the repo.
- Ground every item in real evidence from this repo — no generic advice that isn't actually practiced here.
- Skip anything whose title matches an existing_practice_title or whose dedup_key is in rejected_dedup_keys (from the snapshot).
- Keep it to at most ~15 items; quality over quantity. Items land as "observed" for human review — you are proposing, not adopting.`;

export function buildHarvestPrompt(workspace: DevWorkspace, project: DevProject): string {
  return [
    `You are harvesting reusable best practices from the "${project.name}" repository for the "${workspace.name}" workspace's shared knowledge library.`,
    '',
    GROUND_TRUTH,
    '',
    WHAT_TO_MINE,
    KINDS,
    '',
    TOPIC,
    '',
    OUTPUT_CONTRACT,
    '',
    RULES,
    '',
    `Check \`.claude/skills/\` for a \`practice-harvest\` skill and follow it if present; otherwise use the embedded procedure above — do NOT install anything.`,
  ].join('\n');
}
