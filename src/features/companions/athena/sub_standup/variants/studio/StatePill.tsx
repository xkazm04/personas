import {
  Activity, CircleCheck, CircleDashed, CheckCheck, Hand, Layers, Lock, MoonStar, PenLine, type LucideIcon,
} from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../../model/types';
import { STUDIO_COPY } from './copy';

/** Icon per state; the badge's tone class carries fill, border and ink. */
const ICON: Record<RowState, LucideIcon> = {
  proposed: CircleDashed,
  decided: CircleCheck,
  running: Activity,
  done: CheckCheck,
  skipped: MoonStar,
  waits: Hand,
  blank: PenLine,
  filler: Layers,
  refused: Lock,
};

/**
 * A designed state badge at the head of the Decision column, one fixed width so
 * every decision text starts on the same edge. PROPOSED = dashed warning
 * border on a soft tint; DECIDED = solid primary fill; RUNNING = success tint
 * under a still diagonal hatch. Icon AND word, always.
 */
export function StatePill({ row }: { row: Pick<RowView, 'state' | 'agentVerb'> }) {
  const { t } = useTranslation();
  const s = t.athena.standup.state;
  const Icon = ICON[row.state];
  const label = row.state === 'proposed' && row.agentVerb
    ? `${row.agentVerb === 'create' ? s.verb_create : s.verb_retune}?`
    : STUDIO_COPY.state[row.state];
  return (
    <span className={`ss-badge ss-badge--${row.state}`}>
      <Icon className="ss-badge__icon" aria-hidden="true" strokeWidth={2.25} />
      <span className="ss-badge__label">{label}</span>
    </span>
  );
}
