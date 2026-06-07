import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, BookMarked, AlertTriangle } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaChip, usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, memberColor, type RedRoomItem, type RedRoomEventItem, type RedRoomMemoryItem } from './useRedRoomFeed';
import { RedRoomDetailModal } from './RedRoomDetailModal';

/**
 * RELAY variant — "who handed what to whom".
 *
 * Metaphor: the baton pass. Every event renders as an EDGE — emitter chip →
 * event arrow → consumer chips — making the orchestration graph legible as a
 * sequence of relays rather than a flat log. The right rail pins the team's
 * shared memory (decisions / constraints / learnings, by importance) as
 * Transcript-style monospace rows — click one for the full note. Strongest at
 * answering "is the orchestration actually flowing, and where does it stall?"
 */

const FAMILY_ARROW: Record<string, string> = {
  handoff: 'text-violet-300',
  pr: 'text-blue-300',
  qa: 'text-amber-300',
  release: 'text-emerald-300',
  failure: 'text-red-300',
  build: 'text-sky-300',
  other: 'text-foreground/50',
};

export function RedRoomRelay({ items }: { items: RedRoomItem[] }) {
  const personaIndex = usePersonaIndex();
  const [openItem, setOpenItem] = useState<RedRoomItem | null>(null);

  const { exchanges, pinned } = useMemo(() => {
    const ev = items.filter((i): i is RedRoomEventItem => i.kind === 'event');
    const mem = items
      .filter((i): i is RedRoomMemoryItem => i.kind === 'memory')
      .sort((a, b) => b.importance - a.importance || b.at - a.at);
    return { exchanges: ev, pinned: mem };
  }, [items]);

  return (
    <div className="h-full flex gap-4 min-h-0" data-testid="redroom-relay">
      {/* Relay feed */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto space-y-2 pr-1">
        {exchanges.map((e) => {
          const emitter = e.personaId ? personaIndex.get(e.personaId) : undefined;
          const fam = eventFamily(e.eventType);
          return (
            <div
              key={e.id}
              className="rounded-card border border-primary/10 bg-background/50 px-3 py-2.5 hover:bg-secondary/15 transition-colors"
              data-testid="relay-edge"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <PersonaChip persona={emitter} />
                <span className={`inline-flex items-center gap-1 typo-caption font-mono ${FAMILY_ARROW[fam]}`}>
                  <ArrowRight className="w-3.5 h-3.5" />
                  {e.eventType}
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
                {e.consumers.length > 0 ? (
                  e.consumers.slice(0, 4).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)
                ) : (
                  <span className="typo-caption text-foreground/35 italic">no listeners</span>
                )}
                <span className="ml-auto typo-caption text-foreground/40 flex-shrink-0">
                  <RelativeTime timestamp={new Date(e.at).toISOString()} />
                </span>
              </div>
              {(e.summary || e.errorMessage || e.artifact) && (
                <div className="mt-1.5 ml-1 flex items-start gap-2 flex-wrap">
                  {e.errorMessage ? (
                    <p className="flex items-center gap-1.5 typo-caption text-red-300/90">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {e.errorMessage}
                    </p>
                  ) : (
                    e.summary && <p className="typo-body text-foreground/75 line-clamp-2">{e.summary}</p>
                  )}
                  {e.artifact && (
                    <a
                      href={e.artifact.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-foreground/80 hover:bg-secondary/60 transition-colors flex-shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" /> {e.artifact.label}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {exchanges.length === 0 && (
          <p className="typo-body text-foreground/45 px-1 py-3">No relays yet — the channel fills as the team works.</p>
        )}
      </div>

      {/* Shared-memory rail — Transcript-style monospace rows, click for full note */}
      <div className="w-80 flex-shrink-0 min-h-0 flex flex-col">
        <p className="px-1 mb-1.5 typo-label uppercase tracking-wider text-amber-300/90 flex items-center gap-1.5 flex-shrink-0">
          <BookMarked className="w-3.5 h-3.5" /> Shared memory
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-background/60 font-mono">
          {pinned.map((m) => {
            const author = m.personaId ? personaIndex.get(m.personaId) : undefined;
            const color = memberColor(author, m.personaId);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenItem(m)}
                className="w-full text-left flex gap-2 px-3 py-1 border-l-2 border-l-amber-300/60 hover:bg-secondary/25 cursor-pointer"
              >
                <span className="typo-caption text-amber-300/80 uppercase tracking-wider flex-shrink-0 w-20 truncate" title={m.category}>{m.category}</span>
                <span className="typo-caption flex-shrink-0" style={{ color }} title={author?.name.replace(/^T: /, '')}>
                  {'★'.repeat(Math.max(1, Math.min(3, Math.round(m.importance / 4))))}
                </span>
                <span className="typo-caption text-foreground/80 truncate" title={m.title}>
                  {m.title}
                </span>
              </button>
            );
          })}
          {pinned.length === 0 && (
            <p className="typo-caption text-foreground/45 px-3 py-3">No shared memories yet.</p>
          )}
        </div>
      </div>

      <RedRoomDetailModal item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}

export default RedRoomRelay;
