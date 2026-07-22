import { useEffect, useState } from 'react';
import { ExternalLink, History, Tag } from 'lucide-react';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import * as api from '@/api/events/sharedEvents';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventChange } from '@/lib/bindings/SharedEventChange';
import { FeedIcon, SeverityBadge, parseChangePayload, severityLabel } from './sharedEventsUi';

interface Props {
  entry: SharedEventCatalogEntry;
  onClose: () => void;
}

/**
 * Per-feed change history — the log of recorded events (firings) for one
 * Marketplace feed. Opened from a table row's action button. Read-only.
 */
export function EventHistoryModal({ entry, onClose }: Props) {
  const { t, tx } = useTranslation();
  const m = t.triggers.marketplace;
  const [changes, setChanges] = useState<SharedEventChange[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listFirings(entry.slug, 100)
      .then((rows) => { if (alive) setChanges(rows); })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/EventHistoryModal:load')(e);
        if (alive) setChanges([]);
      });
    return () => { alive = false; };
  }, [entry.slug]);

  return (
    <DetailModal
      title={
        <span className="flex items-center gap-2.5">
          <FeedIcon entry={entry} className="w-7 h-7" />
          {entry.name}
        </span>
      }
      subtitle={m.history_subtitle}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
    >
      <div className="px-6 py-5 overflow-y-auto">
        {changes === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-foreground/70">
            <LoadingSpinner />
            <span className="typo-body">{m.history_loading}</span>
          </div>
        ) : changes.length === 0 ? (
          <EmptyState
            icon={History}
            iconColor="text-sky-400"
            iconContainerClassName="bg-sky-500/10 border-sky-500/20"
            title={m.history_empty_title}
            subtitle={m.history_empty_hint}
          />
        ) : (
          <ol className="relative flex flex-col gap-4 pl-5 border-l border-primary/15">
            {changes.map((c) => {
              const p = parseChangePayload(c.payload);
              return (
                <li key={c.id} className="relative">
                  {/* timeline node */}
                  <span className="absolute -left-[1.4rem] top-1.5 w-2.5 h-2.5 rounded-full bg-primary/60 ring-4 ring-background" />
                  <div className="flex flex-col gap-2 rounded-card border border-primary/10 bg-card/50 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="typo-body font-semibold text-foreground">{c.title}</span>
                      <SeverityBadge severity={p.severity} label={severityLabel(t, p.severity)} />
                    </div>
                    {p.summary && (
                      <p className="typo-body text-foreground/90 leading-relaxed">{p.summary}</p>
                    )}
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input bg-secondary/50 text-foreground/70 typo-caption"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 pt-0.5 typo-caption text-foreground/60">
                      <span>{m.history_detected} <RelativeTime timestamp={c.firedAt} /></span>
                      {c.releaseVersion && (
                        <span>{tx(m.history_release, { version: c.releaseVersion })}</span>
                      )}
                      {p.docs_url && (
                        <a
                          href={p.docs_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {m.history_docs}
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </DetailModal>
  );
}
