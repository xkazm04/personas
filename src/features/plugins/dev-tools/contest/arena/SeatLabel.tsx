// A seat as ONE inline unit: an engine dot, the model name, the effort muted.
// `claude:claude-opus-5-5@xhigh` reads "● Opus 5.5 Extra high" — never a mono
// id between two pills. Unknown models keep their raw id (seatLabel's rule).
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestEngine } from '@/lib/bindings/ContestEngine';

import { effortLabel, engineLabel } from '../model/labels';
import { seatLabel } from '../model/seatCatalog';

// The dot names the ENGINE, so it takes the categorical brand hues, never a
// status tone (the same row's state dot owns those) and never the theme
// accent: violet, cyan and the foreground stay apart from every state colour.
const ENGINE_DOT: Record<ContestEngine, string> = {
  claude: 'bg-brand-purple',
  codex: 'bg-brand-cyan',
  grok: 'bg-foreground',
};

export interface SeatLabelProps {
  spec: string;
  className?: string;
  /** Hide the effort (a column that already names it). */
  hideEffort?: boolean;
}

export function SeatLabel({ spec, className = '', hideEffort = false }: SeatLabelProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const seat = seatLabel(spec);
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${className}`} data-testid="contest-seat-label">
      {seat.engine && (
        <span className={`h-2 w-2 shrink-0 self-center rounded-pill ${ENGINE_DOT[seat.engine]}`} aria-hidden />
      )}
      {seat.engine && <span className="sr-only">{engineLabel(s, seat.engine)}</span>}
      <span className="typo-caption text-foreground truncate">{seat.model}</span>
      {!hideEffort && seat.effort && <span className="typo-caption shrink-0">{effortLabel(s, seat.effort)}</span>}
      {seat.label && <span className="typo-caption shrink-0">#{seat.label}</span>}
    </span>
  );
}
