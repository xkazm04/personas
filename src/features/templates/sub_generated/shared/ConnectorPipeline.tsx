import { ChevronRight } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorPipelineStep } from '@/lib/types/designTypes';

interface ConnectorPipelineProps {
  steps: ConnectorPipelineStep[];
  className?: string;
}

export function ConnectorPipeline({ steps, className = '' }: ConnectorPipelineProps) {
  if (steps.length === 0) return null;

  const sorted = [...steps]
    .filter((s) => s.connector_name)
    .sort((a, b) => a.order - b.order);

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`}>
      {sorted.map((step, idx) => {
        const meta = getConnectorMeta(step.connector_name);
        return (
          <div key={`${step.connector_name}-${step.order}`} className="flex items-center gap-1">
            {idx > 0 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
            )}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${meta.color}18` }}
              >
                <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
              </div>
              <span className="text-sm text-foreground/70 whitespace-nowrap">
                {step.action_label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
