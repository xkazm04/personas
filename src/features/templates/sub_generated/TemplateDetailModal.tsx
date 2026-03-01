import { useState } from 'react';
import {
  X,
  Download,
  Trash2,
  Workflow,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Lightbulb,
  Play,
} from 'lucide-react';
import { PromptTabsPreview } from '@/features/shared/components/PromptTabsPreview';
import { DesignConnectorGrid } from '@/features/shared/components/DesignConnectorGrid';
import { DimensionRadial } from './DimensionRadial';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

type DetailTab = 'overview' | 'prompt' | 'connectors' | 'json';

const TAB_CONFIG: { key: DetailTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'connectors', label: 'Connectors' },
  { key: 'json', label: 'Raw JSON' },
];

interface TemplateDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  onAdopt: (review: PersonaDesignReview) => void;
  onDelete: (id: string) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onTryIt: (review: PersonaDesignReview) => void;
}

export function TemplateDetailModal({
  isOpen,
  onClose,
  review,
  onAdopt,
  onDelete,
  onViewFlows,
  onTryIt,
}: TemplateDetailModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  if (!isOpen || !review) return null;

  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  const adjustment = parseJsonSafe<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);

  const statusBadge = {
    passed: { Icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Passed' },
    failed: { Icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Failed' },
    error: { Icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Error' },
  }[review.status] || { Icon: Clock, color: 'text-muted-foreground bg-secondary/30 border-primary/10', label: review.status };

  const StatusIcon = statusBadge.Icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground/90 truncate">
              {review.test_case_name}
            </h2>
            <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2">
              {review.instruction}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${statusBadge.color}`}>
                <StatusIcon className="w-3 h-3" />
                {statusBadge.label}
              </span>
              <DimensionRadial designResult={designResult} />
              {review.adoption_count > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-emerald-500/10 border border-emerald-500/15 text-emerald-400/70">
                  <Download className="w-3 h-3" />
                  {review.adoption_count} adopted
                </span>
              )}
              {review.had_references && (
                <span className="text-xs text-violet-400/50 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400/40" />
                  Used reference patterns
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors flex-shrink-0">
            <X className="w-5 h-5 text-muted-foreground/70" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-primary/10 flex gap-0 flex-shrink-0">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-violet-300'
                  : 'text-muted-foreground/60 hover:text-foreground/80'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500/70 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'overview' && (
            <OverviewTab
              designResult={designResult}
              flows={flows}
              adjustment={adjustment}
              review={review}
              onViewFlows={() => onViewFlows(review)}
            />
          )}
          {activeTab === 'prompt' && designResult && (
            <PromptTabsPreview designResult={designResult} />
          )}
          {activeTab === 'connectors' && designResult && (
            <DesignConnectorGrid designResult={designResult} />
          )}
          {activeTab === 'json' && (
            <pre className="p-4 bg-secondary/30 rounded-xl border border-primary/10 text-xs text-muted-foreground/90 overflow-x-auto whitespace-pre-wrap">
              {designResult ? JSON.stringify(designResult, null, 2) : 'No design data available'}
            </pre>
          )}
          {!designResult && activeTab !== 'json' && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/60">
              Design data unavailable for this template.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-primary/10 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAdopt(review)}
              className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Adopt as Persona
            </button>
            {designResult && (
              <button
                onClick={() => {
                  onClose();
                  onTryIt(review);
                }}
                className="px-4 py-2 text-sm rounded-xl bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Try It
              </button>
            )}
          </div>
          <button
            onClick={() => {
              onDelete(review.id);
              onClose();
            }}
            className="px-3 py-2 text-sm rounded-xl text-red-400/70 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  designResult,
  flows,
  adjustment,
  review,
  onViewFlows,
}: {
  designResult: DesignAnalysisResult | null;
  flows: UseCaseFlow[];
  adjustment: { suggestion: string; reason: string; appliedFixes: string[] } | null;
  review: PersonaDesignReview;
  onViewFlows: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* Summary */}
      {designResult?.summary && (
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* Use Case Flows */}
      {flows.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            Use Case Flows
          </h4>
          <div className="flex items-center gap-3 flex-wrap">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={onViewFlows}
                className="bg-violet-500/5 border border-violet-500/15 rounded-xl px-4 py-3 text-left hover:bg-violet-500/10 hover:border-violet-500/25 transition-all group min-w-[180px]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Workflow className="w-4 h-4 text-violet-400/70 group-hover:text-violet-400 transition-colors" />
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground/95 truncate">
                    {flow.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                  <span>{flow.nodes.length} nodes</span>
                  <span>{flow.edges.length} edges</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Adjustment */}
      {adjustment && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-400/80" />
            <h4 className="text-xs font-medium text-amber-400/80 uppercase">
              Suggested Adjustment
              {review.adjustment_generation != null && review.adjustment_generation > 0 && (
                <span className="ml-1.5 text-muted-foreground/80 normal-case">
                  (attempt {review.adjustment_generation}/3)
                </span>
              )}
            </h4>
          </div>
          <p className="text-sm text-muted-foreground/90">{adjustment.reason}</p>
          <div className="bg-background/50 rounded-md px-3 py-2 text-sm text-foreground/90 border border-primary/10">
            {adjustment.suggestion}
          </div>
          {adjustment.appliedFixes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {adjustment.appliedFixes.map((fix: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-400/70"
                >
                  {fix}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dimension completion */}
      {review.structural_score !== null && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide mb-2">
            Dimension Completion
          </h4>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-secondary/40 rounded-full overflow-hidden max-w-[200px]">
              <div
                className={`h-full rounded-full transition-all ${
                  review.structural_score >= 80 ? 'bg-emerald-500/70' : review.structural_score >= 60 ? 'bg-amber-500/70' : 'bg-red-500/70'
                }`}
                style={{ width: `${Math.min(review.structural_score, 100)}%` }}
              />
            </div>
            <span className={`text-sm font-mono font-semibold ${
              review.structural_score >= 80 ? 'text-emerald-400' : review.structural_score >= 60 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {review.structural_score}%
            </span>
            <span className="text-xs text-muted-foreground/50">
              ({Math.round(review.structural_score / 100 * 9)}/9 dimensions)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
