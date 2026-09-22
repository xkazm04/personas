/**
 * ThreadRail — variant C's side panel: the parallel threads Athena is holding.
 *
 * Each row is one thread of work: Athena herself (her own operations and
 * whatever has no project), each project with a live task, and the other
 * conversations. A row is a name, a glyph that pulses only while that thread
 * is working, and a count of what waits there. Selecting a row walks into its
 * room.
 */

import { Bot, MessagesSquare } from 'lucide-react';
import { TONE_VAR } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import type { ProcessTone, Workforce } from '../useWorkforce';

function Glyph({ tone, count }: { tone: ProcessTone; count: number }) {
  return (
    <span className="relative w-7 h-7 shrink-0 grid place-items-center" aria-hidden>
      <span className="absolute inset-0 rounded-full opacity-20" style={{ background: TONE_VAR[tone] }} />
      <span
        className={`w-2.5 h-2.5 rounded-full ${tone === 'working' ? 'animate-pulse' : ''}`}
        style={{ background: TONE_VAR[tone] }}
      />
      {count > 1 && (
        <span className="absolute -bottom-1 -right-1 typo-label text-foreground/80 leading-none">{count}</span>
      )}
    </span>
  );
}

function Waiting({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="ml-auto min-w-6 h-6 px-2 rounded-full bg-status-warning/20 text-status-warning typo-label grid place-items-center">
      {n}
    </span>
  );
}

export function ThreadRail({
  workforce,
  active,
  onOpenRoom,
  onOpenThread,
}: {
  workforce: Workforce;
  /** `null` = Athena's own room, a project name, or undefined when in chat. */
  active: string | null | undefined;
  onOpenRoom: (project: string | null) => void;
  onOpenThread: (id: string) => void;
}) {
  const { lanes, looseItems, ops, threads } = workforce;
  const row = (on: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-interactive text-left focus-ring transition-colors ${
      on ? 'bg-primary/12 text-foreground' : 'text-foreground/85 hover:bg-foreground/[0.05]'
    }`;
  return (
    <aside className="w-72 shrink-0 border-r border-foreground/10 bg-secondary/25 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
        <button type="button" onClick={() => onOpenRoom(null)} className={row(active === null)}>
          <span className="w-7 h-7 grid place-items-center rounded-full bg-primary/15 text-primary shrink-0">
            <Bot className="w-4 h-4" aria-hidden />
          </span>
          <span className="typo-title truncate">{C.opsLabel}</span>
          <Waiting n={looseItems.length} />
        </button>
        {ops.length > 0 && (
          <div className="pl-12 pr-3 pb-1 flex gap-1" aria-hidden>
            {ops.map((o) => (
              <span key={o.id} className="h-1 flex-1 rounded-full bg-primary/60" />
            ))}
          </div>
        )}
        <p className="px-3 pt-3 pb-1 typo-label uppercase tracking-wider text-muted">{C.processes}</p>
        {lanes.length === 0 && <p className="px-3 py-1 typo-caption text-muted">{C.noProcesses}</p>}
        {lanes.map((l) => (
          <button key={l.project} type="button" onClick={() => onOpenRoom(l.project)} className={row(active === l.project)}>
            <Glyph tone={l.bullets[0]?.tone ?? 'idle'} count={l.bullets.length} />
            <span className="typo-body truncate">{l.project}</span>
            <Waiting n={l.items.length} />
          </button>
        ))}
        {threads.length > 0 && (
          <>
            <p className="px-3 pt-3 pb-1 typo-label uppercase tracking-wider text-muted">{C.threadsLabel}</p>
            {threads.map((th) => (
              <button key={th.id} type="button" onClick={() => onOpenThread(th.id)} className={row(false)}>
                <span className="w-7 h-7 grid place-items-center rounded-full bg-accent/15 text-accent shrink-0">
                  <MessagesSquare className="w-4 h-4" aria-hidden />
                </span>
                <span className="typo-body truncate">{th.title}</span>
                <span className="ml-auto typo-label text-accent">{th.unread}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
