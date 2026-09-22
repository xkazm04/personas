/**
 * RoomLayer — variant C's nested layer: one thread of work, whole.
 *
 * A room is everything about one project (or Athena herself) side by side: its
 * processes as a timeline on the left, what waits on the operator there as full
 * cards on the right. The composer below replies about the room's first
 * waiting card, so "go ahead" typed in a room lands where it is meant.
 */

import { ArrowLeft } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KIND_VAR, TONE_DOT, TONE_VAR } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import { WorkItemBody } from '../WorkItemBody';
import type { AthenaOp, ProjectLane, WorkItem } from '../useWorkforce';

export function RoomLayer({
  title,
  lane,
  ops,
  items,
  onBack,
  onSend,
}: {
  title: string;
  lane: ProjectLane | null;
  ops: AthenaOp[];
  items: WorkItem[];
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const tone = lane?.tone ?? 'working';
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="flex items-center gap-4 px-8 pt-5 pb-4 border-b border-foreground/10"
        style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${TONE_VAR[tone]} 12%, transparent), transparent 60%)` }}
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-body text-foreground/80 hover:bg-foreground/[0.06] focus-ring"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {C.backToChat}
        </button>
        <h2 className="typo-heading-lg text-foreground">{title}</h2>
        {lane && <span className="typo-body text-foreground/70">{C.tone[lane.tone]}</span>}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
        <section className="min-h-0 overflow-y-auto scrollbar-thin border-r border-foreground/10 px-6 py-6">
          <p className="typo-label uppercase tracking-wider text-muted mb-4">{C.processes}</p>
          <ol className="relative space-y-5 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-foreground/15">
            {ops.map((o) => (
              <li key={o.id} className="relative pl-6">
                <span className="absolute left-0 top-1.5 w-3 h-3 rotate-45 bg-primary" aria-hidden />
                <p className="typo-body text-foreground">{o.intent}</p>
                <p className="typo-caption text-muted">{o.status} · {o.duration}</p>
              </li>
            ))}
            {lane?.bullets.map((b) => (
              <li key={b.id} className="relative pl-6">
                <span className={`absolute left-0 top-1.5 w-3 h-3 rounded-full ${TONE_DOT[b.tone]}`} aria-hidden />
                <p className="typo-body text-foreground">{b.label}</p>
                <p className="typo-caption text-muted">
                  {C.tone[b.tone]} · <RelativeTime timestamp={b.sinceMs} showTooltip={false} />
                </p>
              </li>
            ))}
            {ops.length === 0 && !lane?.bullets.length && <li className="pl-6 typo-caption text-muted">{C.noProcesses}</li>}
          </ol>
        </section>
        <section className="min-h-0 overflow-y-auto scrollbar-thin px-8 py-6 space-y-5">
          <p className="typo-label uppercase tracking-wider text-muted">
            {C.waitingHere} · {items.length}
          </p>
          {items.length === 0 && <p className="typo-body text-foreground/70">{C.roomEmpty}</p>}
          {items.map((it) => (
            <article
              key={it.id}
              className="rounded-card border border-foreground/10 border-l-4 bg-secondary/30 p-5 shadow-elevation-1"
              style={{ borderLeftColor: KIND_VAR[it.kind] }}
            >
              <p className="typo-label uppercase tracking-wider" style={{ color: KIND_VAR[it.kind] }}>
                {C.kind[it.kind]}
              </p>
              <h3 className="typo-title-lg text-foreground mt-1 mb-3">{it.title}</h3>
              <WorkItemBody item={it} onSend={onSend} />
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
