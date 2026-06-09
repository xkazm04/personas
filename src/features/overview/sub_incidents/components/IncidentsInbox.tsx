import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Inbox, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import EmptyState, { InboxZero } from '@/features/shared/components/feedback/EmptyState';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { getAuditIncident } from '@/api/overview/incidents';
import { useIncidentsData } from '../libs/useIncidentsData';
import { useIncidentActions } from '../libs/useIncidentActions';
import { consumePendingIncidentDeepLink } from '../libs/incidentDeepLink';
import { IncidentsInboxKpiHeader } from './IncidentsInboxKpiHeader';
import { IncidentSeverityLegend } from './IncidentSeverityLegend';
import { IncidentsFilterBar } from './IncidentsFilterBar';
import { IncidentRow } from './IncidentRow';
import { IncidentAgentGroup } from './IncidentAgentGroup';
import { IncidentDetailModal } from './IncidentDetailModal';
import { groupIncidents, type IncidentGroupMode } from '../libs/groupIncidents';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

const DEFAULT_FILTERS: IncidentFilters = {
  statuses: ['open'], // default to open-only — the inbox's primary use case
  severities: null,
  source_tables: null,
  persona_id: null,
  since: null,
};

const COLLAPSED_GROUPS_KEY = 'incidents:collapsed-groups';
const GROUP_MODE_KEY = 'incidents:group-mode';
const FILTERS_KEY = 'incidents:filters';
const SORT_KEY = 'incidents:oldest-first';
const LAST_SEEN_KEY = 'incidents:last-seen';
const GROUP_MODES: IncidentGroupMode[] = ['agent', 'severity', 'source', 'none'];

/** Whether a persisted value is a valid group mode (guards against stale storage). */
function isGroupMode(value: string): value is IncidentGroupMode {
  return (GROUP_MODES as string[]).includes(value);
}

/**
 * Restore the persisted filter view, but only the stable dimensions
 * (status / severity / source). `since` is an absolute timestamp that would go
 * stale between sessions, and `persona_id` is a transient detail-modal drill-in
 * — both reset to null on load so the inbox never reopens into a stale or
 * surprising deep-filter.
 */
function loadPersistedFilters(): IncidentFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const saved = JSON.parse(raw) as Partial<IncidentFilters>;
    return {
      statuses: saved.statuses ?? DEFAULT_FILTERS.statuses,
      severities: saved.severities ?? null,
      source_tables: saved.source_tables ?? null,
      persona_id: null,
      since: null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** User-facing label for a group-by lens. */
function groupModeLabel(t: ReturnType<typeof useTranslation>['t'], mode: IncidentGroupMode): string {
  switch (mode) {
    case 'agent': return t.overview.incidents.group_by_agent;
    case 'severity': return t.overview.incidents.group_by_severity;
    case 'source': return t.overview.incidents.group_by_source;
    case 'none': return t.overview.incidents.group_by_none;
  }
}

export default function IncidentsInbox() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<IncidentFilters>(loadPersistedFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailIncident, setDetailIncident] = useState<AuditIncident | null>(null);
  const [justCleared, setJustCleared] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [oldestFirst, setOldestFirst] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === '1';
    } catch {
      return false;
    }
  });
  // The timestamp the user last marked the inbox "seen" — incidents created
  // after it count as new. Null on first-ever visit (no marker shown).
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      return null;
    }
  });
  const [groupMode, setGroupMode] = useState<IncidentGroupMode>(() => {
    try {
      const raw = localStorage.getItem(GROUP_MODE_KEY);
      return raw && isGroupMode(raw) ? raw : 'agent';
    } catch {
      return 'agent';
    }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  // Armed by an actual incident action (ack / resolve / dismiss) so a filter
  // change that yields zero never triggers the celebration — only clearing the
  // open inbox does.
  const clearedByActionRef = useRef(false);

  const { incidents, summary, loading, error, refresh } = useIncidentsData(filters);
  const actions = useIncidentActions({
    onAfterChange: async () => {
      clearedByActionRef.current = true;
      setSelectedIds(new Set());
      await refresh();
    },
  });

  // Keep the latest loaded incidents in a ref so the deep-link resolver can
  // prefer the in-memory list without making the storeBus subscription depend
  // on `incidents` (which would tear down / re-add the listener on every refresh).
  const incidentsRef = useRef<AuditIncident[]>(incidents);
  incidentsRef.current = incidents;

  // Deep-link: open a specific incident's detail modal when Athena's
  // `incident_blocker` nudge is engaged. The engage handler navigates here
  // (lazy-mounting this component) and both (a) latches the id via
  // `incidentDeepLink` and (b) emits `incidents:open-detail`. We consume the
  // latch on mount (covers the case where the emit fired before we subscribed)
  // AND subscribe to the event (covers the already-mounted case). Resolve from
  // the loaded list first; otherwise fetch by id.
  useEffect(() => {
    let cancelled = false;

    const openById = (incidentId: string) => {
      const fromList = incidentsRef.current.find((i) => i.id === incidentId);
      if (fromList) {
        if (!cancelled) setDetailIncident(fromList);
        return;
      }
      getAuditIncident(incidentId)
        .then((incident) => {
          if (!cancelled && incident) setDetailIncident(incident);
        })
        .catch(silentCatch('incidents.deep-link.get_audit_incident'));
    };

    // Late-subscriber bridge: the emit may have fired during lazy-mount.
    const pending = consumePendingIncidentDeepLink();
    if (pending) openById(pending);

    const unsubscribe = storeBus.on('incidents:open-detail', ({ incidentId }) => {
      openById(incidentId);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const toggleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Group incidents by the active lens — agent ("which of my agents needs me?"),
  // severity ("what's most urgent?"), source ("what kind of thing is failing?"),
  // or a flat recency list (none). Worst-severity groups float to the top.
  const groups = useMemo(
    () => groupIncidents(incidents, groupMode, oldestFirst),
    [incidents, groupMode, oldestFirst],
  );

  // Persist collapsed groups so a tidied inbox stays tidy across refresh/reopen.
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Array.from(collapsedGroups)));
    } catch (e) {
      silentCatch('incidents.collapsed-groups.persist')(e);
    }
  }, [collapsedGroups]);

  // Remember the chosen lens so the inbox reopens the way the user left it.
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_MODE_KEY, groupMode);
    } catch (e) {
      silentCatch('incidents.group-mode.persist')(e);
    }
  }, [groupMode]);

  // Persist the stable filter view (status/severity/source) + sort order so the
  // inbox reopens where the user left it. since/persona_id are intentionally
  // excluded (see loadPersistedFilters).
  useEffect(() => {
    try {
      const { statuses, severities, source_tables } = filters;
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ statuses, severities, source_tables }));
    } catch (e) {
      silentCatch('incidents.filters.persist')(e);
    }
  }, [filters]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, oldestFirst ? '1' : '0');
    } catch (e) {
      silentCatch('incidents.sort.persist')(e);
    }
  }, [oldestFirst]);

  // On leaving the inbox, stamp "now" as the last-seen mark so the next visit
  // highlights only what arrived while away. Runs once on unmount.
  useEffect(() => {
    return () => {
      try {
        localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      } catch (e) {
        silentCatch('incidents.last-seen.persist')(e);
      }
    };
  }, []);

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsedGroups.has(g.key));
  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));
  }, [allCollapsed, groups]);

  // Flatten the rows the user can actually see (skipping collapsed groups) so
  // keyboard navigation moves through exactly what's on screen.
  const visibleIncidents = useMemo(
    () => groups.filter((g) => !collapsedGroups.has(g.key)).flatMap((g) => g.incidents),
    [groups, collapsedGroups],
  );

  // How many currently-listed incidents arrived after the user last marked the
  // inbox seen — surfaced as a "N new since your last visit" marker.
  const newCount = useMemo(() => {
    if (!lastSeenAt) return 0;
    const cutoff = new Date(lastSeenAt).getTime();
    if (Number.isNaN(cutoff)) return 0;
    return incidents.filter((i) => new Date(i.createdAt).getTime() > cutoff).length;
  }, [incidents, lastSeenAt]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenAt(now);
    try {
      localStorage.setItem(LAST_SEEN_KEY, now);
    } catch (e) {
      silentCatch('incidents.last-seen.persist')(e);
    }
  }, []);

  // Latest-value refs so the global keydown listener can stay mounted once
  // without re-binding on every focus change or refresh.
  const visibleRef = useRef(visibleIncidents);
  visibleRef.current = visibleIncidents;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const modalOpenRef = useRef(false);
  modalOpenRef.current = detailIncident !== null;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const tRef = useRef(t);
  tRef.current = t;

  // Keyboard triage: j/k (or arrows) move the cursor, Enter opens, A/R act on
  // the focused incident, Esc clears. Ignored while typing or with the modal up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)
      ) {
        return;
      }
      const list = visibleRef.current;
      if (list.length === 0) return;
      const curIdx = list.findIndex((i) => i.id === focusedIdRef.current);
      const focusAt = (idx: number) => {
        const inc = list[idx];
        if (!inc) return;
        setFocusedId(inc.id);
        document.getElementById(`incident-row-${inc.id}`)?.scrollIntoView({ block: 'nearest' });
        const tt = tRef.current;
        const sev = tokenLabel(tt, 'severity', inc.severity);
        const pos = tt.overview.incidents.a11y_position
          .replace('{current}', String(idx + 1))
          .replace('{total}', String(list.length));
        const persona = inc.personaName ? `, ${inc.personaName}` : '';
        setAnnouncement(`${sev}, ${inc.title}${persona}. ${pos}`);
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          focusAt(curIdx < 0 ? 0 : Math.min(list.length - 1, curIdx + 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          focusAt(curIdx < 0 ? list.length - 1 : Math.max(0, curIdx - 1));
          break;
        case 'Enter':
          if (curIdx >= 0) {
            e.preventDefault();
            setDetailIncident(list[curIdx]!);
          }
          break;
        case 'a':
          if (curIdx >= 0 && list[curIdx]!.status === 'open') {
            e.preventDefault();
            const inc = list[curIdx]!;
            void actionsRef.current.acknowledge(inc.id);
            setAnnouncement(`${tRef.current.overview.incidents.a11y_acknowledged}: ${inc.title}`);
          }
          break;
        case 'r':
          if (curIdx >= 0) {
            e.preventDefault();
            const inc = list[curIdx]!;
            void actionsRef.current.resolve(inc.id);
            setAnnouncement(`${tRef.current.overview.incidents.a11y_resolved}: ${inc.title}`);
          }
          break;
        case 'Escape':
          setFocusedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderRow = useCallback(
    (incident: AuditIncident) => (
      <IncidentRow
        key={incident.id}
        incident={incident}
        selected={selectedIds.has(incident.id)}
        focused={focusedId === incident.id}
        onSelectChange={(sel) => toggleSelect(incident.id, sel)}
        onAcknowledge={() => void actions.acknowledge(incident.id)}
        onResolve={() => void actions.resolve(incident.id)}
        onDismiss={() => void actions.dismiss(incident.id)}
        onReopen={() => void actions.reopen(incident.id)}
        onOpenDetail={() => setDetailIncident(incident)}
      />
    ),
    [selectedIds, focusedId, toggleSelect, actions],
  );

  // "Narrowed" = the user moved beyond the default open-only inbox view. The
  // default (statuses: ['open'], nothing else) is NOT narrowed, so reaching
  // zero there reads as a healthy "all clear" rather than a no-match result —
  // and only that path earns the inbox-zero celebration.
  const statusesAreDefaultOpen =
    !filters.statuses || (filters.statuses.length === 1 && filters.statuses[0] === 'open');
  const isNarrowed =
    !statusesAreDefaultOpen ||
    (filters.severities?.length ?? 0) > 0 ||
    (filters.source_tables?.length ?? 0) > 0 ||
    !!filters.persona_id ||
    !!filters.since;

  // Detect an action-driven drain to zero. Evaluated once the refresh settles;
  // a non-action path (filter change) leaves the ref unarmed, so no pop fires.
  useEffect(() => {
    if (loading) return;
    if (incidents.length > 0) {
      setJustCleared(false);
      clearedByActionRef.current = false;
      return;
    }
    if (clearedByActionRef.current && !isNarrowed) setJustCleared(true);
    clearedByActionRef.current = false;
  }, [loading, incidents.length, isNarrowed]);

  const selectedArray = Array.from(selectedIds);
  const hasSelection = selectedArray.length > 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Inbox className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.incidents.title}
        subtitle={t.overview.incidents.subtitle}
        actions={
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
            aria-label={t.overview.incidents.refresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t.overview.incidents.refresh}
          </button>
        }
      />

      <ContentBody>
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>

        <div className="px-4 pt-3 pb-2">
          <IncidentsInboxKpiHeader summary={summary} filters={filters} onApplyFilters={setFilters} />
        </div>

        <IncidentSeverityLegend />

        <IncidentsFilterBar filters={filters} onChange={setFilters} />

        {hasSelection && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-primary/5">
            <span className="typo-caption text-foreground">
              {selectedArray.length} selected
            </span>
            <button
              onClick={() => void actions.bulkAck(selectedArray)}
              className="px-2 py-0.5 typo-caption rounded-card border border-primary/15 hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_acknowledge_count.replace('{count}', String(selectedArray.length))}
            </button>
            <button
              onClick={() => void actions.bulkResolve(selectedArray)}
              className="px-2 py-0.5 typo-caption rounded-card border border-primary/15 hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_resolve_count.replace('{count}', String(selectedArray.length))}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-0.5 typo-caption rounded-card border border-transparent text-foreground hover:bg-secondary/40 focus-ring"
            >
              {t.overview.incidents.bulk_clear_selection}
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-3">
            <InlineErrorBanner
              message={`${t.overview.incidents.load_failed}: ${error}`}
              onRetry={() => void refresh()}
            />
          </div>
        )}

        {loading && incidents.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size="lg" label={t.overview.incidents.loading} />
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            {isNarrowed ? (
              <EmptyState
                icon={Inbox}
                title={t.overview.incidents.empty_filtered_title}
                subtitle={t.overview.incidents.empty_state_filtered}
              />
            ) : (
              <InboxZero
                title={t.overview.incidents.empty_open_title}
                subtitle={t.overview.incidents.empty_state_open}
                celebrate={justCleared}
              />
            )}
          </div>
        ) : (
          <div>
            {newCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-primary/5">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="typo-caption text-primary">
                  {t.overview.incidents.new_since_last_visit.replace('{count}', String(newCount))}
                </span>
                <button
                  type="button"
                  onClick={markSeen}
                  className="ml-auto px-2 py-0.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
                >
                  {t.overview.incidents.mark_seen}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="typo-caption text-foreground mr-1">
                  {t.overview.incidents.group_by_label}:
                </span>
                {GROUP_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGroupMode(mode)}
                    aria-pressed={groupMode === mode}
                    className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
                      groupMode === mode
                        ? 'bg-primary/15 text-primary border-primary/25'
                        : 'text-foreground border-transparent hover:bg-secondary/40'
                    }`}
                  >
                    {groupModeLabel(t, mode)}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-primary/10" />
                <button
                  type="button"
                  onClick={() => setOldestFirst(false)}
                  className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
                    !oldestFirst
                      ? 'bg-primary/15 text-primary border-primary/25'
                      : 'text-foreground border-transparent hover:bg-secondary/40'
                  }`}
                >
                  {t.overview.incidents.sort_newest}
                </button>
                <button
                  type="button"
                  onClick={() => setOldestFirst(true)}
                  className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
                    oldestFirst
                      ? 'bg-primary/15 text-primary border-primary/25'
                      : 'text-foreground border-transparent hover:bg-secondary/40'
                  }`}
                >
                  {t.overview.incidents.sort_oldest}
                </button>
              </div>
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={toggleAllGroups}
                  className="typo-caption text-foreground rounded-card px-2 py-0.5 hover:bg-secondary/40 transition-colors focus-ring"
                >
                  {allCollapsed
                    ? t.overview.incidents.groups_expand_all
                    : t.overview.incidents.groups_collapse_all}
                </button>
              )}
            </div>
            {groups.map((group) => (
              <IncidentAgentGroup
                key={group.key}
                group={group}
                collapsed={collapsedGroups.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
                onAckAll={(ids) => void actions.bulkAck(ids)}
                onResolveAll={(ids) => void actions.bulkResolve(ids)}
                renderRow={renderRow}
              />
            ))}
          </div>
        )}
      </ContentBody>

      {detailIncident && (
        <IncidentDetailModal
          incident={detailIncident}
          onClose={() => setDetailIncident(null)}
          onChanged={() => {
            setSelectedIds(new Set());
            void refresh();
          }}
          onOpenIncident={(inc) => setDetailIncident(inc)}
          onFilterPersona={(personaId) =>
            setFilters({
              statuses: null,
              severities: null,
              source_tables: null,
              persona_id: personaId,
              since: null,
            })
          }
        />
      )}
    </ContentBox>
  );
}
