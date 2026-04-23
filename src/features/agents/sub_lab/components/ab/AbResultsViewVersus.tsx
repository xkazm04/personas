// Versus variant of AbResultsView — "tale of the tape" boxing scorecard metaphor.
// Central vertical divider; each metric row extends left for v1 and right for v2,
// bar lengths proportional to the score. Scenario duels stack underneath as a
// fight card. Rationale + suggestions surface as corner commentary.
import { useMemo } from 'react';
import { Target, FileText, Shield, Swords, DollarSign, Clock, Crown, Megaphone } from 'lucide-react';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import type { AbVersionAggregate } from '../../libs/labAggregation';
import type { AbVariantProps } from './AbResultsView';

interface MetricRowSpec {
  label: string;
  icon: typeof Target;
  pick: (a: AbVersionAggregate) => number;
}

const METRICS: MetricRowSpec[] = [
  { label: 'Tool Usage', icon: Target, pick: (a) => a.avgToolAccuracy },
  { label: 'Output Quality', icon: FileText, pick: (a) => a.avgOutputQuality },
  { label: 'Protocol', icon: Shield, pick: (a) => a.avgProtocolCompliance },
];

function parseVerdict(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { verdict?: string; summary?: string };
    return parsed.verdict ?? parsed.summary ?? raw;
  } catch { return raw; }
}

function collectRationaleByVersion(results: LabAbResult[]): Map<string, Array<{ scenario: string; text: string }>> {
  const byVersion = new Map<string, Array<{ scenario: string; text: string }>>();
  for (const r of results) {
    if (!r.rationale) continue;
    if (!byVersion.has(r.versionId)) byVersion.set(r.versionId, []);
    byVersion.get(r.versionId)!.push({ scenario: r.scenarioName, text: parseVerdict(r.rationale) });
  }
  return byVersion;
}

function collectSuggestionsByVersion(results: LabAbResult[]): Map<string, string[]> {
  const byVersion = new Map<string, string[]>();
  for (const r of results) {
    if (!r.suggestions) continue;
    if (!byVersion.has(r.versionId)) byVersion.set(r.versionId, []);
    const list = byVersion.get(r.versionId)!;
    if (!list.includes(r.suggestions)) list.push(r.suggestions);
  }
  return byVersion;
}

function VersusHeader({ left, right, winnerId }: { left: AbVersionAggregate; right: AbVersionAggregate; winnerId: string | null }) {
  const gap = left.compositeScore - right.compositeScore;
  const absGap = Math.abs(gap);
  const leaningLeft = gap > 0;
  const leaningRight = gap < 0;
  const tied = gap === 0;

  return (
    <div className="relative rounded-modal overflow-hidden border border-primary/15 bg-gradient-to-br from-secondary/40 via-background/30 to-secondary/40">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-8">
        <VersusCorner agg={left} isWinner={left.versionId === winnerId} align="right" />
        <div className="flex flex-col items-center gap-2">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${
            tied ? 'border-primary/20 bg-primary/5' : 'border-primary/30 bg-gradient-to-br from-primary/15 to-primary/5 shadow-elevation-2 shadow-primary/10'
          }`}>
            <Swords className={`w-6 h-6 ${tied ? 'text-foreground/40' : 'text-primary'}`} />
          </div>
          {!tied && (
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              leaningLeft ? 'border-primary/25 bg-primary/10 text-primary -translate-x-1' : 'border-primary/25 bg-primary/10 text-primary translate-x-1'
            }`}>
              <Crown className="w-3 h-3" />
              <span>+{absGap}</span>
            </div>
          )}
          {tied && <span className="typo-caption text-foreground/60 uppercase tracking-wider">Draw</span>}
        </div>
        <VersusCorner agg={right} isWinner={right.versionId === winnerId} align="left" />
      </div>
      {!tied && (
        <div className={`absolute inset-y-0 ${leaningLeft ? 'left-0 right-1/2' : 'left-1/2 right-0'} bg-gradient-to-r ${
          leaningLeft ? 'from-primary/[0.07] to-transparent' : 'from-transparent to-primary/[0.07]'
        } pointer-events-none`} />
      )}
      {leaningRight && null}
    </div>
  );
}

function VersusCorner({ agg, isWinner, align }: { agg: AbVersionAggregate; isWinner: boolean; align: 'left' | 'right' }) {
  return (
    <div className={`flex flex-col gap-1 ${align === 'right' ? 'items-end text-right' : 'items-start text-left'}`}>
      <div className="flex items-center gap-2">
        {align === 'right' && isWinner && <Crown className="w-3.5 h-3.5 text-primary" />}
        <span className="typo-code font-mono font-bold text-foreground/80 text-sm">v{agg.versionNumber}</span>
        {align === 'left' && isWinner && <Crown className="w-3.5 h-3.5 text-primary" />}
      </div>
      <div className={`typo-hero font-black tracking-tight ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</div>
      <div className="flex items-center gap-3 typo-caption text-foreground/70">
        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{agg.totalCost.toFixed(4)}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(agg.avgDuration / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

function TaleOfTheTapeRow({ spec, left, right }: { spec: MetricRowSpec; left: AbVersionAggregate; right: AbVersionAggregate }) {
  const Icon = spec.icon;
  const lv = spec.pick(left);
  const rv = spec.pick(right);
  const leftLeads = lv > rv;
  const rightLeads = rv > lv;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 py-2.5">
      <div className="flex items-center justify-end gap-2">
        <span className={`typo-heading font-bold tabular-nums ${leftLeads ? scoreColor(lv) : 'text-foreground/60'}`}>{lv}</span>
        <div className="flex-1 h-2 rounded-full bg-primary/5 overflow-hidden flex justify-end">
          <div
            className={`h-full rounded-full transition-all ${leftLeads ? 'bg-primary/60' : 'bg-primary/25'}`}
            style={{ width: `${Math.max(lv, 2)}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 px-2 min-w-[88px]">
        <Icon className="w-3.5 h-3.5 text-foreground/70" />
        <span className="text-[10px] uppercase tracking-widest text-foreground/70 font-semibold whitespace-nowrap">{spec.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-primary/5 overflow-hidden flex justify-start">
          <div
            className={`h-full rounded-full transition-all ${rightLeads ? 'bg-primary/60' : 'bg-primary/25'}`}
            style={{ width: `${Math.max(rv, 2)}%` }}
          />
        </div>
        <span className={`typo-heading font-bold tabular-nums ${rightLeads ? scoreColor(rv) : 'text-foreground/60'}`}>{rv}</span>
      </div>
    </div>
  );
}

function FightCardRow({
  scenario, left, right, leftAgg, rightAgg, selectedCell, onSelectCell,
}: {
  scenario: string;
  left: LabAbResult[];
  right: LabAbResult[];
  leftAgg: AbVersionAggregate;
  rightAgg: AbVersionAggregate;
  selectedCell: { scenario: string; versionId: string } | null;
  onSelectCell: (cell: { scenario: string; versionId: string } | null) => void;
}) {
  const lScore = left.length > 0 ? computeComposite(left) : null;
  const rScore = right.length > 0 ? computeComposite(right) : null;
  const winnerSide: 'left' | 'right' | 'tie' | 'none' =
    lScore === null || rScore === null ? 'none' : lScore > rScore ? 'left' : rScore > lScore ? 'right' : 'tie';

  const leftSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === leftAgg.versionId;
  const rightSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === rightAgg.versionId;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,220px)_minmax(0,1fr)] items-center gap-3 px-3 py-2 border-t border-primary/5 first:border-t-0">
      <div className="flex justify-end">
        <FightScoreButton
          score={lScore}
          isWinner={winnerSide === 'left'}
          isSelected={leftSelected}
          align="right"
          disabled={lScore === null}
          onClick={() => onSelectCell(leftSelected ? null : { scenario, versionId: leftAgg.versionId })}
        />
      </div>
      <div className="text-center px-2 truncate typo-caption text-foreground/80" title={scenario}>
        {scenario}
      </div>
      <div className="flex justify-start">
        <FightScoreButton
          score={rScore}
          isWinner={winnerSide === 'right'}
          isSelected={rightSelected}
          align="left"
          disabled={rScore === null}
          onClick={() => onSelectCell(rightSelected ? null : { scenario, versionId: rightAgg.versionId })}
        />
      </div>
    </div>
  );
}

function FightScoreButton({
  score, isWinner, isSelected, align, disabled, onClick,
}: {
  score: number | null;
  isWinner: boolean;
  isSelected: boolean;
  align: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  if (score === null) {
    return <span className={`typo-caption text-foreground/40 ${align === 'right' ? 'text-right' : 'text-left'}`}>—</span>;
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-card transition-all ${
        isSelected
          ? 'bg-primary/10 ring-1 ring-primary/25 shadow-elevation-1'
          : isWinner
            ? 'bg-primary/[0.06] hover:bg-primary/10'
            : 'bg-secondary/20 hover:bg-secondary/40'
      } ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      {isWinner && <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold">W</span>}
      <span className={`typo-heading font-bold tabular-nums ${scoreColor(score)} ${!isWinner ? 'opacity-80' : ''}`}>{score}</span>
    </button>
  );
}

function CornerColumn({
  agg, isWinner, rationale, suggestions,
}: {
  agg: AbVersionAggregate;
  isWinner: boolean;
  rationale: Array<{ scenario: string; text: string }>;
  suggestions: string[];
}) {
  if (rationale.length === 0 && suggestions.length === 0) return null;
  return (
    <div className={`rounded-modal border overflow-hidden ${isWinner ? 'border-primary/25 bg-primary/[0.03]' : 'border-primary/10 bg-secondary/15'}`}>
      <div className={`px-4 py-2 border-b flex items-center justify-between ${isWinner ? 'border-primary/15 bg-primary/[0.05]' : 'border-primary/10 bg-secondary/20'}`}>
        <div className="flex items-center gap-2">
          <Megaphone className={`w-3.5 h-3.5 ${isWinner ? 'text-primary' : 'text-foreground/60'}`} />
          <span className="typo-label font-semibold uppercase tracking-wider text-foreground/80">
            v{agg.versionNumber} Corner
          </span>
        </div>
        {isWinner && <Crown className="w-3.5 h-3.5 text-primary" />}
      </div>
      <div className="p-4 space-y-3">
        {rationale.slice(0, 3).map((r, i) => (
          <div key={i} className="typo-body leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold mb-0.5">{r.scenario}</div>
            <p className="text-foreground">{r.text.length > 200 ? r.text.slice(0, 200) + '…' : r.text}</p>
          </div>
        ))}
        {suggestions.slice(0, 2).map((s, i) => (
          <div key={`s-${i}`} className="rounded-card border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold mb-0.5">Coaching</div>
            <p className="typo-body text-foreground leading-relaxed">{s.length > 200 ? s.slice(0, 200) + '…' : s}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function computeComposite(rows: LabAbResult[]): number {
  const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / rows.length;
  const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / rows.length;
  const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / rows.length;
  return compositeScore(avgTA, avgOQ, avgPC);
}

export function AbResultsViewVersus({ results, aggregation, selectedCell, onSelectCell }: AbVariantProps) {
  const { versionAggs, scenarios, matrix, winnerId } = aggregation;
  const left = versionAggs[0];
  const right = versionAggs[1];

  const rationaleByVersion = useMemo(() => collectRationaleByVersion(results), [results]);
  const suggestionsByVersion = useMemo(() => collectSuggestionsByVersion(results), [results]);

  if (!left || !right) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/10 px-4 py-8 text-center typo-body text-foreground/70">
        Versus view needs two versions — only one was found in this run.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <VersusHeader left={left} right={right} winnerId={winnerId} />

      <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
        <div className="px-4 py-2 border-b border-primary/10 bg-secondary/20">
          <span className="typo-label uppercase tracking-wider font-semibold text-foreground/80">Tale of the Tape</span>
        </div>
        <div className="px-4 py-2">
          {METRICS.map((spec) => (
            <TaleOfTheTapeRow key={spec.label} spec={spec} left={left} right={right} />
          ))}
        </div>
      </div>

      <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
        <div className="px-4 py-2 border-b border-primary/10 bg-secondary/20 flex items-center justify-between">
          <span className="typo-label uppercase tracking-wider font-semibold text-foreground/80">Fight Card</span>
          <span className="text-[10px] text-foreground/50">Click a score for round details</span>
        </div>
        <div className="py-1">
          {scenarios.map((scenario) => (
            <FightCardRow
              key={scenario}
              scenario={scenario}
              left={matrix[scenario]?.[left.versionId] ?? []}
              right={matrix[scenario]?.[right.versionId] ?? []}
              leftAgg={left}
              rightAgg={right}
              selectedCell={selectedCell}
              onSelectCell={onSelectCell}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CornerColumn
          agg={left}
          isWinner={left.versionId === winnerId}
          rationale={rationaleByVersion.get(left.versionId) ?? []}
          suggestions={suggestionsByVersion.get(left.versionId) ?? []}
        />
        <CornerColumn
          agg={right}
          isWinner={right.versionId === winnerId}
          rationale={rationaleByVersion.get(right.versionId) ?? []}
          suggestions={suggestionsByVersion.get(right.versionId) ?? []}
        />
      </div>
    </div>
  );
}
