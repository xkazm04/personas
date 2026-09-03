import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Moon, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import {
  companionListCycleReports,
  parseCycleStats,
  type CyclePhase,
  type CycleStats,
  type CycleSummary,
} from '@/api/companion/brain';
import { titleCase } from './athenaLabels';

/**
 * Sleep-cycle journal — every reconciliation pass Athena ran over her own
 * memory, newest first.
 *
 * Reads `companion_list_cycle_reports`, which had no frontend caller at all
 * until this component: ten completed cycles were sitting in
 * `personas_data.db` with nothing that displayed them.
 *
 * **What is shown and what is not.** A cycle writes two things — a structured
 * row (status, phase log, counters) and a markdown narrative stored as a
 * `companion_node` of kind `cycle_report`. Only the first is reachable from
 * TypeScript: no registered command returns that node's body (see the module
 * docblock of `@/api/companion/brain`). So this surface renders the counters
 * and the phase log faithfully and claims nothing about prose it cannot read.
 *
 * Loading law: a delayed geometry-matched ghost under permanent chrome, never
 * a spinner, and a module-scoped warm cache so re-opening the tab paints warm.
 */

/**
 * Warm cache for the journal. Keyed by `limit` so a future "show more" is a
 * second entry rather than a clobber; `maxSize` is mandatory for any cache
 * whose key space is not a fixed literal set.
 */
const cycleCache = createModuleCache<number, CycleSummary[]>({
  ttlMs: 5 * 60 * 1000,
  maxSize: 4,
});

/** Rows that play the one-shot entrance cascade when the journal lands. */
const CASCADE_ROWS = 12;

const DEFAULT_LIMIT = 20;

export function BrainCycleReports({ limit = DEFAULT_LIMIT }: { limit?: number }) {
  const { t } = useTranslation();
  const cached = useModuleSubscription(cycleCache, limit);
  const [error, setError] = useState<string | null>(null);
  const enter = useRevealTracker(`cycles:${limit}`);

  useEffect(() => {
    let cancelled = false;
    companionListCycleReports(limit)
      .then((rows) => {
        if (cancelled) return;
        setError(null);
        // The backend already orders newest-first; sorting again makes the
        // guarantee local rather than assumed.
        const sorted = [...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        cycleCache.set(limit, sorted);
        cycleCache.notify();
      })
      .catch((err: unknown) => {
        // Nobody asked for this read - it fires on mount - so the failure is
        // reported where the data would have been, not as a toast over
        // whatever the user was actually doing. The inline state below is the
        // surface; Sentry still gets the event.
        if (!cancelled) {
          setError(resolveError(err instanceof Error ? err.message : String(err)).message);
        }
        silentCatch('companion_list_cycle_reports')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  // A fetch never hides rows already on screen: the ghost only paints into
  // emptiness, and an error only replaces the list when there is no warm copy.
  if (cached === undefined) {
    if (error) return <CycleLoadError message={error} />;
    return <CycleGhostRows />;
  }
  if (cached.length === 0) {
    return (
      <div data-testid="cycles-empty">
        <EmptyState
          icon={Moon}
          title={t.plugins.companion.cycles_empty}
          subtitle={t.plugins.companion.cycles_empty_hint}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {cached.map((cycle, index) => (
        <RevealItem
          key={cycle.id}
          revealId={cycle.id}
          order={index}
          hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
          markEntered={enter.markEntered}
        >
          <CycleCard cycle={cycle} />
        </RevealItem>
      ))}
    </div>
  );
}

function CycleLoadError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div data-testid="cycles-error">
      <EmptyState
        icon={AlertTriangle}
        title={t.plugins.companion.cycles_load_failed}
        subtitle={message}
      />
    </div>
  );
}

const STATUS_ICON = {
  completed: CheckCircle2,
  failed: XCircle,
  running: Loader2,
} as const;

function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: string): string {
  switch (status) {
    case 'completed':
      return t.plugins.companion.cycles_status_completed;
    case 'failed':
      return t.plugins.companion.cycles_status_failed;
    case 'running':
      return t.plugins.companion.cycles_status_running;
    default:
      return titleCase(status);
  }
}

function CycleCard({ cycle }: { cycle: CycleSummary }) {
  const { t } = useTranslation();
  const stats = parseCycleStats(cycle.statsJson);
  const Icon = STATUS_ICON[cycle.status as keyof typeof STATUS_ICON] ?? AlertTriangle;
  const accent =
    cycle.status === 'failed'
      ? 'text-rose-400'
      : cycle.status === 'running'
        ? 'text-amber-400'
        : 'text-emerald-400';

  return (
    <article
      className="rounded-card border border-foreground/10 bg-foreground/[0.02] px-4 py-3"
      data-testid="cycle-card"
      data-cycle-id={cycle.id}
    >
      <header className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 shrink-0 ${accent}`} aria-hidden="true" />
        <span className="typo-body font-medium">{statusLabel(t, cycle.status)}</span>
        <span className="typo-caption text-foreground">
          <RelativeTime timestamp={cycle.startedAt} className="text-foreground" />
        </span>
      </header>

      {stats.error ? <p className="typo-caption text-rose-400 mb-2">{stats.error}</p> : null}

      <p className="typo-caption text-foreground mb-2">
        {t.plugins.companion.cycles_episodes_read}{' '}
        <Numeric value={stats.episodes_in ?? 0} unit="count" />
        {' / '}
        <Numeric value={stats.episodes_available ?? 0} unit="count" />
        {stats.truncated ? ` · ${t.plugins.companion.cycles_truncated}` : ''}
      </p>

      <CycleStatChips stats={stats} />
      <CyclePhaseRow phases={cycle.phases} />
    </article>
  );
}

/**
 * The counters worth a glance. Every entry is skipped when the cycle did not
 * record it — `statsJson` is a versionless snake_case blob and an absent key
 * means "not recorded", never zero.
 */
function CycleStatChips({ stats }: { stats: CycleStats }) {
  const { t } = useTranslation();
  const entries: { key: string; label: string; value: number | undefined; hint?: string }[] = [
    {
      key: 'facts',
      label: t.plugins.companion.cycles_facts,
      value: stats.facts_applied,
      hint: stats.facts_dropped ? t.plugins.companion.cycles_dropped : undefined,
    },
    {
      key: 'procedurals',
      label: t.plugins.companion.cycles_procedurals,
      value: stats.procedurals_applied,
      hint: stats.procedurals_dropped ? t.plugins.companion.cycles_dropped : undefined,
    },
    {
      key: 'supersedes',
      label: t.plugins.companion.cycles_supersedes,
      value: stats.supersedes_applied,
    },
    { key: 'tags', label: t.plugins.companion.cycles_proposed_tags, value: stats.tags_proposed },
    {
      key: 'contradictions',
      label: t.plugins.companion.cycles_contradictions,
      value: stats.contradictions,
    },
    {
      key: 'prune',
      label: t.plugins.companion.cycles_prune_candidates,
      value: stats.prune_candidates,
    },
    { key: 'staged', label: t.plugins.companion.cycles_staged, value: stats.staged_consumed },
    { key: 'chars', label: t.plugins.companion.cycles_chars, value: stats.chars_in },
  ];
  const shown = entries.filter((e) => e.value !== undefined);
  if (shown.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2">
      {shown.map((entry) => (
        <div key={entry.key} className="flex items-baseline gap-1.5">
          <dt className="typo-caption text-foreground">{entry.label}</dt>
          <dd className="typo-caption font-semibold text-foreground">
            <Numeric value={entry.value ?? 0} unit="count" />
            {entry.hint ? (
              <Tooltip content={entry.hint}>
                <span className="ml-1 text-amber-400" aria-label={entry.hint}>
                  !
                </span>
              </Tooltip>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CyclePhaseRow({ phases }: { phases: CyclePhase[] }) {
  const { t } = useTranslation();
  if (phases.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {phases.map((phase) => (
        <Tooltip key={`${phase.phase}-${phase.at}`} content={phase.detail || phase.status}>
          <span
            className={`typo-caption rounded-interactive px-2 py-0.5 border ${
              phase.status === 'failed'
                ? 'border-rose-400/40 text-rose-400'
                : phase.status === 'skipped'
                  ? 'border-foreground/15 text-foreground'
                  : 'border-emerald-400/30 text-emerald-400'
            }`}
          >
            {titleCase(phase.phase)}
          </span>
        </Tooltip>
      ))}
      <span className="sr-only">{t.plugins.companion.cycles_phases}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghost cards — geometry-matched to CycleCard, delayed so a warm/fast fetch
// never paints one. No spinner, no `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';

function CycleGhostRows() {
  return (
    <div className="p-4 space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-card border border-foreground/10 px-4 py-3 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-4 h-4 ${GHOST_BAR}`} />
            <span className={`h-3 w-24 ${GHOST_BAR}`} />
            <span className={`h-2.5 w-16 ${GHOST_BAR}`} />
          </div>
          <span className={`block h-2.5 w-2/3 mb-2 ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-1/2 ${GHOST_BAR}`} />
        </div>
      ))}
    </div>
  );
}

/** Test seam: drop every warm entry so a fresh mount refetches. */
export function __resetCycleCacheForTests() {
  cycleCache.clear();
}
