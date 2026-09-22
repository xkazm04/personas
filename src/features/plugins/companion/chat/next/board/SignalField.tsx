/**
 * SignalField — variant B's side panel, purely graphical.
 *
 * No sentences and no counts in words: each project with a live task is a small
 * block of squares (one per process, coloured by state), anything waiting on
 * the operator is a ringed, glowing square in the same block, Athena's own
 * operations are diamonds at the top and other threads are dots at the bottom.
 * The only text is a two-letter monogram; names live in the tooltip.
 */

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KIND_VAR, TONE_VAR } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import type { ProjectLane, Workforce } from '../useWorkforce';

/** Two letters: initials of a multi-part name, else its first two letters. */
const monogram = (s: string) => {
  const parts = s.split(/[-_\s.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : s.slice(0, 2)).toUpperCase();
};

function Block({ lane, active, onOpen }: { lane: ProjectLane; active: boolean; onOpen: () => void }) {
  const tip = `${lane.project}: ${lane.bullets.map((b) => C.tone[b.tone]).join(', ')}${
    lane.items.length ? ` · ${lane.items.length} ${C.waitingOnYou.toLowerCase()}` : ''
  }`;
  return (
    <Tooltip content={tip} placement="right">
      <button
        type="button"
        onClick={onOpen}
        aria-label={tip}
        className={`w-full flex flex-col items-center gap-1.5 py-2 rounded-interactive focus-ring transition-colors ${
          active ? 'bg-primary/15' : 'hover:bg-foreground/[0.06]'
        }`}
      >
        <span className="grid grid-cols-3 gap-1" aria-hidden>
          {lane.items.map((it) => (
            <span
              key={it.id}
              className="w-3 h-3 rounded-[3px] border-2 bg-background"
              style={{ borderColor: KIND_VAR[it.kind], boxShadow: `0 0 10px -1px ${KIND_VAR[it.kind]}` }}
            />
          ))}
          {lane.bullets.map((b) => (
            <span key={b.id} className="w-3 h-3 rounded-[3px]" style={{ background: TONE_VAR[b.tone] }} />
          ))}
        </span>
        <span className="typo-label text-foreground/75">{monogram(lane.project)}</span>
      </button>
    </Tooltip>
  );
}

export function SignalField({
  workforce,
  activeProject,
  onOpenProject,
  onOpenThread,
}: {
  workforce: Workforce;
  activeProject: string | null | undefined;
  onOpenProject: (project: string | null) => void;
  onOpenThread: (id: string) => void;
}) {
  const { lanes, looseItems, ops, threads } = workforce;
  return (
    <aside className="w-24 shrink-0 border-r border-foreground/10 bg-secondary/25 flex flex-col items-stretch min-h-0 py-3 px-2 gap-3">
      <Tooltip content={`${C.opsLabel}: ${ops.map((o) => o.intent).join(', ') || C.idle}`} placement="right">
        <button
          type="button"
          onClick={() => onOpenProject(null)}
          aria-label={C.opsLabel}
          className={`flex flex-wrap justify-center gap-1.5 py-2 rounded-interactive focus-ring ${
            activeProject === null ? 'bg-primary/15' : 'hover:bg-foreground/[0.06]'
          }`}
        >
          {ops.length === 0 && <span className="w-3 h-3 rotate-45 border-2 border-primary/50" aria-hidden />}
          {ops.map((o) => (
            <span key={o.id} className="w-3 h-3 rotate-45 bg-primary shadow-[0_0_10px_-1px_var(--primary)]" aria-hidden />
          ))}
          {looseItems.map((it) => (
            <span
              key={it.id}
              className="w-3 h-3 rounded-full border-2 bg-background"
              style={{ borderColor: KIND_VAR[it.kind], boxShadow: `0 0 10px -1px ${KIND_VAR[it.kind]}` }}
              aria-hidden
            />
          ))}
        </button>
      </Tooltip>
      <div className="h-px bg-foreground/10" aria-hidden />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none flex flex-col gap-1">
        {lanes.map((l) => (
          <Block key={l.project} lane={l} active={activeProject === l.project} onOpen={() => onOpenProject(l.project)} />
        ))}
      </div>
      {threads.length > 0 && (
        <>
          <div className="h-px bg-foreground/10" aria-hidden />
          <div className="flex flex-wrap justify-center gap-2">
            {threads.map((th) => (
              <Tooltip key={th.id} content={`${th.title} · ${th.unread}`} placement="right">
                <button
                  type="button"
                  onClick={() => onOpenThread(th.id)}
                  aria-label={th.title}
                  className="w-3.5 h-3.5 rounded-full bg-accent shadow-[0_0_8px_-1px_var(--accent)] focus-ring"
                />
              </Tooltip>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
