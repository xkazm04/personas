import { useMemo } from 'react';
import { Dna, AlertTriangle, Sparkles, Link2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import {
  computeIdeaFitness,
  generateSynthesisSuggestions,
  findSimilarPairs,
} from './ideaEvolution';
import { fitnessColor, fitnessBar } from '../constants/ideaColors';

export function IdeaEvolutionPanel() {
  const ideas = useSystemStore((s) => s.ideas);

  const fitness = useMemo(() => computeIdeaFitness(ideas), [ideas]);
  const syntheses = useMemo(() => generateSynthesisSuggestions(ideas), [ideas]);
  const similarPairs = useMemo(() => findSimilarPairs(ideas, 0.5).slice(0, 5), [ideas]);

  const penalizedCount = fitness.filter((f) => f.rejectionPenalty > 0.2).length;
  const highFitness = fitness.filter((f) => f.finalFitness > 0.3);

  if (ideas.length < 2) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Dna className="w-4 h-4 text-violet-400" />
        <h3 className="text-md font-semibold uppercase tracking-wider text-primary">
          Idea Evolution
        </h3>
      </div>

      {/* Fitness ranking */}
      {fitness.length > 0 && (
        <div className="rounded-xl border border-primary/10 overflow-hidden">
          <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center justify-between">
            <span className="text-md font-medium text-foreground">Fitness Ranking</span>
            <div className="flex items-center gap-3 text-md text-foreground">
              <span className="text-emerald-400">{highFitness.length} high</span>
              {penalizedCount > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {penalizedCount} penalized
                </span>
              )}
            </div>
          </div>
          <div className="divide-y divide-primary/5">
            {fitness.slice(0, 8).map((f) => (
              <div key={f.idea.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-md text-foreground truncate">{f.idea.title}</p>
                  {f.similarRejections.length > 0 && (
                    <p className="text-md text-red-400/60 truncate">
                      Similar to rejected: {f.similarRejections[0]}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {f.rejectionPenalty > 0.2 && (
                    <span className="text-md text-red-400">-{Math.round(f.rejectionPenalty * 100)}%</span>
                  )}
                  <div className="w-16 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${fitnessBar(f.finalFitness)}`}
                      style={{ width: `${Math.max(5, (f.finalFitness + 1) * 50)}%` }}
                    />
                  </div>
                  <span className={`text-md font-medium w-10 text-right ${fitnessColor(f.finalFitness)}`}>
                    {f.finalFitness.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Synthesis suggestions */}
      {syntheses.length > 0 && (
        <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span className="text-md font-medium text-foreground">Synthesis Suggestions</span>
          </div>
          {syntheses.map((s, i) => (
            <div key={i} className="rounded-lg border border-violet-500/10 bg-background/30 p-3">
              <p className="text-md font-medium text-foreground">{s.suggestedTitle}</p>
              <p className="text-md text-foreground mt-1">{s.reasoning}</p>
              <div className="flex items-center gap-2 mt-2 text-md text-violet-400/60">
                <Link2 className="w-3 h-3" />
                {s.parentA.title.slice(0, 30)} + {s.parentB.title.slice(0, 30)}
                <span className="text-foreground ml-auto">{Math.round(s.similarity * 100)}% similar</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate detection */}
      {similarPairs.length > 0 && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-md font-medium text-foreground">Potential Duplicates</span>
          </div>
          {similarPairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-2 text-md text-foreground">
              <span className="truncate flex-1">{pair.ideaA.title}</span>
              <span className="text-amber-400 flex-shrink-0">{Math.round(pair.similarity * 100)}%</span>
              <span className="truncate flex-1">{pair.ideaB.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
