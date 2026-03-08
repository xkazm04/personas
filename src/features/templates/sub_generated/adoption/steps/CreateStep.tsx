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
  ExternalLink,
} from 'lucide-react';
import { DraftEditStep } from '@/features/shared/components/draft-editor/DraftEditStep';
import { extractProtocolCapabilities } from '@/features/templates/sub_n8n/edit/protocolParser';
import { useAdoptionWizard } from '../AdoptionWizardContext';
import { SandboxWarningBanner } from '../../shared/SandboxWarningBanner';
import { ScanResultsBanner } from '../../shared/ScanResultsBanner';
import { N8nUseCasesTab } from '@/features/templates/sub_n8n/edit/N8nUseCasesTab';
import { N8nEntitiesTab } from '@/features/templates/sub_n8n/edit/N8nEntitiesTab';
import { useTemplateMotion } from '@/features/templates/animationPresets';
import { usePersonaStore } from '@/stores/personaStore';

export function CreateStep() {
  const { motion: MOTION } = useTemplateMotion();
  const {
    state,
    wizard,
    designResult,
    readinessStatuses,
    verification,
    safetyScan,
    updateDraft,
    startTransform,
    cleanupAll,
  } = useAdoptionWizard();

  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

  const {
    draft,
    created,
    partialEntityErrors,
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

  // Tab content for DraftEditStep
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
  const readyCount = readinessStatuses.filter((s) => s.health === 'ready').length;
  const allConnectorsReady = readyCount === readinessStatuses.length;

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
        className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', damping: 10, stiffness: 200 }}
          className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
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
          className="text-sm text-emerald-400/60 mb-4"
        >
          {draft.name ?? 'Your persona'} is ready to use.
        </motion.p>

        {partialEntityErrors.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="mx-auto max-w-xl text-left rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 mb-4"
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
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center gap-3"
        >
          <button
            onClick={() => {
              setSidebarSection('personas');
              onReset();
            }}
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
    <div className="space-y-3">
      {/* Step header */}
      <div>
        <h3 className="text-base font-semibold text-foreground">Review & Create</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Review the generated persona, then create it.
        </p>
      </div>

      {/* Safety warnings — above everything so user can't miss them */}
      <ScanResultsBanner result={safetyScan} scanning={false} />
      {verification.trustLevel !== 'verified' && (
        <SandboxWarningBanner verification={verification} />
      )}

      {/* Persona identity card (compact) */}
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg border flex-shrink-0"
            style={{
              backgroundColor: `${draft.color ?? '#8b5cf6'}18`,
              borderColor: `${draft.color ?? '#8b5cf6'}30`,
            }}
          >
            {draft.icon ?? '\u2728'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground/90">
              {draft.name ?? 'Unnamed Persona'}
            </p>
            <p className="text-sm text-muted-foreground/70 truncate">
              {draft.description ?? 'No description provided'}
            </p>
          </div>
        </div>

        {/* Inline entity badges + connector readiness */}
        <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-primary/8">
          {toolCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-blue-500/8 text-blue-400/70 border border-blue-500/10">
              <Wrench className="w-2.5 h-2.5" /> {toolCount} Tools
            </span>
          )}
          {triggerCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-amber-500/8 text-amber-400/70 border border-amber-500/10">
              <Zap className="w-2.5 h-2.5" /> {triggerCount} Triggers
            </span>
          )}
          {connectorCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-emerald-500/8 text-emerald-400/70 border border-emerald-500/10">
              <Link className="w-2.5 h-2.5" /> {connectorCount} Connectors
            </span>
          )}
          {channelCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-md bg-violet-500/8 text-violet-400/70 border border-violet-500/10">
              <Bell className="w-2.5 h-2.5" /> {channelCount} Channels
            </span>
          )}
          {readinessStatuses.length > 0 && (
            <span className={`ml-auto text-sm ${allConnectorsReady ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
              {allConnectorsReady ? 'All connectors ready' : `${readyCount}/${readinessStatuses.length} ready`}
            </span>
          )}
        </div>

        {/* Protocol capabilities */}
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {capabilities.map((cap) => (
              <span
                key={cap.type}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-full bg-cyan-500/8 text-cyan-400/60 border border-cyan-500/10"
                title={cap.context}
              >
                <Shield className="w-2.5 h-2.5" />
                {cap.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Creation summary */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
        <span className="text-sm text-muted-foreground/60">
          Will create: 1 persona
          {toolCount > 0 && `, ${toolCount} tool${toolCount !== 1 ? 's' : ''}`}
          {triggerCount > 0 && `, ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}`}
          {connectorCount > 0 && `, ${connectorCount} connector subscription${connectorCount !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Readiness checklist */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className={`inline-flex items-center gap-1 ${draft.name ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {draft.name ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          Name
        </span>
        <span className={`inline-flex items-center gap-1 ${draft.system_prompt?.trim() ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {draft.system_prompt?.trim() ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          Prompt
        </span>
        {readinessStatuses.length > 0 && (
          <span className={`inline-flex items-center gap-1 ${allConnectorsReady ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
            {allConnectorsReady ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            Connectors
          </span>
        )}
        {(safetyScan?.critical.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 text-red-400/60">
            <AlertTriangle className="w-3 h-3" />
            Safety issues
          </span>
        )}
      </div>

      {/* Edit Details */}
      <div>
        <button
          onClick={onToggleEditInline}
          className="flex items-center gap-2 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full py-1.5"
        >
          {showEditInline ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span>Edit Details</span>
        </button>

        <AnimatePresence>
          {showEditInline && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={MOTION.smooth.framer}
              className="overflow-hidden"
            >
              <div className="min-h-[400px] rounded-xl border border-primary/10 bg-secondary/10 p-4">
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
    </div>
  );
}
