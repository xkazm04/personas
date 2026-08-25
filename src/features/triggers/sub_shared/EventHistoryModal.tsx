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
import type { SharedEventImpactRun } from '@/lib/bindings/SharedEventImpactRun';
import type { Translations } from '@/i18n/generated/types';
import { FeedIcon, SeverityBadge, parseChangePayload, severityLabel } from './sharedEventsUi';

/** Chip styling per impact verdict: committed emerald, assessed amber, red for
 * gates_red/failed, muted no_impact — painted through status tokens. */
function verdictStyle(verdict: string): string {
  switch (verdict) {
    case 'committed':
      return 'bg-status-success/10 text-status-success border-status-success/25';
    case 'assessed':
      return 'bg-status-warning/10 text-status-warning border-status-warning/25';
    case 'gates_red':
    case 'failed':
      return 'bg-status-error/10 text-status-error border-status-error/25';
    default:
      return 'bg-secondary/40 text-foreground/90 border-primary/10';
  }
}

function verdictLabel(t: Translations, verdict: string): string {
  const m = t.triggers.marketplace;
  switch (verdict) {
    case 'committed': return m.verdict_committed;
    case 'assessed': return m.verdict_assessed;
    case 'gates_red': return m.verdict_gates_red;
    case 'failed': return m.verdict_failed;
    default: return m.verdict_no_impact;
  }
}

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
  // Impact runs (verdicts of dispatched fleet sessions), grouped per firing.
  const [runsByFiring, setRunsByFiring] = useState<Map<string, SharedEventImpactRun[]>>(new Map());

  useEffect(() => {
    let alive = true;
    api
      .listFirings(entry.slug, 100)
      .then((rows) => { if (alive) setChanges(rows); })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/EventHistoryModal:load')(e);
        if (alive) setChanges([]);
      });
    api
      .listImpactRuns(entry.id, 200)
      .then((rows) => {
        if (!alive) return;
        const map = new Map<string, SharedEventImpactRun[]>();
        for (const r of rows) {
          const list = map.get(r.firingId) ?? [];
          list.push(r);
          map.set(r.firingId, list);
        }
        setRunsByFiring(map);
      })
      .catch((e) => {
        silentCatch('features/triggers/sub_shared/EventHistoryModal:loadImpact')(e);
      });
    return () => { alive = false; };
  }, [entry.slug, entry.id]);

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
              const runs = runsByFiring.get(c.id) ?? [];
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
                    {runs.length > 0 && (
                      <div className="flex flex-col gap-1.5 pt-1.5 border-t border-primary/10">
                        <span className="typo-caption text-foreground">{m.impact_title}</span>
                        {runs.map((r) => (
                          <div key={r.id} className="flex items-center flex-wrap gap-x-2.5 gap-y-1 min-w-0">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full typo-caption border ${verdictStyle(r.verdict)}`}
                            >
                              {verdictLabel(t, r.verdict)}
                            </span>
                            {r.commitSha && (
                              <code className="typo-caption text-foreground/90 font-mono">{r.commitSha.slice(0, 7)}</code>
                            )}
                            <span className="typo-caption text-foreground/90 truncate flex-1 min-w-0">{r.summary}</span>
                            <RelativeTime timestamp={r.createdAt} className="typo-caption text-foreground/90 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}
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
