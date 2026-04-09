import { useState, useMemo } from 'react';
import { LabStaggerGroup, LabStaggerItem } from '../shared/LabStaggerGroup';
import { LabResultCard, LabResultCardHeader, LabResultCardBody, LabResultCardSectionHeader } from '../shared/LabResultCard';
import { Trophy, Target, FileText, Shield, DollarSign, Clock, ArrowRight, MessageSquare, Lightbulb, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { aggregateAbResults, type AbVersionAggregate } from '../../libs/labAggregation';
import { BORDER_DEFAULT } from '@/lib/utils/designTokens';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabAbResult[];
  runId?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, versionId: string, rating: number, feedback?: string) => void;
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

function buildSummary(aggs: AbVersionAggregate[], winnerId: string | null, scenarios: string[]): string {
  if (aggs.length < 2) return '';
  const winner = aggs.find(a => a.versionId === winnerId);
  const loser = aggs.find(a => a.versionId !== winnerId);
  if (!winner || !loser) return '';

  const gap = winner.compositeScore - loser.compositeScore;
  let text = `**Version ${winner.versionNumber}** scored **${winner.compositeScore}/100** overall`;

  if (gap > 0) {
    text += `, beating v${loser.versionNumber} by ${gap} points across ${scenarios.length} scenarios.`;
  } else {
    text += `. Both versions scored identically across ${scenarios.length} scenarios.`;
  }

  // Highlight dimension differences
  const oqDiff = winner.avgOutputQuality - loser.avgOutputQuality;
  const taDiff = winner.avgToolAccuracy - loser.avgToolAccuracy;
  if (Math.abs(oqDiff) > 10) {
    text += oqDiff > 0
      ? ` v${winner.versionNumber} produced notably higher quality output (+${oqDiff}).`
      : ` However, v${loser.versionNumber} had better output quality (+${Math.abs(oqDiff)}).`;
  }
  if (Math.abs(taDiff) > 10) {
    text += taDiff > 0
      ? ` v${winner.versionNumber} used tools more effectively (+${taDiff}).`
      : ` v${loser.versionNumber} had stronger tool usage (+${Math.abs(taDiff)}).`;
  }
  return text;
}

function parseVerdict(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { verdict?: string; summary?: string };
    return parsed.verdict ?? parsed.summary ?? raw;
  } catch { return raw; }
}

function collectTopRationale(results: LabAbResult[], limit = 3): Array<{ scenario: string; version: number; rationale: string }> {
  const items: Array<{ scenario: string; version: number; rationale: string; score: number }> = [];
  for (const r of results) {
    if (r.rationale) {
      const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
      items.push({ scenario: r.scenarioName, version: r.versionNumber, rationale: parseVerdict(r.rationale), score: comp });
    }
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}

function collectTopSuggestions(results: LabAbResult[], limit = 3): string[] {
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

const VERSION_COLORS = [
  { accent: 'blue', gradient: 'from-blue-500/15 via-blue-500/10 to-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', bg: 'bg-blue-500/15' },
  { accent: 'violet', gradient: 'from-violet-500/15 via-violet-500/10 to-violet-500/5', border: 'border-violet-500/20', text: 'text-violet-400', bg: 'bg-violet-500/15' },
] as const;

export function AbResultsView({ results, runId: _runId, userRatings, onRate }: Props) {
  const { versionAggs, scenarios, matrix, winnerId } = useMemo(
    () => aggregateAbResults(results),
    [results],
  );
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; versionId: string } | null>(null);

  const summary = useMemo(() => buildSummary(versionAggs, winnerId, scenarios), [versionAggs, winnerId, scenarios]);
  const topRationale = useMemo(() => collectTopRationale(results), [results]);
  const topSuggestions = useMemo(() => collectTopSuggestions(results), [results]);

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground/60 text-sm">
        No results to display
      </div>
    );
  }

  const selectedResults = selectedCell ? (matrix[selectedCell.scenario]?.[selectedCell.versionId] ?? []) : [];
  const selectedFirst = selectedResults[0] ?? null;
  const selectedVersion = selectedCell ? versionAggs.find((a) => a.versionId === selectedCell.versionId) : null;

  return (
    <div className="space-y-6">
      {/* Executive summary */}
      <LabResultCard className="bg-gradient-to-br from-secondary/40 to-background/20 backdrop-blur-sm">
        <LabResultCardHeader
          className="space-y-3"
          icon={<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 flex items-center justify-center"><Trophy className="w-4 h-4 text-primary" /></div>}
          title="A/B Test Summary"
          subtitle={`v${versionAggs[0]?.versionNumber} vs v${versionAggs[1]?.versionNumber} across ${scenarios.length} scenarios`}
        >
          {summary && (
            <p className="typo-body text-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: summary.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground">$1</strong>') }}
            />
          )}
        </LabResultCardHeader>
      </LabResultCard>

      {/* Head-to-head comparison */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-1">Head-to-Head</h4>
        <LabStaggerGroup className="grid grid-cols-[1fr_auto_1fr] gap-0 items-stretch">
          {versionAggs.map((agg, idx) => {
            const isWinner = agg.versionId === winnerId;
            const c = VERSION_COLORS[idx] ?? VERSION_COLORS[0]!;
            const other = versionAggs[1 - idx];

            return (
              <div key={agg.versionId} className="contents">
                {idx === 1 && (
                  <div className="flex items-center justify-center px-3">
                    <div className="flex flex-col items-center gap-1">
                      <span className="typo-caption font-bold text-muted-foreground/30 uppercase tracking-widest">vs</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/20 rotate-90" />
                    </div>
                  </div>
                )}
                <LabStaggerItem>
                  <LabResultCard
                    borderClass={isWinner ? c.border : undefined}
                    className={isWinner ? 'shadow-elevation-3 shadow-primary/5' : ''}
                  >
                    {/* Version header */}
                    <LabResultCardHeader className={`bg-gradient-to-r ${c.gradient}`}
                      trailing={isWinner ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                          <Trophy className="w-2.5 h-2.5" /> Winner
                        </span>
                      ) : undefined}
                    >
                      <span className={`px-2 py-0.5 rounded-md typo-body font-mono font-bold ${c.bg} ${c.text}`}>v{agg.versionNumber}</span>
                    </LabResultCardHeader>

                    {/* Scores */}
                    <LabResultCardBody className="space-y-3 bg-background/40">
                      <div className={`flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r ${scoreBg(agg.compositeScore)}`}>
                        <span className={`text-3xl font-black tracking-tight ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                        <div className="flex-1 min-w-0">
                          <span className={`typo-caption font-semibold ${scoreColor(agg.compositeScore)}`}>{scoreLabel(agg.compositeScore)}</span>
                          <p className="typo-caption text-muted-foreground/50">Composite Score</p>
                        </div>
                        {other && (
                          <div className="flex items-center gap-0.5 typo-caption text-muted-foreground/50">
                            {agg.compositeScore > other.compositeScore
                              ? <><TrendingUp className="w-3 h-3 text-emerald-400/60" /><span>+{agg.compositeScore - other.compositeScore}</span></>
                              : agg.compositeScore < other.compositeScore
                                ? <><TrendingDown className="w-3 h-3 text-red-400/60" /><span>{agg.compositeScore - other.compositeScore}</span></>
                                : <span>tied</span>
                            }
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <ScoreBar value={agg.avgToolAccuracy} label="Tool Usage" icon={Target} />
                        <ScoreBar value={agg.avgOutputQuality} label="Output Quality" icon={FileText} />
                        <ScoreBar value={agg.avgProtocolCompliance} label="Protocol" icon={Shield} />
                      </div>

                      <div className="flex items-center gap-3 pt-1 border-t border-primary/5 typo-body text-muted-foreground/50">
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{agg.totalCost.toFixed(4)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(agg.avgDuration / 1000).toFixed(1)}s avg</span>
                      </div>
                    </LabResultCardBody>
                  </LabResultCard>
                </LabStaggerItem>
              </div>
            );
          })}
        </LabStaggerGroup>
      </div>

      {/* Key insights */}
      {(topRationale.length > 0 || topSuggestions.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {topRationale.length > 0 && (
            <LabResultCard className="bg-secondary/20">
              <LabResultCardSectionHeader className="bg-secondary/30">
                <h4 className="flex items-center gap-1.5 typo-caption font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  <MessageSquare className="w-3 h-3" /> Evaluation Insights
                </h4>
              </LabResultCardSectionHeader>
              <LabResultCardBody className="space-y-2.5">
                {topRationale.map((r, i) => (
                  <div key={i} className="typo-body leading-relaxed">
                    <span className="typo-caption font-semibold text-muted-foreground/40 uppercase">v{r.version} — {r.scenario}</span>
                    <p className="text-foreground mt-0.5">{r.rationale.length > 200 ? r.rationale.slice(0, 200) + '...' : r.rationale}</p>
                  </div>
                ))}
              </LabResultCardBody>
            </LabResultCard>
          )}
          {topSuggestions.length > 0 && (
            <LabResultCard borderClass="border-amber-500/10" className="bg-amber-500/[0.03]">
              <LabResultCardSectionHeader className="bg-amber-500/[0.05] border-amber-500/10">
                <h4 className="flex items-center gap-1.5 typo-caption font-semibold text-amber-400/70 uppercase tracking-wider">
                  <Lightbulb className="w-3 h-3" /> Improvement Suggestions
                </h4>
              </LabResultCardSectionHeader>
              <LabResultCardBody className="space-y-2">
                {topSuggestions.map((s, i) => (
                  <p key={i} className="typo-body text-foreground leading-relaxed">
                    {s.length > 200 ? s.slice(0, 200) + '...' : s}
                  </p>
                ))}
              </LabResultCardBody>
            </LabResultCard>
          )}
        </div>
      )}

      {/* Scenario breakdown */}
      <details className="group" open>
        <summary className="flex items-center gap-2 cursor-pointer select-none px-1">
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 transition-transform group-open:rotate-180" />
          <h4 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">Scenario Breakdown</h4>
          <span className="typo-caption text-muted-foreground/30">Click a cell for details</span>
        </summary>
        <div className={`mt-3 overflow-x-auto border ${BORDER_DEFAULT} rounded-card`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${BORDER_DEFAULT} bg-secondary/20`}>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">Scenario</th>
                {versionAggs.map((agg, idx) => {
                  const c = VERSION_COLORS[idx] ?? VERSION_COLORS[0]!;
                  return (
                    <th key={agg.versionId} className={`text-center px-3 py-2.5 font-medium text-xs uppercase tracking-wider ${c.text}`}>
                      v{agg.versionNumber}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario) => (
                <>
                  <td className="px-3 py-2.5 text-foreground/70 text-sm max-w-[250px] truncate">{scenario}</td>
                  {versionAggs.map((agg) => {
                    const rows = matrix[scenario]?.[agg.versionId] ?? [];
                    if (rows.length === 0) return <td key={agg.versionId} className="px-3 py-2.5 text-center text-muted-foreground/30">--</td>;
                    const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / rows.length;
                    const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / rows.length;
                    const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / rows.length;
                    const comp = compositeScore(avgTA, avgOQ, avgPC);
                    const isSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === agg.versionId;
                    return (
                      <td key={agg.versionId} className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => setSelectedCell(isSelected ? null : { scenario, versionId: agg.versionId })}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all ${
                            isSelected ? 'bg-primary/10 ring-1 ring-primary/25 shadow-elevation-1' : 'hover:bg-secondary/40'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full ${comp >= 60 ? 'bg-emerald-500/60' : comp >= 30 ? 'bg-amber-500/60' : 'bg-red-500/40'}`} />
                          <span className={`text-sm font-semibold ${scoreColor(comp)}`}>{comp}</span>
                        </button>
                      </td>
                    );
                  })}
                </>
              )}
            />
          </table>
        </div>
      </details>

      {/* Detail panel */}
      {selectedFirst && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.versionId}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedVersion ? `v${selectedVersion.versionNumber}` : undefined,
              status: selectedFirst.status,
              toolAccuracyScore: selectedFirst.toolAccuracyScore,
              outputQualityScore: selectedFirst.outputQualityScore,
              protocolCompliance: selectedFirst.protocolCompliance,
              outputPreview: selectedFirst.outputPreview,
              toolCallsExpected: selectedFirst.toolCallsExpected,
              toolCallsActual: selectedFirst.toolCallsActual,
              costUsd: selectedFirst.costUsd,
              durationMs: selectedFirst.durationMs,
              errorMessage: selectedFirst.errorMessage,
              rationale: selectedFirst.rationale ?? null,
              suggestions: selectedFirst.suggestions ?? null,
              evalMethod: selectedFirst.evalMethod ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.versionId, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
