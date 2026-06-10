import { useState, useCallback } from 'react';
import { Dna, RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { listCompetitions, getCompetition } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import { parseGenesFromPrompt, type StrategyGenes } from './strategyPresets';

/**
 * On-demand "what wins here" analysis: across the project's resolved
 * competitions, recover each winner's genes (parsed from its stored strategy
 * prompt) and average them, so the user sees the emphasis profile that tends
 * to win. Button-triggered to avoid an N+1 detail fetch on every tab open.
 */
export function WinningGeneProfile({ projectId }: { projectId: string }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [result, setResult] = useState<{ avg: StrategyGenes; sample: number } | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    try {
      const comps = await listCompetitions(projectId, 'resolved');
      const genesList: StrategyGenes[] = [];
      for (const c of comps) {
        const detail = await getCompetition(c.id);
        const winner = detail.slots.find((s) => s.slot.task_id === detail.competition.winner_task_id)?.slot;
        const g = winner?.strategy_prompt ? parseGenesFromPrompt(winner.strategy_prompt) : null;
        if (g) genesList.push(g);
      }
      if (genesList.length === 0) {
        setResult(null);
      } else {
        const keys = Object.keys(genesList[0]!) as (keyof StrategyGenes)[];
        const avg = {} as StrategyGenes;
        for (const k of keys) avg[k] = genesList.reduce((a, g) => a + g[k], 0) / genesList.length;
        setResult({ avg, sample: genesList.length });
      }
      setAnalyzed(true);
    } catch (err) {
      setResult(null);
      setAnalyzed(true);
      silentCatch('WinningGeneProfile:analyze')(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  return (
    <div className="rounded-card border border-primary/15 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Dna className="w-4 h-4 text-violet-400" />
        <h4 className="typo-section-title">{dl.winning_genes_title}</h4>
        {result && (
          <span className="typo-caption text-foreground">{tx(dl.winning_genes_sample, { count: result.sample })}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={loading}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          onClick={analyze}
        >
          {dl.winning_genes_analyze}
        </Button>
      </div>

      {analyzed && !result && (
        <p className="typo-caption text-foreground">{dl.winning_genes_empty}</p>
      )}

      {result && (
        <div className="space-y-1.5">
          {(Object.keys(result.avg) as (keyof StrategyGenes)[]).map((k) => {
            const v = result.avg[k];
            const color = v >= 6.5 ? 'bg-emerald-400' : v <= 3.5 ? 'bg-amber-400' : 'bg-primary/40';
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="typo-caption text-foreground w-28 shrink-0 truncate capitalize">
                  {k.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <div className="flex-1 h-2 bg-background/60 rounded-full overflow-hidden">
                  <div className={`h-full ${color} transition-all`} style={{ width: `${(v / 10) * 100}%` }} />
                </div>
                <span className="typo-caption text-foreground w-8 text-right shrink-0 tabular-nums">{v.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
