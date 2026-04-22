/**
 * GroupPanel — one connector-category bucket.
 *
 * Animated chevron + height-collapse via framer-motion. The "live" counter
 * pill at the panel header stays — it's a per-panel hint, not the deleted
 * top-bar "N live" display.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { EventRow } from './EventRow';
import type { Connection, EventRow as EventRowData } from '../routingHelpers';
import type { ActivityEntry, GroupDef } from './types';

interface Props {
  group: GroupDef;
  activity: Map<string, ActivityEntry>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedRows: Set<string>;
  onToggleRow: (eventType: string) => void;
  onAdd: (row: EventRowData) => void;
  onRename: (row: EventRowData) => void;
  onDisconnect: (conn: Connection, row: EventRowData) => void;
}

const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function GroupPanel({
  group, activity, collapsed, onToggleCollapse,
  expandedRows, onToggleRow, onAdd, onRename, onDisconnect,
}: Props) {
  const Icon = group.icon;
  const activeCount = group.rows.filter(r => {
    const a = activity.get(r.eventType);
    return a?.lastTs && Date.now() - a.lastTs < LIVE_WINDOW_MS;
  }).length;

  return (
    <section className={`rounded-card border ${group.accentBorder} bg-card/40 overflow-hidden`}>
      <button
        type="button"
        onClick={onToggleCollapse}
        className={`w-full flex items-center gap-2.5 px-3 py-2 ${group.accentBg} hover:brightness-110 transition-all text-left`}
      >
        <motion.span animate={{ rotate: collapsed ? 0 : 90 }} transition={{ duration: 0.15 }} className="inline-flex">
          <ChevronRight className="w-3.5 h-3.5 text-foreground/60" />
        </motion.span>
        <Icon className={`w-4 h-4 ${group.accentText}`} />
        <span className={`text-sm font-semibold uppercase tracking-wider ${group.accentText}`}>{group.label}</span>
        <span className="text-xs text-foreground/60 tabular-nums">· {group.rows.length} event{group.rows.length !== 1 ? 's' : ''}</span>
        {activeCount > 0 && (
          <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-card bg-emerald-500/10 border border-emerald-500/30">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-400 tabular-nums">{activeCount} live</span>
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0.0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {group.rows.map(row => (
              <EventRow
                key={row.eventType}
                row={row}
                activity={activity.get(row.eventType)}
                expanded={expandedRows.has(row.eventType)}
                onToggleExpand={() => onToggleRow(row.eventType)}
                onAdd={() => onAdd(row)}
                onRename={() => onRename(row)}
                onDisconnect={(conn) => onDisconnect(conn, row)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
