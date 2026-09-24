/**
 * Lane "knowledge" — what the brain PRODUCED rather than received: the
 * distilled facts and the reflections.
 *
 * The two kinds share one newest-first list because they are read the same way
 * and each row already wears its kind as a glyph; splitting them into two
 * columns would have restated in layout what the glyph already says. Rows are
 * `HubEntryRow`, so delete is the same inline affordance it is everywhere else.
 *
 * Above the list sits the one WRITE this lane offers: a seed for
 * `HubFeedApi.reflect`, which asks the twin to think about something and files
 * the result as a new reflection at the top of the list.
 */

import { useMemo, useState } from 'react';
import { BookHeart, Sparkles } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { HubEntryRow } from '../HubEntryRow';
import { HUB_BUSY } from '../useHubFeed';
import type { HubDeskProps } from '../hubContract';
import { knowledgeEntries } from './laneModel';

export function KnowledgeLane({ feed }: HubDeskProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const [seed, setSeed] = useState('');
  const rows = useMemo(() => knowledgeEntries(feed.entries), [feed.entries]);
  const enter = useRevealTracker('knowledge');
  const trimmed = seed.trim();

  const reflect = async () => {
    if (!trimmed) return;
    await feed.reflect(trimmed);
    setSeed('');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Ask for a reflection ───────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 py-2 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap max-w-4xl">
          <BookHeart className="w-3.5 h-3.5 text-status-neutral flex-shrink-0" />
          <span className="typo-label text-foreground flex-shrink-0">{t.knowledge.reflectLabel}</span>
          <input
            type="text"
            value={seed}
            aria-label={t.knowledge.reflectLabel}
            placeholder={t.knowledge.reflectPlaceholder}
            onChange={(e) => setSeed(e.target.value)}
            className={`${INPUT_FIELD} flex-1 min-w-[12rem]`}
          />
          <AsyncButton
            size="xs"
            variant="accent"
            tone="agent"
            isLoading={feed.busyId === HUB_BUSY.reflect}
            disabled={trimmed.length === 0}
            disabledReason={trimmed.length === 0 ? t.knowledge.reflectNeedsSeed : undefined}
            icon={<Sparkles className="w-3 h-3" />}
            onClick={reflect}
          >
            {t.knowledge.reflectAction}
          </AsyncButton>
          <span className="ml-auto typo-caption text-foreground tabular-nums">
            {tx(t.knowledge.total, { facts: feed.counts.facts, reflections: feed.counts.reflections })}
          </span>
        </div>
      </div>

      {/* ── Facts and reflections, newest first ────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3">
        {feed.loading && rows.length === 0 ? (
          <KnowledgeGhost />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            icon={BookHeart}
            title={t.knowledge.emptyTitle}
            subtitle={t.knowledge.emptySubtitle}
          />
        ) : (
          <ul className="space-y-1.5 max-w-4xl">
            {rows.map((entry, i) => (
              <HubEntryRow key={entry.id} entry={entry} feed={feed} order={i} enter={enter} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Calm, geometry-matched ghost under the permanent reflect row. */
function KnowledgeGhost() {
  return (
    <ul className="space-y-1.5 max-w-4xl" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-start gap-2 rounded-card border border-border bg-card/40 px-3 py-2 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}>
          <span className="w-5 h-5 rounded-full bg-primary/[0.06] flex-shrink-0" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-2/5 rounded bg-primary/[0.06]" />
            <span className="block h-3 w-4/5 rounded bg-primary/[0.06]" />
          </span>
        </li>
      ))}
    </ul>
  );
}
