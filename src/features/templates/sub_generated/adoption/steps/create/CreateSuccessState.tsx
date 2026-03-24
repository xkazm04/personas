import {
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AdoptEntityError } from '../../state/adoptTypes';

interface CreateSuccessStateProps {
  draft: N8nPersonaDraft;
  partialEntityErrors: AdoptEntityError[];
  onOpenInEditor: () => void;
  onReset: () => void;
}

export function CreateSuccessState({
  draft,
  partialEntityErrors,
  onOpenInEditor,
  onReset,
}: CreateSuccessStateProps) {
  return (
    <div
      className="animate-fade-slide-in p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center"
    >
      <div
        className="animate-fade-scale-in w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
      >
        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
      </div>
      <p
        className="animate-fade-slide-in text-sm font-semibold text-emerald-400 mb-1"
      >
        Persona Created Successfully
      </p>
      <p
        className="animate-fade-slide-in text-sm text-emerald-400/60 mb-4"
      >
        {draft.name ?? 'Your persona'} is ready to use.
      </p>

      {partialEntityErrors.length > 0 && (
        <div
          className="animate-fade-slide-in mx-auto max-w-xl text-left rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 mb-4"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-300/90 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Partial Setup Issues
          </div>
          <div className="space-y-1">
            {partialEntityErrors.map((entry, idx) => (
              <div key={`${entry.entity_type}-${entry.entity_name}-${idx}`} className="text-sm text-amber-100/85">
                <span className="font-medium">{entry.entity_type}</span>{' '}
                "{entry.entity_name}": <span className="text-amber-200/80">{entry.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="animate-fade-slide-in flex items-center justify-center gap-3"
      >
        <button
          onClick={onOpenInEditor}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in Editor
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border border-primary/15 text-muted-foreground/70 hover:bg-secondary/30 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Adopt Another
        </button>
      </div>
    </div>
  );
}
