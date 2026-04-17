import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { GenomeBreedingResult } from '@/lib/bindings/GenomeBreedingResult';
import { useTranslation } from '@/i18n/useTranslation';

interface GenerationStats {
  generation: number;
  avgFitness: number;
  bestFitness: number;
  worstFitness: number;
  count: number;
  bestId: string;
}

function computeGenerationStats(results: GenomeBreedingResult[]): GenerationStats[] {
  const byGen = new Map<number, GenomeBreedingResult[]>();
  for (const r of results) {
    const list = byGen.get(r.generation) ?? [];
    list.push(r);
    byGen.set(r.generation, list);
  }

  const stats: GenerationStats[] = [];
  for (const [gen, items] of byGen) {
    const fitnesses = items
      .map((r) => r.fitnessOverall ?? 0)
      .filter((f) => f > 0);

    if (fitnesses.length === 0) {
      stats.push({
        generation: gen,
        avgFitness: 0,
        bestFitness: 0,
        worstFitness: 0,
        count: items.length,
        bestId: items[0]?.id ?? '',
      });
      continue;
    }

    const sorted = [...fitnesses].sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const worst = sorted[sorted.length - 1] ?? 0;
    const bestIdx = items.findIndex((r) => r.fitnessOverall === best);

    stats.push({
      generation: gen,
      avgFitness: fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length,
      bestFitness: best,
      worstFitness: worst,
      count: items.length,
      bestId: items[bestIdx]?.id ?? items[0]?.id ?? '',
    });
  }

  return stats.sort((a, b) => a.generation - b.generation);
}

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return <Minus className="w-3 h-3 text-foreground" />;
  if (diff > 0) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  return <TrendingDown className="w-3 h-3 text-red-400" />;
}

export function GenerationEvolutionChart({
  results,
  onSelectOffspring,
}: {
  results: GenomeBreedingResult[];
  onSelectOffspring?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const stats = useMemo(() => computeGenerationStats(results), [results]);

  if (stats.length === 0) return null;

  const maxFitness = Math.max(...stats.map((s) => s.bestFitness), 0.01);

  return (
    <div className="space-y-3" role="region" aria-label="Generation evolution chart">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground">{t.agents.lab.evolution_progress}</h4>
        <span className="text-xs text-foreground">
          {stats.length} generation{stats.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1.5 h-28" role="img" aria-label="Fitness progression across generations">
        {stats.map((gen, _idx) => {
          const bestHeight = maxFitness > 0 ? (gen.bestFitness / maxFitness) * 100 : 0;
          const avgHeight = maxFitness > 0 ? (gen.avgFitness / maxFitness) * 100 : 0;
          const worstHeight = maxFitness > 0 ? (gen.worstFitness / maxFitness) * 100 : 0;

          return (
            <button
              key={gen.generation}
              onClick={() => onSelectOffspring?.(gen.bestId)}
              className="flex-1 flex flex-col items-center gap-0.5 group cursor-pointer"
              aria-label={`Generation ${gen.generation}: best ${Math.round(gen.bestFitness * 100)}%, avg ${Math.round(gen.avgFitness * 100)}%`}
            >
              <div className="w-full flex items-end justify-center gap-px h-24 relative">
                {/* Worst (background) */}
                <div
                  className="animate-fade-in w-2 bg-red-500/20 rounded-t-sm" style={{ height: `${worstHeight}%` }}
                />
                {/* Average */}
                <div
                  className="animate-fade-in w-2 bg-amber-500/40 rounded-t-sm"
                  style={{ height: `${avgHeight}%` }}
                />
                {/* Best */}
                <div
                  className="animate-fade-in w-2 bg-violet-500 rounded-t-sm group-hover:bg-violet-400 transition-colors"
                  style={{ height: `${bestHeight}%` }}
                />

                {/* Tooltip on hover */}
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover border border-primary/15 rounded-input px-2 py-1 text-xs whitespace-nowrap z-10 shadow-elevation-3">
                  Best: {Math.round(gen.bestFitness * 100)}% | Avg: {Math.round(gen.avgFitness * 100)}%
                </div>
              </div>
              <span className="text-[10px] text-foreground">G{gen.generation}</span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 justify-center">
        <span className="flex items-center gap-1 text-[10px] text-foreground">
          <span className="w-2 h-2 rounded-interactive bg-violet-500 inline-block" /> {t.agents.lab.best_legend}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-foreground">
          <span className="w-2 h-2 rounded-interactive bg-amber-500/40 inline-block" /> {t.agents.lab.avg_legend}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-foreground">
          <span className="w-2 h-2 rounded-interactive bg-red-500/20 inline-block" /> {t.agents.lab.worst_legend}
        </span>
      </div>

      {/* Generation summary row */}
      {stats.length > 1 && (() => {
        const first = stats[0]!;
        const last = stats[stats.length - 1]!;
        return (
          <div className="flex items-center gap-3 text-xs text-foreground border-t border-primary/5 pt-2">
            <div className="flex items-center gap-1">
              <TrendIndicator
                current={last.bestFitness}
                previous={first.bestFitness}
              />
              <span>
                {first.bestFitness > 0
                  ? `${Math.round(((last.bestFitness - first.bestFitness) / first.bestFitness) * 100)}% fitness change`
                  : 'No baseline fitness data'}
              </span>
            </div>
            <span className="text-foreground">|</span>
            <span>
              {results.length} total offspring
            </span>
          </div>
        );
      })()}
    </div>
  );
}
