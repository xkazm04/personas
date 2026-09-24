import { useMemo, useState } from 'react';
import { GitCommitVertical } from 'lucide-react';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { buildSpine } from './engine/spine';
import { devFailure, devInstances, type DevMode } from './engine/devAdapter';
import { useProcessData } from './useProcessData';
import { RepoFilter } from './RepoFilter';
import { SpineSummary } from './SpineSummary';
import { SpineStation } from './SpineStation';
import { SpineOutcomes } from './SpineOutcomes';
import { ProcessGhost } from './ProcessGhost';
import { ProcessLanes, type LanesVariant } from './ProcessLanes';
import { PROTO } from './lanes';

const MODES: DevMode[] = ['interactive', 'headless'];
const MODE_TABS = 'process-mode';

// TODO(prototype, 2026-09-24): consolidate the Process variant switcher (baseline vs side-by-side lanes).
type Variant = 'baseline' | LanesVariant;
const VARIANTS: Variant[] = ['baseline', 'rivers', 'transit', 'instruments'];
const PROTO_TABS = 'process-proto';

export default function ProcessPage() {
  const [variant, setVariant] = useState<Variant>(() => {
    const v = new URLSearchParams(window.location.search).get('variant') as Variant | null;
    return v && VARIANTS.includes(v) ? v : 'baseline';
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b border-primary/10 px-4 py-2">
        <SegmentedTabs<Variant>
          tabs={VARIANTS.map((v) => ({ id: v, label: PROTO.variants[v][0], testId: `process-variant-${v}` }))}
          activeTab={variant}
          onTabChange={setVariant}
          ariaLabel={PROTO.heading}
          idPrefix={PROTO_TABS}
          size="sm"
          fullWidth={false}
        />
        <span className="typo-caption">{PROTO.variants[variant][1]}</span>
      </div>
      <div role="tabpanel" id={`${PROTO_TABS}-panel-${variant}`} aria-labelledby={`${PROTO_TABS}-tab-${variant}`} className="flex min-h-0 flex-1">
        {variant === 'baseline' ? <ProcessBaseline /> : <ProcessLanes variant={variant} />}
      </div>
    </div>
  );
}

/**
 * Curator > Process: the strategic layer over the fleet's development sessions.
 *
 * One surface, one job - which phases of the work the sessions reach, and where they fail. The
 * standard path is derived from the sessions themselves. Interactive and headless sessions are
 * different processes and are never pooled; a repository is a filter, measured against its mode.
 */
export function ProcessBaseline() {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const { reading, loading, error } = useProcessData();
  const [mode, setMode] = useState<DevMode>('interactive');
  const [repoPick, setRepoPick] = useState<string | null>(null);

  const all = useMemo(() => (reading ? devInstances(reading) : []), [reading]);
  const byMode = useMemo(() => MODES.map((m) => all.filter((x) => x.mode === m)), [all]);
  const cohort = useMemo(() => byMode[MODES.indexOf(mode)] ?? [], [byMode, mode]);
  const repos = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of cohort) n.set(x.project, (n.get(x.project) ?? 0) + 1);
    return [...n].map(([name, count]) => ({ name, n: count })).sort((a, b) => b.n - a.n);
  }, [cohort]);
  // A repository with no sessions in this mode is not a filter, it is an empty page.
  const repo = repoPick && repos.some((r) => r.name === repoPick) ? repoPick : null;
  const view = useMemo(() => (repo ? cohort.filter((x) => x.project === repo) : cohort), [cohort, repo]);
  const base = useMemo(() => buildSpine(cohort, devFailure), [cohort]);
  const model = useMemo(() => (repo ? buildSpine(view, devFailure, cohort) : base), [repo, view, cohort, base]);

  const subtitle = reading
    ? repo
      ? tx(p.subtitle_repo, { count: view.length, repo })
      : tx(p.subtitle_all, { count: cohort.length, repos: repos.length })
    : undefined;

  return (
    <ContentBox data-testid="process-page">
      <ContentHeader
        icon={<GitCommitVertical className="h-5 w-5 text-violet-400" />}
        iconColor="violet"
        title={t.companions.nav.page_process}
        subtitle={subtitle}
        fitWidth
        actions={
          <div className="flex items-center gap-3">
            <SegmentedTabs<DevMode>
              tabs={MODES.map((m, i) => ({
                id: m,
                label: `${m === 'interactive' ? p.mode_interactive : p.mode_headless} ${byMode[i]?.length ?? ''}`.trim(),
                testId: `process-mode-${m}`,
              }))}
              activeTab={mode}
              onTabChange={setMode}
              ariaLabel={p.mode_aria}
              idPrefix={MODE_TABS}
              size="sm"
              fullWidth={false}
            />
            <RepoFilter repos={repos} total={cohort.length} value={repo} onChange={setRepoPick} />
          </div>
        }
      />
      <ContentBody>
        {/* The mode strip's panel, declared literally (the census reads the literal). */}
        <div
          role="tabpanel"
          id={`${MODE_TABS}-panel-${mode}`}
          aria-labelledby={`${MODE_TABS}-tab-${mode}`}
          className="mx-auto w-full max-w-6xl px-2 py-6"
        >
          {!reading ? (
            error ? <LoadError title={p.error_title} message={error} /> : loading ? <ProcessGhost /> : null
          ) : view.length === 0 ? (
            <p className="py-16 text-center typo-body">{p.empty}</p>
          ) : (
            <>
              <SpineSummary model={model} />
              <p className="mt-6 mb-10 max-w-3xl typo-body text-foreground">
                {p.path_note} {p.mode_note} {p.time_note}
              </p>
              <ol aria-label={t.companions.nav.page_process}>
                {model.stations.map((s, i) => (
                  <SpineStation
                    key={s.keys.join('|')}
                    station={s}
                    total={model.n}
                    cohort={repo ? base.stations[i] : undefined}
                    cohortTotal={repo ? base.n : undefined}
                    rank={model.worst.slice(0, 3).includes(s.index) ? model.worst.indexOf(s.index) + 1 : undefined}
                    last={i === model.stations.length - 1}
                  />
                ))}
              </ol>
              <SpineOutcomes outcomes={model.outcomes} total={model.n} />
              <p className="mt-8 typo-caption tabular-nums">
                {tx(p.source, { scanned: reading.source.scanned, cached: reading.source.cached })}
              </p>
            </>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

function LoadError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-card border border-status-error/40 bg-status-error/10 p-6" role="alert">
      <p className="typo-heading text-status-error">{title}</p>
      <p className="mt-2 typo-body">{message}</p>
    </div>
  );
}
