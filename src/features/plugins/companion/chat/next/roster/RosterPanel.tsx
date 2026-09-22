/**
 * RosterPanel — variant A's side panel: Athena's workforce as bullets.
 *
 * One row per project with a live task (nothing else is listed), its processes
 * as filled bullets coloured by state, and anything waiting on the operator as
 * ringed dots at the row's end. No sentences: a name, bullets, dots. Clicking a
 * row, or a single dot, opens the deck on it.
 */

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { KIND_VAR, TONE_DOT } from '../tones';
import { NEXT_COPY as C } from '../nextCopy';
import type { WorkItem, Workforce } from '../useWorkforce';

function ItemDot({ item, onOpen }: { item: WorkItem; onOpen: (id: string) => void }) {
  return (
    <Tooltip content={`${C.kind[item.kind]}: ${item.title}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(item.id);
        }}
        aria-label={`${C.kind[item.kind]}: ${item.title}`}
        className="w-3.5 h-3.5 rounded-full border-2 bg-background focus-ring hover:scale-125 transition-transform"
        style={{ borderColor: KIND_VAR[item.kind], boxShadow: `0 0 8px -1px ${KIND_VAR[item.kind]}` }}
      />
    </Tooltip>
  );
}

function Row({
  label,
  bullets,
  items,
  active,
  onOpen,
  onOpenItem,
}: {
  label: string;
  bullets: { id: string; tone: keyof typeof TONE_DOT; label: string }[];
  items: WorkItem[];
  active: boolean;
  onOpen: () => void;
  onOpenItem: (id: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-interactive cursor-pointer focus-ring transition-colors ${
        active ? 'bg-primary/12' : 'hover:bg-foreground/[0.05]'
      }`}
    >
      <span className={`truncate min-w-0 flex-1 ${active ? 'typo-title text-foreground' : 'typo-body text-foreground/85'}`}>
        {label}
      </span>
      <span className="flex items-center gap-1" aria-hidden>
        {bullets.slice(0, 8).map((b) => (
          <span key={b.id} className={`w-2 h-2 rounded-full ${TONE_DOT[b.tone]}`} />
        ))}
        {bullets.length > 8 && <span className="typo-caption text-muted">+{bullets.length - 8}</span>}
      </span>
      {items.length > 0 && (
        <span className="flex items-center gap-1.5 pl-2 border-l border-foreground/10">
          {items.slice(0, 4).map((it) => (
            <ItemDot key={it.id} item={it} onOpen={onOpenItem} />
          ))}
          {items.length > 4 && <span className="typo-caption text-muted">+{items.length - 4}</span>}
        </span>
      )}
    </div>
  );
}

export function RosterPanel({
  workforce,
  activeProject,
  onOpenProject,
  onOpenItem,
  onOpenThread,
}: {
  workforce: Workforce;
  activeProject: string | null | undefined;
  onOpenProject: (project: string | null) => void;
  onOpenItem: (id: string) => void;
  onOpenThread: (id: string) => void;
}) {
  const { lanes, looseItems, ops, threads } = workforce;
  return (
    <aside className="w-80 shrink-0 border-l border-foreground/10 bg-secondary/25 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-4">
        <div>
          <p className="px-3 pt-2 pb-1 typo-label uppercase tracking-wider text-muted">{C.waitingOnYou}</p>
          <Row
            label={C.opsLabel}
            bullets={ops.map((o) => ({ id: o.id, tone: 'working' as const, label: o.intent }))}
            items={looseItems}
            active={activeProject === null}
            onOpen={() => onOpenProject(null)}
            onOpenItem={onOpenItem}
          />
        </div>
        <div>
          <p className="px-3 pb-1 typo-label uppercase tracking-wider text-muted">{C.processes}</p>
          {lanes.length === 0 && <p className="px-3 py-2 typo-caption text-muted">{C.noProcesses}</p>}
          {lanes.map((l) => (
            <Row
              key={l.project}
              label={l.project}
              bullets={l.bullets}
              items={l.items}
              active={activeProject === l.project}
              onOpen={() => onOpenProject(l.project)}
              onOpenItem={onOpenItem}
            />
          ))}
        </div>
        {threads.length > 0 && (
          <div>
            <p className="px-3 pb-1 typo-label uppercase tracking-wider text-muted">{C.threadsLabel}</p>
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => onOpenThread(th.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-interactive hover:bg-foreground/[0.05] focus-ring"
              >
                <span className="typo-body text-foreground/85 truncate flex-1 text-left">{th.title}</span>
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: Math.min(th.unread, 6) }, (_, i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent" />
                  ))}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
