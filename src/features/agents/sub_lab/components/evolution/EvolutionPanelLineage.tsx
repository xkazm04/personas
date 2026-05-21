/**
 * Variant — "Genome Lineage"
 *
 * Metaphor: vertical generational chain on the left (each cycle is a "generation"
 * card showing the winner DNA), DNA strand visualization in the centre showing
 * fitness weights as colour-coded chromosome segments, telemetry + the trigger CTA
 * on the right. Settings collapse into a "mutation lab" tray at the bottom.
 *
 * Why different from baseline: baseline stacks settings → stats → trigger →
 * cycle list vertically. This variant gives lineage primary spatial real estate
 * and turns fitness weights into a tangible visual rather than three sliders.
 */
import { Loader2, Sparkles, Play, ToggleLeft, ToggleRight, TrendingUp, CheckCircle2, XCircle, Zap, Target, DollarSign, ChevronDown, FlaskConical, GitCommit } from 'lucide-react';
import { useEvolutionPanelState } from './useEvolutionPanelState';
import { useTranslation } from '@/i18n/useTranslation';
import type { EvolutionCycle } from '@/lib/bindings/EvolutionCycle';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import { DebtText, debtText } from '@/i18n/DebtText';


const STATUS_DOT: Record<string, string> = {
  breeding: 'bg-blue-500/70',
  evaluating: 'bg-amber-500/70',
  promoting: 'bg-violet-500/70',
  completed: 'bg-emerald-500/70',
  failed: 'bg-red-500/70',
};

function GenerationNode({ cycle, idx, isLatest }: { cycle: EvolutionCycle; idx: number; isLatest: boolean }) {
  const improvement = cycle.winnerFitness != null && cycle.incumbentFitness != null
    ? cycle.winnerFitness - cycle.incumbentFitness
    : null;
  const dot = STATUS_DOT[cycle.status] ?? 'bg-foreground/40';

  return (
    <div className="relative flex gap-3">
      {/* Spine + node */}
      <div className="relative flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${dot} ring-2 ring-background ${isLatest ? 'shadow-[0_0_12px_var(--primary)]' : ''}`} />
        <div className="flex-1 w-px bg-primary/15 mt-1" aria-hidden />
      </div>

      {/* Card */}
      <div className={`flex-1 mb-3 rounded-card border ${isLatest ? 'border-violet-500/30 bg-violet-500/5' : 'border-primary/10 bg-secondary/20'} px-3 py-2`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="typo-label text-foreground">Gen {idx + 1}</span>
            {cycle.promoted && (
              <span className="flex items-center gap-1 typo-caption text-emerald-400">
                <TrendingUp className="w-3 h-3" /> promoted
              </span>
            )}
          </div>
          <span className="typo-caption text-foreground">
            {new Date(cycle.startedAt).toLocaleDateString()}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-1.5">
          <span className="typo-caption text-foreground">
            {cycle.variantsTested} variants
          </span>
          {cycle.winnerFitness != null && cycle.incumbentFitness != null && (
            <div className="flex items-center gap-1 typo-data">
              <span className="text-foreground">{Math.round(cycle.incumbentFitness * 100)}%</span>
              <span className="text-foreground">→</span>
              <span className={improvement && improvement > 0 ? 'text-emerald-400' : 'text-foreground'}>
                {Math.round(cycle.winnerFitness * 100)}%
              </span>
              {improvement != null && improvement !== 0 && (
                <span className={`text-[10px] ${improvement > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {improvement > 0 ? '+' : ''}{(improvement * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )}
          {cycle.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
          {cycle.status === 'completed' && !cycle.promoted && <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />}
        </div>
      </div>
    </div>
  );
}

function DnaStrand({ objective }: { objective: FitnessObjective }) {
  const segments: Array<{ key: keyof FitnessObjective; weight: number; color: string; label: string; icon: typeof Target }> = [
    { key: 'quality', weight: objective.quality, color: 'bg-emerald-400', label: 'Quality', icon: Target },
    { key: 'speed', weight: objective.speed, color: 'bg-amber-400', label: 'Speed', icon: Zap },
    { key: 'cost', weight: objective.cost, color: 'bg-blue-400', label: 'Cost', icon: DollarSign },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1 h-32">
        {segments.map((seg) => {
          const Icon = seg.icon;
          const heightPct = Math.max(seg.weight * 100, 6);
          return (
            <div key={seg.key} className="flex-1 flex flex-col items-center gap-1.5">
              <span className="typo-data text-foreground">{Math.round(seg.weight * 100)}%</span>
              <div className="relative w-full flex-1 rounded-input bg-primary/5 border border-primary/10 overflow-hidden">
                <div
                  className={`absolute bottom-0 left-0 right-0 ${seg.color} opacity-80 transition-[height] duration-300`}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="flex items-center gap-1 typo-caption text-foreground">
                <Icon className="w-3 h-3" /> {seg.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="typo-caption text-foreground text-center">
        <DebtText k="auto_fitness_genome_adjust_below_in_the_mutatio_b67d9f9f" />
      </p>
    </div>
  );
}

export function EvolutionPanelLineage() {
  const { t } = useTranslation();
  const s = useEvolutionPanelState();

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
    <div className="space-y-4" role="region" aria-label={debtText("auto_auto_evolution_panel_lineage_cdb5cb26")}>
      {/* Three-pane core */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_1fr] gap-3 items-stretch">
        {/* Lineage column */}
        <div className="rounded-card border border-primary/10 bg-secondary/20 p-3 min-h-[420px]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-violet-400" />
              <h3 className="typo-heading text-foreground">Lineage</h3>
            </div>
            <span className="typo-caption text-foreground">{s.cycles.length} generation{s.cycles.length !== 1 ? 's' : ''}</span>
          </div>
          {s.cycles.length === 0 ? (
            <div className="flex items-center justify-center h-72 typo-caption text-foreground text-center px-4">
              <DebtText k="auto_no_generations_yet_trigger_a_cycle_to_begi_a93bb324" />
            </div>
          ) : (
            <div className="overflow-y-auto max-h-96 pr-1">
              {s.cycles.map((c, idx) => (
                <GenerationNode key={c.id} cycle={c} idx={s.cycles.length - 1 - idx} isLatest={idx === 0} />
              ))}
            </div>
          )}
        </div>

        {/* Genome column */}
        <div className="rounded-card border border-primary/10 bg-gradient-to-b from-secondary/30 to-secondary/10 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <FlaskConical className="w-4 h-4 text-emerald-400" />
            <h3 className="typo-heading text-foreground">Genome</h3>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <DnaStrand objective={s.objective} />
          </div>
        </div>

        {/* Telemetry column */}
        <div className="rounded-card border border-primary/10 bg-secondary/20 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h3 className="typo-heading text-foreground">Telemetry</h3>
            </div>
            <button
              onClick={s.handleToggle}
              disabled={s.isSaving}
              className="flex items-center gap-1 typo-caption focus-ring rounded-interactive"
              aria-label={s.isEnabled ? 'Disable auto-evolution' : 'Enable auto-evolution'}
            >
              {s.isEnabled ? <ToggleRight className="w-7 h-7 text-emerald-400" /> : <ToggleLeft className="w-7 h-7 text-foreground" />}
            </button>
          </div>

          <div className="space-y-2">
            <div className="rounded-card bg-primary/5 border border-primary/10 px-3 py-2">
              <div className="typo-caption text-foreground"><DebtText k="auto_total_cycles_bac636ac" /></div>
              <div className="typo-data-lg text-foreground">{s.policy?.totalCycles ?? 0}</div>
            </div>
            <div className="rounded-card bg-primary/5 border border-primary/10 px-3 py-2">
              <div className="typo-caption text-foreground">Promotions</div>
              <div className="typo-data-lg text-emerald-400">{s.policy?.totalPromotions ?? 0}</div>
            </div>
            <div className="rounded-card bg-primary/5 border border-primary/10 px-3 py-2">
              <div className="typo-caption text-foreground"><DebtText k="auto_last_cycle_delta_b3d9d914" /></div>
              <div className={`typo-data-lg ${lastDelta != null && lastDelta > 0 ? 'text-emerald-400' : lastDelta != null && lastDelta < 0 ? 'text-red-400' : 'text-foreground'}`}>
                {lastDelta != null ? `${lastDelta > 0 ? '+' : ''}${(lastDelta * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div className={`rounded-card px-3 py-2 border ${s.eligible ? 'bg-amber-500/10 border-amber-500/25 text-amber-400' : 'bg-primary/5 border-primary/10 text-foreground'}`}>
              <div className="typo-caption">Status</div>
              <div className="typo-body font-medium">
                {s.eligible ? t.agents.lab.ready_label : t.agents.lab.waiting_label}
              </div>
            </div>
          </div>

          <button
            onClick={s.handleTriggerCycle}
            disabled={s.isTriggering}
            className="mt-3 flex items-center justify-center gap-2 px-3 py-2.5 typo-body font-medium rounded-card bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-40 focus-ring"
          >
            {s.isTriggering ? <><Loader2 className="w-4 h-4 animate-spin" /> <DebtText k="auto_evolving_416d12e5" /></> : <><Play className="w-4 h-4" /> <DebtText k="auto_trigger_generation_06fe1d47" /></>}
          </button>
        </div>
      </div>

      {/* Mutation lab tray */}
      <details className="group rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
        <summary className="flex items-center justify-between gap-2 cursor-pointer select-none px-3 py-2.5 hover:bg-secondary/25">
          <span className="flex items-center gap-2 typo-heading text-foreground">
            <FlaskConical className="w-4 h-4 text-violet-400" />
            <DebtText k="auto_mutation_lab_b38885e8" />
          </span>
          <ChevronDown className="w-4 h-4 text-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-primary/8">
          <ObjectiveSliders objective={s.objective} setObjective={s.setObjective} />
          <div className="grid grid-cols-2 gap-3">
            <SliderField id="lin-mutation" label="Mutation rate" value={s.mutationRate} onChange={s.setMutationRate} min={5} max={50} />
            <NumberSelect id="lin-variants" label="Variants per cycle" value={s.variants} onChange={s.setVariants} options={[2, 3, 4, 5, 6, 8]} />
            <SliderField id="lin-threshold" label="Improvement threshold" value={s.threshold} onChange={s.setThreshold} min={1} max={20} />
            <NumberSelect id="lin-execs" label="Min executions between" value={s.minExecs} onChange={s.setMinExecs} options={[3, 5, 10, 15, 20, 30, 50]} />
          </div>
          <button
            onClick={s.handleSaveSettings}
            disabled={s.isSaving}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 typo-body font-medium rounded-card bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 focus-ring"
          >
            {s.isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {t.agents.lab.save_settings}
          </button>
        </div>
      </details>
    </div>
  );
}

function ObjectiveSliders({ objective, setObjective }: { objective: FitnessObjective; setObjective: (o: FitnessObjective) => void }) {
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

function SliderField({ id, label, value, onChange, min, max }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <div>
      <label htmlFor={id} className="typo-caption text-foreground">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <input id={id} type="range" min={min} max={max} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="flex-1 h-1 accent-violet-500" />
        <span className="typo-caption text-foreground w-9 text-right">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

function NumberSelect({ id, label, value, onChange, options }: { id: string; label: string; value: number; onChange: (n: number) => void; options: number[] }) {
  return (
    <div>
      <label htmlFor={id} className="typo-caption text-foreground">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full typo-body bg-primary/5 border border-primary/10 rounded-input px-2 py-1 text-foreground focus-ring"
      >
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
}
