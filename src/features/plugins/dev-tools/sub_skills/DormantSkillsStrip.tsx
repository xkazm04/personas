/**
 * "Recommended from sweep" — the dormant-skill findings, rendered where the
 * skills they name actually live.
 *
 * The action offered is Use, not Uninstall, and that is the deliberate half.
 * The finding's own wording is "make it discoverable, fold it into a skill that
 * IS used, or retire it" — three options, of which only one is destructive and
 * none is reversible from this surface. Invoking the skill is the cheap move
 * that settles the question: a skill that turns out to be useful stops being
 * dormant on the next sweep, and one that does not has now been tried before
 * anyone deletes it.
 */

import { Moon, Play } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DormantSkillFinding } from './dormantSkillFindings';

interface Props {
  findings: DormantSkillFinding[];
  /** Skill names this project actually has. A finding for a skill that has
   *  since been removed is stale and must not be offered as an action. */
  installedNames: Set<string>;
  onUse: (skillName: string) => void;
}

export function DormantSkillsStrip({ findings, installedNames, onUse }: Props) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;

  const live = findings.filter((f) => installedNames.has(f.skillName));
  if (live.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-card border border-primary/15 bg-card/40 overflow-hidden"
      data-testid="dormant-skills-strip"
    >
      <header className="px-3 py-2 border-b border-primary/10 flex items-center gap-2">
        <Moon className="w-3.5 h-3.5 text-amber-300" aria-hidden />
        <span className="typo-card-label">{dt.skills_dormant_heading}</span>
        <span className="typo-caption ml-auto" data-testid="dormant-skills-count">
          {live.length}
        </span>
      </header>
      <ul className="divide-y divide-primary/5">
        {live.map((f) => (
          <li
            key={f.ideaId}
            data-testid={`dormant-skill-${f.skillName}`}
            className="px-3 py-2 flex items-center gap-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block typo-card-label truncate">{f.skillName}</span>
              <span className="block typo-caption">
                {f.lastInvokedAt ? (
                  <>
                    {dt.skills_dormant_last} <RelativeTime timestamp={f.lastInvokedAt} />
                  </>
                ) : (
                  dt.skills_dormant_never
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onUse(f.skillName)}
              data-testid={`dormant-skill-use-${f.skillName}`}
              className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border border-primary/20 typo-caption text-foreground hover:bg-primary/10 focus-ring"
            >
              <Play className="w-3 h-3" aria-hidden />
              {dt.skills_dormant_use}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DormantSkillsStrip;
