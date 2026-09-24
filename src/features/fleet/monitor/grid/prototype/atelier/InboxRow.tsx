// Atelier inbox row — roomy and calm: the producing persona's face (or the
// kind's icon), a title that may take two lines, the source quietly under it.
// Decidable rows reveal a labelled Approve / Dismiss pair on hover or focus;
// unread rows carry one primary dot. One fixed height feeds the virtualiser.

import { memo, type MouseEvent } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Button } from '@/features/shared/components/buttons';
import { RailCheckbox, RailTime } from '../../rail/RailBits';
import { TONE_TEXT, type RailRow } from '../../rail/railModel';

export const INBOX_ROW_H = 84;
export const inboxRowHeight = (): number => INBOX_ROW_H;

export const InboxRow = memo(function InboxRow({
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
  const canDecide = row.decidable && !!onAccept && !!onReject;
  const dim = row.tracksRead && !row.unread;
  const stop = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };

  const body = (
    <>
      {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} className="mt-1" />}
      <span className="relative mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-pill bg-secondary/45">
        {row.persona ? (
          <PersonaIcon icon={row.persona.icon} color={row.persona.color} size="w-4 h-4" />
        ) : (
          <Icon className={`h-4 w-4 ${TONE_TEXT[row.tone]}`} aria-hidden />
        )}
        {row.unread && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />}
      </span>
      <span className={`flex min-w-0 flex-1 flex-col ${dim ? 'opacity-55' : ''}`}>
        <span className="line-clamp-2 typo-body text-foreground">{row.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground opacity-60">
          {row.source && <span className="truncate">{row.source}</span>}
          {row.showKind && <span className={`flex-shrink-0 ${TONE_TEXT[row.tone]}`}>· {row.kind}</span>}
          {!row.showKind && <span className="sr-only">{row.kind}</span>}
          {row.showTime && <RailTime at={row.at} className="ml-auto" />}
        </span>
      </span>
      {canDecide && (
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-pill bg-background/90 p-0.5 opacity-0 shadow-elevation-2 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          <Button
            variant="ghost"
            size="xs"
            icon={<Check className="h-3.5 w-3.5" aria-hidden />}
            onClick={(e) => { stop(e); onAccept(row.id); }}
            aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
            className="text-status-success"
            data-testid="rail-row-accept"
          >
            Approve
          </Button>
          <Button
            variant="ghost"
            size="xs"
            icon={<X className="h-3.5 w-3.5" aria-hidden />}
            onClick={(e) => { stop(e); onReject(row.id); }}
            aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
            className="text-status-error"
            data-testid="rail-row-reject"
          >
            Dismiss
          </Button>
        </span>
      )}
    </>
  );

  const cls = `group/row relative flex w-full items-start gap-3 rounded-input px-3 py-2.5 text-left transition-colors ${
    selected ? 'bg-primary/10' : 'hover:bg-secondary/35'
  }`;
  const style = { height: INBOX_ROW_H - 4 };

  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`} style={style} data-testid="rail-row">{body}</label>;
  }
  return onOpen ? (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen(row);
      }}
      className={`${cls} focus-ring cursor-pointer`}
      style={style}
      data-testid="rail-row"
    >
      {body}
    </div>
  ) : (
    <div className={cls} style={style} data-testid="rail-row">{body}</div>
  );
});
