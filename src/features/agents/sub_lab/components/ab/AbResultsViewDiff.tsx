// Diff variant of AbResultsView — git-diff / code-review metaphor.
// Uses +N / -N delta notation for every metric and scenario; scenarios read as
// files in a pull request, rationale + suggestions attach as inline review
// comments. Typography leans tabular & monospace where it carries meaning.
import { useMemo } from 'react';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import type { AbVersionAggregate } from '../../libs/labAggregation';
import type { AbVariantProps, SelectedCell } from './AbResultsView';
import { FileDiff, MessageSquare, Lightbulb, GitPullRequest, Plus, Minus, Equal } from 'lucide-react';

interface MetricSpec {
  key: string;
  label: string;
  pick: (a: AbVersionAggregate) => number;
}

const METRICS: MetricSpec[] = [
  { key: 'composite', label: 'Composite', pick: (a) => a.compositeScore },
  { key: 'tool', label: 'Tool Accuracy', pick: (a) => a.avgToolAccuracy },
  { key: 'output', label: 'Output Quality', pick: (a) => a.avgOutputQuality },
  { key: 'protocol', label: 'Protocol', pick: (a) => a.avgProtocolCompliance },
];

function parseVerdict(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { verdict?: string; summary?: string };
    return parsed.verdict ?? parsed.summary ?? raw;
  } catch { return raw; }
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '±0';
}

function deltaClass(n: number): string {
  if (n > 0) return 'text-status-success';
  if (n < 0) return 'text-status-error';
  return 'text-foreground/50';
}

function DeltaPill({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = value > 0 ? Plus : value < 0 ? Minus : Equal;
  const bg = value > 0 ? 'bg-status-success/10 border-status-success/20' : value < 0 ? 'bg-status-error/10 border-status-error/20' : 'bg-secondary/30 border-primary/10';
  const sizeClass = size === 'lg' ? 'px-3 py-1.5 text-base' : size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 typo-caption';
  return (
    <span className={`inline-flex items-center gap-1 rounded-input border font-mono font-bold tabular-nums ${bg} ${deltaClass(value)} ${sizeClass}`}>
      <Icon className={size === 'lg' ? 'w-4 h-4' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      <span>{value === 0 ? '0' : Math.abs(value)}</span>
    </span>
  );
}

function DiffStripe({ left, right }: { left: AbVersionAggregate; right: AbVersionAggregate }) {
  const delta = right.compositeScore - left.compositeScore;
  const gained = delta > 0 ? delta : 0;
  const lost = delta < 0 ? Math.abs(delta) : 0;

  return (
    <div className="rounded-modal border border-primary/15 bg-gradient-to-br from-secondary/30 to-background/20 overflow-hidden">
      <div className="px-5 py-4 flex flex-wrap items-center gap-4 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-primary" />
          <span className="typo-code font-mono text-foreground/70 text-sm">
            v{left.versionNumber}
          </span>
          <span className="text-foreground/40">→</span>
          <span className="typo-code font-mono text-foreground text-sm font-semibold">
            v{right.versionNumber}
          </span>
        </div>
        <div className="h-6 w-px bg-primary/15" />
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-status-success font-mono text-sm">
            <Plus className="w-3.5 h-3.5" />
            <span className="font-bold tabular-nums">{gained}</span>
          </span>
          <span className="flex items-center gap-1 text-status-error font-mono text-sm">
            <Minus className="w-3.5 h-3.5" />
            <span className="font-bold tabular-nums">{lost}</span>
          </span>
          <span className="typo-caption text-foreground/60">composite</span>
        </div>
        <div className="flex-1" />
        <DeltaPill value={delta} size="lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-primary/10">
        {METRICS.map((spec) => {
          const lv = spec.pick(left);
          const rv = spec.pick(right);
          const d = rv - lv;
          return (
            <div key={spec.key} className="px-4 py-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-foreground/60 font-semibold">{spec.label}</span>
              <div className="flex items-baseline gap-2 font-mono">
                <span className="text-foreground/50 text-sm tabular-nums">{lv}</span>
                <span className="text-foreground/30">→</span>
                <span className={`text-lg font-bold tabular-nums ${scoreColor(rv)}`}>{rv}</span>
                <span className={`text-sm font-bold tabular-nums ${deltaClass(d)}`}>{signed(d)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricDiffRow({ spec, left, right }: { spec: MetricSpec; left: AbVersionAggregate; right: AbVersionAggregate }) {
  const lv = spec.pick(left);
  const rv = spec.pick(right);
  const d = rv - lv;
  const maxBar = 100;

  return (
    <div className="grid grid-cols-[140px_1fr_1fr_72px] items-center gap-3 py-2 font-mono">
      <span className="typo-caption text-foreground/80 font-sans">{spec.label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-sm tabular-nums w-10 text-right ${scoreColor(lv)}`}>{lv}</span>
        <div className="flex-1 h-1.5 rounded-full bg-primary/5 overflow-hidden">
          <div className="h-full bg-primary/30 rounded-full" style={{ width: `${(lv / maxBar) * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-primary/5 overflow-hidden">
          <div className="h-full bg-primary/60 rounded-full" style={{ width: `${(rv / maxBar) * 100}%` }} />
        </div>
        <span className={`text-sm tabular-nums w-10 ${scoreColor(rv)}`}>{rv}</span>
      </div>
      <div className="flex justify-end">
        <DeltaPill value={d} size="sm" />
      </div>
    </div>
  );
}

interface ScenarioDiff {
  scenario: string;
  leftScore: number | null;
  rightScore: number | null;
  delta: number;
  leftResults: LabAbResult[];
  rightResults: LabAbResult[];
  rationaleLeft: string | null;
  rationaleRight: string | null;
  suggestionsRight: string | null;
}

function buildScenarioDiffs(
  scenarios: string[],
  matrix: Record<string, Record<string, LabAbResult[]>>,
  left: AbVersionAggregate,
  right: AbVersionAggregate,
): ScenarioDiff[] {
  return scenarios.map((scenario) => {
    const l = matrix[scenario]?.[left.versionId] ?? [];
    const r = matrix[scenario]?.[right.versionId] ?? [];
    const ls = l.length > 0 ? computeComposite(l) : null;
    const rs = r.length > 0 ? computeComposite(r) : null;
    const delta = (ls != null && rs != null) ? rs - ls : 0;
    return {
      scenario,
      leftScore: ls,
      rightScore: rs,
      delta,
      leftResults: l,
      rightResults: r,
      rationaleLeft: l.find((x) => x.rationale)?.rationale ?? null,
      rationaleRight: r.find((x) => x.rationale)?.rationale ?? null,
      suggestionsRight: r.find((x) => x.suggestions)?.suggestions ?? null,
    };
  });
}

function computeComposite(rows: LabAbResult[]): number {
  const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / rows.length;
  const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / rows.length;
  const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / rows.length;
  return compositeScore(avgTA, avgOQ, avgPC);
}

function ScoreCell({
  score, isSelected, onClick, tone,
}: {
  score: number | null;
  isSelected: boolean;
  onClick: () => void;
  tone: 'base' | 'left' | 'right';
}) {
  if (score === null) {
    return <span className="font-mono text-foreground/30">—</span>;
  }
  const bg = tone === 'left' ? 'bg-status-error/[0.04] hover:bg-status-error/10'
    : tone === 'right' ? 'bg-status-success/[0.04] hover:bg-status-success/10'
    : 'bg-secondary/20 hover:bg-secondary/40';
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center px-2 py-1 rounded-input transition-all font-mono font-bold tabular-nums ${
        isSelected ? 'ring-1 ring-primary/25 bg-primary/10 shadow-elevation-1' : bg
      } ${scoreColor(score)}`}
    >
      {score}
    </button>
  );
}

function ScenarioDiffBlock({
  diff, left, right, selectedCell, onSelectCell,
}: {
  diff: ScenarioDiff;
  left: AbVersionAggregate;
  right: AbVersionAggregate;
  selectedCell: SelectedCell | null;
  onSelectCell: (cell: SelectedCell | null) => void;
}) {
  const leftSelected = selectedCell?.scenario === diff.scenario && selectedCell?.versionId === left.versionId;
  const rightSelected = selectedCell?.scenario === diff.scenario && selectedCell?.versionId === right.versionId;

  const rationaleText = diff.rationaleRight ? parseVerdict(diff.rationaleRight) : diff.rationaleLeft ? parseVerdict(diff.rationaleLeft) : null;

  return (
    <div className="rounded-card border border-primary/10 overflow-hidden bg-background/30">
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-2 border-b border-primary/10 bg-secondary/15">
        <FileDiff className="w-3.5 h-3.5 text-foreground/60" />
        <span className="typo-code font-mono text-sm text-foreground truncate">{diff.scenario}</span>
        <ScoreCell
          score={diff.leftScore}
          isSelected={leftSelected}
          onClick={() => diff.leftResults.length > 0 && onSelectCell(leftSelected ? null : { scenario: diff.scenario, versionId: left.versionId })}
          tone="left"
        />
        <span className="text-foreground/30 font-mono">→</span>
        <div className="flex items-center gap-2">
          <ScoreCell
            score={diff.rightScore}
            isSelected={rightSelected}
            onClick={() => diff.rightResults.length > 0 && onSelectCell(rightSelected ? null : { scenario: diff.scenario, versionId: right.versionId })}
            tone="right"
          />
          {diff.leftScore !== null && diff.rightScore !== null && <DeltaPill value={diff.delta} size="sm" />}
        </div>
      </div>
      {(rationaleText || diff.suggestionsRight) && (
        <div className="px-4 py-2.5 space-y-2 bg-secondary/[0.06]">
          {rationaleText && <ReviewComment kind="note" author={`v${right.versionNumber}`} body={rationaleText} />}
          {diff.suggestionsRight && <ReviewComment kind="suggestion" author="reviewer" body={diff.suggestionsRight} />}
        </div>
      )}
    </div>
  );
}

function ReviewComment({ kind, author, body }: { kind: 'note' | 'suggestion'; author: string; body: string }) {
  const Icon = kind === 'note' ? MessageSquare : Lightbulb;
  const tone = kind === 'note' ? 'border-primary/15 bg-secondary/20 text-foreground/80' : 'border-amber-500/20 bg-amber-500/[0.04] text-foreground/90';
  const iconTone = kind === 'note' ? 'text-foreground/60' : 'text-amber-400/80';
  return (
    <div className={`flex gap-2 rounded-input border ${tone} px-3 py-2`}>
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${iconTone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="typo-code font-mono text-[11px] text-foreground/70">{author}</span>
          <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">
            {kind === 'note' ? 'rationale' : 'suggestion'}
          </span>
        </div>
        <p className="typo-body leading-relaxed">
          {body.length > 240 ? body.slice(0, 240) + '…' : body}
        </p>
      </div>
    </div>
  );
}

export function AbResultsViewDiff({ results: _results, aggregation, selectedCell, onSelectCell }: AbVariantProps) {
  const { versionAggs, scenarios, matrix } = aggregation;
  const byVersionAsc = [...versionAggs].sort((a, b) => a.versionNumber - b.versionNumber);
  const left = byVersionAsc[0];
  const right = byVersionAsc[byVersionAsc.length - 1];

  const scenarioDiffs = useMemo(
    () => (left && right ? buildScenarioDiffs(scenarios, matrix, left, right) : []),
    [scenarios, matrix, left, right],
  );

  if (!left || !right || left.versionId === right.versionId) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/10 px-4 py-8 text-center typo-body text-foreground/70">
        Diff view needs two versions — only one was found in this run.
      </div>
    );
  }

  const sorted = [...scenarioDiffs].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return (
    <div className="space-y-5">
      <DiffStripe left={left} right={right} />

      <div className="rounded-modal border border-primary/10 bg-background/20 overflow-hidden">
        <div className="px-4 py-2 border-b border-primary/10 bg-secondary/15 flex items-center justify-between">
          <span className="typo-label uppercase tracking-wider font-semibold text-foreground/80">Metric Diff</span>
          <span className="text-[10px] font-mono text-foreground/50">v{left.versionNumber} → v{right.versionNumber}</span>
        </div>
        <div className="px-4 py-2">
          {METRICS.map((spec) => (
            <MetricDiffRow key={spec.key} spec={spec} left={left} right={right} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="typo-label uppercase tracking-wider font-semibold text-foreground/80">Files Changed</span>
          <span className="text-[10px] font-mono text-foreground/50">{sorted.length} scenarios · sorted by |Δ|</span>
        </div>
        <div className="space-y-2">
          {sorted.map((d) => (
            <ScenarioDiffBlock
              key={d.scenario}
              diff={d}
              left={left}
              right={right}
              selectedCell={selectedCell}
              onSelectCell={onSelectCell}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
