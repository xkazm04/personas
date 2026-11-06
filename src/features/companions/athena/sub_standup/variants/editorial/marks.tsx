import {
  ArrowUpFromLine, Brush, Forward, GitCommitHorizontal, Hand, Layers, OctagonX, Play, Shuffle, SlidersHorizontal, Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { EventMark } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { fill, ED_COPY } from './copy';

/** Icon AND colour carry the kind: an away act is readable without the legend. */
const KIND: Record<StandupEventKind, { icon: LucideIcon; tone: string }> = {
  push: { icon: ArrowUpFromLine, tone: 'text-status-success' },
  dispatch: { icon: Play, tone: 'text-status-info' },
  ask_parked: { icon: Hand, tone: 'text-status-error' },
  ask_delegated: { icon: Forward, tone: 'text-role-agent' },
  stop: { icon: OctagonX, tone: 'text-status-error' },
  drift: { icon: Shuffle, tone: 'text-status-warning' },
  agent_created: { icon: Sparkles, tone: 'text-role-highlight' },
  agent_retuned: { icon: SlidersHorizontal, tone: 'text-role-highlight' },
  sweep: { icon: Brush, tone: 'text-foreground' },
  backfill: { icon: Layers, tone: 'text-foreground' },
};

const MAX_KINDS = 3;

function byKind(marks: readonly EventMark[]): Array<[StandupEventKind, EventMark[]]> {
  const m = new Map<StandupEventKind, EventMark[]>();
  for (const e of marks) m.set(e.kind, [...(m.get(e.kind) ?? []), e]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

function tip(kind: StandupEventKind, list: EventMark[]): string {
  const head = `${ED_COPY.kinds[kind]}: ${list.length}`;
  return [head, ...list.slice(0, 3).map((e) => e.summary)].join('\n');
}

/** One readable figure per kind (icon + count), each with its own tip; the moved-commits figure leads. */
export function MarkChips({ marks, moved }: { marks: readonly EventMark[]; moved: number }) {
  const kinds = byKind(marks);
  const shown = kinds.slice(0, MAX_KINDS);
  const rest = kinds.slice(MAX_KINDS);
  return (
    <span className="se-chips">
      {moved > 0 && (
        <Tooltip content={fill(ED_COPY.today.moved_hint, { n: moved })}>
          <span className="se-fig se-num">
            <GitCommitHorizontal className="w-3.5 h-3.5 se-quiet" aria-hidden="true" />{moved}<span className="se-sc se-wide">{ED_COPY.today.moved_word}</span>
          </span>
        </Tooltip>
      )}
      {shown.map(([kind, list]) => {
        const { icon: Icon, tone } = KIND[kind];
        return (
          <Tooltip key={kind} content={<span className="whitespace-pre-line">{tip(kind, list)}</span>}>
            <span className="se-fig se-num" aria-label={`${ED_COPY.kinds[kind]}: ${list.length}`}>
              <Icon className={`w-3.5 h-3.5 ${tone}`} strokeWidth={2.25} aria-hidden="true" />{list.length}
            </span>
          </Tooltip>
        );
      })}
      {rest.length > 0 && (
        <Tooltip content={<span className="whitespace-pre-line">{rest.map(([k, l]) => tip(k, l)).join('\n\n')}</span>}>
          <span className="se-fig se-num se-quiet">+{rest.reduce((n, [, l]) => n + l.length, 0)}</span>
        </Tooltip>
      )}
    </span>
  );
}

/** Where on the shared axis each act happened: a fine stroke per act on the cell's floor, like a rug plot in print. */
export function Rug({ marks }: { marks: readonly EventMark[] }) {
  return (
    <>
      {marks.map((m) => (
        <svg key={m.id} x={pct(m.pos)} y="100%" overflow="visible">
          <rect className={`se-rug ${KIND[m.kind].tone}`} y="-13" width="1.5" height="7" />
        </svg>
      ))}
    </>
  );
}
