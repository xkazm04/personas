/**
 * Event row — one line per event, with the canonical spine:
 *
 *   chevron · pulse · SOURCE(s) → EVENT → LISTENER(s) · time-ago · activity-count
 *
 * Column labels live in the sticky <RoutingTableHeader /> above the panels
 * (Source / Event / Listeners), not on every row — so rows stay value-only.
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
import { ROUTING_GRID_COLUMNS, type ActivityEntry } from './types';

interface Props {
  row: EventRowData;
  activity: ActivityEntry | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onAdd: () => void;
  onRename: () => void;
  onDisconnect: (conn: Connection) => void;
}

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
        aria-expanded={expanded}
        className={`group w-full grid items-center gap-3 px-3 py-2.5 cursor-pointer text-left border-l-2 transition-colors ${
          expanded
            ? 'bg-secondary/40 border-l-primary/60'
            : 'border-l-transparent hover:bg-secondary/35 hover:border-l-primary/40'
        }`}
        style={{ gridTemplateColumns: ROUTING_GRID_COLUMNS }}
      >
        <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="inline-flex">
          <ChevronRight className="w-3.5 h-3.5 text-foreground group-hover:text-foreground transition-colors" />
        </motion.span>

        <PulseDot activity={activity} />

        {/* SOURCE — named chips. */}
        <div className="min-w-0">
          <SourceStack row={row} />
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-foreground" />

        {/* EVENT — icon + type + class badge + label. */}
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${row.template?.color ?? accent.text}`} />
          <code className="font-mono typo-body text-foreground truncate">{row.eventType}</code>
          <span className={`typo-caption font-semibold uppercase tracking-wider flex-shrink-0 ${accent.text}`}>{accent.label}</span>
          {row.template && (
            <span className="typo-caption text-foreground truncate hidden xl:inline">· {row.template.label}</span>
          )}
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-foreground" />

        {/* LISTENERS — avatar stack; full names live in drawer. */}
        <div className="min-w-0">
          <ListenerStack row={row} />
        </div>

        <span className="typo-caption text-foreground tabular-nums w-12 text-right flex-shrink-0">
          {formatAgo(activity?.lastTs ?? null)}
        </span>

        <span
          className="typo-caption text-foreground tabular-nums flex-shrink-0"
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
