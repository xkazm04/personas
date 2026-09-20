// Building the consented dispatch that starts a council round.
//
// Nothing here spawns anything: it composes a `DispatchRequest` for the shared
// `DispatchChooserModal`, which is the app's ONE consent surface for handing a
// prompt to an agent. The prompt is the `/council <slug>` slash command, the
// Fleet key is the subject's address (so a second dispatch for the same subject
// is refused by the chooser's own dedup check), and `prepare()` refuses the
// whole dispatch when the target repo has no `/council` skill to run.
import { councilSkillInstalled } from '@/api/devTools/council';
import type { DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';

/** Where the operator is told to go when the skill link is missing. */
export const COUNCIL_LINK_REMEDY = 'node <registry>/scripts/link-registry.mjs';

export interface CouncilTarget {
  projectId: string;
  projectName: string;
  rootPath: string;
}

/** The Fleet session name for one subject. One key per (project, subject), so
 *  the chooser's running-session check makes a double dispatch impossible. */
export function councilFleetKey(projectId: string, slug: string): string {
  return `council:${projectId}:${slug}`;
}

/** `/council <slug>` for a first round; later rounds carry `--round <n>`. */
export function councilPrompt(slug: string, nextRound: number): string {
  return nextRound > 1
    ? skillCommand('council', `${slug} --round ${nextRound}`)
    : skillCommand('council', slug);
}

/**
 * The dispatch request for one subject's next round.
 *
 * `roundNo` is the round already ON RECORD (null when none has run), so the
 * round this dispatch asks for is `roundNo + 1`.
 */
export function buildCouncilDispatch(args: {
  target: CouncilTarget;
  slug: string;
  featureName: string;
  roundNo: number | null;
}): DispatchRequest {
  const { target, slug, featureName, roundNo } = args;
  const t = getActiveTranslations().plugins.dev_tools;
  const nextRound = (roundNo ?? 0) + 1;

  return {
    title: interpolate(t.council_dispatch_title, { feature: featureName }),
    prompt: councilPrompt(slug, nextRound),
    target: {
      projectId: target.projectId,
      projectName: target.projectName,
      rootPath: target.rootPath,
    },
    fleetKey: councilFleetKey(target.projectId, slug),
    prepare: async () => {
      // A read failure throws out of here rather than resolving to "missing":
      // the chooser aborts the dispatch and surfaces the real error, so a
      // session is never pointed at a repo whose state nobody observed.
      const installed = await councilSkillInstalled(target.projectId);
      if (!installed) {
        throw new Error(
          interpolate(
            getActiveTranslations().plugins.dev_tools.council_skill_missing,
            { project: target.projectName, remedy: COUNCIL_LINK_REMEDY },
          ),
        );
      }
    },
  };
}
