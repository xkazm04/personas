/**
 * RowsPanel — Halo · Rows' right panel: the usage columns turned sideways into
 * Gwent battlefield rows.
 *
 * One ~40px row per project, Athena's first and framed exactly like the others
 * (her portrait is the row emblem where a project has its monogram). Left to
 * right: emblem, name, the row's strength (how many processes run there), the
 * processes as small square unit tokens (type icon inside, the owning
 * surface's NATIVE state colour as a bottom bar, a thin warning frame when one
 * needs the operator), and at the right end a single leader slot: a small card
 * with a count badge for what waits on the operator. No rings.
 */

import { useCompanionStore } from '../../../../../companionStore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as C } from '../../../nextCopy';
import { KIND_VAR, frameGradient } from '../../../tones';
import { ATHENA_COLUMN, type ProcessMark, type ProjectColumn } from '../../../useProcessColumns';
import { useWorkforce, type WorkItem } from '../../../useWorkforce';
import { FRAME_LOOKS } from '../../frameLook';
import { FramePiece } from '../../FramePiece';
import type { RightPanelProps } from '../../slots';
import { ROWS_COPY as R } from './copy';
import { CARD_GLYPH, PROCESS_GLYPH } from './glyphs';

/** Unit tokens that fit beside the name; past that, the last slot folds into "+n". */
const TOKEN_SLOTS = 5;

export const ATHENA_PORTRAIT = '/athena/athena_baseline.jpg';

export function RowsPanel({ columns, waiting, onOpenItem, onOpenWaiting }: RightPanelProps) {
  const workforce = useWorkforce();
  const streaming = useCompanionStore((s) => s.streaming);
  return (
    <FramePiece
      edge="right"
      look={FRAME_LOOKS.halo}
      frame={frameGradient(workforce)}
      working={streaming}
      label={R.panelLabel}
      sectionClassName="w-[340px]"
    >
      <div className="flex flex-col h-full min-h-0">
        <WaitingPlaque waiting={waiting} onOpen={onOpenWaiting} />
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-3 flex flex-col gap-1.5">
          {columns.map((c) => (
            <BattleRow key={c.key} col={c} onOpenItem={onOpenItem} />
          ))}
        </div>
      </div>
    </FramePiece>
  );
}

function WaitingPlaque({ waiting, onOpen }: { waiting: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mx-2 mt-2 mb-2 flex items-center gap-2 rounded-interactive border border-foreground/10 bg-secondary/40 px-2.5 py-1.5 hover:bg-secondary/70 focus-ring transition-colors"
    >
      <span
        className="w-2.5 h-3.5 rounded-[3px] border"
        style={{ borderColor: 'var(--status-warning)', background: 'color-mix(in srgb, var(--status-warning) 22%, transparent)' }}
        aria-hidden
      />
      <span className="typo-body text-foreground">{R.waiting(waiting)}</span>
      <kbd className="ml-auto rounded-interactive border border-foreground/15 bg-foreground/[0.05] px-1.5 typo-caption text-foreground">
        {R.altW}
      </kbd>
    </button>
  );
}

/** One project (or Athena) as a battlefield row. */
export function BattleRow({ col, onOpenItem }: { col: ProjectColumn; onOpenItem: (id: string) => void }) {
  const athena = col.key === ATHENA_COLUMN;
  const urgent = col.processes.some((p) => p.urgent);
  return (
    <div
      role="group"
      aria-label={col.label}
      className="relative h-10 shrink-0 flex items-center gap-2 pl-1 pr-1 rounded-interactive border border-foreground/10"
      style={{
        background: `linear-gradient(90deg, color-mix(in srgb, ${athena ? 'var(--primary)' : 'var(--foreground)'} ${athena ? 14 : 6}%, transparent), color-mix(in srgb, var(--secondary) 45%, transparent) 55%)`,
      }}
    >
      <RowEmblem athena={athena} label={col.label} />
      <Tooltip content={col.label} placement="left">
        <span className={`min-w-10 max-w-[128px] shrink truncate typo-body ${athena ? 'text-primary' : 'text-foreground'}`}>{col.label}</span>
      </Tooltip>
      <StrengthGem n={col.processes.length} urgent={urgent} />
      <RowTokens processes={col.processes} />
      <LeaderSlot decisions={col.decisions} onOpen={onOpenItem} />
    </div>
  );
}

/** Athena's portrait or a project's monogram, the same 28px shield either way. */
export function RowEmblem({ athena, label }: { athena: boolean; label: string }) {
  return athena ? (
    <img
      src={ATHENA_PORTRAIT}
      alt=""
      className="w-7 h-7 shrink-0 rounded-interactive object-cover border border-primary/50"
    />
  ) : (
    <span
      aria-hidden
      className="w-7 h-7 shrink-0 rounded-interactive grid place-items-center border border-foreground/15 bg-background/70 typo-label uppercase text-foreground"
    >
      {label.slice(0, 1)}
    </span>
  );
}

/** Gwent's row strength: the number of processes running in the row. */
export function StrengthGem({ n, urgent }: { n: number; urgent: boolean }) {
  return (
    <Tooltip content={R.strength(n)} placement="left">
      <span
        className={`w-6 h-6 shrink-0 grid place-items-center typo-caption tabular-nums ${n ? 'text-foreground' : 'text-foreground/85'}`}
        style={{
          clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
          background: urgent
            ? 'color-mix(in srgb, var(--status-warning) 35%, var(--background))'
            : 'color-mix(in srgb, var(--foreground) 12%, var(--background))',
        }}
      >
        {n}
      </span>
    </Tooltip>
  );
}

export function RowTokens({ processes }: { processes: ProcessMark[] }) {
  const cut = processes.length > TOKEN_SLOTS ? TOKEN_SLOTS - 1 : TOKEN_SLOTS;
  const shown = processes.slice(0, cut);
  const rest = processes.slice(cut);
  return (
    <div className="flex-1 min-w-0 flex items-center justify-end gap-1">
      {processes.length === 0 && (
        <span className="typo-caption text-foreground/85 truncate">{R.idleRow}</span>
      )}
      {shown.map((p) => (
        <UnitToken key={p.id} p={p} />
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.map((p) => `${C.processKind[p.kind]} · ${p.label}`).join('\n')} placement="left">
          <span
            aria-label={R.more(rest.length)}
            className="w-6 h-6 shrink-0 grid place-items-center rounded-interactive border border-dashed border-foreground/20 typo-caption text-foreground"
          >
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** A process as a unit: type icon inside, native state as the bottom bar. */
export function UnitToken({ p }: { p: ProcessMark }) {
  const Icon = PROCESS_GLYPH[p.kind];
  return (
    <Tooltip content={`${C.processKind[p.kind]} · ${p.label} · ${p.state}`} placement="left">
      <button
        type="button"
        onClick={p.open}
        aria-label={`${C.processKind[p.kind]}: ${p.label}, ${p.state}`}
        className={`relative w-6 h-6 shrink-0 grid place-items-center rounded-interactive bg-background/80 border text-foreground/90 hover:text-foreground hover:bg-secondary focus-ring transition-colors ${
          p.urgent ? 'border-status-warning' : 'border-foreground/12'
        }`}
      >
        <Icon className="w-3.5 h-3.5 -mt-0.5" />
        <span className={`absolute inset-x-1 bottom-[2px] h-[3px] rounded-full ${p.dot}`} aria-hidden />
      </button>
    </Tooltip>
  );
}

/** The row's leader slot: one small card for everything waiting, with a count. */
export function LeaderSlot({ decisions, onOpen }: { decisions: WorkItem[]; onOpen: (id: string) => void }) {
  const first = decisions[0];
  if (!first) {
    return (
      <Tooltip content={R.noLeader} placement="left">
        <span aria-hidden className="w-6 h-8 shrink-0 rounded-[4px] border border-dashed border-foreground/15" />
      </Tooltip>
    );
  }
  const color = KIND_VAR[first.kind];
  const Glyph = CARD_GLYPH[first.kind];
  const tip = [R.leader(decisions.length), ...decisions.map((d) => `${C.kind[d.kind]}: ${d.title}`)].join('\n');
  return (
    <Tooltip content={tip} placement="left">
      <button
        type="button"
        onClick={() => onOpen(first.id)}
        aria-label={R.leader(decisions.length)}
        className="relative w-6 h-8 shrink-0 grid place-items-center rounded-[4px] focus-ring hover:-translate-y-0.5 transition-transform"
        style={{
          border: `1.5px solid ${color}`,
          background: `linear-gradient(160deg, color-mix(in srgb, ${color} 38%, var(--background)), var(--background))`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--background) 70%, transparent)`,
        }}
      >
        <Glyph className="w-3.5 h-3.5" style={{ color }} aria-hidden />
        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-status-warning text-background typo-caption tabular-nums leading-none">
          {decisions.length}
        </span>
      </button>
    </Tooltip>
  );
}
