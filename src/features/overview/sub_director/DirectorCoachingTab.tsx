import { useState } from 'react';
import { Clapperboard, RefreshCw, UserPlus, Gauge, Star, Coins, BarChart3, Cpu, Brain, ExternalLink, Layers } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useDirector } from './useDirector';
import { DirectorSection } from './DirectorSection';
import { scoreTone } from './directorScore';
import { PersonaCoachingTable } from './components/PersonaCoachingTable';
import { PersonaDetailModal } from './components/PersonaDetailModal';
import { AddToScopeModal } from './components/AddToScopeModal';
import { ValueLeakBar } from './components/ValueLeakBar';
import { PeriodSelect } from './components/PeriodSelect';
import { ScoreDistribution } from './components/ScoreDistribution';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * Director coaching — a single Overview sub-tab consolidating what used to be
 * five Director tabs. Top to bottom: a thin subheader (scope stats + Memory
 * toggle), the portfolio scorecard (KPIs + score distribution + model
 * efficiency), and one coaching table (Roster + Attention) whose rows open a
 * per-agent detail modal (Reviews). Add-to-scope is a modal so the surface
 * stays compact. All data flows through the shared `useDirector` hook.
 */
export default function DirectorCoachingTab() {
  const { t, tx } = useTranslation();
  const d = useDirector();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);

  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<DirectorRosterEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const p = d.portfolio;
  const inScope = p?.inScope ?? 0;
  const lastReviewAt = d.verdicts[0]?.createdAt ?? null;

  const runAll = async () => {
    setRunning(true);
    try { await d.runBatch(); } finally { setRunning(false); }
  };

  const openBrain = () => {
    setPluginTab('obsidian-brain');
    setSidebarSection('plugins');
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={<RefreshCw className={`w-3.5 h-3.5 ${d.refreshing ? 'animate-spin' : ''}`} />}
        onClick={d.refresh}
      >
        {t.director.refresh}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<UserPlus className="w-3.5 h-3.5" />}
        onClick={() => setAddOpen(true)}
      >
        {t.director.add_to_scope}
      </Button>
      <AsyncButton
        variant="accent"
        accentColor="violet"
        size="sm"
        isLoading={running}
        loadingText={t.director.running}
        disabled={inScope === 0}
        title={inScope === 0 ? t.director.no_scope_hint : t.director.run_batch_hint}
        onClick={runAll}
        data-testid="director-run-batch"
      >
        {t.director.run_all}
      </AsyncButton>
    </div>
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={
          <span className="relative inline-flex items-center justify-center">
            <span aria-hidden className="absolute -inset-2 rounded-full bg-violet-500/30 blur-md animate-glow-breathe motion-reduce:hidden" />
            <span className="relative inline-flex">
              {d.director ? (
                <PersonaIcon icon={d.director.icon} color={d.director.color} size="w-5 h-5" />
              ) : (
                <Clapperboard className="w-5 h-5 text-violet-300" />
              )}
            </span>
          </span>
        }
        iconColor="violet"
        title={t.director.panel_title}
        subtitle={inScope > 0 ? tx(t.director.scope_summary, { count: inScope }) : t.director.scope_empty}
        actions={headerActions}
      />

      <ContentBody>
       <div className="relative min-h-full">
        {/* Decorative Athena backdrop — very low opacity, non-interactive, behind all content. */}
        <img
          aria-hidden
          src="/athena/athena_baseline.jpg"
          className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover object-center opacity-[0.05]"
        />
        <div className="relative z-10">
        {!d.ready ? (
          <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
        ) : !p || inScope === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title={t.director.empty_title}
            subtitle={t.director.empty_subtitle}
            iconColor="text-violet-300"
            iconContainerClassName="bg-violet-500/10 border-violet-500/25"
            action={{ label: t.director.add_to_scope, onClick: () => setAddOpen(true), icon: UserPlus }}
          />
        ) : (
          <div className="space-y-4 pb-6">
            {/* Thin subheader: secondary stats + Memory toggle */}
            <div className="flex items-center justify-between gap-4 px-3.5 py-2 rounded-card border border-primary/10 bg-secondary/20">
              <div className="flex items-center gap-4 typo-caption text-foreground flex-wrap">
                <PeriodSelect value={d.period ?? p.periodDays} onChange={d.setPeriod} />
                {p.avgScore != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-violet-300" />
                    {t.director.kpi_avg_score}
                    <Numeric value={p.avgScore} precision={1} className="text-foreground font-medium tabular-nums" />
                  </span>
                )}
                {lastReviewAt && (
                  <span className="inline-flex items-center gap-1.5">
                    {t.director.last_review}
                    <RelativeTime timestamp={lastReviewAt} className="text-foreground" />
                  </span>
                )}
              </div>
              {/* Memory toggle */}
              {d.vaultConfigured ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Brain className={`w-3.5 h-3.5 ${d.brainEnabled ? 'text-violet-300' : 'text-foreground'}`} />
                  <span className="typo-caption text-foreground">{t.director.brain_title}</span>
                  <AccessibleToggle
                    checked={d.brainEnabled}
                    onChange={() => d.setBrainEnabled(!d.brainEnabled)}
                    label={t.director.brain_title}
                    data-testid="director-brain-toggle"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openBrain}
                  className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors shrink-0"
                  title={t.director.brain_unavailable}
                >
                  <Brain className="w-3.5 h-3.5" />
                  {t.director.brain_title}
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Scorecard */}
            <Scorecard d={d} />

            {/* Coaching table */}
            <DirectorSection label={t.director.table_title} icon={Star}>
              <PersonaCoachingTable
                roster={p.roster}
                onSelect={setSelected}
                onRemove={(id) => d.setStarred(id, false)}
              />
            </DirectorSection>
          </div>
        )}
        </div>
       </div>
      </ContentBody>

      {/* Modals */}
      <PersonaDetailModal entry={selected} onClose={() => setSelected(null)} onRunReview={d.runOnPersona} />
      <AddToScopeModal open={addOpen} onClose={() => setAddOpen(false)} personas={d.personas} onAdd={(id) => d.setStarred(id, true)} />
    </ContentBox>
  );
}

/** Portfolio scorecard — KPIs + score distribution + model efficiency. */
function Scorecard({ d }: { d: ReturnType<typeof useDirector> }) {
  const { t, tx } = useTranslation();
  const p = d.portfolio!;
  const { rollup } = p;
  const avgTone = p.avgScore != null ? scoreTone(p.avgScore) : null;
  const maxModelRuns = Math.max(1, ...rollup.models.map((m) => m.executions));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          style={{ animationDelay: '0ms' }} className="animate-fade-slide-in"
          label={t.director.kpi_value_rate}
          value={<Numeric value={rollup.valueDeliveredRate} unit="ratio" precision={0} />}
          icon={Gauge}
          tone={rollup.valueDeliveredRate >= 0.6 ? 'success' : rollup.valueDeliveredRate >= 0.3 ? 'warning' : 'danger'}
          hint={t.director.kpi_value_rate_hint}
        />
        <StatCard
          style={{ animationDelay: '40ms' }} className="animate-fade-slide-in"
          label={t.director.kpi_avg_score}
          value={p.avgScore != null ? <Numeric value={p.avgScore} precision={1} /> : '—'}
          icon={Star}
          tone={avgTone?.tier === 'high' ? 'success' : avgTone?.tier === 'mid' ? 'warning' : avgTone?.tier === 'low' ? 'danger' : 'neutral'}
          hint={t.director.kpi_avg_score_hint}
        />
        <StatCard
          style={{ animationDelay: '80ms' }} className="animate-fade-slide-in"
          label={t.director.kpi_cost_per_value}
          value={rollup.costPerValueDelivered != null ? <Numeric value={rollup.costPerValueDelivered} unit="usd" /> : '—'}
          icon={Coins}
          tone="info"
          hint={t.director.kpi_cost_per_value_hint}
        />
        <StatCard
          style={{ animationDelay: '120ms' }} className="animate-fade-slide-in"
          label={t.director.kpi_in_scope}
          value={<Numeric value={p.inScope} />}
          icon={Star}
          tone="neutral"
          hint={tx(t.director.kpi_in_scope_hint, { reviewed: p.reviewed, unreviewed: p.unreviewed })}
        />
      </div>

      <DirectorSection label={t.director.value_leak_title} icon={Layers}>
        <ValueLeakBar rollup={rollup} />
      </DirectorSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DirectorSection label={t.director.score_distribution} icon={BarChart3}>
          <ScoreDistribution bands={p.scoreDistribution} avgScore={p.avgScore} />
        </DirectorSection>

        {rollup.models.length > 0 && (
          <DirectorSection label={t.director.model_efficiency} icon={Cpu}>
            <div className="space-y-1.5">
              {rollup.models.map((m) => {
                const runPct = (m.executions / maxModelRuns) * 100;
                const valuePct = m.executions > 0 ? (m.valueDelivered / m.executions) * 100 : 0;
                return (
                  <div key={m.model} className="grid grid-cols-[1.6fr_auto_auto_auto] items-center gap-3 px-1.5 py-1 rounded">
                    <div className="min-w-0">
                      <div className="typo-caption text-foreground truncate" title={m.model}>{m.model}</div>
                      <div className="mt-1 h-1.5 rounded-pill bg-secondary/60 overflow-hidden" style={{ width: `${Math.max(runPct, 8)}%` }}>
                        <div className="h-full rounded-pill" style={{ width: `${valuePct}%`, background: 'var(--status-success)' }} />
                      </div>
                    </div>
                    <Numeric value={m.executions} className="typo-caption text-foreground text-right tabular-nums" />
                    <Numeric value={m.costUsd} unit="usd" className="typo-caption text-foreground text-right tabular-nums" />
                    <span className="typo-caption text-right tabular-nums" style={{ color: 'var(--status-success)' }}>
                      <Numeric value={m.valueDelivered} />
                    </span>
                  </div>
                );
              })}
            </div>
          </DirectorSection>
        )}
      </div>
    </>
  );
}
