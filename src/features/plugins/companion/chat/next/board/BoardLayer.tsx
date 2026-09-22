/**
 * BoardLayer — variant B's nested layer: everything waiting, at once.
 *
 * Where the deck (variant A) shows one card at a time, the board lays every
 * waiting item out as full cards in columns by what the operator has to do
 * (answer, decide, review, read), with the live processes as a band on top.
 * A project picked in the signal field narrows the board to that project and
 * the composer below replies about the card last clicked.
 */

import { ArrowLeft } from 'lucide-react';
import { KIND_VAR, TONE_DOT } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import { WorkItemBody } from '../WorkItemBody';
import type { ProjectLane, WorkItem, WorkItemKind } from '../useWorkforce';

const COLUMNS: { title: string; kinds: WorkItemKind[] }[] = [
  { title: 'Answer', kinds: ['session_request', 'decision'] },
  { title: 'Approve', kinds: ['approval', 'plan'] },
  { title: 'Review', kinds: ['failure', 'warning', 'nudge', 'assignment'] },
];

export function BoardLayer({
  items,
  lanes,
  project,
  focusId,
  onFocus,
  onBack,
  onSend,
}: {
  items: WorkItem[];
  lanes: ProjectLane[];
  project: string | null;
  focusId: string | null;
  onFocus: (id: string) => void;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const shownLanes = project ? lanes.filter((l) => l.project === project) : lanes;
  const columns = COLUMNS.map((col) => ({ ...col, items: items.filter((i) => col.kinds.includes(i.kind)) })).filter(
    (c) => c.items.length > 0,
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-4 px-8 pt-5 pb-4 border-b border-foreground/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-body text-foreground/80 hover:bg-foreground/[0.06] focus-ring"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {C.backToChat}
        </button>
        <h2 className="typo-section-title text-foreground">{project ?? C.allProjects}</h2>
        <span className="typo-body text-foreground/70">
          {items.length} {C.waitingOnYou.toLowerCase()}
        </span>
      </div>

      {shownLanes.length > 0 && (
        <div className="flex gap-6 overflow-x-auto scrollbar-thin px-8 py-3 border-b border-foreground/10 bg-secondary/20">
          {shownLanes.map((l) => (
            <div key={l.project} className="shrink-0">
              <p className="typo-card-label text-foreground">{l.project}</p>
              <div className="mt-1 flex flex-col gap-0.5">
                {l.bullets.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-2 typo-caption text-foreground/80">
                    <span className={`w-2 h-2 rounded-full ${TONE_DOT[b.tone]}`} aria-hidden />
                    <span className="truncate max-w-56">{b.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-8 py-6">
        {columns.length === 0 ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className="typo-section-title text-foreground">{C.nothingWaiting}</p>
              <p className="typo-body text-foreground/70 mt-1">{C.nothingWaitingSub}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(320px, 1fr))` }}>
            {columns.map((col) => (
              <section key={col.title} className="min-w-0 space-y-4">
                <p className="typo-label uppercase tracking-wider text-muted">
                  {col.title} · {col.items.length}
                </p>
                {col.items.map((it) => (
                  <article
                    key={it.id}
                    onClickCapture={() => onFocus(it.id)}
                    className={`rounded-card border bg-secondary/30 p-4 shadow-elevation-1 transition-shadow ${
                      it.id === focusId ? 'border-primary/60 ring-2 ring-primary/25' : 'border-foreground/10'
                    }`}
                  >
                    <p className="typo-label uppercase tracking-wider" style={{ color: KIND_VAR[it.kind] }}>
                      {C.kind[it.kind]}
                      {it.project ? ` · ${it.project}` : ''}
                    </p>
                    <h3 className="typo-title-lg text-foreground mt-1 mb-3">{it.title}</h3>
                    <WorkItemBody item={it} onSend={onSend} />
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
