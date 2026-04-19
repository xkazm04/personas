import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Power, PowerOff, Play, FlaskConical, Clock, Cpu, Bell, Calendar, Webhook, Zap, MousePointer,
  ChevronRight, X,
} from 'lucide-react';
import { UseCaseHistory } from '@/features/shared/components/use-cases/UseCaseHistory';
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
  schedule: Calendar,
  polling: Zap,
  webhook: Webhook,
  manual: MousePointer,
};

const MODE_TONE: Record<string, string> = {
  e2e: 'text-emerald-400',
  mock: 'text-amber-400',
  non_executable: 'text-foreground',
};

interface Props {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

/**
 * Command-dashboard variant — every capability visible at once as a dense
 * tile in a 3-column grid. Tiles carry their own power toggle, Run, and
 * Simulate actions so the user can act on any capability without drilling
 * in. Clicking a tile slides a bottom panel with history + config.
 *
 * Design intent: treat use cases as first-class runnable units; the grid
 * reflects their equal significance. Minimal hierarchy, maximum density.
 */
export function PersonaUseCasesTabGrid({
  draft, patch, modelDirty, credentials, connectorDefinitions,
}: Props) {
  const {
    selectedPersona,
    isExecuting,
    personaId,
    useCases,
    selectedUseCaseId,
    setSelectedUseCaseId,
    historyRefreshKey,
    handleExecute,
    handleRerun,
  } = useUseCasesTab();

  const {
    pendingUseCaseId, disableConfirmation, requestToggle, confirmDisable, cancelDisable, requestSimulate,
  } = useCapabilityToggle();

  const [detailTab, setDetailTab] = useState<'history' | 'config'>('history');

  const handleToggle = useCallback(
    (uc: UseCaseItem) => {
      if (!personaId) return;
      requestToggle(personaId, uc.id, uc.title, uc.enabled === false);
    },
    [personaId, requestToggle],
  );

  const handleSim = useCallback(
    (uc: UseCaseItem) => personaId && requestSimulate(personaId, uc.id),
    [personaId, requestSimulate],
  );

  if (!selectedPersona) return null;

  const activeCount = useCases.filter((u) => u.enabled !== false).length;
  const pausedCount = useCases.length - activeCount;

  const selected = useCases.find((u) => u.id === selectedUseCaseId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Top stats strip */}
      <div className="flex items-center gap-4 px-1 pb-3">
        <span className="typo-label uppercase tracking-wider text-foreground">Capabilities</span>
        <span className="typo-data font-mono text-foreground">{useCases.length}</span>
        <span className="typo-caption text-emerald-400">{activeCount} active</span>
        {pausedCount > 0 && <span className="typo-caption text-foreground/60">{pausedCount} paused</span>}
        <div className="ml-auto">
          <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} personaId={personaId} />
        </div>
      </div>

      {useCases.length === 0 ? (
        <EmptyState variant="use-cases-empty" />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 auto-rows-fr"
        >
          {useCases.map((uc) => {
            const enabled = uc.enabled !== false;
            const mode = uc.execution_mode ?? 'e2e';
            const active = isExecuting && selectedUseCaseId === uc.id;
            const triggerType = uc.suggested_trigger?.type ?? 'manual';
            const TIcon = TRIGGER_ICON[triggerType] ?? MousePointer;
            const isSelected = selectedUseCaseId === uc.id;
            return (
              <motion.div
                layout
                key={uc.id}
                onClick={() => setSelectedUseCaseId(isSelected ? null : uc.id)}
                className={`group relative rounded-xl border p-3 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-primary/40 bg-primary/[0.06]'
                    : enabled
                      ? 'border-primary/10 bg-secondary/30 hover:border-primary/25 hover:bg-secondary/40'
                      : 'border-primary/5 bg-secondary/10 opacity-70 hover:opacity-95'
                }`}
              >
                {/* Status dot + title */}
                <div className="flex items-start gap-2 mb-2">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    enabled ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-foreground/30'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <h4 className="typo-heading text-foreground/95 truncate">{uc.title}</h4>
                    {uc.category && (
                      <span className="typo-caption text-foreground/60 uppercase tracking-wider">
                        {uc.category.replace('-', ' ')}
                      </span>
                    )}
                  </div>
                  <span className={`typo-label ${MODE_TONE[mode]}`}>
                    {mode === 'e2e' ? 'E2E' : mode === 'mock' ? 'MOCK' : 'INFO'}
                  </span>
                </div>

                {/* Summary */}
                <p className="typo-body text-foreground/70 line-clamp-2 mb-2 min-h-[2.5rem]">
                  {uc.capability_summary ?? uc.description}
                </p>

                {/* Trigger + indicators */}
                <div className="flex items-center gap-2 mb-3 typo-caption">
                  <TIcon className="w-3 h-3 text-primary/60" />
                  <span className="text-foreground/70 truncate flex-1">
                    {uc.suggested_trigger?.description ?? triggerType}
                  </span>
                  {uc.model_override && (
                    <span title="Custom model"><Cpu className="w-3 h-3 text-primary/60" /></span>
                  )}
                  {(uc.notification_channels?.length ?? 0) > 0 && (
                    <span title="Notifications"><Bell className="w-3 h-3 text-amber-400/70" /></span>
                  )}
                </div>

                {/* Action row */}
                <div
                  className="flex items-center gap-1 pt-2 border-t border-primary/10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleToggle(uc)}
                    disabled={pendingUseCaseId === uc.id}
                    className={`p-1.5 rounded-lg border transition-colors ${
                      enabled
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/80 hover:bg-emerald-500/20'
                        : 'bg-secondary/40 border-primary/15 text-foreground hover:border-primary/30'
                    }`}
                    title={enabled ? 'Pause capability' : 'Activate capability'}
                  >
                    {enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleExecute(uc.id, uc.sample_input ?? undefined)}
                    disabled={!enabled || mode === 'non_executable' || (isExecuting && !active)}
                    className="p-1.5 rounded-lg border bg-secondary/40 border-primary/15 text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={`Run ${uc.title}`}
                  >
                    {active ? (
                      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                        <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-40" />
                        <span className="relative rounded-full h-2 w-2 bg-primary" />
                      </span>
                    ) : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleSim(uc)}
                    disabled={mode === 'non_executable' || (isExecuting && !active)}
                    className="p-1.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400/80 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Simulate — no notifications delivered"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                  </button>
                  <div className="ml-auto flex items-center gap-1 typo-caption text-foreground/50">
                    <Clock className="w-3 h-3" />
                    <span>history</span>
                    <ChevronRight className={`w-3 h-3 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Detail tray */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="mt-4 rounded-xl border border-primary/20 bg-secondary/40 backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
              <span className="typo-heading text-foreground/95 flex-1 truncate">{selected.title}</span>
              <div className="flex items-center gap-1 rounded-lg bg-secondary/60 border border-primary/10 p-0.5">
                {(['history', 'config'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={`px-2.5 py-1 rounded-md typo-caption transition-colors ${
                      detailTab === tab
                        ? 'bg-primary/15 text-primary'
                        : 'text-foreground/70 hover:text-foreground'
                    }`}
                  >
                    {tab === 'history' ? 'History' : 'Config'}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSelectedUseCaseId(null)}
                className="p-1 rounded hover:bg-primary/10 text-foreground/60"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[40vh] overflow-y-auto">
              {detailTab === 'history' ? (
                <UseCaseHistory
                  personaId={personaId}
                  useCaseId={selected.id}
                  onRerun={handleRerun}
                  refreshKey={historyRefreshKey}
                />
              ) : (
                <div className="p-3">
                  <UseCaseDetailPanel
                    useCaseId={selected.id}
                    credentials={credentials}
                    connectorDefinitions={connectorDefinitions}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
