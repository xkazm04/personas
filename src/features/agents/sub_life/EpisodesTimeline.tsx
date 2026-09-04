import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaEpisode } from '@/lib/bindings/PersonaEpisode';
import { listPersonaEpisodes } from '@/api/agents/personaBrain';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { silentCatch } from '@/lib/silentCatch';
import { episodesCache } from './lifeCache';

const PAGE_SIZE = 30;

interface EpisodesTimelineProps {
  personaId: string;
  /**
   * Render inside its own `SectionCard`. Default `true` for a standalone
   * mount; the Brain dashboard passes `false` because the record is a
   * DRILL-DOWN under the volume tile there, and a card inside a card reads as
   * a second, unrelated section.
   */
  framed?: boolean;
}

/**
 * The persona's episodic record, newest first, with a keyset "load older"
 * cursor (both `beforeCreatedAt` and `beforeId`, per the command contract).
 *
 * This is the DETAIL view, not the front page: at a few hundred episodes a
 * flat newest-first list stops being readable, so `sub_brain`'s volume tile
 * carries the shape and opens this on demand.
 */
export function EpisodesTimeline({ personaId, framed = true }: EpisodesTimelineProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [episodes, setEpisodes] = useState<PersonaEpisode[]>(
    () => episodesCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!episodesCache.has(personaId));
  const [hasMore, setHasMore] = useState(true);
  const tracker = useRevealTracker(personaId);

  useEffect(() => {
    let alive = true;
    setEpisodes(episodesCache.get(personaId) ?? []);
    setHasMore(true);
    listPersonaEpisodes(personaId, undefined, undefined, PAGE_SIZE)
      .then((rows) => {
        episodesCache.set(personaId, rows);
        if (alive) {
          setEpisodes(rows);
          setHasMore(rows.length === PAGE_SIZE);
        }
      })
      .catch(silentCatch('life:listEpisodes'))
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [personaId]);

  const loadOlder = useCallback(async () => {
    const last = episodes[episodes.length - 1];
    if (!last) return;
    try {
      const older = await listPersonaEpisodes(personaId, last.createdAt, last.id, PAGE_SIZE);
      setEpisodes((cur) => {
        const merged = [...cur, ...older];
        episodesCache.set(personaId, merged);
        return merged;
      });
      setHasMore(older.length === PAGE_SIZE);
    } catch (err) {
      silentCatch('life:loadOlderEpisodes')(err);
    }
  }, [episodes, personaId]);

  const body = (
    <>
      {episodes.length === 0 ? (
          isLoading ? (
            <div className="space-y-1.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-input bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <p className="typo-caption py-2">{life.brain_episodes_empty}</p>
          )
        ) : (
          <>
            <ul className="space-y-1">
              {episodes.map((e, i) => (
                <RevealItem key={e.id} as="li" revealId={e.id} order={i} {...tracker}>
                  <div className="px-2 py-1.5 rounded-input hover:bg-secondary/30 transition-colors">
                    <div className="flex items-center gap-2">
                      {/* role/source are wire identifiers — rendered as technical chips */}
                      <span className="typo-code px-1.5 py-px rounded-pill bg-primary/10 text-primary/80 border border-primary/15">
                        {e.role}
                      </span>
                      <span className="typo-code text-foreground/85">{e.source}</span>
                      <span className="flex-1" />
                      <RelativeTime timestamp={e.createdAt} className="typo-caption" />
                    </div>
                    <p className="typo-caption mt-0.5 line-clamp-2 break-words">
                      {e.bodyExcerpt}
                    </p>
                  </div>
                </RevealItem>
              ))}
            </ul>
            {hasMore && (
              <div className="mt-2">
                <AsyncButton size="sm" variant="ghost" onClick={loadOlder} data-testid="life-brain-load-older">
                  {life.brain_load_older}
                </AsyncButton>
              </div>
            )}
          </>
        )}
    </>
  );

  return (
    <div data-testid="life-brain-episodes">
      {framed ? <SectionCard title={life.brain_episodes_title}>{body}</SectionCard> : body}
    </div>
  );
}
