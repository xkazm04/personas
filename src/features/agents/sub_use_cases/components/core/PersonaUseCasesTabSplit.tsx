import { useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Power, PowerOff, Play, FlaskConical, Cpu, Bell, Calendar, Webhook, Zap, MousePointer,
} from 'lucide-react';
import { UseCaseHistory } from '@/features/shared/components/use-cases/UseCaseHistory';
import { UseCaseExecutionPanel } from '@/features/shared/components/use-cases/UseCaseExecutionPanel';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { UseCaseDetailPanel } from '../detail/UseCaseDetailPanel';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { DefaultModelSection } from './DefaultModelSection';
import { CapabilityDisableDialog } from './CapabilityDisableDialog';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';

const TRIGGER_ICON: Record<string, typeof Calendar> = {
  schedule: Calendar, polling: Zap, webhook: Webhook, manual: MousePointer,
};

interface Props {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

/**
 * Master-detail variant — a thin capability list on the left, a focused
 * detail pane on the right. j/k or ArrowDown/ArrowUp to walk the list.
 *
 * Design intent: capability as the primary navigation unit. Full attention
 * on one at a time; switching is cheap. Everything (config, history,
 * execution) lives in the right pane, no inline expands.
 */
export function PersonaUseCasesTabSplit({
  draft, patch, modelDirty, credentials, connectorDefinitions,
}: Props) {
  const {
    selectedPersona, isExecuting, personaId, useCases,
    selectedUseCaseId, setSelectedUseCaseId,
    executionPanelRef, historyRefreshKey,
    handleExecute, handleRerun, handleExecutionFinished,
  } = useUseCasesTab();

  const {
    pendingUseCaseId, disableConfirmation, requestToggle, confirmDisable, cancelDisable, requestSimulate,
  } = useCapabilityToggle();

  // Default-select the first capability so the right pane is never empty.
  useEffect(() => {
    const first = useCases[0];
    if (!selectedUseCaseId && first) setSelectedUseCaseId(first.id);
  }, [selectedUseCaseId, useCases, setSelectedUseCaseId]);

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (useCases.length === 0) return;
      const idx = useCases.findIndex((u) => u.id === selectedUseCaseId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = useCases[(idx + 1) % useCases.length];
        if (next) setSelectedUseCaseId(next.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = useCases[(idx - 1 + useCases.length) % useCases.length];
        if (prev) setSelectedUseCaseId(prev.id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedUseCaseId, useCases, setSelectedUseCaseId]);

  const selected = useMemo(
    () => useCases.find((u) => u.id === selectedUseCaseId) ?? useCases[0] ?? null,
    [useCases, selectedUseCaseId],
  );

  const handleToggle = useCallback(
    (uc: UseCaseItem) => personaId && requestToggle(personaId, uc.id, uc.title, uc.enabled === false),
    [personaId, requestToggle],
  );

  if (!selectedPersona) return null;

  const activeCount = useCases.filter((u) => u.enabled !== false).length;

  return (
    <div className="flex flex-col h-full">
      {/* Top strip */}
      <div className="flex items-center gap-4 px-1 pb-3">
        <span className="typo-label uppercase tracking-wider text-foreground">Capabilities</span>
        <span className="typo-data font-mono text-foreground">{activeCount}/{useCases.length}</span>
        <span className="typo-caption text-foreground/60">j/k to navigate</span>
        <div className="ml-auto">
          <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} personaId={personaId} />
        </div>
      </div>

      {useCases.length === 0 ? (
        <EmptyState variant="use-cases-empty" />
      ) : (
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Master list */}
          <div className="w-72 flex-shrink-0 rounded-xl border border-primary/10 bg-secondary/20 overflow-y-auto">
            {useCases.map((uc, i) => {
              const enabled = uc.enabled !== false;
              const isSel = selected?.id === uc.id;
              const mode = uc.execution_mode ?? 'e2e';
              const TIcon = TRIGGER_ICON[uc.suggested_trigger?.type ?? 'manual'] ?? MousePointer;
              return (
                <button
                  key={uc.id}
                  onClick={() => setSelectedUseCaseId(uc.id)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                    isSel
                      ? 'border-l-primary bg-primary/[0.08]'
                      : 'border-l-transparent hover:bg-secondary/30'
                  } ${!enabled ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      enabled ? 'bg-emerald-400' : 'bg-foreground/30'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="typo-caption font-mono text-foreground/50 w-4">{i + 1}</span>
                        <span className="typo-heading text-foreground/95 truncate flex-1">{uc.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 typo-caption text-foreground/60">
                        <TIcon className="w-3 h-3" />
                        <span className="truncate">{uc.suggested_trigger?.type ?? 'manual'}</span>
                        {uc.model_override && <Cpu className="w-3 h-3 text-primary/60 ml-auto" />}
                        {(uc.notification_channels?.length ?? 0) > 0 && (
                          <Bell className="w-3 h-3 text-amber-400/70" />
                        )}
                        <span className={`typo-label ml-auto ${
                          mode === 'e2e' ? 'text-emerald-400/70'
                            : mode === 'mock' ? 'text-amber-400/70'
                            : 'text-foreground/50'
                        }`}>
                          {mode === 'e2e' ? 'E2E' : mode === 'mock' ? 'M' : 'i'}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail pane */}
          <motion.div
            key={selected?.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 min-w-0 rounded-xl border border-primary/10 bg-secondary/20 overflow-y-auto"
          >
            {selected && (
              <div className="p-4 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="typo-heading text-foreground/95">{selected.title}</h3>
                    {selected.category && (
                      <span className="typo-caption text-foreground/60 uppercase tracking-wider">
                        {selected.category.replace('-', ' ')}
                      </span>
                    )}
                    <p className="typo-body text-foreground/80 mt-2 leading-relaxed">
                      {selected.capability_summary ?? selected.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(selected)}
                      disabled={pendingUseCaseId === selected.id}
                      className={`p-1.5 rounded-lg border transition-colors ${
                        selected.enabled !== false
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/80 hover:bg-emerald-500/20'
                          : 'bg-secondary/40 border-primary/15 text-foreground hover:border-primary/25'
                      }`}
                      title={selected.enabled !== false ? 'Pause capability' : 'Activate capability'}
                    >
                      {selected.enabled !== false
                        ? <Power className="w-3.5 h-3.5" />
                        : <PowerOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleExecute(selected.id, selected.sample_input ?? undefined)}
                      disabled={selected.enabled === false || selected.execution_mode === 'non_executable' || isExecuting}
                      className="p-1.5 rounded-lg border bg-secondary/40 border-primary/15 text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title={`Run ${selected.title}`}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => personaId && requestSimulate(personaId, selected.id)}
                      disabled={selected.execution_mode === 'non_executable' || isExecuting}
                      className="p-1.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400/80 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Simulate — no notifications delivered"
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Trigger + delivery pills */}
                <div className="flex flex-wrap gap-2 typo-caption">
                  {selected.suggested_trigger && (
                    <span className="px-2 py-1 rounded border border-primary/15 bg-secondary/40 text-foreground/80">
                      Trigger: {selected.suggested_trigger.description || selected.suggested_trigger.type}
                    </span>
                  )}
                  {selected.model_override && (
                    <span className="px-2 py-1 rounded border border-primary/15 bg-primary/5 text-primary/80 flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> Custom model
                    </span>
                  )}
                  {(selected.notification_channels ?? []).map((ch, i) => (
                    <span key={i} className="px-2 py-1 rounded border border-amber-500/20 bg-amber-500/5 text-amber-400/80 flex items-center gap-1">
                      <Bell className="w-3 h-3" /> {ch.type}
                    </span>
                  ))}
                </div>

                {/* Execution panel (handles input + run) */}
                <div ref={executionPanelRef}>
                  <UseCaseExecutionPanel
                    personaId={personaId}
                    useCase={selected}
                    onClose={() => { /* no-op in split view */ }}
                    onExecutionFinished={handleExecutionFinished}
                  />
                </div>

                {/* Config */}
                <div className="pt-3 border-t border-primary/10">
                  <UseCaseDetailPanel
                    useCaseId={selected.id}
                    credentials={credentials}
                    connectorDefinitions={connectorDefinitions}
                  />
                </div>

                {/* History */}
                <div className="pt-3 border-t border-primary/10">
                  <p className="typo-label uppercase tracking-wider text-foreground/70 mb-2">History</p>
                  <UseCaseHistory
                    personaId={personaId}
                    useCaseId={selected.id}
                    onRerun={handleRerun}
                    refreshKey={historyRefreshKey}
                  />
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {disableConfirmation && personaId && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={() => confirmDisable(personaId)}
          onCancel={cancelDisable}
        />
      )}
    </div>
  );
}
