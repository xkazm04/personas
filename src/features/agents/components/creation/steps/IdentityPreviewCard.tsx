import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Sparkles } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { BuilderState } from './builder/types';
import { deriveNameFromState } from './identityHelpers';

interface IdentityPreviewCardProps {
  name: string;
  description: string;
  icon: string;
  color: string;
  summary: string;
  builderState: BuilderState;
}

export function IdentityPreviewCard({ name, description, icon, color, summary, builderState }: IdentityPreviewCardProps) {
  const filledUseCases = builderState.useCases.filter((uc) => uc.title.trim());

  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/60">
        Preview
      </p>

      {/* Card preview */}
      <div
        className="flex items-center gap-3 p-3 rounded-lg border border-primary/10 bg-background/40"
        style={{ borderLeftWidth: 3, borderLeftColor: color }}
      >
        {icon ? (
          sanitizeIconUrl(icon) ? (
            <img src={sanitizeIconUrl(icon)!} alt="" className="w-8 h-8" referrerPolicy="no-referrer" crossOrigin="anonymous" />
          ) : isIconUrl(icon) ? null : (
            <span className="text-2xl">{icon}</span>
          )
        ) : (
          <div className="icon-frame icon-frame-pop" style={{ backgroundColor: colorWithAlpha(color, 0.13) }}>
            <PersonaIcon icon={icon} color={color} size="w-4 h-4" framed frameSize='lg' />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground/85 truncate">
            {name.trim() || deriveNameFromState(builderState) || 'Agent Name'}
          </p>
          <p className="text-sm text-muted-foreground/60 truncate">
            {description.trim() || 'Description'}
          </p>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/5">
          <Sparkles className="w-3.5 h-3.5 text-primary/50 shrink-0" />
          <span className="text-sm text-foreground/60">{summary}</span>
        </div>
      )}

      {/* Use cases */}
      {filledUseCases.length > 0 && (
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
            Use Cases
          </p>
          <ul className="space-y-1">
            {filledUseCases.slice(0, 5).map((uc) => (
              <li key={uc.id} className="text-sm text-foreground/70 truncate">{uc.title}</li>
            ))}
            {filledUseCases.length > 5 && (
              <li className="text-sm text-muted-foreground/50 italic">+{filledUseCases.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Components */}
      {builderState.components.length > 0 && (
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
            Components
          </p>
          <div className="flex flex-wrap gap-1">
            {builderState.components.map((comp) => (
              <span key={comp.id} className="inline-flex items-center px-1.5 py-0.5 bg-secondary/40 rounded text-sm text-foreground/70">
                {comp.connectorName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trigger + Policies */}
      {(builderState.globalTrigger || builderState.errorStrategy !== 'halt' || builderState.reviewPolicy !== 'never') && (
        <div className="space-y-1">
          {builderState.globalTrigger && (
            <p className="text-sm text-foreground/60">
              <span className="text-muted-foreground/55">Schedule:</span> {builderState.globalTrigger.label}
            </p>
          )}
          {builderState.errorStrategy !== 'halt' && (
            <p className="text-sm text-foreground/60">
              <span className="text-muted-foreground/55">Errors:</span> {builderState.errorStrategy}
            </p>
          )}
          {builderState.reviewPolicy !== 'never' && (
            <p className="text-sm text-foreground/60">
              <span className="text-muted-foreground/55">Review:</span> {builderState.reviewPolicy}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
