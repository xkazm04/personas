import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { listExecutions } from '@/api/agents/executions';
import { listAttentionLedger } from '@/api/agents/responsibilities';
import { listMemories } from '@/api/overview/memories';
import { listManualReviewsPage } from '@/api/overview/reviews';
import { searchEvents } from '@/api/overview/events';
import { listReports } from '@/api/overview/reports';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent, PersonaReport } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';
import { FILTER_TABS, type ActivityItem, type ActivityType } from './activityTypes';
import { ActiveChainsBadge } from '../sub_executions/components/ActiveChainsBadge';
import { ActivityFilters } from './ActivityFilters';
import { ActivityList } from './ActivityList';
import { useActivityModals } from './ActivityModals';
import { ExecutionList } from '../sub_executions/components/list/ExecutionList';
import { useExecutionList } from '../sub_executions/libs/useExecutionList';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { useExecutionAnnotations } from '@/hooks/agents/useExecutionAnnotations';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

// Tolerate bindings that haven't been regenerated yet — use_case_id is
// optional on every row that carries it after Phase C5.
type WithUseCase = { use_case_id?: string | null };
const getUseCaseId = (raw: unknown): string | null =>
  ((raw as WithUseCase | null | undefined)?.use_case_id) ?? null;

/** Rows each feed asks for. A feed that returns exactly this many may have more. */
const FEED_LIMIT = 50;

type FeedKey = 'execution' | 'event' | 'memory' | 'review' | 'message' | 'attention';
type FeedMap = Record<FeedKey, ActivityItem[]>;
type PendingMap = Record<FeedKey, boolean>;

const emptyFeeds = (): FeedMap => ({
  execution: [], event: [], memory: [], review: [], message: [], attention: [],
});

export function ActivityTab() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [feeds, setFeeds] = useState<FeedMap>(emptyFeeds);
  const [pending, setPending] = useState<PendingMap>({
    execution: false, event: true, memory: true, review: true, message: true, attention: true,
  });
  const [filter, setFilter] = useState<ActivityType>('execution');
  const [statusFilter, setStatusFilter] = useState('all');
  const [useCaseFilter, setUseCaseFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [starredOnly, setStarredOnly] = useState(false);
  // Partial-failure honesty for every feed (golden path
  // partial-failure-read-envelope): a failed read is disclosed instead of
  // rendering as "no activity". Attention had this alone; the other five
  // landed [] on failure and a dead feed read as a quiet agent.
  const [failedFeeds, setFailedFeeds] = useState<FeedKey[]>([]);
  // Feeds whose window came back full: their tab count is a floor, not a total.
  const [truncatedFeeds, setTruncatedFeeds] = useState<FeedKey[]>([]);
  const attentionUnavailable = failedFeeds.includes('attention');
  const loadGenRef = useRef(0);
  const execLatest = useRef(createLatestWins()).current;

  const personaId = selectedPersona?.id;
  const useCases = useSelectedUseCases();
  const { byExecution: annotationsByExecution, knownTags } = useExecutionAnnotations(personaId);

  // The runs tab is served by `ExecutionList` — the revived surface that owns
  // bulk-rerun, two-run comparison, the chains badge and paging through the
  // store cache. While it is mounted the tab must NOT also fetch executions:
  // that parallel `list_executions` call was the thing that bypassed the
  // store's TTL/dedup/latest-wins cache in the first place. The other four
  // feeds are unaffected.
  const runsRegionOwnsExecutions = filter === 'execution';
  // Store-backed (cached, deduped) run list — the count on the "Executions"
  // tab while the aggregate feed is deliberately not fetching them.
  const { executions: storeExecutions } = useExecutionList(personaId ?? '');

  const markPending = useCallback((key: FeedKey) => {
    setPending((p) => (p[key] ? p : { ...p, [key]: true }));
  }, []);
  const land = useCallback((key: FeedKey, rows: ActivityItem[], failed = false) => {
    setFeeds((prev) => ({ ...prev, [key]: rows }));
    setPending((p) => ({ ...p, [key]: false }));
    const truncated = !failed && rows.length >= FEED_LIMIT;
    setTruncatedFeeds((prev) => {
      if (prev.includes(key) === truncated) return prev;
      return truncated ? [...prev, key] : prev.filter((k) => k !== key);
    });
    setFailedFeeds((prev) => {
      if (prev.includes(key) === failed) return prev;
      return failed ? [...prev, key] : prev.filter((k) => k !== key);
    });
  }, []);

  // The execution feed has its own loader and generation: entering or leaving
  // the runs tab changes only this identity, so it no longer re-fires the five
  // other feeds' reads (Events -> Runs -> Events cost ten IPCs, not five).
  const loadExecutions = useCallback(() => {
    if (!personaId) return;
    const token = execLatest.next();
    const landIfCurrent = (rows: ActivityItem[], failed = false) => {
      if (execLatest.isCurrent(token)) land('execution', rows, failed);
    };
    if (runsRegionOwnsExecutions) {
      landIfCurrent([]);
    } else {
      markPending('execution');
      listExecutions(personaId, FEED_LIMIT)
        .then((executions: PersonaExecution[]) => landIfCurrent(executions.map((e): ActivityItem => ({
          type: 'execution', id: e.id,
          title: tx(t.agents.activity.execution_status, { status: e.status }),
          subtitle: e.output_data?.slice(0, 80) || t.agents.activity.no_output,
          status: e.status,
          timestamp: e.started_at || e.created_at,
          useCaseId: getUseCaseId(e),
          raw: e,
        }))))
        .catch((err) => { silentCatch('ActivityTab:listExecutions')(err); landIfCurrent([], true); });
    }
  }, [personaId, t, tx, runsRegionOwnsExecutions, land, markPending]);

  const loadData = useCallback(() => {
    if (!personaId) return;
    const gen = ++loadGenRef.current;
    const landIfCurrent = (key: FeedKey, rows: ActivityItem[], failed = false) => {
      if (loadGenRef.current === gen) land(key, rows, failed);
    };

    markPending('event');
    searchEvents({
      eventType: null,
      sourceType: null,
      status: null,
      targetPersonaId: personaId,
      since: null,
      until: null,
      search: null,
      limit: BigInt(FEED_LIMIT),
    })
      .then((page) => landIfCurrent('event', page.events.map((e: PersonaEvent): ActivityItem => ({
        type: 'event', id: e.id,
        title: e.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        subtitle: e.source_type || 'System',
        status: e.status === 'pending' ? 'delivered' : e.status,
        timestamp: e.created_at,
        useCaseId: getUseCaseId(e),
        raw: e,
      }))))
      .catch((err) => { silentCatch('ActivityTab:searchEvents')(err); landIfCurrent('event', [], true); });

    markPending('memory');
    listMemories(personaId, undefined, undefined, FEED_LIMIT)
      .then((memories: PersonaMemory[]) => landIfCurrent('memory', memories.map((m): ActivityItem => ({
        type: 'memory', id: m.id,
        title: m.title,
        subtitle: m.category,
        status: `importance: ${m.importance}`,
        timestamp: m.created_at,
        useCaseId: getUseCaseId(m),
        raw: m,
      }))))
      .catch((err) => { silentCatch('ActivityTab:listMemories')(err); landIfCurrent('memory', [], true); });

    markPending('review');
    listManualReviewsPage({ personaId, limit: FEED_LIMIT })
      .then((page) => landIfCurrent('review', page.rows.map((r: PersonaManualReview): ActivityItem => ({
        type: 'review', id: r.id,
        title: r.title,
        subtitle: r.description?.slice(0, 80) || '',
        status: r.status,
        timestamp: r.created_at,
        useCaseId: getUseCaseId(r),
        raw: r,
      }))))
      .catch((err) => { silentCatch('ActivityTab:listManualReviewsPage')(err); landIfCurrent('review', [], true); });

    markPending('message');
    listReports(FEED_LIMIT, undefined, personaId)
      .then((messages: PersonaReport[]) => landIfCurrent('message', messages.map((m): ActivityItem => ({
        type: 'message', id: m.id,
        title: m.title || t.agents.activity.report_title,
        subtitle: m.content?.slice(0, 80) || '',
        status: m.priority || 'normal',
        timestamp: m.created_at,
        useCaseId: getUseCaseId(m),
        raw: m,
      }))))
      .catch((err) => { silentCatch('ActivityTab:listReports')(err); landIfCurrent('message', [], true); });

    markPending('attention');
    listAttentionLedger(personaId, FEED_LIMIT)
      .then((attention: AttentionLedgerEntry[]) => {
        landIfCurrent('attention', attention.map((a): ActivityItem => ({
          type: 'attention', id: a.id,
          title: t.agents.life.activity_attention_row,
          subtitle: a.reason.slice(0, 80),
          status: a.verdict,
          timestamp: a.startedAt,
          useCaseId: null,
          raw: a,
        })));
      })
      .catch((err) => {
        silentCatch('ActivityTab:listAttentionLedger')(err);
        landIfCurrent('attention', [], true);
      });
  }, [personaId, t, tx, land, markPending]);

  // A mutation (verdict, delete) refreshes every feed.
  const reloadAll = useCallback(() => { loadData(); loadExecutions(); }, [loadData, loadExecutions]);

  useEffect(() => {
    setFeeds(emptyFeeds());
    setPending({
      execution: true, event: true, memory: true, review: true, message: true, attention: true,
    });
    setFailedFeeds([]);
    setTruncatedFeeds([]);
  }, [personaId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  const items = useMemo(() => {
    const all = [
      ...feeds.execution,
      ...feeds.event,
      ...feeds.memory,
      ...feeds.review,
      ...feeds.message,
      ...feeds.attention,
    ];
    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return all;
  }, [feeds]);

  const anyPending = pending.execution || pending.event || pending.memory
    || pending.review || pending.message || pending.attention;
  const activeFeed: FeedKey | null = filter === 'all' || filter === 'execution' ? null : filter;
  const isLoading = filter === 'all'
    ? items.length === 0 && anyPending
    : activeFeed != null && pending[activeFeed] && feeds[activeFeed].length === 0;

  const filtered = useMemo(() => {
    let result = filter === 'all' ? items : items.filter((i) => i.type === filter);
    if (statusFilter !== 'all') result = result.filter((i) => i.status.toLowerCase() === statusFilter);
    if (useCaseFilter !== 'all') {
      result = useCaseFilter === '__none__'
        ? result.filter((i) => !i.useCaseId)
        : result.filter((i) => i.useCaseId === useCaseFilter);
    }
    // Run-only filters apply where the controls are offered (the All tab); a
    // stale toggle must not empty the other tabs.
    if (filter === 'all' && starredOnly) {
      result = result.filter(
        (i) => i.type === 'execution' && (annotationsByExecution.get(i.id)?.starred ?? false),
      );
    }
    if (filter === 'all' && tagFilter !== 'all') {
      result = result.filter(
        (i) => i.type === 'execution' && annotationsByExecution.get(i.id)?.tags.includes(tagFilter),
      );
    }
    return result;
  }, [items, filter, statusFilter, useCaseFilter, starredOnly, tagFilter, annotationsByExecution]);

  const useCaseOptions = useMemo(
    () =>
      useCases.map((uc) => ({
        id: uc.id,
        title: uc.title || uc.id,
      })),
    [useCases],
  );

  const availableStatuses = useMemo(() => {
    const base = filter === 'all' ? items : items.filter((i) => i.type === filter);
    return Array.from(new Set(base.map((i) => i.status.toLowerCase()))).sort();
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<ActivityType, number> = { all: items.length, execution: 0, event: 0, memory: 0, review: 0, message: 0, attention: 0 };
    for (const item of items) c[item.type]++;
    if (runsRegionOwnsExecutions) {
      // The aggregate feed skipped executions on purpose — take the count from
      // the store's cached list so the tab label stays honest.
      c.execution = storeExecutions.length;
      c.all = items.length + storeExecutions.length;
    }
    return c;
  }, [items, runsRegionOwnsExecutions, storeExecutions.length]);

  // Tab labels that must read "N+": a full feed window hides older rows. The
  // runs tab is ExecutionList's region (store-counted), so it is never flagged
  // while that region owns it.
  const truncated = useMemo(() => {
    const t2: Partial<Record<ActivityType, boolean>> = {};
    for (const k of truncatedFeeds) {
      if (k === 'execution' && runsRegionOwnsExecutions) continue;
      t2[k] = true;
      t2.all = true;
    }
    return t2;
  }, [truncatedFeeds, runsRegionOwnsExecutions]);

  // Failed feeds the current view would otherwise paint as empty. Attention
  // keeps its own notice below; the runs tab is ExecutionList's region.
  const visibleFailedFeedLabels = failedFeeds
    .filter((k) => k !== 'attention' && (filter === 'all' || filter === k))
    .map((k) => {
      const key = FILTER_TABS.find((tab) => tab.id === k)?.labelKey;
      return key ? t.agents.activity_filters[key] : k;
    });

  const { handleRowClick, modals } = useActivityModals({
    personaName: selectedPersona?.name ?? '',
    personaColor: selectedPersona?.color || '#6366f1',
    onDataChanged: reloadAll,
  });

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-12 text-foreground typo-body">
        {t.agents.activity.select_persona}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chains in flight: renders nothing when idle, so it costs no pixels.
          `ExecutionList` is told not to mount its own copy below. */}
      <ActiveChainsBadge />
      <ActivityFilters
        filter={filter}
        statusFilter={statusFilter}
        useCaseFilter={useCaseFilter}
        tagFilter={tagFilter}
        starredOnly={starredOnly}
        counts={counts}
        truncated={truncated}
        availableStatuses={availableStatuses}
        availableTags={knownTags}
        useCaseOptions={useCaseOptions}
        hideSecondaryFilters={runsRegionOwnsExecutions}
        onFilterChange={setFilter}
        onStatusFilterChange={setStatusFilter}
        onUseCaseFilterChange={setUseCaseFilter}
        onTagFilterChange={setTagFilter}
        onStarredOnlyChange={setStarredOnly}
      />
      {attentionUnavailable && (filter === 'all' || filter === 'attention') && (
        <p className="typo-caption text-status-warning" data-testid="activity-attention-unavailable">
          {t.agents.life.activity_attention_unavailable}
        </p>
      )}
      {!runsRegionOwnsExecutions && visibleFailedFeedLabels.length > 0 && (
        <p className="typo-caption text-status-warning" data-testid="activity-feed-unavailable">
          {visibleFailedFeedLabels.join(', ')}: {t.common.source_unreachable}
        </p>
      )}
      {runsRegionOwnsExecutions ? (
        /* The runs region. `ExecutionList` renders its own permanent chrome and
           a geometry-matched ghost underneath it while the store's first page
           is in flight (docs/design/overview-loading.md) — never a spinner. */
        <ExecutionList showActiveChains={false} />
      ) : (
        <ActivityList
          items={filtered}
          isLoading={isLoading}
          useCaseOptions={useCaseOptions}
          annotationsByExecution={annotationsByExecution}
          onRowClick={handleRowClick}
        />
      )}
      {modals}
    </div>
  );
}
