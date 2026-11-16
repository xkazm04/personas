import type { LucideIcon } from 'lucide-react';
import { Radar, MessagesSquare, CalendarClock, FlaskConical, MousePointerClick } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { ExecutionOrigin } from '../../libs/executionOrigin';

/**
 * Visual language per run origin. Manual is deliberately absent from the row
 * badge (the default state stays unmarked) and simulation is covered by the
 * pre-existing simulated badge, but both still need icons + labels for the
 * origin filter dropdown, so the full map lives here.
 */
export const ORIGIN_META: Record<ExecutionOrigin, { icon: LucideIcon; chipClass: string }> = {
  attention: { icon: Radar, chipClass: 'text-ink-1' },
  channel: { icon: MessagesSquare, chipClass: 'text-ink-2' },
  scheduled: { icon: CalendarClock, chipClass: 'text-ink-2' },
  simulation: { icon: FlaskConical, chipClass: 'text-ink-3' },
  manual: { icon: MousePointerClick, chipClass: 'text-ink-3' },
};

/** Localized label for an origin token. */
export function originLabel(t: Translations, origin: ExecutionOrigin): string {
  const e = t.agents.executions;
  switch (origin) {
    case 'attention':
      return e.origin_attention;
    case 'channel':
      return e.origin_channel;
    case 'scheduled':
      return e.origin_scheduled;
    case 'simulation':
      return e.origin_simulation;
    case 'manual':
      return e.origin_manual;
  }
}

function originTooltip(t: Translations, origin: ExecutionOrigin): string {
  const e = t.agents.executions;
  switch (origin) {
    case 'attention':
      return e.origin_tooltip_attention;
    case 'channel':
      return e.origin_tooltip_channel;
    case 'scheduled':
      return e.origin_tooltip_scheduled;
    default:
      return originLabel(t, origin);
  }
}

/**
 * Compact origin chip for an execution row. Renders only for the origins that
 * carry signal (attention / channel / scheduled): manual is the unmarked
 * default and simulation already has its own badge on the row. Attention rows
 * show their lane.
 */
export function OriginBadge({ origin, lane }: { origin: ExecutionOrigin; lane: string | null }) {
  const { t } = useTranslation();
  if (origin === 'manual' || origin === 'simulation') return null;
  const meta = ORIGIN_META[origin];
  const Icon = meta.icon;
  return (
    <Tooltip content={originTooltip(t, origin)}>
      <span className={`inline-flex items-center gap-1.5 typo-code ${meta.chipClass}`}>
        <Icon className="w-2.5 h-2.5" />
        {originLabel(t, origin)}
        {origin === 'attention' && lane ? ` · ${lane}` : ''}
      </span>
    </Tooltip>
  );
}
