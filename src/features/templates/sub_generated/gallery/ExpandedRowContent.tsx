import { useMemo } from 'react';
import { Play, Download, CheckCircle2, AlertCircle, Wrench } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { ConnectorPipelineStep, DesignAnalysisResult, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

interface ExpandedRowContentProps {
  review: PersonaDesignReview;
  designResult: DesignAnalysisResult | null;
  allConnectorsReady: boolean;
  readinessStatuses: ConnectorReadinessStatus[];
  onAdopt: () => void;
  onTryIt: () => void;
  onAddCredential: (connectorName: string) => void;
}

// ── Component card data ─────────────────────────────────────────

interface ComponentCardData {
  name: string;
  role: string | undefined;
  actions: string[];
  tools: string[];
  health: ConnectorReadinessStatus['health'];
  hasCredential: boolean;
}

function buildComponentCards(
  designResult: DesignAnalysisResult | null,
  readinessStatuses: ConnectorReadinessStatus[],
): ComponentCardData[] {
  if (!designResult?.suggested_connectors) return [];

  // Build action map from service_flow
  const actionsByConnector = new Map<string, string[]>();
  const raw = designResult as unknown as Record<string, unknown>;
  const sf = raw?.service_flow;
  if (Array.isArray(sf)) {
    for (const step of sf) {
      if (typeof step === 'object' && step !== null && 'connector_name' in step) {
        const s = step as ConnectorPipelineStep;
        const existing = actionsByConnector.get(s.connector_name) ?? [];
        if (!existing.includes(s.action_label)) {
          existing.push(s.action_label);
        }
        actionsByConnector.set(s.connector_name, existing);
      }
    }
  }

  return designResult.suggested_connectors.map((conn) => {
    const status = readinessStatuses.find((s) => s.connector_name === conn.name);
    return {
      name: conn.name,
      role: conn.role,
      actions: actionsByConnector.get(conn.name) ?? [],
      tools: conn.related_tools ?? [],
      health: status?.health ?? 'unknown',
      hasCredential: status?.has_credential ?? false,
    };
  });
}

// ── Main Component ──────────────────────────────────────────────

export function ExpandedRowContent({
  review,
  designResult,
  allConnectorsReady,
  readinessStatuses,
  onAdopt,
  onTryIt,
  onAddCredential,
}: ExpandedRowContentProps) {
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  const displayFlows = flows.length > 0
    ? flows
    : (() => {
        const raw = designResult as unknown as Record<string, unknown> | null;
        return raw?.use_case_flows
          ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
          : [];
      })();

  const cards = useMemo(
    () => buildComponentCards(designResult, readinessStatuses),
    [designResult, readinessStatuses],
  );

  return (
    <div className="py-3 px-4 space-y-3">
      {/* Component architecture cards */}
      {cards.length > 0 && (
        <div className="flex items-start gap-3">
          <div className="flex-1 flex gap-2.5 overflow-x-auto pb-1">
            {cards.map((card) => {
              const meta = getConnectorMeta(card.name);
              const isReady = card.health === 'ready';
              const HealthIcon = isReady ? CheckCircle2 : AlertCircle;
              const healthColor = isReady ? 'text-emerald-400' : 'text-amber-400';

              return (
                <div
                  key={card.name}
                  className="min-w-[180px] max-w-[220px] flex-shrink-0 rounded-lg border border-primary/10 bg-background/50 p-3 space-y-2"
                >
                  {/* Header: icon + name + health */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${meta.color}18` }}
                    >
                      <ConnectorIcon meta={meta} size="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground/80 truncate">{meta.label}</div>
                      {card.role && (
                        <div className="text-[10px] text-muted-foreground/50 truncate">{card.role}</div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isReady) onAddCredential(card.name);
                      }}
                      className={`flex-shrink-0 ${isReady ? '' : 'cursor-pointer hover:opacity-80'}`}
                      title={isReady ? 'Ready' : 'Click to add credential'}
                      disabled={isReady}
                    >
                      <HealthIcon className={`w-3.5 h-3.5 ${healthColor}`} />
                    </button>
                  </div>

                  {/* Actions from service_flow */}
                  {card.actions.length > 0 && (
                    <ul className="space-y-0.5">
                      {card.actions.map((action) => (
                        <li key={action} className="flex items-start gap-1.5 text-[11px] text-foreground/65">
                          <span className="mt-1 w-1 h-1 rounded-full bg-violet-400/50 flex-shrink-0" />
                          <span className="leading-tight">{action}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Tools from related_tools */}
                  {card.tools.length > 0 && (
                    <div className="flex items-start gap-1 pt-0.5 border-t border-primary/5">
                      <Wrench className="w-2.5 h-2.5 text-muted-foreground/30 mt-0.5 flex-shrink-0" />
                      <span className="text-[10px] text-muted-foreground/40 leading-tight">
                        {card.tools.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-1">
            {allConnectorsReady && (
              <button
                onClick={onTryIt}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
              >
                <Play className="w-3.5 h-3.5" />
                Try It
              </button>
            )}
            <button
              onClick={onAdopt}
              className={`px-3.5 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
            >
              <Download className="w-3.5 h-3.5" />
              Adopt
            </button>
          </div>
        </div>
      )}

      {/* Fallback when no connector cards (pipeline + buttons inline) */}
      {cards.length === 0 && (
        <div className="flex items-center justify-center gap-4">
          <div className="text-sm text-muted-foreground/40 italic">
            No architecture data available
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {allConnectorsReady && (
              <button
                onClick={onTryIt}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
              >
                <Play className="w-3.5 h-3.5" />
                Try It
              </button>
            )}
            <button
              onClick={onAdopt}
              className={`px-3.5 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
            >
              <Download className="w-3.5 h-3.5" />
              Adopt
            </button>
          </div>
        </div>
      )}

      {/* Use case flows (compact) */}
      {displayFlows.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-violet-400/70 flex-shrink-0">Use cases:</span>
          {displayFlows.map((flow, i) => (
            <span key={flow.id} className="font-light text-foreground/70">
              {i > 0 && <span className="mx-1.5 text-violet-400/30">·</span>}
              {flow.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
