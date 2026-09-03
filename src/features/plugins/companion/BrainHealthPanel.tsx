import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  MinusCircle,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import { toastCatch } from '@/lib/silentCatch';
import {
  companionBrainHealth,
  type BrainCounters,
  type BrainHealth,
  type StageStatus,
} from '@/api/companion/brain';
import { titleCase } from './athenaLabels';

/**
 * Brain health — the whole recall pipeline's verdict, stage by stage.
 *
 * Reads `companion_brain_health`, a 795-line diagnostic that had no frontend
 * caller until this panel. Every signal the struct carries is rendered: the
 * overall verdict, whether the vector lane is live, the first blocking cause
 * with its fix, all eight stages, and every raw counter.
 *
 * **Honest labels.** `HealthStage.detail` and `BlockingCause.summary`/`fix` are
 * English prose written by the backend for the operator; they are shown
 * verbatim rather than paraphrased, because a paraphrase of a diagnostic is a
 * second source of truth. Only the stage *names* and the counter labels are
 * translated — those are stable machine tokens the UI owns.
 *
 * ## Both pending backend signals have landed
 *
 * 1. **Consolidation staleness.** The `consolidation` stage used to report
 *    `Ok` from the mere existence of `counters.lastCycleAt`; it is now
 *    staleness-aware (`Degraded` past 72h, `Unknown` on an unreadable
 *    timestamp) and the new `StageStatus` flows through {@link STAGE_ICON} /
 *    {@link statusLabel} with no change here, exactly as this note predicted.
 * 2. **Conversation-only episode count.** `BrainCounters.conversationEpisodes`
 *    excludes machine correlator records with the same exclusion the recency
 *    lane and the sleep cycle use, and sits in {@link COUNTER_ROWS} beside
 *    `episodes` — the total and the part of it a cycle would actually consume,
 *    which on a brain that has seen a Fleet load test differ by two orders of
 *    magnitude.
 *
 * Loading law: a delayed ghost under permanent chrome, a module-scoped warm
 * cache so re-opening the tab paints warm, and errors through `toastCatch`
 * plus an inline state.
 */

/** One-slot warm cache — the report has no key space of its own. */
const HEALTH_KEY = 'brain-health' as const;
const healthCache = createModuleCache<typeof HEALTH_KEY, BrainHealth>({
  ttlMs: 60 * 1000,
  maxSize: 1,
});

const STAGE_ICON: Record<StageStatus, LucideIcon> = {
  ok: CheckCircle2,
  skipped: MinusCircle,
  degraded: CircleDashed,
  blocked: ShieldAlert,
  unknown: HelpCircle,
};

const STAGE_ACCENT: Record<StageStatus, string> = {
  ok: 'text-emerald-400',
  skipped: 'text-foreground',
  degraded: 'text-amber-400',
  blocked: 'text-rose-400',
  unknown: 'text-foreground',
};

function statusLabel(t: ReturnType<typeof useTranslation>['t'], status: StageStatus): string {
  switch (status) {
    case 'ok':
      return t.plugins.companion.health_status_ok;
    case 'skipped':
      return t.plugins.companion.health_status_skipped;
    case 'degraded':
      return t.plugins.companion.health_status_degraded;
    case 'blocked':
      return t.plugins.companion.health_status_blocked;
    case 'unknown':
      return t.plugins.companion.health_status_unknown;
    default:
      return titleCase(status);
  }
}

/**
 * The eight stable stage names `health.rs` emits. An unknown name (a stage
 * added backend-first) title-cases rather than rendering a raw slug.
 */
function stageLabel(t: ReturnType<typeof useTranslation>['t'], name: string): string {
  switch (name) {
    case 'ml_feature':
      return t.plugins.companion.health_stage_ml_feature;
    case 'embedder':
      return t.plugins.companion.health_stage_embedder;
    case 'corpus':
      return t.plugins.companion.health_stage_corpus;
    case 'keyword_index':
      return t.plugins.companion.health_stage_keyword_index;
    case 'vector_index':
      return t.plugins.companion.health_stage_vector_index;
    case 'embedding_coverage':
      return t.plugins.companion.health_stage_embedding_coverage;
    case 'model_guard':
      return t.plugins.companion.health_stage_model_guard;
    case 'consolidation':
      return t.plugins.companion.health_stage_consolidation;
    default:
      return titleCase(name);
  }
}

export function BrainHealthPanel() {
  const { t } = useTranslation();
  const cached = useModuleSubscription(healthCache, HEALTH_KEY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    companionBrainHealth()
      .then((report) => {
        if (cancelled) return;
        setError(null);
        healthCache.set(HEALTH_KEY, report);
        healthCache.notify();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        toastCatch('companion_brain_health')(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (cached === undefined) {
    if (error) {
      return (
        <div data-testid="health-error">
          <EmptyState
            icon={AlertTriangle}
            title={t.plugins.companion.health_load_failed}
            subtitle={error}
          />
        </div>
      );
    }
    return <HealthGhost />;
  }

  return (
    <div className="p-4 space-y-4" data-testid="brain-health-panel">
      <HealthVerdict report={cached} />
      {cached.firstBlockingCause ? (
        <section className="rounded-card border border-rose-400/30 bg-rose-400/5 px-4 py-3">
          <h3 className="typo-body font-medium text-rose-400 mb-1">
            {t.plugins.companion.health_blocking_cause}
          </h3>
          <p className="typo-caption text-foreground">{cached.firstBlockingCause.summary}</p>
          <p className="typo-caption text-foreground mt-1.5">
            <span className="font-semibold">{t.plugins.companion.health_fix}</span>{' '}
            {cached.firstBlockingCause.fix}
          </p>
        </section>
      ) : null}
      <HealthStages report={cached} />
      <HealthCounters counters={cached.counters} />
    </div>
  );
}

function HealthVerdict({ report }: { report: BrainHealth }) {
  const { t } = useTranslation();
  const Icon = report.healthy ? CheckCircle2 : ShieldAlert;
  return (
    <header className="flex items-center gap-2">
      <Icon
        className={`w-5 h-5 shrink-0 ${report.healthy ? 'text-emerald-400' : 'text-rose-400'}`}
        aria-hidden="true"
      />
      <span className="typo-body font-medium">
        {report.healthy
          ? t.plugins.companion.health_healthy
          : t.plugins.companion.health_unhealthy}
      </span>
      <span className="typo-caption text-foreground">
        ·{' '}
        {report.vectorLane
          ? t.plugins.companion.health_vector_lane_on
          : t.plugins.companion.health_vector_lane_off}
      </span>
    </header>
  );
}

function HealthStages({ report }: { report: BrainHealth }) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="typo-caption font-semibold text-foreground mb-2">
        {t.plugins.companion.health_stages}
      </h3>
      <ul className="space-y-1.5">
        {report.stages.map((stage) => {
          const Icon = STAGE_ICON[stage.status] ?? HelpCircle;
          const accent = STAGE_ACCENT[stage.status] ?? 'text-foreground';
          return (
            <li
              key={stage.name}
              className="flex items-start gap-2"
              data-testid="health-stage"
              data-stage={stage.name}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${accent}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="typo-caption font-medium text-foreground">
                  {stageLabel(t, stage.name)}
                  <span className={`ml-1.5 font-normal ${accent}`}>
                    {statusLabel(t, stage.status)}
                  </span>
                </div>
                {/* Backend English, verbatim — a paraphrase of a diagnostic is a
                    second source of truth. */}
                <div className="typo-caption text-foreground">{stage.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Every counter `BrainCounters` carries, in the order the pipeline produces
 * them. `vectors` is nullable and its `null` means something specific — the
 * `companion_embedding` table does not exist — so it renders as its own label
 * rather than as zero.
 */
const COUNTER_ROWS = [
  'nodes',
  'embedded',
  'unembedded',
  'vectors',
  'ftsRows',
  'episodes',
  'conversationEpisodes',
  'facts',
  'procedurals',
  'doctrineChunks',
  'modelGuardExcluded',
] as const satisfies readonly (keyof BrainCounters)[];

function counterLabel(
  t: ReturnType<typeof useTranslation>['t'],
  key: (typeof COUNTER_ROWS)[number],
): string {
  switch (key) {
    case 'nodes':
      return t.plugins.companion.health_counter_nodes;
    case 'embedded':
      return t.plugins.companion.health_counter_embedded;
    case 'unembedded':
      return t.plugins.companion.health_counter_unembedded;
    case 'vectors':
      return t.plugins.companion.health_counter_vectors;
    case 'ftsRows':
      return t.plugins.companion.health_counter_fts_rows;
    case 'episodes':
      return t.plugins.companion.health_counter_episodes;
    case 'conversationEpisodes':
      return t.plugins.companion.health_counter_conversation_episodes;
    case 'facts':
      return t.plugins.companion.health_counter_facts;
    case 'procedurals':
      return t.plugins.companion.health_counter_procedurals;
    case 'doctrineChunks':
      return t.plugins.companion.health_counter_doctrine_chunks;
    case 'modelGuardExcluded':
      return t.plugins.companion.health_counter_model_guard_excluded;
    default:
      return titleCase(key);
  }
}

function HealthCounters({ counters }: { counters: BrainCounters }) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="typo-caption font-semibold text-foreground mb-2">
        {t.plugins.companion.health_counters}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {COUNTER_ROWS.map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-2" data-counter={key}>
            <dt className="typo-caption text-foreground">{counterLabel(t, key)}</dt>
            <dd className="typo-caption font-semibold text-foreground">
              {counters[key] === null ? (
                t.plugins.companion.health_counter_absent
              ) : (
                <Numeric value={counters[key]} unit="count" />
              )}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2" data-counter="lastCycleAt">
          <dt className="typo-caption text-foreground">
            {t.plugins.companion.health_counter_last_cycle}
          </dt>
          <dd className="typo-caption font-semibold text-foreground">
            {counters.lastCycleAt ? (
              <RelativeTime timestamp={counters.lastCycleAt} className="text-foreground" />
            ) : (
              t.plugins.companion.health_counter_never
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ghost — geometry-matched to the verdict + stage list. Delayed, so a warm
// cache or a fast read never paints one. No spinner.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';

function HealthGhost() {
  return (
    <div className="p-4 space-y-4 animate-fade-in" style={{ animationDelay: '120ms' }} aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className={`w-5 h-5 ${GHOST_BAR}`} />
        <span className={`h-3 w-32 ${GHOST_BAR}`} />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`w-4 h-4 mt-0.5 ${GHOST_BAR}`} />
            <span className={`block h-2.5 w-1/2 ${GHOST_BAR}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Test seam: drop the warm report so a fresh mount refetches. */
export function __resetHealthCacheForTests() {
  healthCache.clear();
}

/** Exported for the icon/label tables' tests. */
export const __healthInternals = { STAGE_ICON, STAGE_ACCENT, COUNTER_ROWS };

/** Re-exported so `Activity` stays the panel's tab icon owner. */
export const BRAIN_HEALTH_ICON: LucideIcon = Activity;
