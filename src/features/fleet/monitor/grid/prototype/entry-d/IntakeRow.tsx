// One request waiting on the operator. The title gets the whole width in body
// type; the verdict buttons live in their own column on the right and only
// light up on hover or focus, so sixty rows do not read as a hundred and
// twenty buttons. The keyboard is the fast path: with a row focused, A
// accepts, R rejects, Enter opens, and the arrows walk the list.

import { memo, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import type { RailRow } from '../../rail/railModel';
import { TONE_FILL } from '../../rail/railModel';
import { RailCheckbox, RailTime } from '../../rail/RailBits';

export const INTAKE_ROW_H = 60;
export const INTAKE_GROUP_H = 28;
export const intakeHeight = (row: RailRow): number => INTAKE_ROW_H + (row.groupHeader ? INTAKE_GROUP_H : 0);

function walk(from: HTMLElement, delta: 1 | -1) {
  const list = Array.from(document.querySelectorAll<HTMLElement>('[data-intake-row]'));
  const i = list.indexOf(from);
  list[i + delta]?.focus();
}

export const IntakeRow = memo(function IntakeRow({
  row, selected, onToggle, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (row: RailRow) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const Icon = row.icon;
  const primary = () => (onToggle ? onToggle(row.id) : onOpen?.(row));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'enter' || k === ' ') { e.preventDefault(); primary(); }
    else if (k === 'a' && onAccept) { e.preventDefault(); walk(e.currentTarget, 1); onAccept(row.id); }
    else if (k === 'r' && onReject) { e.preventDefault(); walk(e.currentTarget, 1); onReject(row.id); }
    else if (k === 'arrowdown') { e.preventDefault(); walk(e.currentTarget, 1); }
    else if (k === 'arrowup') { e.preventDefault(); walk(e.currentTarget, -1); }
  };
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="flex flex-col">
      {row.groupHeader && (
        <div className="flex items-end px-3 pb-1 typo-eyebrow" style={{ height: INTAKE_GROUP_H }}>{row.groupHeader}</div>
      )}
      <div
        role="button"
        tabIndex={0}
        data-intake-row
        data-selected={selected || undefined}
        onClick={primary}
        onKeyDown={onKey}
        aria-label={[row.title, row.source].filter(Boolean).join(', ')}
        data-testid="entry-d-intake-row"
        className="ed-intake-row ed-row flex cursor-pointer items-stretch"
        style={{ height: INTAKE_ROW_H }}
      >
        <span aria-hidden className={`w-[3px] flex-shrink-0 ${TONE_FILL[row.tone]} ${row.unread || row.decidable ? '' : 'opacity-40'}`} />
        {onToggle && (
          <span className="flex items-center pl-3" onClick={(e) => e.stopPropagation()}>
            <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pl-3 pr-2">
          <span className={`truncate typo-body ${row.unread ? 'text-primary' : 'text-foreground'}`}>{row.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 typo-caption">
            <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{row.source ?? row.kind}</span>
            {row.unreadCount ? <span className="flex-shrink-0 tabular-nums text-primary">{row.unreadCount}</span> : null}
            <RailTime at={row.at} className="ml-auto" />
          </span>
        </div>
        {onAccept && onReject && (
          <div className="ed-verdicts flex flex-shrink-0 items-center gap-1 pr-2">
            <Button variant="accent" tone="success" size="icon-sm" aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
              data-testid="rail-row-accept" onClick={stop(() => onAccept(row.id))} icon={<Check className="h-4 w-4" aria-hidden />} />
            <Button variant="accent" tone="error" size="icon-sm" aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
              data-testid="rail-row-reject" onClick={stop(() => onReject(row.id))} icon={<X className="h-4 w-4" aria-hidden />} />
          </div>
        )}
      </div>
    </div>
  );
});
