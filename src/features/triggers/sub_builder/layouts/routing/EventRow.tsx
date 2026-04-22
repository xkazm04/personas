/**
 * Event row — one line per event, with the canonical spine:
 *
 *   chevron · pulse · SOURCE(s) → EVENT → LISTENER(s) · time-ago · activity-count
 *
 * Round 3: SOURCE column width doubled (160px → 320px min) so full persona
 * names render via <SourceStack />.
 *
 * Clicking anywhere on the row toggles the <ExpandedDrawer /> below it.
 * framer-motion rotates the chevron and height-animates the drawer.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ArrowRight } from 'lucide-react';
import { CLASS_ACCENT } from './accent';
import { formatAgo } from './activity';
import { ExpandedDrawer } from './ExpandedDrawer';
import { ListenerStack } from './ListenerStack';
import { PulseDot } from './PulseDot';
import { resolveIcon, type Connection, type EventRow as EventRowData } from '../routingHelpers';
import { SourceStack } from './SourceStack';
import type { ActivityEntry } from './types';

interface Props {
  row: EventRowData;
  activity: ActivityEntry | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onAdd: () => void;
  onRename: () => void;
  onDisconnect: (conn: Connection) => void;
}

// `auto` for icons/controls; `minmax(px, fr)` for data columns so they share
// horizontal slack proportionally. Source column is ~2x every other column.
const GRID_COLUMNS =
  'auto auto minmax(320px, 2.2fr) auto minmax(200px, 1.3fr) auto minmax(160px, 1fr) auto auto';

export function EventRow({
  row, activity, expanded, onToggleExpand, onAdd, onRename, onDisconnect,
}: Props) {
  const Icon = resolveIcon(row.template);
  const accent = CLASS_ACCENT[row.sourceClass];

  return (
    <div className="border-t border-primary/5 first:border-t-0">
      <button
        type="button"
        onClick={onToggleExpand}
        className="group w-full grid items-center gap-3 px-3 py-2.5 hover:bg-secondary/20 transition-colors text-left"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="inline-flex">
          <ChevronRight className="w-3.5 h-3.5 text-foreground/40" />
        </motion.span>

        <PulseDot activity={activity} />

        {/* SOURCE — doubled column with named chips. */}
        <div className="min-w-0">
          <ColumnLabel>Source</ColumnLabel>
          <SourceStack row={row} />
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-foreground/25" />

        {/* EVENT — type + label + class badge. */}
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <ColumnLabel>Event</ColumnLabel>
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${accent.text}`}>· {accent.label}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${row.template?.color ?? accent.text}`} />
            <code className="font-mono text-sm text-foreground truncate">{row.eventType}</code>
            {row.template && (
              <span className="text-xs text-foreground/50 truncate hidden xl:inline">· {row.template.label}</span>
            )}
          </div>
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-foreground/25" />

        {/* LISTENERS — compact avatar stack; full names live in drawer. */}
        <div className="min-w-0">
          <ColumnLabel>Listeners</ColumnLabel>
          <ListenerStack row={row} />
        </div>

        <span className="text-[10px] text-foreground/40 tabular-nums w-10 text-right flex-shrink-0">
          {formatAgo(activity?.lastTs ?? null)}
        </span>

        <span
          className="text-[10px] text-foreground/30 tabular-nums flex-shrink-0"
          title={`${activity?.count ?? 0} event${(activity?.count ?? 0) !== 1 ? 's' : ''} in window`}
        >
          {activity?.count ? `×${activity.count}` : '·'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0.0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <ExpandedDrawer row={row} onAdd={onAdd} onRename={onRename} onDisconnect={onDisconnect} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-widest text-foreground/40 mb-0.5">
      {children}
    </div>
  );
}
