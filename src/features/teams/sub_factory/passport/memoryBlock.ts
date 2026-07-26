// MEMORY BLOCK — the per-dispatch memory context for skills bound to the
// Project Memory Ledger (docs/plans/skill-memory-unification.md §3.4).
// Composed by dispatchSkillToRepo for skills whose SKILL.md declares
// `memory: project` or `memory: vault`; undeclared/none skills get nothing.
//
// Three parts: the WRITE contract (outbox path + JSONL line shapes), the
// project's context names (so nodes anchor without guessing ids), and RECALL —
// up to 8 fresh ledger nodes (operator decision: context-filtered cap 8;
// dispatches have no single-context focus, so project-wide fresh-first here).
import { listContexts, listMemoryNodes } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';

/** Recall cap per dispatch (design §5 decision 1). */
const RECALL_CAP = 8;

const contract = (skillName: string | undefined) => [
  '--- MEMORY BLOCK (Personas Project Memory Ledger) ---',
  'This project has a durable, cross-terminal memory ledger. Before you finish, record what the NEXT session (yours or another terminal’s) would need: durable facts, progress made, decisions taken, gotchas hit.',
  '',
  'WRITE contract — append JSON lines to `.personas/memory-outbox.jsonl` in the repo root (create dirs as needed; append, never rewrite). The app ingests and deletes it when your session ends. Line shapes:',
  `  {"type":"node","id":"n1","kind":"fact|progress|decision|gotcha|map","title":"≤200 chars","body":"≤4000 chars (optional)","context":"<context name from the list below> (optional)"${skillName ? `,"skill":"${skillName}"` : ''}}`,
  '  {"type":"edge","from":"n1","to":"n2","rel":"relates|supersedes|blocks|covers|derived_from"}',
  `Rules: 3–8 nodes per session is the sweet spot — quality over volume; anchor nodes to a context whenever one fits; identical re-notes are deduped (they refresh freshness, so do re-note still-true facts you relied on); \`id\` is only needed when edges reference the node${skillName ? `; ALWAYS include "skill":"${skillName}" on node lines — it drives the per-skill context-coverage instrument` : ''}.`,
].join('\n');

/** Compose the MEMORY BLOCK for a project. `skillName` bakes attribution into
 *  the contract (per-skill context coverage). Tolerant: any data failure
 *  degrades to the write contract alone (a dispatch must never die on recall). */
export async function composeMemoryBlock(projectId: string, binding: 'project' | 'vault', skillName?: string): Promise<string> {
  const [contexts, nodes] = await Promise.all([
    listContexts(projectId).catch((e) => { silentCatch('memoryBlock contexts')(e); return []; }),
    listMemoryNodes(projectId, null, RECALL_CAP).catch((e) => { silentCatch('memoryBlock recall')(e); return []; }),
  ]);

  const parts: string[] = [contract(skillName)];

  if (contexts.length > 0) {
    parts.push('', `Known contexts (use these exact names to anchor nodes): ${contexts.map((c) => c.name).join(' · ')}`);
  }

  if (nodes.length > 0) {
    parts.push('', `RECALL — the ${nodes.length} freshest ledger notes (trust but verify against the code):`);
    for (const n of nodes) {
      const anchor = n.contextId ? ` [ctx]` : '';
      parts.push(`- (${n.kind}${anchor}) ${n.title}${n.body ? ` — ${n.body.slice(0, 240)}` : ''}`);
    }
  }

  if (binding === 'vault') {
    parts.push('', 'This skill also keeps Obsidian vault notes — keep doing that, AND mirror the durable summary nodes through the outbox above so non-vault surfaces see the same signal.');
  }

  parts.push('--- END MEMORY BLOCK ---');
  return parts.join('\n');
}
