/**
 * Fusion · decision v2 - the stakes, as the kit's 30px chips (`.k-chip`): the
 * project with its tech-stack mark and the ref inside it, when it was asked,
 * the blast radius an approval carries, and how many more wait behind a
 * decision. Static chips: nothing here presses.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { Clock, FolderGit2, Layers, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { TechGlyph } from '@/features/shared/components/display/techIcons';
import type { WorkItem } from '../../../../../useWorkforce';
import type { CardModel } from '../../../c/bodies/model';
import { V2_COPY as C } from './copy';
import type { Provenance } from './useProvenance';

/** An approval's risk read: low when the product marks Approve as the safe pick. */
export function blastRadius(model: CardModel | null, herOwn: boolean): 'low' | 'elevated' | null {
  const rec = model?.recommendation;
  if (!model || herOwn || !rec || rec.reveal || !rec.revealed || model.choices.length === 0) return null;
  return model.choices.some((c) => c.recommended) ? 'low' : 'elevated';
}

export function Stakes({ item, model, prov, herOwn }: { item: WorkItem; model: CardModel | null; prov: Provenance; herOwn: boolean }) {
  const risk = blastRadius(model, herOwn);
  const behind = model?.waiting ?? 0;
  if (!prov.project && item.createdAtMs <= 0 && !risk && behind <= 0) return null;
  return (
    <div className="d2-chips" role="group" aria-label={C.stakes} data-testid="companion-fusion-d2-stakes">
      {prov.project && (
        <span className="k-chip d2-chip">
          {prov.tech ? <TechGlyph icon={prov.tech} size={15} /> : <FolderGit2 aria-hidden />}
          <span className="typo-label text-foreground">{prov.project}</span>
          {prov.ref && <span className="typo-data d2-quiet">{prov.ref}</span>}
        </span>
      )}
      {item.createdAtMs > 0 && (
        <span className="k-chip d2-chip">
          <Clock aria-hidden />
          <span className="typo-label text-foreground">{C.asked}</span>
          <RelativeTime timestamp={item.createdAtMs} className="typo-data d2-quiet" />
        </span>
      )}
      {risk && (
        <Tooltip content={model?.recommendation?.text ?? C.blastRadius}>
          <span className={`k-chip d2-chip is-${risk}`} tabIndex={0} data-testid="companion-fusion-d2-risk">
            {risk === 'low' ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
            <span className="typo-label text-foreground">{C.blastRadius}</span>
            <span className={`typo-data ${risk === 'low' ? 'text-status-success' : 'text-status-warning'}`}>
              {risk === 'low' ? C.low : C.elevated}
            </span>
          </span>
        </Tooltip>
      )}
      {behind > 0 && (
        <span className="k-chip d2-chip">
          <Layers aria-hidden />
          <span className="typo-label text-foreground">{C.behind(behind)}</span>
        </span>
      )}
    </div>
  );
}
