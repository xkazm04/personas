import { useState, useEffect, useMemo, useCallback } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { useVaultStore } from "@/stores/vaultStore";
import { useAutomationDesign } from '@/hooks/design/core/useAutomationDesign';
import type { AutomationPlatform } from '@/lib/bindings/AutomationPlatform';
import type { AutomationFallbackMode } from '@/lib/bindings/AutomationFallbackMode';
import type { CredentialMetadata } from '@/lib/types/types';
import type { DeployAutomationResult } from '@/api/agents/automations';
import { PLATFORM_TO_SERVICE_TYPE } from './automationSetupConstants';
import { usePlatformData } from './usePlatformData';
import { clampTimeoutSecs } from './useAutomationSetup';

export function useAutomationSetupState(personaId: string, editAutomationId?: string | null) {
  const design = useAutomationDesign();
  const automations = useVaultStore((s) => s.automations);
  const editAutomation = editAutomationId
    ? automations.find((a) => a.id === editAutomationId) ?? null
    : null;
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<AutomationPlatform>('n8n');
  const [inputSchema, setInputSchema] = useState('');
  const [timeoutSecs, setTimeoutSecs] = useState(30);
  const [fallbackMode, setFallbackMode] = useState<AutomationFallbackMode>('connector');
  const [platformCredentialId, setPlatformCredentialId] = useState<string | null>(null);

  const [localPhase, setLocalPhase] = useState<'deploying' | 'success' | null>(null);
  const [deployResult, setDeployResult] = useState<DeployAutomationResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const deployAutomation = useVaultStore((s) => s.deployAutomation);
  const fetchAutomations = useVaultStore((s) => s.fetchAutomations);

  const platformServiceType = PLATFORM_TO_SERVICE_TYPE[platform];
  const platformCredentials = useMemo(() => {
    if (!platformServiceType) return [];
    return credentials.filter((c: CredentialMetadata) => c.service_type === platformServiceType);
  }, [credentials, platformServiceType]);
  const hasPlatformCredential = platformCredentials.length > 0;
  const needsCredential = platformServiceType !== null;

  const platformConnector = useMemo(() => {
    if (!platformServiceType) return null;
    return connectorDefinitions.find((c) => c.name === platformServiceType) ?? null;
  }, [connectorDefinitions, platformServiceType]);

  const platformData = usePlatformData(platform, platformCredentialId);

  useEffect(() => {
    if (editAutomation) {
      setPlatform(editAutomation.platform);
      setName(editAutomation.name);
      setDescription(editAutomation.description);
      setFallbackMode(editAutomation.fallbackMode);
      // Clamp to keep an out-of-range stored value (legacy row, manual DB
      // edit, undefined timeoutMs producing NaN via /1000) from immediately
      // re-deploying the same out-of-range value when the user clicks
      // Deploy without changing the field.
      setTimeoutSecs(clampTimeoutSecs(Math.round(Number(editAutomation.timeoutMs) / 1000)));
      if (editAutomation.inputSchema) setInputSchema(editAutomation.inputSchema);
      if (editAutomation.platformCredentialId) setPlatformCredentialId(editAutomation.platformCredentialId);
    }
  }, [editAutomation]);

  useEffect(() => {
    if (platformCredentials.length > 0 && !platformCredentialId) {
      setPlatformCredentialId(platformCredentials[0]!.id);
    } else if (platformCredentials.length === 0) {
      setPlatformCredentialId(null);
    }
  }, [platformCredentials, platformCredentialId]);

  useEffect(() => {
    if (design.phase !== 'analyzing') { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [design.phase]);

  useEffect(() => {
    if (design.result) {
      setName(design.result.name);
      setPlatform(design.result.platform);
      setInputSchema(design.result.input_schema || '');
      // Clamp the LLM-suggested timeout in case the model returns 0,
      // a negative, or absurdly large value — clampTimeoutSecs handles
      // NaN/Infinity by returning the default and clamps into [1, 3600].
      setTimeoutSecs(clampTimeoutSecs(design.result.timeout_secs ?? 30));
      setFallbackMode(design.result.fallback_mode || 'connector');
    }
  }, [design.result]);

  const handleDesign = useCallback(() => {
    if (!description.trim()) return;
    design.start(personaId, description.trim());
  }, [description, design, personaId]);

  const handleDeploy = async () => {
    if (!name.trim() || !platformCredentialId) return;
    const mergedDesign = {
      ...design.result,
      name: name.trim(),
      input_schema: inputSchema.trim() || null,
      // Final-line clamp before IPC: even if the local state is somehow
      // out of range (manual DOM injection, race with design.result update,
      // future prop-bypass), the backend never sees an invalid timeout.
      timeout_secs: clampTimeoutSecs(timeoutSecs),
      fallback_mode: fallbackMode,
    };
    setLocalPhase('deploying');
    setDeployError(null);
    try {
      const result = await deployAutomation({
        personaId,
        credentialId: platformCredentialId,
        designResult: mergedDesign as Parameters<typeof deployAutomation>[0]['designResult'],
        githubRepo: platform === 'github_actions' ? platformData.githubRepo : null,
        useCaseId: null,
      });
      if (result) {
        setDeployResult(result);
        setLocalPhase('success');
        void fetchAutomations(personaId);
      } else {
        setLocalPhase(null);
        setDeployError('Deployment failed. Check your platform credentials and try again.');
      }
    } catch (err) {
      setLocalPhase(null);
      setDeployError(errMsg(err, 'Automation deployment failed'));
    }
  };

  const handleClose = useCallback(() => {
    design.reset();
    setDescription('');
    setShowAdvanced(false);
    setName('');
    setInputSchema('');
    setTimeoutSecs(30);
    setFallbackMode('connector');
    setPlatformCredentialId(null);
    platformData.resetPlatformData();
    setLocalPhase(null);
    setDeployResult(null);
    setDeployError(null);
  }, [design, platformData]);

  const canDesign = description.trim().length > 0
    && (!needsCredential || hasPlatformCredential)
    && (platform !== 'github_actions' || !!platformData.githubRepo);

  return {
    design, editAutomation,
    description, setDescription,
    showAdvanced, setShowAdvanced,
    name, setName,
    platform, setPlatform,
    inputSchema, setInputSchema,
    timeoutSecs, setTimeoutSecs,
    fallbackMode, setFallbackMode,
    platformCredentialId, setPlatformCredentialId,
    ...platformData,
    localPhase, deployResult, deployError, setDeployError, setLocalPhase,
    elapsed,
    platformCredentials, hasPlatformCredential, needsCredential, platformConnector,
    handleDesign, handleDeploy, handleClose,
    canDesign,
  };
}
