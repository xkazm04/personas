import { useMemo } from 'react';
import { ArrowRight, ExternalLink, BookMarked, AlertTriangle } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaChip, usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, type RedRoomItem, type RedRoomEventItem, type RedRoomMemoryItem } from './useRedRoomFeed';

/**
 * RELAY variant — "who handed what to whom".
 *
 * Metaphor: the baton pass. Every event renders as an EDGE — emitter chip →
 * event arrow → consumer chips — making the orchestration graph legible as a
 * sequence of relays rather than a flat log. The right rail pins the team's
 * shared memory (decisions / constraints / learnings, by importance): the
 * knowledge the relays have deposited. Strongest at answering "is the
 * orchestration actually flowing, and where does it stall?"
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

      {/* Shared-memory rail */}
      <div className="w-72 flex-shrink-0 min-h-0 overflow-y-auto">
        <p className="px-1 mb-1.5 typo-label uppercase tracking-wider text-amber-300/90 flex items-center gap-1.5">
          <BookMarked className="w-3.5 h-3.5" /> Shared memory
        </p>
        <div className="space-y-1.5">
          {pinned.map((m) => {
            const author = m.personaId ? personaIndex.get(m.personaId) : undefined;
            return (
              <div key={m.id} className="rounded-card border border-amber-500/15 bg-amber-500/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="typo-caption uppercase tracking-wider text-amber-300/80">{m.category}</span>
                  <span className="ml-auto typo-caption text-foreground/40 tabular-nums">{'★'.repeat(Math.max(1, Math.min(3, Math.round(m.importance / 4))))}</span>
                </div>
                <p className="mt-0.5 typo-card-label text-foreground">{m.title}</p>
                <p className="mt-0.5 typo-caption text-foreground/65 line-clamp-3">{m.content}</p>
                {author && (
                  <div className="mt-1.5">
                    <PersonaChip persona={author} dim />
                  </div>
                )}
              </div>
            );
          })}
          {pinned.length === 0 && (
            <p className="typo-caption text-foreground/45 px-1">No shared memories yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default RedRoomRelay;
