import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Power, PowerOff, Play, FlaskConical, ChevronDown, Cpu, Bell, X } from 'lucide-react';
import { GlyphGrid } from '@/features/shared/glyph';
import type { GlyphRow } from '@/features/shared/glyph';
import {
  buildChronology,
  buildFlowLookup,
} from '@/features/templates/sub_generated/adoption/chronology/useUseCaseChronology';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { UseCaseHistory } from '@/features/shared/components/use-cases/UseCaseHistory';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { CapabilityDisableDialog } from './CapabilityDisableDialog';
import { CapabilityPolicyControls } from './CapabilityPolicyControls';
import { DefaultModelSection } from './DefaultModelSection';
import { UseCasesRefineCard } from './UseCasesRefineCard';
import { UseCaseDetailPanel } from '../detail/UseCaseDetailPanel';

interface Props {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

const MODE_TONE: Record<string, string> = {
  e2e: 'text-emerald-400 border-emerald-400/25 bg-emerald-500/10',
  mock: 'text-amber-400 border-amber-400/25 bg-amber-500/10',
  non_executable: 'text-foreground/70 border-primary/15 bg-primary/5',
};
const MODE_LABEL: Record<string, string> = { e2e: 'E2E', mock: 'MOCK', non_executable: 'INFO' };

function parseDesignResult(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

/** Enriched Glyph variant for view-mode persona use-cases. Mirrors every
 *  feature of `PersonaUseCasesTabGrid` — toggle / run / simulate, mode badge,
 *  policy chips, shared detail tray — on top of the sigil-first visual. */
export function PersonaUseCasesTabGlyph({ draft, patch, modelDirty, credentials, connectorDefinitions }: Props) {
  const {
    selectedPersona, isExecuting, personaId, useCases,
    selectedUseCaseId, setSelectedUseCaseId, historyRefreshKey,
    handleExecute, handleRerun,
  } = useUseCasesTab();
  const {
    pendingUseCaseId, disableConfirmation, requestToggle, confirmDisable, cancelDisable, requestSimulate,
  } = useCapabilityToggle();

  const [detailTab, setDetailTab] = useState<'history' | 'config'>('history');

  const [memoriesDefault, setMemoriesDefault] = useState(true);
  const [reviewsDefault, setReviewsDefault] = useState(true);
  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    Promise.all([
      getMemoryCount(personaId).catch(() => 0),
      listManualReviews(personaId).then((rs) => rs.length).catch(() => 0),
    ]).then(([memCount, revCount]) => {
      if (cancelled) return;
      setMemoriesDefault(memCount > 0);
      setReviewsDefault(revCount > 0);
    });
    return () => { cancelled = true; };
  }, [personaId]);

  const { rows, flowsById } = useMemo(() => {
    const ir = parseDesignResult(selectedPersona?.last_design_result ?? null);
    return { rows: buildChronology(ir), flowsById: buildFlowLookup(ir) };
  }, [selectedPersona?.last_design_result]);

  // Index use cases by id so we can enrich each GlyphRow with live action data.
  const useCaseById = useMemo(() => {
    const map = new Map<string, UseCaseItem>();
    for (const uc of useCases) map.set(uc.id, uc);
    return map;
  }, [useCases]);

  const handleToggle = useCallback((uc: UseCaseItem) => {
    if (!personaId) return;
    requestToggle(personaId, uc.id, uc.title, uc.enabled === false);
  }, [personaId, requestToggle]);

  const handleSim = useCallback(
    (uc: UseCaseItem) => personaId && requestSimulate(personaId, uc.id),
    [personaId, requestSimulate],
  );

  if (!selectedPersona) {
    return <EmptyState title="No persona selected" description="Pick a persona from the sidebar." />;
  }

  const activeCount = useCases.filter((u) => u.enabled !== false).length;
  const pausedCount = useCases.length - activeCount;
  const selectedUc = selectedUseCaseId ? useCaseById.get(selectedUseCaseId) ?? null : null;

  const renderStatusDot = (row: GlyphRow) => {
    const uc = useCaseById.get(row.id);
    if (!uc) return null;
    return uc.enabled !== false ? ('active' as const) : ('paused' as const);
  };

  const renderHeaderBadge = (row: GlyphRow) => {
    const uc = useCaseById.get(row.id);
    if (!uc) return null;
    const mode = uc.execution_mode ?? 'e2e';
    return (
      <span className={`typo-label px-1.5 py-0.5 rounded border shrink-0 ${MODE_TONE[mode] ?? MODE_TONE.e2e}`}>
        {MODE_LABEL[mode] ?? mode.toUpperCase()}
      </span>
    );
  };

  const renderFooterSlot = (row: GlyphRow) => {
    const uc = useCaseById.get(row.id);
    if (!uc) return null;
    const enabled = uc.enabled !== false;
    const mode = uc.execution_mode ?? 'e2e';
    const active = isExecuting && selectedUseCaseId === uc.id;
    const isSelected = selectedUseCaseId === uc.id;

    return (
      <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Extra metadata strip */}
        <div className="flex items-center gap-2 typo-caption text-foreground/65">
          {uc.category && (
            <span className="uppercase tracking-wider">{uc.category.replace(/-/g, ' ')}</span>
          )}
          {uc.model_override && (
            <span title="Custom model" className="inline-flex items-center gap-1"><Cpu className="w-3 h-3" />model</span>
          )}
          {(uc.notification_channels?.length ?? 0) > 0 && (
            <span title="Notifications" className="inline-flex items-center gap-1"><Bell className="w-3 h-3 text-amber-400/70" />notify</span>
          )}
        </div>

        {personaId && (
          <div className="pt-1 border-t border-card-border/50">
            <CapabilityPolicyControls
              personaId={personaId}
              useCase={uc}
              memoriesDefault={memoriesDefault}
              reviewsDefault={reviewsDefault}
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-1 border-t border-card-border/50">
          <button
            type="button"
            onClick={() => handleToggle(uc)}
            disabled={pendingUseCaseId === uc.id}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              enabled
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/80 hover:bg-emerald-500/20'
                : 'bg-secondary/40 border-card-border text-foreground hover:border-primary/30'
            }`}
            title={enabled ? 'Pause capability' : 'Activate capability'}
          >
            {enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => handleExecute(uc.id, uc.sample_input ?? undefined)}
            disabled={!enabled || mode === 'non_executable' || (isExecuting && !active)}
            className="p-1.5 rounded-lg border bg-secondary/40 border-card-border text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
            type="button"
            onClick={() => handleSim(uc)}
            disabled={mode === 'non_executable' || (isExecuting && !active)}
            className="p-1.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400/80 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Simulate — no notifications delivered"
          >
            <FlaskConical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSelectedUseCaseId(isSelected ? null : uc.id)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/40 border border-card-border typo-caption text-foreground/70 hover:text-foreground hover:border-primary/25 cursor-pointer transition-colors"
            title="History & config"
          >
            Details
            <ChevronDown className={`w-3 h-3 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Refine card + stats strip */}
      {personaId && (
        <div className="pb-3 flex-shrink-0">
          <UseCasesRefineCard personaId={personaId} />
        </div>
      )}
      <div className="flex items-center gap-4 px-1 pb-3 flex-shrink-0">
        <span className="typo-label uppercase tracking-wider text-foreground">Capabilities</span>
        <span className="typo-data font-mono text-foreground">{useCases.length}</span>
        <span className="typo-caption text-emerald-400">{activeCount} active</span>
        {pausedCount > 0 && <span className="typo-caption text-foreground/60">{pausedCount} paused</span>}
        <div className="ml-auto">
          <DefaultModelSection draft={draft} patch={patch} modelDirty={modelDirty} personaId={personaId} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pb-6">
        <GlyphGrid
          rows={rows}
          flowsById={flowsById}
          templateName={selectedPersona.name}
          emptyLabel="This persona has no v3 capability data — switch to the grid view."
          renderStatusDot={renderStatusDot}
          renderHeaderBadge={renderHeaderBadge}
          renderFooterSlot={renderFooterSlot}
          slotBelow={
            <AnimatePresence>
              {selectedUc && (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 24 }}
                  className="mt-4 rounded-xl border border-primary/20 bg-secondary/40 backdrop-blur-sm"
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
                    <span className="typo-heading text-foreground/95 flex-1 truncate">{selectedUc.title}</span>
                    <div className="flex items-center gap-1 rounded-lg bg-secondary/60 border border-primary/10 p-0.5">
                      {(['history', 'config'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setDetailTab(tab)}
                          className={`px-2.5 py-1 rounded-md typo-caption transition-colors cursor-pointer ${
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
                      type="button"
                      onClick={() => setSelectedUseCaseId(null)}
                      className="p-1 rounded hover:bg-primary/10 text-foreground/60 cursor-pointer"
                      title="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-[40vh] overflow-y-auto">
                    {detailTab === 'history' ? (
                      <UseCaseHistory
                        personaId={personaId}
                        useCaseId={selectedUc.id}
                        onRerun={handleRerun}
                        refreshKey={historyRefreshKey}
                      />
                    ) : (
                      <div className="p-3">
                        <UseCaseDetailPanel
                          useCaseId={selectedUc.id}
                          credentials={credentials}
                          connectorDefinitions={connectorDefinitions}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          }
        />
      </div>

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
