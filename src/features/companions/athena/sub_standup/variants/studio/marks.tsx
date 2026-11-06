import {
  ArrowUpFromLine, Brush, Forward, GitCommitHorizontal, Hand, Layers, OctagonX, Play, Shuffle, SlidersHorizontal, Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { EventMark } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { fill, STUDIO_COPY } from './copy';

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
  const head = `${STUDIO_COPY.kinds[kind]}: ${list.length}`;
  return [head, ...list.slice(0, 3).map((e) => e.summary)].join('\n');
}

/** One figure per kind (tinted icon + a mono count), each with its own tip; the moved-commits capsule leads. */
export function MarkChips({ marks, moved }: { marks: readonly EventMark[]; moved: number }) {
  const kinds = byKind(marks);
  const shown = kinds.slice(0, MAX_KINDS);
  const rest = kinds.slice(MAX_KINDS);
  return (
    <span className="ss-chips">
      {moved > 0 && (
        <Tooltip content={fill(STUDIO_COPY.today.moved_hint, { n: moved })}>
          <span className="ss-fig ss-fig--moved">
            <GitCommitHorizontal className="ss-ico" aria-hidden="true" /><span className="ss-n">{moved}</span><span className="ss-wide">{STUDIO_COPY.today.moved_word}</span>
          </span>
        </Tooltip>
      )}
      {shown.map(([kind, list]) => {
        const { icon: Icon, tone } = KIND[kind];
        return (
          <Tooltip key={kind} content={<span className="whitespace-pre-line">{tip(kind, list)}</span>}>
            <span className="ss-fig" aria-label={`${STUDIO_COPY.kinds[kind]}: ${list.length}`}>
              <Icon className={`ss-ico ${tone}`} aria-hidden="true" /><span className="ss-n">{list.length}</span>
            </span>
          </Tooltip>
        );
      })}
      {rest.length > 0 && (
        <Tooltip content={<span className="whitespace-pre-line">{rest.map(([k, l]) => tip(k, l)).join('\n\n')}</span>}>
          <span className="ss-fig ss-fig--more">+{rest.reduce((n, [, l]) => n + l.length, 0)}</span>
        </Tooltip>
      )}
    </span>
  );
}

/** Where on the shared axis each act happened: a rounded tick per act on the cell's floor, in its kind's colour. */
export function Rug({ marks }: { marks: readonly EventMark[] }) {
  return (
    <div className="ss-rugs">
      {marks.map((m) => <i key={m.id} className={`ss-rug ${KIND[m.kind].tone}`} style={{ left: pct(m.pos) }} />)}
    </div>
  );
}
