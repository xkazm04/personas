import { Trophy, Target, FileText, Shield, DollarSign, Clock } from 'lucide-react';
import { scoreColor } from '@/lib/eval/evalFramework';
import type { VersionAggregate } from '../../libs/evalAggregation';
import { useTranslation } from '@/i18n/useTranslation';

interface EvalVersionCardsProps {
  versionAggs: VersionAggregate[];
  winnerId: string | null;
  celebrateWinnerId: string | null;
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Weak';
  return 'Poor';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'from-emerald-500/20 to-emerald-500/5';
  if (score >= 60) return 'from-blue-500/20 to-blue-500/5';
  if (score >= 40) return 'from-amber-500/20 to-amber-500/5';
  return 'from-red-500/20 to-red-500/5';
}

function ScoreBar({ value, label, icon: Icon }: { value: number; label: string; icon: typeof Target }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Icon className="w-3 h-3" />{label}
        </span>
        <span className={`text-xs font-semibold ${scoreColor(value)}`}>{value}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-primary/5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${value >= 80 ? 'bg-emerald-500/70' : value >= 50 ? 'bg-amber-500/70' : 'bg-red-500/60'}`}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </div>
    </div>
  );
}

export function EvalVersionCards({ versionAggs, winnerId, celebrateWinnerId }: EvalVersionCardsProps) {
  const { t } = useTranslation();
  const colors = [
    { gradient: 'from-blue-500/15 via-blue-500/10 to-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', bg: 'bg-blue-500/15' },
    { gradient: 'from-violet-500/15 via-violet-500/10 to-violet-500/5', border: 'border-violet-500/20', text: 'text-violet-400', bg: 'bg-violet-500/15' },
    { gradient: 'from-emerald-500/15 via-emerald-500/10 to-emerald-500/5', border: 'border-emerald-500/20', text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    { gradient: 'from-amber-500/15 via-amber-500/10 to-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-400', bg: 'bg-amber-500/15' },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">{t.agents.lab.version_performance}</h4>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(versionAggs.length, 4)}, 1fr)` }}>
        {versionAggs.map((agg, idx) => {
          const isWinner = agg.versionId === winnerId;
          const c = colors[idx % colors.length]!;
          return (
            <div key={agg.versionId} data-testid={`eval-version-card-${agg.versionNumber}`}
              className={`rounded-xl border overflow-hidden transition-all animate-fade-slide-in ${
                isWinner
                  ? `${c.border} shadow-elevation-3 shadow-primary/5 ${celebrateWinnerId === agg.versionId ? 'ring-1 ring-primary/20' : ''}`
                  : 'border-primary/10'
              }`}
              style={{ animationDelay: `${idx * 60}ms`, animationDuration: '300ms' }}>
              {/* Card header */}
              <div className={`px-4 py-2.5 bg-gradient-to-r ${isWinner ? c.gradient : 'from-secondary/40 to-secondary/20'}`}>
                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 rounded-md text-sm font-mono font-bold ${c.bg} ${c.text}`}>v{agg.versionNumber}</span>
                  {isWinner && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-2.5 h-2.5" /> {t.agents.lab.best_badge}
                    </span>
                  )}
                </div>
              </div>

              {/* Scores */}
              <div className="px-4 py-3 space-y-3 bg-background/40">
                <div className={`flex items-center gap-3 p-2.5 rounded-lg bg-gradient-to-r ${scoreBg(agg.compositeScore)}`}>
                  <span className={`text-2xl font-black tracking-tight ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                  <div>
                    <span className={`text-xs font-semibold ${scoreColor(agg.compositeScore)}`}>{scoreLabel(agg.compositeScore)}</span>
                    <p className="text-[10px] text-muted-foreground/50">Composite</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <ScoreBar value={agg.avgToolAccuracy} label="Tool Usage" icon={Target} />
                  <ScoreBar value={agg.avgOutputQuality} label="Output Quality" icon={FileText} />
                  <ScoreBar value={agg.avgProtocolCompliance} label="Protocol" icon={Shield} />
                </div>

                <div className="flex items-center gap-3 pt-1 border-t border-primary/5 text-[11px] text-muted-foreground/50">
                  <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{agg.totalCost.toFixed(4)}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(agg.avgDuration / 1000).toFixed(1)}s avg</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
