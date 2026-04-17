import { useState } from 'react';
import { ChevronDown, Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from "@/stores/agentStore";
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { UseCaseSubscriptions } from '@/features/agents/sub_use_cases/components/schedule/UseCaseSubscriptions';
import { useSubscriptionManager } from '../../libs/subscriptionLifecycle';

export function UseCaseSubscriptionsSection() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);

  const manager = useSubscriptionManager(selectedPersona);

  const useCases = useSelectedUseCases();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (useCases.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Radio className="w-3.5 h-3.5" />}
        label={t.agents.connectors.sub_triggers_title}
        badge={(
          <>
            {manager.totalActive > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 typo-body rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                {tx(t.agents.connectors.sub_active, { count: manager.totalActive })}
              </span>
            )}
            {manager.totalSuggested > 0 && manager.totalActive === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 typo-body rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                {tx(t.agents.connectors.sub_suggested, { count: manager.totalSuggested })}
              </span>
            )}
          </>
        )}
      />

      {manager.error && (
        <div className="px-3 py-2 rounded-modal border border-red-500/20 bg-red-500/10 typo-body text-red-400/80">
          {manager.error}
        </div>
      )}

      <div className="space-y-2">
        {useCases.map((uc) => {
          const ucItems = manager.byUseCase.get(uc.id) ?? [];
          const activeCount = ucItems.filter((i) => i.stage === 'activated').length;
          const suggestedCount = ucItems.filter((i) => i.stage === 'suggested').length;
          const isExpanded = expandedId === uc.id;

          return (
            <SectionCard key={uc.id} size="md" className="overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : uc.id)}
                aria-expanded={isExpanded}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors focus-ring"
              >
                <ChevronDown className={`w-3 h-3 text-foreground transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                <span className="typo-body font-medium text-foreground flex-1 truncate">{uc.title}</span>
                {activeCount > 0 && (
                  <span className="typo-body text-cyan-400/70">{tx(t.agents.connectors.sub_active, { count: activeCount })}</span>
                )}
                {activeCount === 0 && suggestedCount > 0 && (
                  <span className="typo-body text-amber-400/70">{tx(t.agents.connectors.sub_suggested, { count: suggestedCount })}</span>
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-primary/10 p-3.5">
                  <UseCaseSubscriptions
                    items={ucItems}
                    suggestedTrigger={uc.suggested_trigger}
                    useCaseId={uc.id}
                    onActivate={manager.activate}
                    onRetire={manager.retire}
                    onAddSuggested={(sub) => manager.addSuggested(uc.id, sub)}
                    onRemoveSuggested={(idx) => manager.removeSuggested(uc.id, idx)}
                    onToggleSuggested={(idx) => manager.toggleSuggested(uc.id, idx)}
                    activating={manager.activating}
                  />
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
