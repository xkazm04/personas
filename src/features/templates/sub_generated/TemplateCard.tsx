import { useState, useEffect, useRef } from 'react';
import {
  MoreVertical,
  Download,
  Trash2,
  Eye,
  Workflow,
  Clock,
  Webhook,
  MousePointerClick,
  Radio,
  CircleDot,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { DimensionRadial } from './DimensionRadial';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

interface TemplateCardProps {
  review: PersonaDesignReview;
  onAdopt: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  onViewFlows: () => void;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
}

export function TemplateCard({
  review,
  onAdopt,
  onViewDetails,
  onDelete,
  onViewFlows,
  installedConnectorNames,
  credentialServiceTypes,
}: TemplateCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const triggerTypes: string[] = parseJsonSafe(review.trigger_types, []);
  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);

  // Fallback: try extracting flows from design_result if not stored at top level
  const displayFlows = flows.length > 0
    ? flows
    : (() => {
        const raw = designResult as unknown as Record<string, unknown> | null;
        return raw?.use_case_flows
          ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
          : [];
      })();

  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  return (
    <div className="group rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/15 transition-all">
      {/* Header */}
      <div className="px-5 pt-5 pb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground/90 truncate">
            {review.test_case_name}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
            {review.instruction.length > 120
              ? review.instruction.slice(0, 120) + '...'
              : review.instruction}
          </p>
        </div>
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all"
          >
            <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/80" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onViewDetails();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/80 hover:bg-primary/5 transition-colors text-left"
              >
                <Eye className="w-4 h-4" />
                View Details
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3-Column Body */}
      <div className="px-5 py-4 grid grid-cols-3 gap-4 border-t border-primary/5">
        {/* Use Cases */}
        <div className="min-w-0">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Use Cases
          </h4>
          {displayFlows.length > 0 ? (
            <div className="space-y-1.5">
              {displayFlows.slice(0, 4).map((flow) => (
                <button
                  key={flow.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewFlows();
                  }}
                  className="flex items-center gap-2 w-full text-left group/flow hover:text-violet-300 transition-colors"
                >
                  <CircleDot className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
                  <span className="text-sm text-foreground/70 group-hover/flow:text-violet-300 truncate">
                    {flow.name}
                  </span>
                </button>
              ))}
              {displayFlows.length > 4 && (
                <span className="text-xs text-muted-foreground/50 pl-5">
                  +{displayFlows.length - 4} more
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">No flows</span>
          )}
        </div>

        {/* Connectors */}
        <div className="min-w-0">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Connectors
          </h4>
          {connectors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c);
                const status = readinessStatuses.find((s) => s.connector_name === c);
                const isReady = status?.health === 'ready';
                return (
                  <div
                    key={c}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-opacity ${
                      isReady ? '' : 'opacity-30 grayscale'
                    }`}
                    style={{ backgroundColor: `${meta.color}18` }}
                    title={`${meta.label}${isReady ? '' : ' (not configured)'}`}
                  >
                    <ConnectorIcon meta={meta} size="w-4.5 h-4.5" />
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">None</span>
          )}
        </div>

        {/* Triggers */}
        <div className="min-w-0">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Triggers
          </h4>
          {(triggerTypes.length > 0 || suggestedTriggers.length > 0) ? (
            <div className="space-y-1.5">
              {(suggestedTriggers.length > 0 ? suggestedTriggers : triggerTypes.map((t) => ({ trigger_type: t, description: t, config: {} }))).slice(0, 3).map((trigger, i) => {
                const TriggerIcon = TRIGGER_ICONS[trigger.trigger_type] ?? Clock;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <TriggerIcon className="w-3.5 h-3.5 text-blue-400/60 flex-shrink-0" />
                    <span className="text-sm text-foreground/70 truncate">
                      {trigger.description || trigger.trigger_type}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">None</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-primary/5 flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdopt();
          }}
          className="px-3.5 py-2 text-sm rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Adopt
        </button>
        <div className="flex items-center gap-2.5">
          {displayFlows.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewFlows();
              }}
              className="px-2.5 py-1.5 text-sm rounded-md bg-violet-500/8 text-violet-400/70 hover:bg-violet-500/15 transition-colors inline-flex items-center gap-1.5"
            >
              <Workflow className="w-3.5 h-3.5" />
              {displayFlows.length}
            </button>
          )}
          <DimensionRadial designResult={designResult} size={32} />
        </div>
      </div>
    </div>
  );
}
