import {
  ArrowUpFromLine, Brush, Forward, GitCommitHorizontal, Hand, Layers, OctagonX, Play, Shuffle, SlidersHorizontal, Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { EventMark } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { fill, CONSOLE_COPY } from './copy';

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
  const head = `${CONSOLE_COPY.kinds[kind]}: ${list.length}`;
  return [head, ...list.slice(0, 3).map((e) => e.summary)].join('\n');
}

/** One mono figure per kind (signal-coloured glyph + count), each with its own tip; the moved-commits figure leads. */
export function MarkChips({ marks, moved }: { marks: readonly EventMark[]; moved: number }) {
  const kinds = byKind(marks);
  const shown = kinds.slice(0, MAX_KINDS);
  const rest = kinds.slice(MAX_KINDS);
  return (
    <span className="sc-chips">
      {moved > 0 && (
        <Tooltip content={fill(CONSOLE_COPY.today.moved_hint, { n: moved })}>
          <span className="sc-fig sc-fig--lead">
            <GitCommitHorizontal className="sc-ico" aria-hidden="true" /><span className="sc-num">{moved}</span><span className="sc-fig__word sc-wide">{CONSOLE_COPY.today.moved_word}</span>
          </span>
        </Tooltip>
      )}
      {shown.map(([kind, list]) => {
        const { icon: Icon, tone } = KIND[kind];
        return (
          <Tooltip key={kind} content={<span className="whitespace-pre-line">{tip(kind, list)}</span>}>
            <span className="sc-fig" aria-label={`${CONSOLE_COPY.kinds[kind]}: ${list.length}`}>
              <Icon className={`sc-ico ${tone}`} aria-hidden="true" /><span className="sc-num">{list.length}</span>
            </span>
          </Tooltip>
        );
      })}
      {rest.length > 0 && (
        <Tooltip content={<span className="whitespace-pre-line">{rest.map(([k, l]) => tip(k, l)).join('\n\n')}</span>}>
          <span className="sc-fig sc-fig--more"><span className="sc-num">+{rest.reduce((n, [, l]) => n + l.length, 0)}</span></span>
        </Tooltip>
      )}
    </span>
  );
}

/** Where on the shared axis each act happened: a quiet tick per act on the cell's floor. */
export function Rug({ marks }: { marks: readonly EventMark[] }) {
  return (
    <>
      {marks.map((m) => (
        <svg key={m.id} x={pct(m.pos)} y="100%" overflow="visible">
          <rect className={`sc-rug ${KIND[m.kind].tone}`} y="-8" width="1.25" height="5" />
        </svg>
      ))}
    </>
  );
}
