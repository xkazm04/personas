// The depth axis beside the cores: the same 102 laminae as a core, but
// carrying names instead of ink.
//
// It exists because a compressed cut has no row chrome to hang an identity on,
// and "which of the 102 am I on" is a question the operator must be able to
// answer without counting. Every tenth depth prints its index and the last one
// prints the denominator; the depth the cursor is at prints the project's
// name, expanded to the same height as the slice it labels, so the two line up
// with nothing measured in script.
import { Button } from '@/features/shared/components/buttons';
import { ATLAS_WORDS as W } from '../../atlasWords';
import type { AppPassport } from '../../../passportModel';
import type { AtlasNames } from '../../atlasFigure';
import { splitLead } from '../stampsheet/stampsheet.model';
import { depthTicks } from './coresample.model';

export function DepthAxis({ projects, names, pi, onOpenProject }: {
  projects: AppPassport[];
  names: AtlasNames;
  pi: number;
  onOpenProject: (slug: string) => void;
}) {
  const ticks = new Set(depthTicks(projects.length));
  const n = projects.length;

  return (
    <div className="atlas-cut__axis">
      {projects.map((p, i) => {
        const nm = names.get(p.identity.slug);
        if (i === pi) {
          return (
            <span key={p.identity.slug} className="atlas-cut__depth is-at">
              <Button
                variant="ghost"
                size="sm"
                className="atlas-cut__name"
                onClick={() => onOpenProject(p.identity.slug)}
                data-testid={`atlas-open-${p.identity.slug}`}
              >
                <span className="typo-body">{splitLead(nm?.name ?? p.identity.name).title}</span>
              </Button>
              <span className="atlas-cut__index typo-caption tabular-nums" aria-hidden="true">{W.depthOf(i + 1, n)}</span>
            </span>
          );
        }
        return (
          <span key={p.identity.slug} className={`atlas-cut__depth${ticks.has(i) ? ' is-tick' : ''}`}>
            {ticks.has(i) && <span className="atlas-cut__index typo-caption tabular-nums" aria-hidden="true">{i + 1}</span>}
          </span>
        );
      })}
    </div>
  );
}
