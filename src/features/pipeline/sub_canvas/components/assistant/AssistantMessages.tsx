import { ChevronDown, ChevronUp, Check, ArrowRight } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PersonaAvatar, ROLE_COLORS } from '../../libs/teamConstants';
import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import type { BlueprintMember } from '@/lib/bindings/BlueprintMember';
import { useTranslation } from '@/i18n/useTranslation';

interface AssistantMessagesProps {
  loading: boolean;
  error: string | null;
  blueprint: TopologyBlueprint | null;
  previewExpanded: boolean;
  isApplying: boolean;
  memberCount: number;
  onTogglePreview: () => void;
  onApply: () => void;
}

const roleColor = (role: string) =>
  ROLE_COLORS[role] ?? { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' };

export default function AssistantMessages({
  loading,
  error,
  blueprint,
  previewExpanded,
  isApplying,
  memberCount,
  onTogglePreview,
  onApply,
}: AssistantMessagesProps) {
  const { t, tx } = useTranslation();
  const suggestedPattern = blueprint?.description
    ? blueprint.description.match(/\(Pattern:\s*([^)]+)\)/)?.[1] ?? null
    : null;

  const connectionSummary = blueprint
    ? (() => {
        const types = new Map<string, number>();
        for (const c of blueprint.connections) {
          types.set(c.connection_type, (types.get(c.connection_type) ?? 0) + 1);
        }
        return Array.from(types.entries())
          .map(([t, n]) => `${n} ${t}`)
          .join(', ');
      })()
    : '';

  return (
    <>
      {/* Loading message */}
      {loading && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-modal bg-indigo-500/8 border border-indigo-500/15 typo-body text-indigo-300/80 flex items-center gap-2">
          <LoadingSpinner size="xs" className="flex-shrink-0" />
          {t.pipeline.building_team}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-modal bg-red-500/10 border border-red-500/20 typo-body text-red-400">
          {error}
        </div>
      )}

      {/* Blueprint preview */}
      {blueprint && (
          <div
            className="animate-fade-slide-in border-t border-primary/10 overflow-hidden"
          >
            {/* Preview header */}
            <button
              onClick={onTogglePreview}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/30 transition-colors"
            >
              <span className="typo-heading font-semibold text-foreground flex items-center gap-2">
                {tx(t.pipeline.blueprint_agents, { count: blueprint.members.length })}
                {suggestedPattern && (
                  <span className="px-1.5 py-0.5 rounded typo-body font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                    {suggestedPattern}
                  </span>
                )}
              </span>
              {previewExpanded ? (
                <ChevronUp className="w-3 h-3 text-foreground" />
              ) : (
                <ChevronDown className="w-3 h-3 text-foreground" />
              )}
            </button>

            {previewExpanded && (
              <div className="px-3 pb-3 space-y-2">
                <p className="typo-body text-foreground leading-relaxed">
                  {blueprint.description}
                </p>

                <div className="space-y-1">
                  {blueprint.members.map((m: BlueprintMember, i: number) => {
                    const rc = roleColor(m.role);
                    return (
                      <div
                        key={`${m.persona_id}-${i}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-secondary/40 border border-primary/10"
                      >
                        <PersonaAvatar size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="typo-body font-medium text-foreground truncate">
                            {m.persona_name}
                          </div>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded typo-heading font-semibold uppercase tracking-wider ${rc.bg} ${rc.text} ${rc.border} border`}
                        >
                          {m.role}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {blueprint.connections.length > 0 && (
                  <div className="flex items-center gap-1.5 typo-body text-foreground">
                    <ArrowRight className="w-3 h-3" />
                    {connectionSummary} connection{blueprint.connections.length !== 1 ? 's' : ''}
                  </div>
                )}

                <button
                  onClick={onApply}
                  disabled={isApplying}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-modal bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 typo-body font-medium transition-all disabled:opacity-50"
                >
                  {isApplying ? (
                    <>
                      <LoadingSpinner size="sm" />
                      {t.pipeline.applying}
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      {memberCount > 0 ? t.pipeline.apply_to_canvas : t.pipeline.build_pipeline}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
    </>
  );
}
