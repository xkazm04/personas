import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Wrench, Workflow } from 'lucide-react';
import { extractProtocolCapabilities } from '@/features/templates/sub_n8n/edit/protocolParser';
import { useAdoptionWizard } from '../../AdoptionWizardContext';
import { SandboxWarningBanner } from '../../../shared/SandboxWarningBanner';
import { ScanResultsBanner } from '../../../shared/ScanResultsBanner';
import { N8nUseCasesTab } from '@/features/templates/sub_n8n/edit/N8nUseCasesTab';
import { N8nEntitiesTab } from '@/features/templates/sub_n8n/edit/N8nEntitiesTab';
import { useTemplateMotion } from '@/features/templates/animationPresets';
import { useSystemStore } from "@/stores/systemStore";
import { CreateSuccessState } from './CreateSuccessState';
import { CreateIdentityCard } from './CreateIdentityCard';
import { CreateReadinessChecklist } from './CreateReadinessChecklist';
import { CreateEditDetails } from './CreateEditDetails';
import { PromptQualityGate } from './PromptQualityGate';

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

  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

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
  const onReset = async () => { await cleanupAll(); wizard.reset(); };
  const onDraftUpdated = wizard.draftUpdated;
  const onJsonEdited = wizard.draftJsonEdited;
  const onAdjustmentChange = wizard.setAdjustment;
  const onApplyAdjustment = () => void startTransform();

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
    () => draft ? extractProtocolCapabilities(draft.system_prompt, draft.structured_prompt as Record<string, unknown> | null) : [],
    [draft?.system_prompt, draft?.structured_prompt],
  );

  // A. Success state
  if (created && draft) {
    return (
      <CreateSuccessState
        draft={draft}
        partialEntityErrors={partialEntityErrors}
        onOpenInEditor={() => {
          setSidebarSection('personas');
          onReset();
        }}
        onReset={onReset}
      />
    );
  }

  if (!draft) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 rounded-full border-2 border-muted-foreground/20 border-t-violet-400/60" />
        <p className="text-sm text-muted-foreground/60">Waiting for persona draft...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">Review & Create</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">Review the generated persona, then create it.</p>
      </div>
      <PromptQualityGate draft={draft} />
      <ScanResultsBanner result={safetyScan} scanning={false} />
      {verification.trustLevel !== 'verified' && <SandboxWarningBanner verification={verification} />}
      <CreateIdentityCard
        draft={draft}
        toolCount={toolCount}
        triggerCount={triggerCount}
        connectorCount={connectorCount}
        channelCount={channelCount}
        readinessStatuses={readinessStatuses}
        readyCount={readyCount}
        allConnectorsReady={allConnectorsReady}
        capabilities={capabilities}
      />

      <CreateReadinessChecklist
        draft={draft}
        readinessStatuses={readinessStatuses}
        allConnectorsReady={allConnectorsReady}
        safetyScan={safetyScan}
        safetyCriticalOverride={state.safetyCriticalOverride}
        confirming={confirming}
        onSafetyCriticalOverrideChange={(checked) => wizard.setSafetyCriticalOverride(checked)}
        toolCount={toolCount}
        triggerCount={triggerCount}
        connectorCount={connectorCount}
      />

      <CreateEditDetails
        showEditInline={showEditInline}
        onToggle={onToggleEditInline}
        draft={draft}
        draftJson={draftJson}
        draftJsonError={draftJsonError}
        adjustmentRequest={adjustmentRequest}
        transforming={transforming}
        confirming={confirming}
        updateDraft={updateDraft}
        onDraftUpdated={onDraftUpdated}
        onJsonEdited={onJsonEdited}
        onAdjustmentChange={onAdjustmentChange}
        onApplyAdjustment={onApplyAdjustment}
        earlyTabs={earlyTabs}
        additionalTabs={additionalTabs}
        motionConfig={MOTION.smooth}
      />
    </div>
  );
}
