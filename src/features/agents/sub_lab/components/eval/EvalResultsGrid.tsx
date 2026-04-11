import { useMemo, useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Grid3X3, ChevronDown, MessageSquare, Lightbulb } from 'lucide-react';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { buildEvalGridData, type VersionAggregate } from '../../libs/evalAggregation';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { EvalVersionCards } from './EvalVersionCards';
import { EvalRadarChart } from './EvalRadarChart';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabEvalResult[];
  runId?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, key: string, rating: number, feedback?: string) => void;
}

function parseVerdict(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { verdict?: string; summary?: string };
    return parsed.verdict ?? parsed.summary ?? raw;
  } catch { return raw; }
}

function buildSummary(versionAggs: VersionAggregate[], winnerId: string | null, scenarioCount: number): string {
  if (versionAggs.length === 0) return '';
  const winner = versionAggs.find(a => a.versionId === winnerId) ?? versionAggs[0];
  if (!winner) return '';

  let text = `**Version ${winner.versionNumber}** leads with a composite score of **${winner.compositeScore}/100** across ${scenarioCount} scenarios`;
  if (versionAggs.length > 1) {
    const others = versionAggs.filter(a => a.versionId !== winner.versionId);
    const otherScores = others.map(a => `v${a.versionNumber}: ${a.compositeScore}`).join(', ');
    text += ` (${otherScores})`;
  }
  text += '.';

  if (winner.avgToolAccuracy < 30) {
    text += ' Tool usage is critically low — the persona may not be calling available tools.';
  }
  if (winner.avgOutputQuality < 40) {
    text += ' Output quality needs improvement — responses lack key content or formatting.';
  }
  return text;
}

function collectTopInsights(results: LabEvalResult[], limit = 3): Array<{ label: string; text: string }> {
  const items: Array<{ label: string; text: string; score: number }> = [];
  for (const r of results) {
    if (r.rationale) {
      const verdict = parseVerdict(r.rationale);
      const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
      items.push({ label: `v${r.versionNumber} / ${r.modelId} — ${r.scenarioName}`, text: verdict, score: comp });
    }
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}

function collectSuggestions(results: LabEvalResult[], limit = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    if (r.suggestions && !seen.has(r.suggestions)) {
      seen.add(r.suggestions);
      out.push(r.suggestions);
    }
  }
  return out.slice(0, limit);
}

export function EvalResultsGrid({ results, runId: _runId, userRatings, onRate }: Props) {
  const { t } = useTranslation();
  const [celebrateWinnerId, setCelebrateWinnerId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; versionId: string; modelId: string } | null>(null);
  const { shouldAnimate } = useMotion();

  const { versionAggs, versions, models, grid, winnerId } = useMemo(
    () => buildEvalGridData(results),
    [results],
  );

  const { scenarios, scenarioMatrix } = useMemo(() => {
    const scenarioSet = new Set<string>();
    const sm: Record<string, Record<string, Record<string, LabEvalResult>>> = {};
    for (const r of results) {
      scenarioSet.add(r.scenarioName);
      if (!sm[r.scenarioName]) sm[r.scenarioName] = {};
      if (!sm[r.scenarioName]![r.versionId]) sm[r.scenarioName]![r.versionId] = {};
      sm[r.scenarioName]![r.versionId]![r.modelId] = r;
    }
    return { scenarios: [...scenarioSet], scenarioMatrix: sm };
  }, [results]);

  const summary = useMemo(() => buildSummary(versionAggs, winnerId, scenarios.length), [versionAggs, winnerId, scenarios.length]);
  const insights = useMemo(() => collectTopInsights(results), [results]);
  const suggestions = useMemo(() => collectSuggestions(results), [results]);

  const selectedResult = selectedCell
    ? scenarioMatrix[selectedCell.scenario]?.[selectedCell.versionId]?.[selectedCell.modelId]
    : null;

  useEffect(() => {
    if (!shouldAnimate) { setCelebrateWinnerId(null); return; }
    if (!winnerId) return;
    setCelebrateWinnerId(winnerId);
    const timer = window.setTimeout(() => {
      setCelebrateWinnerId((prev) => (prev === winnerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [winnerId, shouldAnimate]);

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground/60 text-sm" data-testid="eval-results-empty">
        {t.agents.lab.no_results}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="eval-results-grid">
      {/* Summary */}
      <div className="rounded-xl border border-primary/10 bg-gradient-to-br from-secondary/40 to-background/20 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-violet-500/20 flex items-center justify-center">
              <Grid3X3 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground/90">{t.agents.lab.eval_summary}</h4>
              <p className="text-xs text-muted-foreground/50">{versions.length} versions x {models.length} models x {scenarios.length} scenarios</p>
            </div>
          </div>
          {summary && (
            <p className="text-sm text-foreground/75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: summary.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground/90">$1</strong>') }}
            />
          )}
        </div>
      </div>

      <EvalVersionCards versionAggs={versionAggs} winnerId={winnerId} celebrateWinnerId={celebrateWinnerId} />
      <EvalRadarChart versionAggs={versionAggs} />

      {/* Insights + Suggestions */}
      {(insights.length > 0 || suggestions.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {insights.length > 0 && (
            <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-primary/5 bg-secondary/30">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  <MessageSquare className="w-3 h-3" /> {t.agents.lab.evaluation_insights}
                </h4>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                {insights.map((r, i) => (
                  <div key={i} className="text-sm leading-relaxed">
                    <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase">{r.label}</span>
                    <p className="text-foreground/70 mt-0.5">{r.text.length > 200 ? r.text.slice(0, 200) + '...' : r.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-amber-500/10 bg-amber-500/[0.05]">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-amber-400/70 uppercase tracking-wider">
                  <Lightbulb className="w-3 h-3" /> {t.agents.lab.improvement_suggestions}
                </h4>
              </div>
              <div className="px-4 py-3 space-y-2">
                {suggestions.map((s, i) => (
                  <p key={i} className="text-sm text-foreground/70 leading-relaxed">
                    {s.length > 200 ? s.slice(0, 200) + '...' : s}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Version x Model matrix */}
      <details className="group" open>
        <summary className="flex items-center gap-2 cursor-pointer select-none px-1">
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 transition-transform group-open:rotate-180" />
          <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">{t.agents.lab.version_model_matrix}</h4>
        </summary>
        <div className="mt-3 overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm" data-testid="eval-matrix-table">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/20">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">Version</th>
                {models.map((m) => (
                  <th key={m} className="text-center px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">{m}</th>
                ))}
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">Avg</th>
              </tr>
            </thead>
            <VirtualizedTableBody
              items={versions}
              rowKey={(vId) => vId}
              renderRow={(vId) => {
                const agg = versionAggs.find((a) => a.versionId === vId);
                return (
                  <>
                    <td className="px-3 py-2.5 font-medium">
                      <span className="font-mono text-foreground/80">v{agg?.versionNumber}</span>
                    </td>
                    {models.map((mId) => {
                      const cell = grid[vId]?.[mId];
                      if (!cell || cell.count === 0) {
                        return <td key={mId} className="px-3 py-2.5 text-center text-muted-foreground/30">&mdash;</td>;
                      }
                      return (
                        <td key={mId} className="px-3 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${cell.compositeScore >= 60 ? 'bg-emerald-500/60' : cell.compositeScore >= 30 ? 'bg-amber-500/60' : 'bg-red-500/40'}`} />
                            <span className={`text-sm font-bold ${scoreColor(cell.compositeScore)}`}>{cell.compositeScore}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm font-bold ${scoreColor(agg?.compositeScore ?? 0)}`}>{agg?.compositeScore ?? 0}</span>
                    </td>
                  </>
                );
              }}
            />
          </table>
        </div>
      </details>

      {/* Scenario breakdown */}
      {scenarios.length > 0 && (
        <details className="group" open>
          <summary className="flex items-center gap-2 cursor-pointer select-none px-1">
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 transition-transform group-open:rotate-180" />
            <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">{t.agents.lab.scenario_breakdown}</h4>
            <span className="text-[10px] text-muted-foreground/30">{t.agents.lab.click_cell_details}</span>
          </summary>
          <div className="mt-3 overflow-x-auto border border-primary/10 rounded-xl">
            <table className="w-full text-sm" data-testid="eval-scenario-table">
              <thead>
                <tr className="border-b border-primary/10 bg-secondary/20">
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">Scenario</th>
                  {versions.map((vId) => {
                    const agg = versionAggs.find((a) => a.versionId === vId);
                    return models.map((mId) => (
                      <th key={`${vId}-${mId}`} className="text-center px-3 py-2.5 font-medium text-muted-foreground/60 text-xs">
                        <div className="uppercase tracking-wider">v{agg?.versionNumber}</div>
                        <div className="text-muted-foreground/40 normal-case">{mId}</div>
                      </th>
                    ));
                  })}
                </tr>
              </thead>
              <VirtualizedTableBody
                items={scenarios}
                rowKey={(s) => s}
                renderRow={(scenario) => (
                  <>
                    <td className="px-3 py-2.5 text-foreground/70 text-sm max-w-[250px] truncate">{scenario}</td>
                    {versions.map((vId) =>
                      models.map((mId) => {
                        const r = scenarioMatrix[scenario]?.[vId]?.[mId];
                        if (!r) return <td key={`${vId}-${mId}`} className="px-3 py-2.5 text-center text-muted-foreground/30">--</td>;
                        const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
                        const isSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === vId && selectedCell?.modelId === mId;
                        return (
                          <td key={`${vId}-${mId}`} className="px-3 py-1.5">
                            <button
                              onClick={() => setSelectedCell(isSelected ? null : { scenario, versionId: vId, modelId: mId })}
                              className={`w-full flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition-all ${
                                isSelected ? 'bg-primary/10 ring-1 ring-primary/25 shadow-elevation-1' : 'hover:bg-secondary/40'
                              }`}
                            >
                              <div className={`w-2 h-2 rounded-full ${comp >= 60 ? 'bg-emerald-500/60' : comp >= 30 ? 'bg-amber-500/60' : 'bg-red-500/40'}`} />
                              <span className={`text-sm font-semibold ${scoreColor(comp)}`}>{comp}</span>
                            </button>
                          </td>
                        );
                      })
                    )}
                  </>
                )}
              />
            </table>
          </div>
        </details>
      )}

      {/* Detail panel */}
      {selectedResult && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.versionId}::${selectedCell.modelId}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedCell.modelId,
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
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, `${selectedCell.versionId}::${selectedCell.modelId}`, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
