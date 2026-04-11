import { useState, useMemo } from 'react';
import { Trophy, Target, FileText, Shield, DollarSign, Clock, TrendingUp, TrendingDown, Minus, MessageSquare, Lightbulb, ChevronDown } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { aggregateArenaResults, type ArenaModelAggregate } from '../../libs/labAggregation';
import { useTranslation } from '@/i18n/useTranslation';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabArenaResult[];
  runId?: string;
  llmSummary?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, modelId: string, rating: number, feedback?: string) => void;
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

function buildSummary(aggregates: ArenaModelAggregate[], _bestModelId: string | null, scenarios: string[]): string {
  if (aggregates.length === 0) return '';
  const best = aggregates[0];
  if (!best) return '';
  const worst = aggregates[aggregates.length - 1]!;
  const gap = best.compositeScore - worst.compositeScore;

  let summary = `**${best.modelId}** achieved the highest composite score of **${best.compositeScore}/100** across ${scenarios.length} test scenarios`;

  if (aggregates.length > 1 && gap > 0) {
    summary += `, outperforming ${worst.modelId} by ${gap} points`;
  }
  summary += '.';

  if (best.avgOutputQuality >= 60) {
    summary += ` Output quality was ${scoreLabel(best.avgOutputQuality).toLowerCase()} (${best.avgOutputQuality}/100).`;
  }
  if (best.avgToolAccuracy < 30 && best.avgOutputQuality > 40) {
    summary += ' Tool usage was limited — the model relied more on its own knowledge than available tools.';
  }
  return summary;
}

function parseVerdict(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { verdict?: string; summary?: string };
    return parsed.verdict ?? parsed.summary ?? raw;
  } catch { return raw; }
}

function collectTopRationale(results: LabArenaResult[], limit = 3): Array<{ scenario: string; model: string; rationale: string }> {
  const items: Array<{ scenario: string; model: string; rationale: string; score: number }> = [];
  for (const r of results) {
    if (r.rationale) {
      const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
      items.push({ scenario: r.scenarioName, model: r.modelId, rationale: parseVerdict(r.rationale), score: comp });
    }
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}

function collectTopSuggestions(results: LabArenaResult[], limit = 3): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const r of results) {
    if (r.suggestions && !seen.has(r.suggestions)) {
      seen.add(r.suggestions);
      suggestions.push(r.suggestions);
    }
  }
  return suggestions.slice(0, limit);
}

export function ArenaResultsView({ results, runId: _runId, llmSummary, userRatings, onRate }: Props) {
  const { t } = useTranslation();
  const { models, scenarios, matrix, aggregates, bestModelId } = useMemo(
    () => aggregateArenaResults(results),
    [results],
  );
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; model: string } | null>(null);

  const summary = useMemo(() => buildSummary(aggregates, bestModelId, scenarios), [aggregates, bestModelId, scenarios]);
  const topRationale = useMemo(() => collectTopRationale(results), [results]);
  const topSuggestions = useMemo(() => collectTopSuggestions(results), [results]);

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground/60 text-sm">
        {t.agents.lab.no_results}
      </div>
    );
  }

  const selectedResult = selectedCell ? matrix[selectedCell.scenario]?.[selectedCell.model] : null;

  return (
    <div className="space-y-6">
      {/* Executive summary */}
      <div className="rounded-xl border border-primary/10 bg-gradient-to-br from-secondary/40 to-background/20 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground/90">{t.agents.lab.test_summary}</h4>
              <p className="text-xs text-muted-foreground/50">{scenarios.length} scenarios across {models.length} models</p>
            </div>
          </div>
          {(llmSummary || summary) && (
            <p className="text-sm text-foreground/75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: (llmSummary ?? summary ?? '').replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground/90">$1</strong>') }}
            />
          )}
        </div>
      </div>

      {/* Model comparison cards */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">{t.agents.lab.model_performance}</h4>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(aggregates.length, 3)}, 1fr)` }}>
          {aggregates.map((agg, idx) => {
            const isWinner = agg.modelId === bestModelId;
            return (
              <div
                key={agg.modelId}
                className={`rounded-xl border overflow-hidden transition-all animate-fade-slide-in ${
                  isWinner
                    ? 'border-primary/25 shadow-elevation-3 shadow-primary/5'
                    : 'border-primary/10'
                }`}
                style={{ animationDelay: `${idx * 60}ms`, animationDuration: '300ms' }}
              >
                {/* Card header gradient */}
                <div className={`px-4 py-3 bg-gradient-to-r ${isWinner ? 'from-primary/15 via-primary/10 to-accent/10' : 'from-secondary/40 to-secondary/20'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${isWinner ? 'text-primary' : 'text-muted-foreground/50'}`}>
                        #{idx + 1}
                      </span>
                      <span className="text-sm font-semibold text-foreground/90 capitalize">{agg.modelId}</span>
                    </div>
                    {isWinner && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                        <Trophy className="w-2.5 h-2.5" /> {t.agents.lab.best_badge}
                      </span>
                    )}
                  </div>
                </div>

                {/* Score section */}
                <div className="px-4 py-3 space-y-3 bg-background/40">
                  {/* Big composite score */}
                  <div className={`flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r ${scoreBg(agg.compositeScore)}`}>
                    <span className={`text-3xl font-black tracking-tight ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-semibold ${scoreColor(agg.compositeScore)}`}>{scoreLabel(agg.compositeScore)}</span>
                      <p className="text-[10px] text-muted-foreground/50">Composite Score</p>
                    </div>
                    {idx > 0 && aggregates[0] && (
                      <div className="flex items-center gap-0.5 text-xs text-muted-foreground/50">
                        {agg.compositeScore < aggregates[0].compositeScore
                          ? <><TrendingDown className="w-3 h-3 text-red-400/60" /><span>-{aggregates[0].compositeScore - agg.compositeScore}</span></>
                          : agg.compositeScore > aggregates[0].compositeScore
                            ? <><TrendingUp className="w-3 h-3 text-emerald-400/60" /><span>+{agg.compositeScore - aggregates[0].compositeScore}</span></>
                            : <><Minus className="w-3 h-3" /><span>{t.agents.lab.tied}</span></>
                        }
                      </div>
                    )}
                  </div>

                  {/* Individual score bars */}
                  <div className="space-y-2">
                    <ScoreBar value={agg.avgToolAccuracy} label="Tool Usage" icon={Target} />
                    <ScoreBar value={agg.avgOutputQuality} label="Output Quality" icon={FileText} />
                    <ScoreBar value={agg.avgProtocolCompliance} label="Protocol" icon={Shield} />
                  </div>

                  {/* Cost & duration */}
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

      {/* Key insights — rationale & suggestions (collapsible) */}
      {(topRationale.length > 0 || topSuggestions.length > 0) && (
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer select-none px-1">
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 transition-transform group-open:rotate-180" />
            <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">{t.agents.lab.insights_suggestions}</h4>
          </summary>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {topRationale.length > 0 && (
              <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-primary/5 bg-secondary/30">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    <MessageSquare className="w-3 h-3" /> {t.agents.lab.evaluation_insights}
                  </h4>
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {topRationale.map((r, i) => (
                    <div key={i} className="text-sm leading-relaxed">
                      <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase">{r.model} — {r.scenario}</span>
                      <p className="text-foreground/70 mt-0.5">{r.rationale.length > 200 ? r.rationale.slice(0, 200) + '...' : r.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {topSuggestions.length > 0 && (
              <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-amber-500/10 bg-amber-500/[0.05]">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/70 uppercase tracking-wider">
                    <Lightbulb className="w-3 h-3" /> {t.agents.lab.improvement_suggestions}
                  </h4>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {topSuggestions.map((s, i) => (
                    <p key={i} className="text-sm text-foreground/70 leading-relaxed">
                      {s.length > 200 ? s.slice(0, 200) + '...' : s}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Scenario breakdown */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">{t.agents.lab.scenario_breakdown}</h4>
          <span className="text-[10px] text-muted-foreground/30">{t.agents.lab.click_cell_details}</span>
        </div>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/20">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">Scenario</th>
                {models.map((mid) => (
                  <th key={mid} className={`text-center px-3 py-2.5 font-medium text-xs uppercase tracking-wider ${mid === bestModelId ? 'text-primary/80' : 'text-muted-foreground/60'}`}>
                    {mid}
                  </th>
                ))}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario, index) => (
                <>
                  <td className={`px-3 py-2.5 text-foreground/70 text-sm max-w-[250px] truncate ${index % 2 === 1 ? 'bg-secondary/10' : ''}`}>{scenario}</td>
                  {models.map((mid) => {
                    const r = matrix[scenario]?.[mid];
                    if (!r) return <td key={mid} className={`px-3 py-2.5 text-center text-muted-foreground/30 ${index % 2 === 1 ? 'bg-secondary/10' : ''}`}>--</td>;
                    const ta = r.toolAccuracyScore ?? 0;
                    const oq = r.outputQualityScore ?? 0;
                    const pc = r.protocolCompliance ?? 0;
                    const comp = compositeScore(ta, oq, pc);
                    const cost = r.costUsd ?? 0;
                    const dur = r.durationMs ?? 0;
                    const isSelected = selectedCell?.scenario === scenario && selectedCell?.model === mid;
                    return (
                      <td key={mid} className={`px-3 py-1.5 ${index % 2 === 1 ? 'bg-secondary/10' : ''}`}>
                        <button
                          onClick={() => setSelectedCell(isSelected ? null : { scenario, model: mid })}
                          className={`w-full flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition-all ${
                            isSelected
                              ? 'bg-primary/10 ring-1 ring-primary/25 shadow-elevation-1'
                              : 'hover:bg-secondary/40'
                          }`}
                        >
                          <span className={`text-base font-bold ${scoreColor(comp)}`}>{comp}</span>
                          <div className="flex gap-2 text-[10px] text-muted-foreground/60">
                            <span>TA {ta}</span>
                            <span>OQ {oq}</span>
                            <span>PC {pc}</span>
                          </div>
                          <div className="flex gap-2 text-[9px] text-muted-foreground/40">
                            <span>${cost.toFixed(4)}</span>
                            <span>{(dur / 1000).toFixed(1)}s</span>
                          </div>
                        </button>
                      </td>
                    );
                  })}
                </>
              )}
            />
          </table>
        </div>
      </div>

      {/* Scenario detail panel */}
      {selectedResult && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.model}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedCell.model,
              status: selectedResult.status,
              toolAccuracyScore: selectedResult.toolAccuracyScore,
              outputQualityScore: selectedResult.outputQualityScore,
              protocolCompliance: selectedResult.protocolCompliance,
              outputPreview: selectedResult.outputPreview,
              toolCallsExpected: selectedResult.toolCallsExpected,
              toolCallsActual: selectedResult.toolCallsActual,
              costUsd: selectedResult.costUsd,
              durationMs: selectedResult.durationMs,
              errorMessage: selectedResult.errorMessage,
              rationale: selectedResult.rationale ?? null,
              suggestions: selectedResult.suggestions ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.model, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
