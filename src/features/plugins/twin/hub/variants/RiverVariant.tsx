/**
 * Variant "river" — ONE chronological stream of every entry kind.
 *
 * Kind is carried by glyph + semantic colour role, never by a long label, and
 * the filters are icon toggles for the same reason. Rows carry their react
 * affordances inline via `HubEntryActions`.
 *
 * Scale: the river CAPS its render at `RENDER_CAP` newest entries and says so
 * in one line, rather than windowing. A window was the alternative; a cap was
 * chosen because the river's rows are variable-height prose and a virtualizer
 * over them buys jitter, not speed, at the few-hundred-row scale the wire
 * itself is limited to (`COMMUNICATION_LIMIT` in useHubFeed).
 */

import { useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_KIND_META, HUB_STATUS_META, HubEntryActions } from '../HubEntryActions';
import type { HubEntryKind, HubReviewStatus, HubVariantProps } from '../hubContract';

const RENDER_CAP = 300;
const KINDS: readonly HubEntryKind[] = ['memory', 'message', 'fact', 'reflection', 'audit'];
const STATUSES: readonly HubReviewStatus[] = ['pending', 'approved', 'rejected'];

export default function RiverVariant({ feed }: HubVariantProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const [kinds, setKinds] = useState<HubEntryKind[]>([]);
  const [statuses, setStatuses] = useState<HubReviewStatus[]>([]);
  const enter = useRevealTracker(`${kinds.join()}|${statuses.join()}`);

  const filtered = useMemo(() => feed.entries.filter((e) => {
    if (kinds.length > 0 && !kinds.includes(e.kind)) return false;
    // A status filter is a claim about reviewed rows; kinds that carry no
    // verdict drop out rather than pretending to satisfy it.
    if (statuses.length > 0 && (e.status === null || !statuses.includes(e.status))) return false;
    return true;
  }), [feed.entries, kinds, statuses]);

  const shown = filtered.slice(0, RENDER_CAP);

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Icon filters ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap px-4 md:px-6 xl:px-8 py-2 border-b border-border">
        <ListFilter className="w-3.5 h-3.5 text-foreground" />
        <div className="flex items-center gap-1">
          {KINDS.map((kind) => {
            const meta = HUB_KIND_META[kind];
            const on = kinds.includes(kind);
            return (
              <Tooltip key={kind} content={t.kinds[kind]}>
                <button type="button" aria-pressed={on} aria-label={t.kinds[kind]}
                  onClick={() => toggle(kinds, setKinds, kind)}
                  className={`w-7 h-7 rounded-interactive border flex items-center justify-center transition-colors focus-ring ${
                    on ? `${meta.bg} ${meta.border} ${meta.text}` : 'border-border text-foreground hover:bg-secondary/50'
                  }`}>
                  <meta.Icon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <span className="w-px h-5 bg-border" />
        <div className="flex items-center gap-1">
          {STATUSES.map((status) => {
            const meta = HUB_STATUS_META[status];
            const on = statuses.includes(status);
            return (
              <Tooltip key={status} content={t.status[status]}>
                <button type="button" aria-pressed={on} aria-label={t.status[status]}
                  onClick={() => toggle(statuses, setStatuses, status)}
                  className={`w-7 h-7 rounded-interactive border flex items-center justify-center transition-colors focus-ring ${
                    on ? `${meta.bg} ${meta.border} ${meta.text}` : 'border-border text-foreground hover:bg-secondary/50'
                  }`}>
                  <meta.Icon className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <span className="ml-auto typo-caption text-foreground tabular-nums">
          {filtered.length > RENDER_CAP
            ? tx(t.river.capped, { shown: RENDER_CAP, total: filtered.length })
            : tx(t.river.total, { total: filtered.length })}
        </span>
      </div>

      {/* ── Stream ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 xl:px-8 py-3">
        {feed.loading && shown.length === 0 ? (
          <RiverGhost />
        ) : shown.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={feed.entries.length === 0 ? t.river.emptyTitle : undefined}
            subtitle={feed.entries.length === 0 ? t.river.emptySubtitle : undefined}
          />
        ) : (
          <ol className="relative space-y-1.5 max-w-4xl">
            <span className="absolute left-3 top-1 bottom-1 w-px bg-gradient-to-b from-primary/40 to-transparent" aria-hidden="true" />
            {shown.map((entry, i) => {
              const meta = HUB_KIND_META[entry.kind];
              const status = entry.status ? HUB_STATUS_META[entry.status] : null;
              return (
                <RevealItem key={entry.id} as="li" revealId={entry.id} order={i} {...enter}
                  className="relative pl-9 group">
                  <span className={`absolute left-0 top-2 w-6 h-6 rounded-full border flex items-center justify-center ${meta.bg} ${meta.border}`}>
                    <meta.Icon className={`w-3 h-3 ${meta.text}`} />
                  </span>
                  <div className="rounded-card border border-border bg-card/40 px-3 py-2 transition-colors hover:border-primary/30">
                    <div className="flex items-center gap-2 flex-wrap">
                      {status && (
                        <Tooltip content={t.status[entry.status!]}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center ${status.bg} ${status.text}`}>
                            <status.Icon className="w-2.5 h-2.5" />
                          </span>
                        </Tooltip>
                      )}
                      {entry.channel && (
                        <span className="px-1.5 rounded-full border border-border bg-secondary/40 typo-label text-foreground">
                          {entry.channel}
                        </span>
                      )}
                      {entry.contactHandle && (
                        <span className="typo-caption text-foreground truncate max-w-[12rem]">{entry.contactHandle}</span>
                      )}
                      <RelativeTime timestamp={entry.at} className="typo-caption text-foreground tabular-nums" />
                      <span className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <HubEntryActions entry={entry} feed={feed} />
                      </span>
                    </div>
                    {entry.title && <p className="typo-card-label text-foreground mt-1">{entry.title}</p>}
                    <p className="typo-body text-foreground leading-relaxed line-clamp-3">{entry.body}</p>
                    {entry.reviewerNotes && (
                      <p className="typo-caption text-status-error mt-1">
                        {tx(t.river.reasonLabel, { reason: entry.reviewerNotes })}
                      </p>
                    )}
                  </div>
                </RevealItem>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Calm, geometry-matched ghost beneath the permanent filter bar. */
function RiverGhost() {
  return (
    <ol className="space-y-1.5 max-w-4xl" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="relative pl-9 animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
          <span className="absolute left-0 top-2 w-6 h-6 rounded-full bg-primary/[0.06]" />
          <div className="rounded-card border border-border bg-card/40 px-3 py-2 space-y-1.5">
            <span className="block h-3 w-1/3 rounded bg-primary/[0.06]" />
            <span className="block h-3 w-3/4 rounded bg-primary/[0.06]" />
          </div>
        </li>
      ))}
    </ol>
  );
}
