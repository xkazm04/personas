import { useState, useMemo } from 'react';
import { Trophy, Target, FileText, Shield, DollarSign, Clock, TrendingUp, TrendingDown, Minus, MessageSquare, Lightbulb, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScoreFromRow, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { aggregateArenaResults, type ArenaModelAggregate } from '../../libs/labAggregation';
import { LabResultsSkeleton } from '../shared/LabResultsSkeleton';
import { useTranslation, type interpolate } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { scoreLabel } from '../shared/scoreLabel';
import { sanitizeRichSummary } from '@/lib/utils/sanitizers/sanitizeHtml';
import { DebtText } from '@/i18n/DebtText';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';


interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabArenaResult[];
  runId?: string;
  llmSummary?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, modelId: string, rating: number, feedback?: string) => void | boolean | Promise<void | boolean>;
  /** Results fetch is still in flight — show the shape-matched skeleton instead of the empty line. */
  loading?: boolean;
}

function scoreBg(score: number): string {
  if (score >= 80) return 'from-emerald-500/20 to-emerald-500/5';
  if (score >= 60) return 'from-blue-500/20 to-blue-500/5';
  if (score >= 40) return 'from-amber-500/20 to-amber-500/5';
  return 'from-red-500/20 to-red-500/5';
}

function ScoreBar({ value, label, icon: Icon }: { value: number | null; label: string; icon: typeof Target }) {
  if (value == null) {
    // Never scored (sandbox runs carry no tool accuracy): show it as absent, not a red 0.
    return (
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 typo-caption text-ink-2">
          <Icon className="w-3 h-3" />{label}
        </span>
        <span className="typo-caption text-ink-2">{'–'}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 typo-caption text-ink-2">
          <Icon className="w-3 h-3" />{label}
        </span>
        <span className={`typo-caption ${scoreColor(value)}`}>{value}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-1 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${value >= 80 ? 'bg-status-success/70' : value >= 50 ? 'bg-status-warning/70' : 'bg-status-error/60'}`}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </div>
    </div>
  );
}

function buildSummary(
  t: Translations,
  tx: typeof interpolate,
  aggregates: ArenaModelAggregate[],
  scenarios: string[],
): string {
  if (aggregates.length === 0) return '';
  const best = aggregates[0];
  if (!best) return '';
  const worst = aggregates[aggregates.length - 1]!;
  const gap = best.compositeScore - worst.compositeScore;

  const vars = { model: best.modelId, score: best.compositeScore, count: scenarios.length, worst: worst.modelId, gap };
  let summary = aggregates.length > 1 && gap > 0
    ? tx(t.agents.lab.arena_summary_best_gap, vars)
    : tx(t.agents.lab.arena_summary_best, vars);

  if (best.avgOutputQuality >= 60) {
    summary += ` ${tx(t.agents.lab.arena_summary_quality, { label: scoreLabel(t, best.avgOutputQuality), score: best.avgOutputQuality })}`;
  }
  if (best.toolAccuracyScored && best.avgToolAccuracy < 30 && best.avgOutputQuality > 40) {
    summary += ` ${t.agents.lab.arena_summary_tools_limited}`;
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
      // Rows with no scoring signal sort last (-1) but stay visible — they
      // still have a rationale worth showing.
      const comp = compositeScoreFromRow(r.toolAccuracyScore, r.outputQualityScore, r.protocolCompliance) ?? -1;
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

export function ArenaResultsView({ results, runId: _runId, llmSummary, userRatings, onRate, loading }: Props) {
  const { t, tx } = useTranslation();
  const { models, scenarios, matrix, aggregates, bestModelId } = useMemo(
    () => aggregateArenaResults(results),
    [results],
  );
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; model: string } | null>(null);

  const summary = useMemo(() => buildSummary(t, tx, aggregates, scenarios), [t, tx, aggregates, scenarios]);
  const topRationale = useMemo(() => collectTopRationale(results), [results]);
  const topSuggestions = useMemo(() => collectTopSuggestions(results), [results]);

  if (results.length === 0) {
    if (loading) return <LabResultsSkeleton />;
    return (
      <div className="text-center py-12 text-ink-1 typo-body">
        {t.agents.lab.no_results}
      </div>
    );
  }

  const selectedResult = selectedCell ? matrix[selectedCell.scenario]?.[selectedCell.model] : null;

  return (
    <div className="space-y-6">
      {/* Executive summary */}
      <div className="rounded-modal border border-hair bg-surface-1 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-card bg-surface-1 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h4 className="typo-heading text-ink-1">{t.agents.lab.test_summary}</h4>
              <p className="typo-caption text-ink-2">{scenarios.length} <DebtText k="auto_scenarios_across_e82c5962" /> {models.length} models</p>
            </div>
          </div>
          {(llmSummary || summary) && (
            <p className="typo-body text-ink-1"
              dangerouslySetInnerHTML={{ __html: sanitizeRichSummary(llmSummary ?? summary ?? '') }}
            />
          )}
        </div>
      </div>

      {/* Model comparison cards */}
      <div className="space-y-3">
        <h4 className="typo-label text-ink-1 px-1">{t.agents.lab.model_performance}</h4>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(aggregates.length, 3)}, 1fr)` }}>
          {aggregates.map((agg, idx) => {
            const isWinner = agg.modelId === bestModelId;
            return (
              <div
                key={agg.modelId}
                className={`rounded-modal border overflow-hidden transition-all animate-fade-slide-in ${
                  isWinner
                    ? 'border-primary/25 shadow-elevation-3 shadow-primary/5'
                    : 'border-hair'
                }`}
                style={{ animationDelay: `${idx * 60}ms`, animationDuration: '300ms' }}
              >
                {/* Card header gradient */}
                <div className={`px-4 py-3 bg-surface-1 ${isWinner ? '' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`typo-heading-lg ${isWinner ? 'text-primary' : 'text-ink-1'}`}>
                        #{idx + 1}
                      </span>
                      <span className="typo-heading text-ink-1 capitalize">{agg.modelId}</span>
                    </div>
                    {isWinner && (
                      <span className="flex items-center gap-1 typo-eyebrow text-primary">
                        <Trophy className="w-2.5 h-2.5" /> {t.agents.lab.best_badge}
                      </span>
                    )}
                  </div>
                </div>

                {/* Score section */}
                <div className="px-4 py-3 space-y-3 bg-background/40">
                  {/* Big composite score */}
                  <div className={`flex items-center gap-3 p-3 rounded-card bg-gradient-to-r ${scoreBg(agg.compositeScore)}`}>
                    <span className={`typo-hero ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`typo-caption ${scoreColor(agg.compositeScore)}`}>{scoreLabel(t, agg.compositeScore)}</span>
                      <p className="typo-caption text-ink-2"><DebtText k="auto_composite_score_b7a389bd" /></p>
                    </div>
                    {idx > 0 && aggregates[0] && (
                      <div className="flex items-center gap-0.5 typo-caption text-ink-2">
                        {agg.compositeScore < aggregates[0].compositeScore
                          ? <><TrendingDown className="w-3 h-3 text-status-error" aria-hidden="true" /><span>-{aggregates[0].compositeScore - agg.compositeScore}</span></>
                          : agg.compositeScore > aggregates[0].compositeScore
                            ? <><TrendingUp className="w-3 h-3 text-status-success" aria-hidden="true" /><span>+{agg.compositeScore - aggregates[0].compositeScore}</span></>
                            : <><Minus className="w-3 h-3" aria-hidden="true" /><span>{t.agents.lab.tied}</span></>
                        }
                      </div>
                    )}
                  </div>

                  {/* Individual score bars */}
                  <div className="space-y-2">
                    <ScoreBar value={agg.toolAccuracyScored ? agg.avgToolAccuracy : null} label="Tool Usage" icon={Target} />
                    <ScoreBar value={agg.avgOutputQuality} label="Output Quality" icon={FileText} />
                    <ScoreBar value={agg.avgProtocolCompliance} label="Protocol" icon={Shield} />
                  </div>

                  {/* Cost & duration */}
                  <div className="flex items-center gap-3 pt-1 border-t border-hair typo-caption text-ink-2">
                    <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /><Numeric value={agg.totalCost} precision={4} /></span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /><Numeric value={agg.avgDuration / 1000} precision={1} /><DebtText k="auto_s_avg_eaee6bda" /></span>
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
            <ChevronDown className="w-3.5 h-3.5 text-ink-1 transition-transform group-open:rotate-180" />
            <h4 className="typo-label text-ink-1">{t.agents.lab.insights_suggestions}</h4>
          </summary>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {topRationale.length > 0 && (
              <div className="rounded-modal border border-hair bg-surface-1 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-hair bg-surface-1">
                  <h4 className="flex items-center gap-1.5 typo-label text-ink-1">
                    <MessageSquare className="w-3 h-3" /> {t.agents.lab.evaluation_insights}
                  </h4>
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {topRationale.map((r, i) => (
                    <div key={i} className="typo-body">
                      <span className="typo-caption text-ink-2 uppercase">{r.model} — {r.scenario}</span>
                      <p className="text-ink-1 mt-0.5">{r.rationale.length > 200 ? r.rationale.slice(0, 200) + '...' : r.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {topSuggestions.length > 0 && (
              <div className="rounded-modal border border-status-warning/10 bg-status-warning/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-status-warning/10 bg-status-warning/[0.05]">
                  <h4 className="flex items-center gap-1.5 typo-label text-status-warning">
                    <Lightbulb className="w-3 h-3" /> {t.agents.lab.improvement_suggestions}
                  </h4>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {topSuggestions.map((s, i) => (
                    <p key={i} className="typo-body text-ink-1">
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
          <h4 className="typo-label text-ink-1">{t.agents.lab.scenario_breakdown}</h4>
          <span className="typo-caption text-ink-2">{t.agents.lab.click_cell_details}</span>
        </div>
        <div data-virtual-scroll className="overflow-x-auto max-h-[70vh] overflow-y-auto border border-hair rounded-modal">
          <table className="w-full typo-body">
            <thead>
              <tr className="border-b border-hair bg-surface-1">
                <th className="text-left px-3 py-2.5 typo-eyebrow text-ink-1">{t.agents.lab.scenario_column}</th>
                {models.map((mid) => (
                  <th key={mid} className={`text-center px-3 py-2.5 typo-eyebrow ${mid === bestModelId ? 'text-primary/80' : 'text-ink-1'}`}>
                    <span className="inline-flex items-center justify-center gap-1">
                      {mid === bestModelId && <Trophy className="w-3 h-3" aria-label={t.agents.lab.best_badge} />}
                      {mid}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario, index) => (
                <>
                  <td className={`px-3 py-2.5 text-ink-1 typo-body max-w-[250px] truncate ${index % 2 === 1 ? 'bg-surface-1' : ''}`}>{scenario}</td>
                  {models.map((mid) => {
                    const r = matrix[scenario]?.[mid];
                    if (!r) return <td key={mid} className={`px-3 py-2.5 text-center text-ink-1 ${index % 2 === 1 ? 'bg-surface-1' : ''}`}>--</td>;
                    const ta = r.toolAccuracyScore;
                    const oq = r.outputQualityScore;
                    const pc = r.protocolCompliance;
                    const comp = compositeScoreFromRow(ta, oq, pc);
                    const cost = r.costUsd;
                    const dur = r.durationMs;
                    const isSelected = selectedCell?.scenario === scenario && selectedCell?.model === mid;
                    return (
                      <td key={mid} className={`px-3 py-1.5 ${index % 2 === 1 ? 'bg-surface-1' : ''} ${r.status === 'failed' || r.status === 'error' ? 'bg-status-error/5' : ''}`}>
                        <PressSurface
                          onPress={() => setSelectedCell(isSelected ? null : { scenario, model: mid })}
                          selected={isSelected}
                          className="w-full flex flex-col items-center gap-0.5 rounded-card px-2 py-1.5"
                        >
                          {r.status === 'running' || r.status === 'queued' || r.status === 'pending' ? (
                            <span className="flex items-center gap-1 typo-caption text-ink-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t.agents.lab.cell_running}
                            </span>
                          ) : r.status === 'failed' || r.status === 'error' ? (
                            <span className="flex items-center gap-1 typo-caption text-status-error">
                              <AlertTriangle className="w-3.5 h-3.5" /> {t.agents.lab.cell_failed}
                            </span>
                          ) : (
                            <>
                              <span className={`typo-body-lg ${scoreColor(comp)}`}>{comp ?? '—'}</span>
                              <div className="flex gap-2 typo-caption text-ink-2">
                                <span>TA {ta ?? '—'}</span>
                                <span>OQ {oq ?? '—'}</span>
                                <span>PC {pc ?? '—'}</span>
                              </div>
                              <div className="flex gap-2 typo-caption text-ink-2">
                                <span>$<Numeric value={cost} precision={4} /></span>
                                <span><Numeric value={dur / 1000} precision={1} />s</span>
                              </div>
                            </>
                          )}
                        </PressSurface>
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
              costUsd: selectedResult.costUsd,
              durationMs: selectedResult.durationMs,
              errorMessage: selectedResult.errorMessage,
              rationale: selectedResult.rationale ?? null,
              suggestions: selectedResult.suggestions ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            // The arena runner persists each cell's event stream and tool
            // calls under this result id (modes.rs insert_events_batch);
            // without these two props the panel never asked for them.
            resultId={selectedResult.id}
            resultKind="arena"
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.model, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
