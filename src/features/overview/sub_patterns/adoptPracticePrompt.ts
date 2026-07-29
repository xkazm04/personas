// Adopt-dispatch — the push half of Arc 3 distribution
// (docs/plans/workspace-knowledge-center.md §8).
//
// The ambient projection makes a workspace's canon *visible* in every member
// repo; this makes it *happen* in one. A Fleet Dev-runner session is pointed
// at the target repo with the practice, its evidence, and an explicit
// customize-for-this-codebase instruction — mirroring the shape of
// `skillTasks.ts::adoptTaskPrompt`, which solved the same "port a thing into a
// different codebase" problem for skills.
//
// Deliberately NOT a blind apply: the session is told to survey first and to
// report a reasoned refusal if the practice genuinely doesn't fit. A rollout
// that can't say "no" produces cargo-culted code.
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

/** Fleet dedup key for a practice rollout into one repo. */
export function adoptDispatchKey(practiceId: string, projectId: string): string {
  return `workspace:adopt:${practiceId}:${projectId}`;
}

export function buildAdoptPrompt(
  practice: WorkspaceKnowledge,
  project: DevProject,
  workspaceName: string,
): string {
  const evidence = (practice.detail_md ?? '').trim();
  const topic = practice.topic ? ` (topic: ${practice.topic})` : '';

  return [
    `Adopt a shared engineering practice into this repository (**${project.name}**).`,
    '',
    `The **${workspaceName}** workspace has adopted the practice below across its projects. Your job is to bring THIS codebase in line with it — adapted to how this repo actually works, not copy-pasted from elsewhere.`,
    '',
    `--- PRACTICE${topic} ---`,
    `## ${practice.title}`,
    '',
    practice.statement.trim(),
    evidence ? `\n### Evidence / how it looks elsewhere\n\n${evidence}` : '',
    '--- END PRACTICE ---',
    '',
    'PROCEDURE',
    '1. **Survey first.** Find where this practice does and does not already hold in this repo. Read before you write.',
    '2. **Judge fit.** If the practice genuinely does not apply here — different stack, a documented deliberate exception, or the cure is worse than the disease — STOP and report why. A reasoned refusal is a valid, valuable outcome; do not force a fit.',
    '3. **Adapt, then apply.** If it fits, implement it using THIS codebase\'s own conventions, naming, and structure. Prefer the smallest coherent change that establishes the pattern over a sweeping rewrite.',
    '4. **Verify.** Run the repo\'s own checks (typecheck / lint / tests as available) and leave them green.',
    '5. **Report.** End with a one-line verdict: `ADOPTED: <what changed>` or `DECLINED: <why it does not fit here>`.',
    '',
    'CONSTRAINTS',
    '- Do not commit or push unless this repo\'s own conventions clearly expect it — leave the work reviewable.',
    '- Do not reformat or refactor code unrelated to this practice.',
    '- If the change would be large, implement the representative first slice and note what remains rather than half-applying it everywhere.',
  ]
    .filter(Boolean)
    .join('\n');
}
