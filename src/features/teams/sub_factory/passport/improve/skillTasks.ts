// LLM-backed skill portability — the prompts behind the Skills module's two
// directions. Neither direction is a plain file copy: a skill that moves INTO a
// repo must be CUSTOMIZED to that codebase's real commands/paths/idioms, and a
// skill that graduates into the user-global library must be GENERALIZED so any
// project can adopt it. Both run as Dev-runner Claude-Code tasks (the
// createTask→executeTask deployNow path — same machinery as the golden-standard
// upgrade tasks), so the work happens in a background engine process and the
// skills cell stays locked until the run's terminal event. The prompts are the
// IP (same doctrine as deployActions.ts): read-the-codebase-first,
// non-destructive, scoped to .claude/skills.
import type { DevProject } from '@/lib/bindings/DevProject';

export interface AdoptItem {
  name: string;
  /** Source project id, or null = the user-global library (~/.claude/skills). */
  source: string | null;
}

export function adoptTaskTitle(items: AdoptItem[]): string {
  const only = items.length === 1 ? items[0] : undefined;
  return only ? `Adopt skill "${only.name}"` : `Adopt ${items.length} reusable skills`;
}

/** Task prompt that installs + customizes the selected skills for the target
 *  repo. Runs with cwd = the ADOPTING project's root; `sourceRootOf` resolves a
 *  sibling source project id to its absolute root path. */
export function adoptTaskPrompt(items: AdoptItem[], sourceRootOf: (projectId: string) => string | null): string {
  const lines = items.map((it) => {
    const src = it.source === null
      ? `~/.claude/skills/${it.name} (the user-global skills library; ~ is the user home directory)`
      : `${sourceRootOf(it.source) ?? '<unknown source project>'}/.claude/skills/${it.name}`;
    return `- "${it.name}" — source: ${src}`;
  });
  return [
    'Adopt the following reusable Claude Code skills into THIS repo, customizing each for this codebase:',
    '',
    ...lines,
    '',
    'For EACH skill listed:',
    '1. Read the source skill fully (SKILL.md plus any reference files). Do NOT modify the source.',
    '2. Write it to .claude/skills/<name>/ in THIS repo, preserving the file structure.',
    "3. CUSTOMIZE the copy — this is an LLM personalization pass, not a file copy. Read this repo first (its stack, build/test/lint commands, directory layout, language + framework idioms, AND its business/product domain from README/docs/package metadata), then rewrite the source's generic assumptions into THIS repo's real ones: concrete commands, real paths, this project's terminology, and examples drawn from what this product actually does. Keep the skill's intent, steps and quality bar intact — personalize the frame to this stack and business, never the method.",
    '4. If a step cannot apply to this codebase, adapt it to the nearest real equivalent and note the change in a short "Adapted for this repo" line at the bottom of that SKILL.md.',
    '',
    'Only write inside .claude/skills/ — do not touch application code, and do not invent commands that do not exist here.',
  ].join('\n');
}

export function shareTaskTitle(name: string): string {
  return `Share skill "${name}" to the library`;
}

/** Task prompt that generalizes a project skill and publishes it into the
 *  user-global library. Runs with cwd = the SOURCE project's root. */
export function shareTaskPrompt(name: string, project: DevProject): string {
  return [
    `Publish the skill at .claude/skills/${name} from this repo (${project.name}) into the user-global Claude Code skills library, generalized so ANY project can adopt it.`,
    '',
    '1. Read the skill fully (SKILL.md plus any reference files). Do NOT modify it inside this repo.',
    `2. Write a generalized copy to ~/.claude/skills/${name}/ (~ is the user home directory; create directories as needed), preserving the file structure.`,
    '3. GENERALIZE the copy — this is an LLM abstraction pass. Strip or parameterize every codebase-specific AND business-specific detail — hard-coded paths, project/product names, repo-specific commands/URLs/tool versions, domain jargon — replacing them with clearly marked placeholders (e.g. <project-root>, <test-command>) or stack- and business-neutral wording. The library copy is the shared workspace version: it must read as reusable doctrine that ANY project (any stack, any business) can adopt, never as this repo’s notes. Preserve the method, the step order and the quality bar exactly.',
    '4. If a reference file is 100% specific to this repo, omit it from the library copy and note the omission at the bottom of the library SKILL.md.',
    '',
    'Only write inside ~/.claude/skills/ — do not touch this repo or its application code.',
  ].join('\n');
}
