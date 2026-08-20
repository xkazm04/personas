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

import { SKILL_REFLECTION_SECTION } from '../reflectionBlock';

/** Shared adopt/share step: standardize the reflection trailer into the copy
 *  being written (docs/skill-standard.md). The deterministic install lane
 *  never rewrites SKILL.md (provenance doctrine), so the LLM passes are where
 *  the trailer enters circulation. */
const reflectionStep = (n: number) =>
  `${n}. STANDARDIZE reflection: ensure the copy's SKILL.md ends with the standard \`## Skill Reflection\` section below — append it verbatim if missing, replace any older variant of the section if present:\n\n${SKILL_REFLECTION_SECTION}`;

export interface AdoptItem {
  name: string;
  /** Source project id, or null = THE LIBRARY (see `libraryRoot` on the prompt). */
  source: string | null;
}

export function adoptTaskTitle(items: AdoptItem[]): string {
  const only = items.length === 1 ? items[0] : undefined;
  return only ? `Adopt skill "${only.name}"` : `Adopt ${items.length} reusable skills`;
}

/**
 * Task prompt that installs + customizes the selected skills for the target repo.
 * Runs with cwd = the ADOPTING project's root; `sourceRootOf` resolves a sibling
 * source project id to its absolute root path.
 *
 * `libraryRoot` is where a `source: null` item comes FROM. When the project's
 * workspace holds a knowledge registry, the library is that registry's `skills/`
 * lane — the same place the board lists rows from and the same place a share
 * publishes to. Omitting it keeps the user-global library, which is what an
 * unwired install has.
 *
 * Passing it is not cosmetic: without it the board could list a registry skill
 * and offer to adopt it, and the adopt task would then go looking for that name
 * under the home library and not find it. The affordance and the source have to
 * agree about which library they mean.
 */
export function adoptTaskPrompt(
  items: AdoptItem[],
  sourceRootOf: (projectId: string) => string | null,
  libraryRoot?: string | null,
): string {
  const library = libraryRoot?.trim()
    ? `${libraryRoot.trim()} (the workspace's knowledge-registry skills lane)`
    : '~/.claude/skills (the user-global skills library; ~ is the user home directory)';
  const lines = items.map((it) => {
    const src = it.source === null
      ? `${library.replace(/ \(/, `/${it.name} (`)}`
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
    '2. Write it to .claude/skills/<name>/ in THIS repo, preserving the file structure AND the frontmatter `category:`, `memory:`, `contexts:` and `version:` fields verbatim (they drive the app’s grouped skill lists, memory wiring, context-coverage instrument and version tracing). If the source has no `version:` field, stamp `version: 1.0` in your copy — first standardization, never a bump. Copy LESSONS.md too if the source has one.',
    "3. CUSTOMIZE the copy — this is an LLM personalization pass, not a file copy. Read this repo first (its stack, build/test/lint commands, directory layout, language + framework idioms, AND its business/product domain from README/docs/package metadata), then rewrite the source's generic assumptions into THIS repo's real ones: concrete commands, real paths, this project's terminology, and examples drawn from what this product actually does. Keep the skill's intent, steps and quality bar intact — personalize the frame to this stack and business, never the method.",
    '4. If a step cannot apply to this codebase, adapt it to the nearest real equivalent and note the change in a short "Adapted for this repo" line at the bottom of that SKILL.md.',
    reflectionStep(5),
    '',
    'Only write inside .claude/skills/ of THIS repo — do not modify the library you read from, and do not invent commands that do not exist here.',
  ].join('\n');
}

export function shareTaskTitle(name: string): string {
  return `Share skill "${name}" to the library`;
}

/**
 * Where a share lands.
 *
 * `home` is the pre-registry behaviour: the user-global library at
 * `~/.claude/skills`, which nothing versions and nobody reviews.
 *
 * `registry` is the wired knowledge registry's working copy. It is a git repo
 * with a published contract, so a share into it is a CONTRIBUTION, not a file
 * copy — it lands on a branch, and the two frontmatter fields whose vocabulary
 * differs between destinations are written in the destination's terms. Writing
 * personas' `Development | Testing | Maintenance | Data | Other` into the
 * registry would be silently normalized to `other` at index time, losing the
 * categorisation without telling anyone.
 */
export type ShareTarget =
  | { kind: 'home' }
  | {
      kind: 'registry';
      /** Absolute path of the registry working copy. */
      clonePath: string;
      /** `owner/repo`, for the commit message. */
      registryName: string;
      /**
       * Repo-relative usage file the app has ALREADY written (`usage/<id>.json`),
       * to be committed alongside the skill. Absent when there is nothing to
       * contribute. This is the piggyback: counts never earn a commit of their
       * own, they ride one that was happening anyway.
       */
      usageFile?: string | null;
    };

/** Branch a share commits onto. Never the default branch: a share is a proposal,
 *  and the human decides whether it becomes a pull request. */
export function shareBranchName(name: string): string {
  return `skill/${name}`;
}

/** Task prompt that generalizes a project skill and publishes it into the
 *  library. Runs with cwd = the SOURCE project's root. */
export function shareTaskPrompt(
  name: string,
  project: DevProject,
  target: ShareTarget = { kind: 'home' },
): string {
  if (target.kind === 'registry') return shareToRegistryPrompt(name, project, target);
  return [
    `Publish the skill at .claude/skills/${name} from this repo (${project.name}) into the user-global Claude Code skills library, generalized so ANY project can adopt it.`,
    '',
    '1. Read the skill fully (SKILL.md plus any reference files). Do NOT modify it inside this repo.',
    `2. Write a generalized copy to ~/.claude/skills/${name}/ (~ is the user home directory; create directories as needed), preserving the file structure.`,
    '3. GENERALIZE the copy — this is an LLM abstraction pass. Strip or parameterize every codebase-specific AND business-specific detail — hard-coded paths, project/product names, repo-specific commands/URLs/tool versions, domain jargon — replacing them with clearly marked placeholders (e.g. <project-root>, <test-command>) or stack- and business-neutral wording. The library copy is the shared workspace version: it must read as reusable doctrine that ANY project (any stack, any business) can adopt, never as this repo’s notes. Preserve the method, the step order and the quality bar exactly.',
    "4. CATEGORIZE it: set a `category:` field in the library copy's SKILL.md YAML frontmatter, choosing EXACTLY ONE of: Development, Testing, Maintenance, Data, Other. Pick by the skill's primary job (building features = Development; test/QA/verification = Testing; upkeep/quality/docs/i18n/refactor = Maintenance; data pipelines/analysis/measurement = Data; anything else = Other).",
    "5. DECLARE its memory + context wiring in the same frontmatter: carry the source's `memory:` field verbatim (project | vault | none; omit if the source has none). Set `contexts: tracked` ONLY when the skill's METHOD explicitly walks the repo's context map (context-map.json / the app's contexts) and records per-context progress in its memory notes — otherwise omit the field entirely. This flag is a promise the app measures against; never set it speculatively.",
    "6. VERSION it: carry the source's `version:` frontmatter field verbatim into the library copy; if the source has none, stamp `version: 1.0`. Never bump the version during a share — sharing generalizes, it does not change the method.",
    reflectionStep(7),
    '8. If a reference file is 100% specific to this repo, omit it from the library copy and note the omission at the bottom of the library SKILL.md.',
    '',
    'Only write inside ~/.claude/skills/ — do not touch this repo or its application code.',
  ].join('\n');
}

/**
 * The registry variant. Same abstraction pass, different destination contract:
 * the registry's closed category set, semver, and a branch + commit instead of
 * a bare file write.
 *
 * It deliberately stops at the commit. Pushing and opening a pull request are
 * outward-facing acts on a repo other people read, and "agents propose, humans
 * adopt" is the governance model this registry is built on — an agent that
 * pushes has quietly adopted on the human's behalf.
 */
function shareToRegistryPrompt(
  name: string,
  project: DevProject,
  target: Extract<ShareTarget, { kind: 'registry' }>,
): string {
  const branch = shareBranchName(name);
  return [
    `Publish the skill at .claude/skills/${name} from this repo (${project.name}) into the knowledge registry ${target.registryName}, generalized so ANY project can adopt it.`,
    '',
    `The registry working copy is at ${target.clonePath}; its skills lane is ${target.clonePath}/skills/.`,
    '',
    '1. Read the skill fully (SKILL.md plus any reference files). Do NOT modify it inside this repo.',
    `2. In the registry working copy, confirm the tree is clean, then create and check out \`${branch}\` from the default branch. If it already exists, check it out and continue on it. NEVER commit to the default branch.`,
    `3. Write a generalized copy to ${target.clonePath}/skills/${name}/, preserving the file structure.`,
    '4. GENERALIZE the copy — this is an LLM abstraction pass. Strip or parameterize every codebase-specific AND business-specific detail — hard-coded paths, project/product names, repo-specific commands/URLs/tool versions, domain jargon — replacing them with clearly marked placeholders (e.g. <project-root>, <test-command>) or stack- and business-neutral wording. The registry copy is read by every repo in the fleet: it must read as reusable doctrine ANY project can adopt, never as this repo\u2019s notes. Preserve the method, the step order and the quality bar exactly.',
    "5. CATEGORIZE it using the REGISTRY's closed set — set `category:` in the copy's SKILL.md frontmatter to EXACTLY ONE of: ci-cd, testing, security, ai-native, docs, workflow, other. This is NOT the vocabulary the source repo uses; map by the skill's primary job, and use `other` only when none of the six fit. A value outside the set is normalized to `other` at index time, so an unmapped category is silently lost.",
    "6. VERSION it as SEMVER — `version: X.Y.Z`. Carry the source's version if it already has three parts; if it has two (`1.4`), write `1.4.0`; if it has none, write `1.0.0`. Never bump during a share: sharing generalizes, it does not change the method.",
    "7. DECLARE its memory + context wiring in the same frontmatter: carry the source's `memory:` field verbatim (project | vault | none; omit if the source has none). Set `contexts: tracked` ONLY when the skill's METHOD explicitly walks the repo's context map and records per-context progress in its memory notes — otherwise omit the field entirely. This flag is a promise the app measures against; never set it speculatively.",
    '8. If a reference file is 100% specific to this repo, omit it from the registry copy and note the omission at the bottom of the registry SKILL.md.',
    target.usageFile
      ? `9. Commit ${target.clonePath}/skills/${name}/ AND ${target.usageFile} on \`${branch}\`, with a message naming the source project and what was generalized away. The usage file was written by the app before this task started — do not edit its contents, just include it; it carries this installation's skill-invocation counts and rides this commit so counts never need one of their own.`
      : `9. Commit ONLY ${target.clonePath}/skills/${name}/ on \`${branch}\`, with a message naming the source project and what was generalized away.`,
    '',
    'Do NOT push and do NOT open a pull request — leave the branch local. A human decides whether this becomes a proposal; merging is how this registry adopts, and an agent that pushes has made that decision for them.',
    'Do NOT modify anything else in the registry working copy: not the root registry.yaml, not another consumer\u2019s overlay, not other skills. If the working copy carries uncommitted changes you did not make, STOP and report rather than committing around them.',
    `Do NOT touch this repo (${project.name}) — it is the source, and read-only for this task.`,
  ].join('\n');
}
