import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Zap,
  Link,
  Bell,
  RefreshCw,
  AlertTriangle,
  Shield,
  Workflow,
} from 'lucide-react';
import { DraftEditStep } from '@/features/shared/components/draft-editor/DraftEditStep';
import { extractProtocolCapabilities } from '@/features/templates/sub_n8n/edit/protocolParser';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { N8nUseCasesTab } from '@/features/templates/sub_n8n/edit/N8nUseCasesTab';
import { N8nEntitiesTab } from '@/features/templates/sub_n8n/edit/N8nEntitiesTab';

export function CreateStep() {
  const {
    state,
    wizard,
    designResult,
    readinessStatuses,
    updateDraft,
    startTransform,
    cleanupAll,
  } = useAdoptionWizard();

  const {
    draft,
    created,
    showEditInline,
    confirming,
    draftJson,
    draftJsonError,
    adjustmentRequest,
    transforming,
  } = state;

  const onToggleEditInline = wizard.toggleEditInline;
  const onReset = async () => {
    await cleanupAll();
    wizard.reset();
  };
  const onDraftUpdated = wizard.draftUpdated;
  const onJsonEdited = wizard.draftJsonEdited;
  const onAdjustmentChange = wizard.setAdjustment;
  const onApplyAdjustment = () => void startTransform();

  // Build tabs for DraftEditStep
  const earlyTabs = useMemo(() => {
    if (!draft) return [];
    return [{
      id: 'use-cases',
      label: 'Use Cases',
      Icon: Workflow,
      content: (
        <N8nUseCasesTab
          draft={draft}
          adjustmentRequest={adjustmentRequest}
          transforming={transforming}
          disabled={transforming || confirming}
          onAdjustmentChange={onAdjustmentChange}
          onApplyAdjustment={onApplyAdjustment}
        />
      ),
    }];
  }, [draft, adjustmentRequest, transforming, confirming]);

  const additionalTabs = useMemo(() => {
    if (!draft || !designResult) return [];
    return [{
      id: 'entities',
      label: 'Tools & Connectors',
      Icon: Wrench,
      content: (
        <N8nEntitiesTab
          draft={draft}
          parsedResult={designResult}
          selectedToolIndices={state.selectedToolIndices}
          selectedTriggerIndices={state.selectedTriggerIndices}
          selectedConnectorNames={state.selectedConnectorNames}
          updateDraft={updateDraft}
        />
      ),
    }];
  }, [draft, designResult, state.selectedToolIndices, state.selectedTriggerIndices, state.selectedConnectorNames, updateDraft]);
  const toolCount = designResult?.suggested_tools?.length ?? 0;
  const triggerCount = designResult?.suggested_triggers?.length ?? 0;
  const connectorCount = designResult?.suggested_connectors?.length ?? 0;
  const channelCount = designResult?.suggested_notification_channels?.length ?? 0;
  const connectorsNeedingSetup = readinessStatuses.filter((s) => s.health !== 'ready');
  const readyCount = readinessStatuses.filter((s) => s.health === 'ready').length;

  const capabilities = useMemo(
    () =>
      draft
        ? extractProtocolCapabilities(
            draft.system_prompt,
            draft.structured_prompt as Record<string, unknown> | null,
          )
        : [],
    [draft?.system_prompt, draft?.structured_prompt],
  );

  // ── A. Success state ────────────────────────────────────────────────
  if (created && draft) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 15, stiffness: 300 }}
        className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', damping: 10, stiffness: 200 }}
          className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-sm font-semibold text-emerald-400 mb-1"
        >
          Persona Created Successfully
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-sm text-emerald-400/60 mb-3"
        >
          {draft.name ?? 'Your persona'} is ready to use. Find it in the sidebar.
        </motion.p>
        {connectorsNeedingSetup.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="flex items-center gap-2 justify-center text-xs text-amber-400/60 mb-3"
          >
            <AlertTriangle className="w-3 h-3" />
            Configure connector{connectorsNeedingSetup.length !== 1 ? 's' : ''}:{' '}
            {connectorsNeedingSetup.map((s) => s.connector_name).join(', ')}
          </motion.div>
        )}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center gap-3"
        >
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Adopt Another
          </button>
        </motion.div>
      </motion.div>
    );
  }

  // ── C. No draft state ───────────────────────────────────────────────
  if (!draft) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 rounded-full border-2 border-muted-foreground/20 border-t-violet-400/60"
        />
        <p className="text-sm text-muted-foreground/60">
          Waiting for persona draft...
        </p>
      </div>
    );
  }

  // ── B. Preview + Edit ───────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Persona preview card */}
      <div className="rounded-2xl border border-primary/10 bg-secondary/20 p-5">
        {/* Icon + name + description */}
        <div className="flex items-center gap-4 mb-5">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="w-14 h-14 rounded-xl flex items-center justify-center text-xl border shadow-lg flex-shrink-0"
            style={{
              backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
              borderColor: `${draft.color ?? '#8b5cf6'}30`,
              boxShadow: `0 4px 24px ${draft.color ?? '#8b5cf6'}15`,
            }}
          >
            {draft.icon ?? '\u2728'}
          </motion.div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground/90">
              {draft.name ?? 'Unnamed Persona'}
            </p>
            <p className="text-sm text-muted-foreground/90 mt-0.5">
              {draft.description ?? 'No description provided'}
            </p>
          </div>
        </div>

        {/* Entity summary grid */}
        {(toolCount > 0 || triggerCount > 0 || connectorCount > 0 || channelCount > 0) && (
          <div
            className={`grid gap-2 mb-4 ${
              channelCount > 0 ? 'grid-cols-4' : connectorCount > 0 ? 'grid-cols-3' : 'grid-cols-2'
            }`}
          >
            {toolCount > 0 && (
              <div className="px-3 py-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
                <Wrench className="w-4 h-4 text-blue-400/60 mx-auto mb-1" />
                <p className="text-lg font-semibold text-foreground/80">{toolCount}</p>
                <p className="text-xs text-muted-foreground/80 uppercase tracking-wider">Tools</p>
              </div>
            )}
            {triggerCount > 0 && (
              <div className="px-3 py-3 rounded-xl bg-amber-500/5 border border-amber-500/10 text-center">
                <Zap className="w-4 h-4 text-amber-400/60 mx-auto mb-1" />
                <p className="text-lg font-semibold text-foreground/80">{triggerCount}</p>
                <p className="text-xs text-muted-foreground/80 uppercase tracking-wider">Triggers</p>
              </div>
            )}
            {connectorCount > 0 && (
              <div className="px-3 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                <Link className="w-4 h-4 text-emerald-400/60 mx-auto mb-1" />
                <p className="text-lg font-semibold text-foreground/80">{connectorCount}</p>
                <p className="text-xs text-muted-foreground/80 uppercase tracking-wider">Connectors</p>
              </div>
            )}
            {channelCount > 0 && (
              <div className="px-3 py-3 rounded-xl bg-violet-500/5 border border-violet-500/10 text-center">
                <Bell className="w-4 h-4 text-violet-400/60 mx-auto mb-1" />
                <p className="text-lg font-semibold text-foreground/80">{channelCount}</p>
                <p className="text-xs text-muted-foreground/80 uppercase tracking-wider">Channels</p>
              </div>
            )}
          </div>
        )}

        {/* Connector readiness progress bar */}
        {readinessStatuses.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground/50">
                Connector Readiness
              </span>
              <span className="text-xs text-emerald-400/80">
                {readyCount} of {readinessStatuses.length} ready
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{
                  width: `${readinessStatuses.length > 0 ? (readyCount / readinessStatuses.length) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="mt-2 space-y-1.5">
              {readinessStatuses.map((s) => (
                <div key={s.connector_name} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      s.health === 'ready' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <span className="text-foreground/70">{s.connector_name}</span>
                  <span className="text-muted-foreground/40 ml-auto">
                    {s.health === 'ready' ? 'Ready' : 'Needs setup'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol capability badges */}
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {capabilities.map((cap) => (
              <span
                key={cap.type}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/15"
                title={cap.context}
              >
                <Shield className="w-3 h-3" />
                {cap.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Edit Details expandable section */}
      <div>
        <button
          onClick={onToggleEditInline}
          className="flex items-center gap-2 text-sm text-muted-foreground/90 hover:text-muted-foreground transition-colors w-full py-2"
        >
          {showEditInline ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <span>Edit Details</span>
        </button>

        <AnimatePresence>
          {showEditInline && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="min-h-[400px] rounded-2xl border border-primary/10 bg-secondary/10 p-4">
                <DraftEditStep
                  draft={draft}
                  draftJson={draftJson}
                  draftJsonError={draftJsonError}
                  adjustmentRequest={adjustmentRequest}
                  transforming={transforming}
                  disabled={confirming}
                  updateDraft={updateDraft}
                  onDraftUpdated={onDraftUpdated}
                  onJsonEdited={onJsonEdited}
                  onAdjustmentChange={onAdjustmentChange}
                  onApplyAdjustment={onApplyAdjustment}
                  earlyTabs={earlyTabs}
                  additionalTabs={additionalTabs}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Confirmation hint */}
      {!created && (
        <p className="text-xs text-amber-300/60 text-center">
          Review the details above, then click &ldquo;Create Persona&rdquo; to save.
        </p>
      )}
    </div>
  );
}
