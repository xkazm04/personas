/**
 * TavernBoard — Halo · Hand's right panel. One slim lane (~40px) per project,
 * Athena first, all built from the SAME three shapes so her lane reads as one
 * of the family:
 *
 * - a crest (her portrait medallion / the project's monogram shield);
 * - a mini deck: the waiting decisions as tiny stacked card-backs with a
 *   count gem (never an empty ring); clicking deals that lane's top card;
 * - process tokens: small round tokens carrying their TYPE icon, rimmed in the
 *   owning surface's native state colour. An urgent token pulses its rim ONCE
 *   when its state changes, never on a loop.
 */

import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as N } from '../../../nextCopy';
import { frameGradient, KIND_VAR } from '../../../tones';
import { useWorkforce } from '../../../useWorkforce';
import { ATHENA_COLUMN, type ProcessMark, type ProjectColumn } from '../../../useProcessColumns';
import { FRAME_LOOKS } from '../../frameLook';
import { FramePiece } from '../../FramePiece';
import type { RightPanelProps } from '../../slots';
import { HAND_COPY as C } from './copy';
import { CardBackFace } from './CardBack';
import { Crest, GOLD, GOLD_SOFT, PROCESS_GLYPH } from './handTokens';

const look = FRAME_LOOKS.halo;

export function TavernBoard({ columns, waiting, onOpenItem, onOpenWaiting }: RightPanelProps) {
  const workforce = useWorkforce();
  return (
    <FramePiece edge="right" look={look} frame={frameGradient(workforce)} label={C.board} sectionClassName="max-w-[420px] h-auto! max-h-full self-start">
      <div className="flex flex-col max-h-[calc(100vh-150px)] min-h-0 min-w-[108px]">
        <WaitingGem waiting={waiting} onOpen={onOpenWaiting} />
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin px-1.5 pb-3">
          <div className="flex gap-1 justify-center">
            {columns.map((c) => (
              <Lane key={c.key} col={c} onOpenItem={onOpenItem} />
            ))}
          </div>
        </div>
      </div>
    </FramePiece>
  );
}

/** The header: the whole table's waiting count as a gem, Alt+W beneath. */
function WaitingGem({ waiting, onOpen }: { waiting: number; onOpen: () => void }) {
  const lit = waiting > 0;
  return (
    <Tooltip content={`${waiting} ${N.waitingOnYou.toLowerCase()} · Alt+W`} placement="left">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${waiting} ${N.waitingOnYou.toLowerCase()}`}
        className="mx-2 mt-2 mb-3 flex items-center justify-center gap-2 rounded-interactive px-2 py-1.5 hover:bg-foreground/[0.06] focus-ring"
      >
        <span
          className="grid place-items-center w-6 h-6 rotate-45 rounded-[5px] shrink-0"
          style={{
            background: lit
              ? `linear-gradient(135deg, ${GOLD}, color-mix(in srgb, var(--status-warning) 70%, var(--background)))`
              : 'color-mix(in srgb, var(--foreground) 12%, transparent)',
            boxShadow: lit ? `0 0 12px -3px ${GOLD}` : undefined,
          }}
          aria-hidden
        >
          <span className="-rotate-45 typo-caption text-background">{waiting}</span>
        </span>
        <span className="typo-body text-foreground">{C.waitingShort}</span>
      </button>
    </Tooltip>
  );
}

function Lane({ col, onOpenItem }: { col: ProjectColumn; onOpenItem: (id: string) => void }) {
  const athena = col.key === ATHENA_COLUMN;
  return (
    <div className="w-10 shrink-0 flex flex-col items-center gap-2.5 pt-1">
      <Tooltip content={col.label} placement="left">
        <span className="block" tabIndex={-1}>
          <Crest athena={athena} label={col.label} size={28} />
        </span>
      </Tooltip>
      <MiniDeck col={col} onOpenItem={onOpenItem} />
      <span className="w-5 h-px" style={{ background: GOLD_SOFT }} aria-hidden />
      <div className="flex flex-col items-center gap-1.5">
        {col.processes.map((p) => (
          <ProcessToken key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

/**
 * Up to three stacked card-backs, each edged in its kind colour, with a gem
 * counting the whole pile. An empty lane keeps the slot's height (so tokens
 * line up across lanes) and paints nothing.
 */
function MiniDeck({ col, onOpenItem }: { col: ProjectColumn; onOpenItem: (id: string) => void }) {
  const n = col.decisions.length;
  if (n === 0) return <span className="h-[34px]" aria-hidden />;
  const shown = col.decisions.slice(0, 3);
  const top = col.decisions[0]!;
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span>{C.deckOf(n, col.label)}</span>
          {col.decisions.slice(0, 4).map((d) => (
            <span key={d.id} className="text-muted">
              {N.kind[d.kind]}: {d.title.length > 60 ? `${d.title.slice(0, 60)}…` : d.title}
            </span>
          ))}
        </span>
      }
      placement="left"
    >
      <button
        type="button"
        onClick={() => onOpenItem(top.id)}
        aria-label={C.deckOf(n, col.label)}
        className="relative w-[26px] h-[34px] focus-ring rounded-[4px] transition-transform duration-150 hover:-translate-y-0.5"
      >
        {shown
          .map((d, i) => (
            <span
              key={d.id}
              className="absolute left-0 top-0"
              style={{ transform: `translate(${i * 2}px, ${-i * 2}px)`, zIndex: 3 - i }}
            >
              <CardBackFace kindColor={KIND_VAR[d.kind]} size="mini" />
            </span>
          ))
          .reverse()}
        <span
          className="absolute -right-1.5 -bottom-1.5 z-10 grid place-items-center min-w-[16px] h-4 px-1 rounded-full typo-caption leading-none text-background"
          style={{ background: GOLD, boxShadow: '0 0 0 2px var(--background)' }}
          aria-hidden
        >
          {n}
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * A 22px round token: type icon inside, native state colour as the rim. The
 * rim is the `dot` class painted on an outer disc behind an inner one.
 */
function ProcessToken({ p }: { p: ProcessMark }) {
  const Icon = PROCESS_GLYPH[p.kind];
  const { shouldAnimate } = useMotion();
  return (
    <Tooltip content={`${N.processKind[p.kind]} · ${p.label} · ${p.state}`} placement="left">
      <button
        type="button"
        onClick={p.open}
        aria-label={`${N.processKind[p.kind]}: ${p.label}, ${p.state}`}
        className="relative block w-[22px] h-[22px] rounded-full focus-ring"
      >
        <motion.span
          // Keyed by state: the pulse replays once when the state changes.
          key={`${p.state}`}
          className={`absolute inset-0 rounded-full ${p.dot}`}
          initial={shouldAnimate && p.urgent ? { scale: 1.35, opacity: 0.4 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          aria-hidden
        />
        <span className="absolute inset-[2px] rounded-full bg-background grid place-items-center text-foreground/85" aria-hidden>
          <Icon className="w-3 h-3" />
        </span>
        {p.urgent && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rotate-45 rounded-[1px] bg-status-warning"
            style={{ boxShadow: '0 0 0 1.5px var(--background)' }}
            aria-hidden
          />
        )}
      </button>
    </Tooltip>
  );
}
