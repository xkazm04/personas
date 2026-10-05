// BayFrame — a team's frame on the field: tinted with the team's colour
// (identity, never a status), a nameplate that says who, and two counts drawn
// in the pile colours: how many work, how many need you. The nameplate is the
// door to the team zoom (L1); `onZoom` is the seam WP3 fills.

import { memo, useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import { Inbox, Layers, Workflow, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { PILE_VISUAL } from './piles';
import type { Bay } from './boardModel';
import type { Rect } from './layout';

/** A stored team icon is honoured only when it names a real glyph (see TeamList's TeamGlyph). */
const NAMED_TEAM_ICONS: Record<string, LucideIcon> = { workflow: Workflow, layers: Layers };

function bayGlyph(bay: Bay): LucideIcon | null {
  if (bay.kind === 'teamless') return Inbox;
  const named = bay.icon ? NAMED_TEAM_ICONS[bay.icon.trim().toLowerCase()] : undefined;
  return named ?? (bay.kind === 'workspace' ? Layers : null);
}

interface Props {
  bay: Bay;
  rect: Rect;
  onZoom: (teamId: string) => void;
}

export const BayFrame = memo(function BayFrame({ bay, rect, onZoom }: Props) {
  const { t, tx } = useTranslation();
  const name = bay.kind === 'teamless' ? t.monitor.board_teamless : bay.name;
  const Glyph = bayGlyph(bay);
  const zoom = useCallback(() => onZoom(bay.id), [onZoom, bay.id]);
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    zoom();
  }, [zoom]);
  const team = bay.color ? colorWithAlpha(bay.color, 1) : 'var(--muted)';
  const { needs, critical, working } = bay.counts;

  return (
    <div
      className="fb-bay"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, '--fb-team': team } as CSSProperties}
    >
      <div
        role="button"
        tabIndex={0}
        data-team-id={bay.id}
        aria-label={tx(t.monitor.board_bay_aria, { team: name, count: bay.cards.length, working, needs })}
        className="fb-bay__head focus-ring"
        onClick={zoom}
        onKeyDown={onKeyDown}
      >
        <i className="fb-tick" aria-hidden />
        {Glyph && <Glyph className="h-4 w-4 flex-shrink-0 text-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate typo-heading text-foreground">{name}</span>
        <span className="flex flex-shrink-0 items-center gap-2" aria-hidden>
          {working > 0 && (
            <span className="fb-bay__work inline-flex items-center gap-1" style={{ '--fb-tone': PILE_VISUAL.working.tone } as CSSProperties}>
              <i className="fb-dot" />
              <Numeric value={working} unit="count" className="typo-label text-foreground" />
            </span>
          )}
          {needs > 0 && (
            <span className="fb-count" style={{ '--fb-tone': PILE_VISUAL[critical > 0 ? 'critical' : 'warning'].tone } as CSSProperties}>
              <Numeric value={needs} unit="count" className="typo-label" />
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
