// Skill placement — run one of the app's library skills inside a TARGET repo
// that may not have it installed. A dispatched Fleet session can only invoke a
// slash command (`/passport-onboard`, …) if the skill physically exists in that
// repo's `.claude/skills`, so we deterministically COPY it in first (from the
// user-global library or a source project) and then dispatch the invocation.
//
// This is the reusable wrapper behind the passport "Onboard with Fleet" door
// and is intended for any future "dispatch a canonical skill into a repo" flow
// (workspace rollouts, per-dimension guided runs, …). The copy is deterministic
// (`skill_files_install`: SKILL.md + reference files, provenance-stamped) — no
// LLM, no token cost, and the workbench later reads it as installed.
import { exportSkillRegistry, installSkill, installSystemSkill, listSkills } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';

import { composeMemoryBlock } from './memoryBlock';
import { composeReflectionBlock } from './reflectionBlock';
import { dispatchRowToFleet } from './passportFleet';

export interface DispatchSkillToRepoOpts {
  /** Library skill to place + run (e.g. "passport-onboard"). */
  skillName: string;
  /** Copy the skill FROM here: a registered project id, or null = the
   *  user-global library (`~/.claude/skills`). Defaults to the global library. */
  sourceProjectId?: string | null;
  /** Registered dev-project id of the TARGET — its `.claude/skills` receives the copy. */
  targetProjectId: string;
  /** Target repo root — the Fleet session's cwd. */
  targetRoot: string;
  /** Fleet session dedup/name key (e.g. `passport:onboard:<slug>`). */
  dispatchKey: string;
  /** The invocation prompt — should invoke `/<skillName>` with any context. */
  prompt: string;
  /** Refresh the target's copy to the current library version on each dispatch
   *  (default true) so a run never uses a stale/edited local copy. Pass false to
   *  preserve an already-installed (possibly customized) copy. */
  overwrite?: boolean;
  /** App-owned system skill (e.g. passport-onboard): source it from the app
   *  bundle / repo instead of the user's global library, so it resolves on a
   *  fresh clone or clean installer. `sourceProjectId` is ignored when set. */
  system?: boolean;
}

/** Ensure `skillName` is present in the target repo, then dispatch a Fleet
 *  session there that invokes it. Rejects (propagating) if the install or the
 *  spawn fails, so callers can surface the error and re-enable their trigger.
 *
 *  Memory: when the installed skill's frontmatter declares `memory: project`
 *  or `memory: vault`, a MEMORY BLOCK (ledger write contract + context names
 *  + fresh recall) is appended to the prompt — the §3.4 chokepoint. Undeclared
 *  or `none` skills dispatch unchanged. Block composition is best-effort: a
 *  memory failure never blocks the dispatch itself. */
export async function dispatchSkillToRepo(opts: DispatchSkillToRepoOpts): Promise<string> {
  if (opts.system) {
    await installSystemSkill(opts.skillName, opts.targetProjectId, opts.overwrite ?? true);
  } else {
    await installSkill(opts.skillName, opts.sourceProjectId ?? null, opts.targetProjectId, opts.overwrite ?? true);
  }
  let prompt = opts.prompt;
  try {
    const binding = (await listSkills(opts.targetProjectId))
      .find((s) => s.name === opts.skillName)?.memory;
    if (binding === 'project' || binding === 'vault') {
      prompt = `${prompt}\n\n${await composeMemoryBlock(opts.targetProjectId, binding, opts.skillName)}`;
    }
  } catch (e) {
    silentCatch('dispatchSkillToRepo memory block')(e);
  }
  // Skill standard: every dispatched skill carries the dual-reflection
  // contract (docs/skill-standard.md) — after the MEMORY BLOCK so lane 1 can
  // reference it. Refresh the repo's offline skill registry first so the
  // reflection's sync ritual reads current sibling/library versions;
  // best-effort like the memory block, never blocks the dispatch.
  try {
    await exportSkillRegistry(opts.targetProjectId);
  } catch (e) {
    silentCatch('dispatchSkillToRepo skill registry export')(e);
  }
  prompt = `${prompt}\n\n${composeReflectionBlock()}`;
  return dispatchRowToFleet(opts.dispatchKey, opts.targetRoot, prompt);
}
