// Home: the light table. Every contest across every project as a contact
// strip, refine rounds nested under the roll they refine. The newest rolls
// show their frames; older ones wait in the sleeve (edge print only).
// Exactly one strip is "developed" (live iframe thumbnails) at a time.
import { useMemo, useState } from 'react';
import { Film, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';

import { useContests } from '../../hooks/useContests';
import { ContactStrip, GhostFrames, SleeveStrip } from './ContactStrip';
import { CONTACT_COPY as C, fill } from './copy';
import { WALL_LIVE_STRIPS, groupRolls } from './contactModel';

export interface SheetWallProps {
  onOpen: (projectId: string, contestId: string, frameKey?: string) => void;
  onNewRoll: () => void;
}

export function SheetWall({ onOpen, onNewRoll }: SheetWallProps) {
  const { t } = useTranslation();
  const { contests, isLoading, error, refresh } = useContests();
  const rolls = useMemo(() => groupRolls(contests), [contests]);
  const onTable = rolls.slice(0, WALL_LIVE_STRIPS);
  const inSleeve = rolls.slice(WALL_LIVE_STRIPS);
  const [developedKey, setDevelopedKey] = useState<string | null>(null);
  const firstKey = onTable[0] ? `${onTable[0].summary.projectId}/${onTable[0].summary.contestId}` : null;
  const developed = developedKey ?? firstKey;

  if (error && contests.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-status-error/30 bg-status-error/5 px-3 py-2">
        <p className="typo-body text-foreground flex-1" role="alert">
          {fill(C.wallLoadFailed, { message: resolveErrorTranslated(t, extractMessage(error)).message })}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
          {C.retry}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <ul className="space-y-3" aria-hidden data-testid="contact-wall-ghost">
        {[0, 1, 2].map((i) => (
          <li key={i} className="space-y-2 rounded-card border border-primary/8 px-3 py-2.5">
            <div className="h-5 w-48 rounded-interactive bg-secondary/25 animate-fade-in" style={{ animationDelay: `${120 + i * 60}ms` }} />
            <GhostFrames count={4} />
          </li>
        ))}
      </ul>
    );
  }

  if (rolls.length === 0) {
    return (
      <EmptyState
        icon={Film}
        title={C.wallEmptyTitle}
        subtitle={C.wallEmptyBody}
        action={{ label: C.newRoll, onClick: onNewRoll, icon: Plus }}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid="contact-wall">
      <ul className="space-y-3">
        {onTable.map(({ summary, depth }) => {
          const key = `${summary.projectId}/${summary.contestId}`;
          return (
            <ContactStrip
              key={key}
              summary={summary}
              depth={depth}
              developed={developed === key}
              onDevelop={() => setDevelopedKey(developed === key ? '' : key)}
              onOpen={(frame) => onOpen(summary.projectId, summary.contestId, frame)}
            />
          );
        })}
      </ul>
      {inSleeve.length > 0 && (
        <section className="space-y-2" aria-label={C.archiveTitle}>
          <div className="space-y-0.5">
            <h3 className="typo-heading">{C.archiveTitle}</h3>
            <p className="typo-caption text-foreground">{C.archiveHint}</p>
          </div>
          <ul className="space-y-2">
            {inSleeve.map(({ summary, depth }) => (
              <SleeveStrip
                key={`${summary.projectId}/${summary.contestId}`}
                summary={summary}
                depth={depth}
                onOpen={(frame) => onOpen(summary.projectId, summary.contestId, frame)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
