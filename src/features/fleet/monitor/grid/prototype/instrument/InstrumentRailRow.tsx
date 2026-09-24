// InstrumentRailRow — one signal-log line: a tone spine, the title on up to two
// lines, then the source in mono with the time or the verdict keys at the right.
// The verdict keys (acknowledge / dismiss) wake on hover and on focus.
//
// Height is ESTIMATED from the title's length against the rail's width (one
// line or two), because the virtualiser needs a number before the row paints.

import { memo } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RailAvatar, RailCheckbox, RailTime } from '../../rail/RailBits';
import { TONE_FILL, TONE_TEXT, type RailRow } from '../../rail/railModel';

const LINE = 23;
const META = 20;
const PAD = 18;
const GROUP = 24;
/** Average advance of a `typo-body` glyph, px — a deliberate overestimate. */
const CHAR_PX = 7.6;

export function railRowHeightFor(width: number) {
  const cpl = Math.max(12, Math.floor((width - 64) / CHAR_PX));
  return (row: RailRow) => PAD + META + (row.title.length > cpl ? 2 : 1) * LINE + (row.groupHeader ? GROUP : 0);
}

const KEY = 'focus-ring inline-flex h-6 items-center gap-1 rounded-interactive border px-1.5 typo-code transition-colors';

export const InstrumentRailRow = memo(function InstrumentRailRow({
  row, height, selected, onToggle, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  height: number;
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
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); };

  const content = (
    <>
      {row.groupHeader && (
        <span className="mb-1 block truncate typo-label uppercase tracking-wider text-foreground opacity-60" style={{ height: GROUP - 4 }}>
          {row.groupHeader}
        </span>
      )}
      <span
        aria-hidden
        className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-pill ${row.accent ? '' : TONE_FILL[row.tone]}`}
        style={row.accent ? { backgroundColor: colorWithAlpha(row.accent, 0.8) } : undefined}
      />
      <span className="flex items-start gap-2">
        {row.selectable && onToggle && <RailCheckbox row={row} checked={!!selected} onToggle={onToggle} className="mt-1" />}
        <span className="mt-1 flex-shrink-0">
          {row.persona ? <RailAvatar row={row} size="w-3.5 h-3.5" /> : <Icon className={`h-3.5 w-3.5 ${TONE_TEXT[row.tone]}`} aria-hidden />}
        </span>
        <span className={`line-clamp-2 min-w-0 flex-1 typo-body text-foreground ${dim ? 'opacity-50' : ''}`}>{row.title}</span>
        {row.unread && (
          <span className="mt-1 flex-shrink-0 rounded-pill bg-primary/20 px-1.5 typo-code tabular-nums text-primary">
            {row.unreadCount ?? '•'}
          </span>
        )}
        {!row.showKind && <span className="sr-only">{row.kind}</span>}
      </span>
      <span className="mt-0.5 flex h-5 items-center gap-2 pl-5 typo-code text-foreground">
        <span className="min-w-0 truncate opacity-60">{row.source}</span>
        {row.showKind && <span className={`flex-shrink-0 ${TONE_TEXT[row.tone]}`}>{row.kind}</span>}
        {canDecide ? (
          <span className="ml-auto flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Tooltip content={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}>
              <button type="button" onClick={(e) => { stop(e); onAccept(row.id); }} aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })} data-testid="rail-row-accept" className={`${KEY} border-status-success/30 text-status-success hover:bg-status-success/15`}>
                <Check className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}>
              <button type="button" onClick={(e) => { stop(e); onReject(row.id); }} aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })} data-testid="rail-row-reject" className={`${KEY} border-status-error/30 text-status-error hover:bg-status-error/15`}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </span>
        ) : (
          row.showTime && <RailTime at={row.at} className="ml-auto flex-shrink-0 opacity-60" />
        )}
      </span>
    </>
  );

  const cls = `group relative block w-full overflow-hidden border-b border-primary/[0.07] py-2 pl-3.5 pr-2 text-left transition-colors ${
    selected ? 'bg-primary/10' : 'hover:bg-foreground/[0.04]'
  }`;
  if (row.selectable && onToggle) {
    return <label className={`${cls} cursor-pointer`} style={{ height }} data-testid="rail-row">{content}</label>;
  }
  if (!onOpen) return <div className={cls} style={{ height }} data-testid="rail-row">{content}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row); } }}
      className={`${cls} focus-ring cursor-pointer`}
      style={{ height }}
      data-testid="rail-row"
    >
      {content}
    </div>
  );
});
