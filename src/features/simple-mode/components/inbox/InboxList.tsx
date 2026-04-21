/**
 * InboxList — master list column for the Phase 09 Simple-mode Inbox variant.
 *
 * Scrollable vertical list of inbox rows, with a two-chip filter bar at the
 * top (All / Needs me) and a small "N of M" footnote at the bottom. Each row
 * is a button that fires `onSelect(id)`; the currently-selected row gets an
 * amber wash + left border so keyboard navigation is visually trackable.
 *
 * Per-row anatomy (left-to-right):
 *   - Persona illustration thumbnail (24×24, low opacity wash + tone border)
 *   - Severity dot (critical = rose, warning = gold, info = tone-of-kind)
 *   - Title (truncated single line) + persona name + relative timestamp
 *
 * All colors are `simple-accent-{tone}-*` utilities (Phase 11 palette).
 * Typography is `typo-*` + `simple-display`.
 */
import { useAgentStore } from '@/stores/agentStore';
import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';

import { useIllustration } from '../../hooks/useIllustration';
import type { UnifiedInboxItem } from '../../types';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

type SimpleModeT = Translations['simple_mode'];
type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

// formatRelativeTime (Phase 15-01) takes the full Translations bundle so it
// can resolve plural-aware keys under simple_mode.inbox.relative_*. We thread
// the full `t` from useTranslation through to each InboxRow alongside the
// narrowed `simple_mode` slice the rest of the row uses.

type FilterKey = 'all' | 'needsme';

export interface InboxListProps {
  items: UnifiedInboxItem[];
  /** Full item count (pre-filter) — drives the "of M" footnote. */
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: FilterKey;
  onFilterChange: (next: FilterKey) => void;
}

/** Per-kind tone — same mapping Mosaic and Console use; keeps the trio in sync. */
function toneForKind(item: UnifiedInboxItem): Tone {
  switch (item.kind) {
    case 'approval':
      return 'amber';
    case 'message':
      return 'violet';
    case 'output':
      return 'emerald';
    case 'health':
      return item.severity === 'critical' ? 'rose' : 'gold';
  }
}

/** Severity → tone for the small left-rail dot. Overrides the kind tone when
 *  severity is critical/warning so the dot draws attention independently. */
function toneForSeverity(item: UnifiedInboxItem): Tone {
  if (item.severity === 'critical') return 'rose';
  if (item.severity === 'warning') return 'gold';
  return toneForKind(item);
}

export function InboxList({
  items,
  totalCount,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: InboxListProps) {
  const { t, tx } = useTranslation();
  const s = t.simple_mode;
  const inb = s.inbox;

  return (
    <aside className="flex flex-col min-h-0 border-r border-foreground/10 bg-background/30">
      {/* Filter chips */}
      <div className="shrink-0 px-4 py-4 border-b border-foreground/10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="typo-heading simple-display text-foreground truncate">
            {inb.header_title}
          </h2>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip
            active={filter === 'all'}
            label={inb.filter_all}
            onClick={() => onFilterChange('all')}
          />
          <FilterChip
            active={filter === 'needsme'}
            label={inb.filter_needs_me}
            onClick={() => onFilterChange('needsme')}
          />
        </div>
      </div>

      {/* Scrollable list */}
      <ul className="flex-1 overflow-auto divide-y divide-foreground/5">
        {items.map((item) => (
          <InboxRow
            key={item.id}
            t={s}
            tFull={t}
            item={item}
            selected={item.id === selectedId}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </ul>

      {/* Footnote: "X of Y · arrow keys to navigate" */}
      <footer className="shrink-0 px-4 py-2 border-t border-foreground/10 typo-caption text-foreground/55 flex items-center gap-2">
        <span>
          {items.length} {inb.of_label} {totalCount}
        </span>
        <span className="text-foreground/30">·</span>
        <span className="italic truncate">
          {tx(inb.item_count, { n: items.length })}
        </span>
        <span className="ml-auto italic text-foreground/40 truncate">
          {inb.nav_hint}
        </span>
      </footer>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  if (active) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="typo-caption px-2.5 py-1 rounded-full border simple-accent-amber-border simple-accent-amber-soft simple-accent-amber-text"
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="typo-caption px-2.5 py-1 rounded-full border border-foreground/10 bg-foreground/[0.02] text-foreground/60 hover:text-foreground/80 hover:border-foreground/20 transition-colors"
    >
      {label}
    </button>
  );
}

function InboxRow({
  t: _t,
  tFull,
  item,
  selected,
  onClick,
}: {
  t: SimpleModeT;
  tFull: Translations;
  item: UnifiedInboxItem;
  selected: boolean;
  onClick: () => void;
}) {
  const dotTone = toneForSeverity(item);

  const rowClass = selected
    ? `w-full text-left px-4 py-3 flex items-start gap-3 simple-accent-amber-soft border-l-2 simple-accent-amber-border`
    : 'w-full text-left px-4 py-3 flex items-start gap-3 border-l-2 border-transparent hover:bg-foreground/[0.04] transition-colors';

  return (
    <li>
      <button type="button" onClick={onClick} className={rowClass}>
        <PersonaThumb item={item} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full simple-accent-${dotTone}-solid shrink-0`}
              aria-hidden
            />
            <span className="typo-body simple-display text-foreground truncate">
              {item.title}
            </span>
          </div>
          <div className="typo-caption text-foreground/55 flex items-center gap-1.5">
            <span className="italic truncate">{item.personaName}</span>
            <span className="text-foreground/30">·</span>
            <span className="shrink-0">{formatRelativeTime(item.createdAt, tFull)}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * Small square thumbnail with the persona's illustration at low opacity.
 * Resolves the persona lazily from the agent store so we don't re-plumb the
 * list props; falls back to a neutral tone circle when the persona is gone.
 */
function PersonaThumb({ item }: { item: UnifiedInboxItem }) {
  const personas = useAgentStore((sx) => sx.personas);
  const persona = personas.find((p) => p.id === item.personaId) ?? null;
  const tone = toneForKind(item);

  // useIllustration requires a persona-like with id + (optional) hints.
  // Pass a minimal stub when persona is missing so hashId stays stable.
  const illustration = useIllustration(
    persona ?? {
      id: item.personaId,
      name: item.personaName,
      icon: item.personaIcon,
      description: null,
    },
  );

  return (
    <div
      className={[
        'relative w-8 h-8 rounded-2xl border overflow-hidden shrink-0',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
      ].join(' ')}
      aria-hidden
    >
      <img
        src={illustration.url}
        alt=""
        className="simple-illustration absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
    </div>
  );
}
