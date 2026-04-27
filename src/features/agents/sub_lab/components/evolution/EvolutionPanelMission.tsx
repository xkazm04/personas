/**
 * Variant — "Mission Control"
 *
 * Metaphor: a reactor-core hero card surfaces the four key vital signs
 * (cycles / promotions / eligibility / last delta) and the persistent trigger
 * CTA. Below it, a horizontal cycle filmstrip lets the user scrub through
 * generations like a control-room timeline. Settings live in a slide-down
 * drawer launched from a single chip — invisible until needed.
 *
 * Why different from baseline: baseline buries vitals inside a SectionCard
 * and lists cycles vertically. This variant treats Evolve as a passive
 * "set & forget" surface that should be glance-able, with one always-visible
 * action and a horizontal generation timeline.
 */
import { Loader2, Sparkles, Play, ToggleLeft, ToggleRight, TrendingUp, TrendingDown, CheckCircle2, XCircle, Settings2, Activity, Trophy, Hourglass, Gauge } from 'lucide-react';
import { useState } from 'react';
import { useEvolutionPanelState } from './useEvolutionPanelState';
import { useTranslation } from '@/i18n/useTranslation';
import type { EvolutionCycle } from '@/lib/bindings/EvolutionCycle';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';

const STATUS_TINT: Record<string, string> = {
  breeding: 'border-blue-500/40 bg-blue-500/8',
  evaluating: 'border-amber-500/40 bg-amber-500/8',
  promoting: 'border-violet-500/40 bg-violet-500/8',
  completed: 'border-emerald-500/30 bg-emerald-500/5',
  failed: 'border-red-500/40 bg-red-500/5',
};

function VitalDial({ icon: Icon, label, value, accent }: { icon: typeof Activity; label: string; value: React.ReactNode; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-background/40 border border-primary/10 px-3 py-2.5 min-w-[140px]">
      <div className={`w-8 h-8 rounded-card flex items-center justify-center ${accent}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="typo-label text-foreground/60">{label}</div>
        <div className="typo-data-lg text-foreground leading-none">{value}</div>
      </div>
    </div>
  );
}

function FilmCard({ cycle, idx, total }: { cycle: EvolutionCycle; idx: number; total: number }) {
  const tint = STATUS_TINT[cycle.status] ?? 'border-primary/15 bg-secondary/20';
  const improvement = cycle.winnerFitness != null && cycle.incumbentFitness != null
    ? cycle.winnerFitness - cycle.incumbentFitness
    : null;

  return (
    <div className={`shrink-0 w-44 rounded-card border ${tint} px-3 py-2.5 space-y-1.5`}>
      <div className="flex items-center justify-between">
        <span className="typo-label text-foreground/60">Gen {total - idx}</span>
        {cycle.status === 'completed' && cycle.promoted ? <Trophy className="w-3.5 h-3.5 text-amber-400" /> : null}
        {cycle.status === 'failed' ? <XCircle className="w-3.5 h-3.5 text-red-400" /> : null}
        {cycle.status === 'completed' && !cycle.promoted ? <CheckCircle2 className="w-3.5 h-3.5 text-foreground/40" /> : null}
        {(cycle.status === 'breeding' || cycle.status === 'evaluating' || cycle.status === 'promoting') ? <Loader2 className="w-3.5 h-3.5 text-foreground/60 animate-spin" /> : null}
      </div>

      <div className="typo-caption text-foreground">
        {cycle.variantsTested} variants
      </div>

      {improvement != null ? (
        <div className="flex items-center gap-1">
          {improvement > 0 ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : improvement < 0 ? <TrendingDown className="w-3 h-3 text-red-400" /> : null}
          <span className={`typo-data ${improvement > 0 ? 'text-emerald-400' : improvement < 0 ? 'text-red-400' : 'text-foreground/60'}`}>
            {improvement > 0 ? '+' : ''}{(improvement * 100).toFixed(1)}%
          </span>
        </div>
      ) : (
        <div className="typo-caption text-foreground/40">no signal</div>
      )}

      <div className="typo-caption text-foreground/50">
        {new Date(cycle.startedAt).toLocaleDateString()}
      </div>
    </div>
  );
}

export function EvolutionPanelMission() {
  const { t } = useTranslation();
  const s = useEvolutionPanelState();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!s.personaId) {
    return (
      <div className="text-center py-10 text-foreground typo-body">
        {t.agents.lab.select_persona_evolution}
      </div>
    );
  }
  if (s.isLoading) {
    return (
      <div className="flex items-center justify-center py-10" role="status">
        <Loader2 className="w-5 h-5 animate-spin text-foreground" />
      </div>
    );
  }

  const lastCycle = s.cycles[0];
  const lastDelta = lastCycle && lastCycle.winnerFitness != null && lastCycle.incumbentFitness != null
    ? lastCycle.winnerFitness - lastCycle.incumbentFitness
    : null;

  return (
    <div className="space-y-4" role="region" aria-label="Auto-evolution panel — mission control">
      {/* Reactor core */}
      <div className="relative rounded-modal border border-primary/15 bg-gradient-to-br from-violet-500/8 via-secondary/30 to-background/20 overflow-hidden">
        {/* Decorative corner glow */}
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" aria-hidden />

        <div className="relative px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
          {/* Identity + toggle */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-card bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-violet-300" />
            </div>
            <div>
              <h3 className="typo-heading text-foreground">Auto-evolution</h3>
              <button
                onClick={s.handleToggle}
                disabled={s.isSaving}
                className="flex items-center gap-1.5 typo-caption focus-ring rounded-interactive mt-0.5"
                aria-label={s.isEnabled ? 'Disable auto-evolution' : 'Enable auto-evolution'}
              >
                {s.isEnabled
                  ? <><ToggleRight className="w-6 h-6 text-emerald-400" /> <span className="text-emerald-400">Enabled</span></>
                  : <><ToggleLeft className="w-6 h-6 text-foreground/60" /> <span className="text-foreground/60">Disabled</span></>}
              </button>
            </div>
          </div>

          {/* Vital dials */}
          <div className="flex flex-wrap gap-2 flex-1">
            <VitalDial icon={Activity} label="Cycles" value={s.policy?.totalCycles ?? 0} accent="bg-blue-500/15 text-blue-300" />
            <VitalDial icon={Trophy} label="Promoted" value={s.policy?.totalPromotions ?? 0} accent="bg-emerald-500/15 text-emerald-300" />
            <VitalDial
              icon={TrendingUp}
              label="Last Δ"
              value={lastDelta != null ? `${lastDelta > 0 ? '+' : ''}${(lastDelta * 100).toFixed(1)}%` : '—'}
              accent={lastDelta != null && lastDelta > 0 ? 'bg-emerald-500/15 text-emerald-300' : lastDelta != null && lastDelta < 0 ? 'bg-red-500/15 text-red-300' : 'bg-primary/10 text-foreground/60'}
            />
            <VitalDial
              icon={Hourglass}
              label="State"
              value={<span className={s.eligible ? 'text-amber-400' : 'text-foreground/70'}>{s.eligible ? t.agents.lab.ready_label : t.agents.lab.waiting_label}</span>}
              accent={s.eligible ? 'bg-amber-500/15 text-amber-300' : 'bg-primary/10 text-foreground/60'}
            />
          </div>

          {/* Trigger + drawer chip */}
          <div className="flex items-center gap-2">
            <button
              onClick={s.handleTriggerCycle}
              disabled={s.isTriggering}
              className="flex items-center gap-2 px-4 py-2.5 typo-body font-medium rounded-modal bg-violet-500/20 text-violet-200 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-40 focus-ring shadow-elevation-1"
            >
              {s.isTriggering ? <><Loader2 className="w-4 h-4 animate-spin" /> Evolving…</> : <><Play className="w-4 h-4" /> Trigger</>}
            </button>
            <button
              onClick={() => setDrawerOpen((v) => !v)}
              className={`p-2.5 rounded-modal border transition-colors focus-ring ${drawerOpen ? 'bg-violet-500/15 border-violet-500/30 text-violet-200' : 'border-primary/15 text-foreground/70 hover:bg-secondary/30'}`}
              aria-label="Toggle settings drawer"
              aria-expanded={drawerOpen}
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Slide-down drawer */}
        {drawerOpen && (
          <div className="border-t border-primary/15 bg-background/30 px-5 py-4 animate-fade-slide-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="typo-label text-foreground/70 mb-2">Fitness objective</h4>
                <ObjectiveBars objective={s.objective} setObjective={s.setObjective} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mutation rate" id="msn-mut">
                  <input id="msn-mut" type="range" min={5} max={50} value={Math.round(s.mutationRate * 100)} onChange={(e) => s.setMutationRate(Number(e.target.value) / 100)} className="w-full h-1 accent-violet-500" />
                  <span className="typo-caption text-foreground">{Math.round(s.mutationRate * 100)}%</span>
                </Field>
                <Field label="Variants per cycle" id="msn-var">
                  <select id="msn-var" value={s.variants} onChange={(e) => s.setVariants(Number(e.target.value))} className="w-full typo-body bg-primary/5 border border-primary/10 rounded-input px-2 py-1 text-foreground focus-ring">
                    {[2, 3, 4, 5, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Improvement threshold" id="msn-thr">
                  <input id="msn-thr" type="range" min={1} max={20} value={Math.round(s.threshold * 100)} onChange={(e) => s.setThreshold(Number(e.target.value) / 100)} className="w-full h-1 accent-violet-500" />
                  <span className="typo-caption text-foreground">{Math.round(s.threshold * 100)}%</span>
                </Field>
                <Field label="Min executions between" id="msn-exec">
                  <select id="msn-exec" value={s.minExecs} onChange={(e) => s.setMinExecs(Number(e.target.value))} className="w-full typo-body bg-primary/5 border border-primary/10 rounded-input px-2 py-1 text-foreground focus-ring">
                    {[3, 5, 10, 15, 20, 30, 50].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                onClick={s.handleSaveSettings}
                disabled={s.isSaving}
                className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-card bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 focus-ring"
              >
                {s.isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {t.agents.lab.save_settings}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filmstrip */}
      <div className="rounded-card border border-primary/10 bg-secondary/15 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-foreground/60" />
            <h3 className="typo-heading text-foreground">Generation timeline</h3>
          </div>
          <span className="typo-caption text-foreground/60">scroll →</span>
        </div>
        {s.cycles.length === 0 ? (
          <div className="text-center py-6 typo-caption text-foreground/60">
            No generations recorded yet. Trigger a cycle from the reactor above.
          </div>
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-2 min-w-max">
              {s.cycles.map((c, i) => <FilmCard key={c.id} cycle={c} idx={i} total={s.cycles.length} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectiveBars({ objective, setObjective }: { objective: FitnessObjective; setObjective: (o: FitnessObjective) => void }) {
  const adjust = (key: keyof FitnessObjective, value: number) => {
    const next = { ...objective, [key]: value };
    const total = next.speed + next.quality + next.cost;
    if (total > 0) {
      next.speed /= total;
      next.quality /= total;
      next.cost /= total;
    }
    setObjective(next);
  };
  const row = (key: keyof FitnessObjective, label: string, color: string) => (
    <div className="flex items-center gap-2">
      <span className={`typo-caption w-16 ${color}`}>{label}</span>
      <input
        type="range" min={0} max={100}
        value={Math.round(objective[key] * 100)}
        onChange={(e) => adjust(key, Number(e.target.value) / 100)}
        className="flex-1 h-1 accent-violet-500"
      />
      <span className="typo-caption text-foreground w-9 text-right">{Math.round(objective[key] * 100)}%</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row('quality', 'Quality', 'text-emerald-400')}
      {row('speed', 'Speed', 'text-amber-400')}
      {row('cost', 'Cost', 'text-blue-400')}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="typo-caption text-foreground/70">{label}</label>
      <div className="flex items-center gap-2 mt-1">{children}</div>
    </div>
  );
}

