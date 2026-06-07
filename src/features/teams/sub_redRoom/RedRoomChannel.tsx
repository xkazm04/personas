import { useMemo } from 'react';
import { ExternalLink, Pin, AlertTriangle } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaChip, usePersonaIndex } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, type RedRoomItem } from './useRedRoomFeed';

/**
 * CHANNEL variant — "the team's Slack room".
 *
 * Metaphor: a chat channel. Each emitted event is a message from its persona
 * (avatar + name + time), with the event type as a colour-coded chip, the
 * payload summary as the message body, artifact links as attachment chips and
 * "→ heard by" consumer chips showing who's subscribed. Team memories appear
 * inline as pinned cards. Day dividers break the stream. Reads top-down like
 * a conversation the crew is having.
 */

const FAMILY_TONE: Record<string, { chip: string; rail: string }> = {
  handoff: { chip: 'bg-violet-500/10 border-violet-500/25 text-violet-300', rail: 'bg-violet-400' },
  pr: { chip: 'bg-blue-500/10 border-blue-500/25 text-blue-300', rail: 'bg-blue-400' },
  qa: { chip: 'bg-amber-500/10 border-amber-500/25 text-amber-300', rail: 'bg-amber-400' },
  release: { chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300', rail: 'bg-emerald-400' },
  failure: { chip: 'bg-red-500/10 border-red-500/25 text-red-300', rail: 'bg-red-400' },
  build: { chip: 'bg-sky-500/10 border-sky-500/25 text-sky-300', rail: 'bg-sky-400' },
  other: { chip: 'bg-secondary/40 border-primary/15 text-foreground/70', rail: 'bg-foreground/30' },
};

function dayKey(at: number): string {
  return new Date(at).toDateString();
}

export function RedRoomChannel({ items }: { items: RedRoomItem[] }) {
  const personaIndex = usePersonaIndex();
  // Chronological for a conversation read; the host scrolls to the latest.
  const ordered = useMemo(() => [...items].reverse(), [items]);

  let lastDay = '';
  return (
    <div className="flex flex-col gap-2 pb-2" data-testid="redroom-channel">
      {ordered.map((item) => {
        const day = dayKey(item.at);
        const divider = day !== lastDay;
        lastDay = day;
        const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
        return (
          <div key={`${item.kind}-${item.id}`}>
            {divider && (
              <div className="flex items-center gap-3 py-2">
                <span className="flex-1 h-px bg-primary/10" />
                <span className="typo-caption text-foreground/45">{new Date(item.at).toLocaleDateString()}</span>
                <span className="flex-1 h-px bg-primary/10" />
              </div>
            )}

            {item.kind === 'memory' ? (
              <div className="ml-10 rounded-card border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Pin className="w-3.5 h-3.5 text-amber-300/80 flex-shrink-0" />
                  <span className="typo-card-label text-foreground">{item.title}</span>
                  <span className="typo-caption text-foreground/45 uppercase tracking-wider">{item.category}</span>
                  <span className="ml-auto typo-caption text-foreground/40"><RelativeTime timestamp={new Date(item.at).toISOString()} /></span>
                </div>
                <p className="mt-1 typo-body text-foreground/75 line-clamp-3">{item.content}</p>
              </div>
            ) : (
              <div className="flex gap-2.5 group">
                {/* Speaker avatar */}
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-secondary/60 border border-primary/10 flex-shrink-0 mt-0.5">
                  {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" /> : <span className="typo-caption text-foreground/40">?</span>}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="typo-body font-medium text-foreground">
                      {persona ? persona.name.replace(/^T: /, '') : 'System'}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-interactive border typo-caption font-mono ${(FAMILY_TONE[eventFamily(item.eventType)] ?? FAMILY_TONE.other!).chip}`}>
                      {item.eventType}
                    </span>
                    <span className="typo-caption text-foreground/40"><RelativeTime timestamp={new Date(item.at).toISOString()} /></span>
                  </div>
                  {item.summary && (
                    <p className="mt-0.5 typo-body text-foreground/80">{item.summary}</p>
                  )}
                  {item.errorMessage && (
                    <p className="mt-0.5 flex items-center gap-1.5 typo-caption text-red-300/90">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {item.errorMessage}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {item.artifact && (
                      <a
                        href={item.artifact.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-foreground/80 hover:bg-secondary/60 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" /> {item.artifact.label}
                      </a>
                    )}
                    {item.consumers.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 typo-caption text-foreground/45">
                        →
                        {item.consumers.slice(0, 3).map((pid) => (
                          <PersonaChip key={pid} persona={personaIndex.get(pid)} />
                        ))}
                        {item.consumers.length > 3 && <span>+{item.consumers.length - 3}</span>}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default RedRoomChannel;
