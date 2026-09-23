/**
 * ProcessColumns — the usage panel: one column per affected project.
 *
 * Every column has two zones that never mix. On top, what waits on the
 * operator: glowing rings in the colour of their kind; one click opens that
 * card at full size. Below a hairline, what is running: square tiles whose
 * icon says the process type (fleet session, Athena's live op, Run Desk task,
 * scheduled check-in) and whose corner dot is that surface's NATIVE state
 * colour. Words live in tooltips; the panel itself is signal.
 *
 * `look` lets the floating-frame variants restyle tiles without forking the
 * structure.
 */

import { Activity, CalendarClock, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { FleetShipIcon } from '@/features/plugins/fleet/FleetShipIcon';
import { KIND_VAR } from './tones';
import { NEXT_COPY as C } from './nextCopy';
import { ATHENA_COLUMN, type ProcessKind, type ProcessMark, type ProjectColumn } from './useProcessColumns';
import type { WorkItem } from './useWorkforce';

export type ColumnsLook = 'panel' | 'glass' | 'bezel' | 'halo';

const KIND_ICON: Record<ProcessKind, (p: { className?: string }) => ReactNode> = {
  fleet: ({ className }) => <FleetShipIcon className={className} />,
  liveop: ({ className }) => <Activity className={className} />,
  rundesk: ({ className }) => <Play className={className} />,
  schedule: ({ className }) => <CalendarClock className={className} />,
};

const TILE: Record<ColumnsLook, string> = {
  panel: 'rounded-interactive bg-secondary/60 border border-foreground/10',
  glass: 'rounded-full bg-foreground/[0.07] border border-foreground/10 backdrop-blur',
  bezel: 'rounded-[3px] bg-background border border-foreground/20 shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)]',
  halo: 'rounded-card bg-background/70 border border-primary/20',
};

function ProcessTile({ p, look }: { p: ProcessMark; look: ColumnsLook }) {
  const Icon = KIND_ICON[p.kind];
  return (
    <Tooltip content={`${C.processKind[p.kind]} · ${p.label} · ${p.state}`} placement="left">
      <button
        type="button"
        onClick={p.open}
        aria-label={`${C.processKind[p.kind]}: ${p.label}, ${p.state}`}
        className={`relative w-8 h-8 grid place-items-center text-foreground/85 hover:text-foreground focus-ring transition-colors ${TILE[look]} ${
          p.urgent ? 'ring-2 ring-status-warning/60' : ''
        }`}
      >
        <Icon className="w-4 h-4" />
        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${p.dot}`} aria-hidden />
      </button>
    </Tooltip>
  );
}

function DecisionRing({ item, onOpen }: { item: WorkItem; onOpen: (id: string) => void }) {
  const color = KIND_VAR[item.kind];
  return (
    <Tooltip content={`${C.kind[item.kind]}: ${item.title}`} placement="left">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        aria-label={`${C.kind[item.kind]}: ${item.title}`}
        className="w-6 h-6 rounded-full border-2 bg-background focus-ring hover:scale-110 transition-transform"
        style={{ borderColor: color, boxShadow: `0 0 12px -2px ${color}, inset 0 0 6px -2px ${color}` }}
      />
    </Tooltip>
  );
}

function Column({ col, look, onOpenItem }: { col: ProjectColumn; look: ColumnsLook; onOpenItem: (id: string) => void }) {
  return (
    <div className="w-11 shrink-0 flex flex-col items-center gap-2 min-h-0">
      <Tooltip content={col.label} placement="left">
        <span
          className={`h-24 typo-caption whitespace-nowrap overflow-hidden text-ellipsis [writing-mode:vertical-rl] rotate-180 ${
            col.key === ATHENA_COLUMN ? 'text-primary' : col.decisions.length ? 'text-foreground' : 'text-foreground/70'
          }`}
        >
          {col.label}
        </span>
      </Tooltip>
      <div className="flex flex-col items-center gap-2 min-h-8">
        {col.decisions.map((d) => (
          <DecisionRing key={d.id} item={d} onOpen={onOpenItem} />
        ))}
      </div>
      <span className="w-6 h-px bg-foreground/15" aria-hidden />
      <div className="flex flex-col items-center gap-2">
        {col.processes.map((p) => (
          <ProcessTile key={p.id} p={p} look={look} />
        ))}
      </div>
    </div>
  );
}

export function ProcessColumns({
  columns,
  waiting,
  onOpenItem,
  onOpenWaiting,
  look = 'panel',
}: {
  columns: ProjectColumn[];
  waiting: number;
  onOpenItem: (id: string) => void;
  onOpenWaiting: () => void;
  look?: ColumnsLook;
}) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <button
        type="button"
        onClick={onOpenWaiting}
        className="mx-2 mt-2 mb-3 flex items-center gap-2 rounded-interactive px-2 py-1.5 hover:bg-foreground/[0.06] focus-ring"
      >
        <span
          className="w-3 h-3 rounded-full border-2 border-status-warning"
          style={{ boxShadow: '0 0 10px -1px var(--status-warning)' }}
          aria-hidden
        />
        <span className="typo-body text-foreground">
          {waiting} {C.waitingOnYou.toLowerCase()}
        </span>
        <kbd className="ml-auto rounded border border-foreground/15 bg-foreground/[0.05] px-1.5 typo-caption font-mono text-foreground/80">
          Alt+W
        </kbd>
      </button>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-1 pb-3">
        <div className="flex gap-0.5">
          {columns.map((c) => (
            <Column key={c.key} col={c} look={look} onOpenItem={onOpenItem} />
          ))}
        </div>
      </div>
    </div>
  );
}
