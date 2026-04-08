import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred');
import type { AutoCredMode } from '../helpers/types';
import { useAutoCredSession } from '../helpers/useAutoCredSession';
import { tauriPlaywrightAdapter, tauriGuidedAdapter } from '../helpers/TauriPlaywrightAdapter';
import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { useVaultStore } from '@/stores/vaultStore';
import { UniversalAutoCredInputPhase } from './UniversalAutoCredInputPhase';
import { UniversalAutoCredRunningPhase } from './UniversalAutoCredRunningPhase';
import { buildUniversalDesignResult } from './universalAutoCredHelpers';

type Phase = 'input' | 'running';

interface UniversalAutoCredPanelProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function UniversalAutoCredPanel({ onComplete, onCancel }: UniversalAutoCredPanelProps) {
  const [phase, setPhase] = useState<Phase>('input');
  const [serviceUrl, setServiceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<AutoCredMode>('playwright');
  const [modeChecked, setModeChecked] = useState(false);
  const [universalSaving, setUniversalSaving] = useState(false);

  const createConnectorDefinition = useVaultStore((s) => s.createConnectorDefinition);
  const createCredential = useVaultStore((s) => s.createCredential);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);

  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => { setMode(available ? 'playwright' : 'guided'); setModeChecked(true); })
      .catch(() => { setMode('guided'); setModeChecked(true); });
  }, []);

  const adapter = mode === 'guided' ? tauriGuidedAdapter : tauriPlaywrightAdapter;
  const session = useAutoCredSession({ adapter });

  const sessionPhaseRef = useRef(session.phase);
  sessionPhaseRef.current = session.phase;
  const cancelBrowserRef = useRef(session.cancelBrowser);
  cancelBrowserRef.current = session.cancelBrowser;
  useEffect(() => () => { if (sessionPhaseRef.current === 'browser') cancelBrowserRef.current(); }, []);

  const isValidUrl = useMemo(() => {
    try { const url = new URL(serviceUrl); return url.protocol === 'http:' || url.protocol === 'https:'; }
    catch { return false; }
  }, [serviceUrl]);

  const handleStart = useCallback(() => {
    if (!isValidUrl || !modeChecked) return;
    session.init(buildUniversalDesignResult(serviceUrl, description));
    setPhase('running');
  }, [serviceUrl, description, isValidUrl, modeChecked, session]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (phase === 'running' && session.phase === 'consent' && !autoStarted.current) {
      autoStarted.current = true;
      session.startBrowser();
    }
  }, [phase, session.phase, session.startBrowser]);

  const handleCancel = () => { session.reset(); autoStarted.current = false; setPhase('input'); };

  /** Save for universal mode: create connector definition + credential. */
  const handleUniversalSave = useCallback(async () => {
    if (universalSaving) return;
    setUniversalSaving(true);

    try {
      const dc = session.discoveredConnector;
      const df = session.discoveredFields;
      const connectorName = dc?.name || `universal_${Date.now()}`;
      const connectorLabel = dc?.label || 'Service';

      const rawFields = df ?? Object.keys(session.extractedValues)
        .filter((k) => !k.startsWith('__'))
        .map((key) => ({
          key,
          label: key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          type: 'text' as const,
          required: true,
          help_text: undefined as string | undefined,
        }));
      const fields = rawFields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type || 'text',
        required: f.required,
        helpText: f.help_text,
      }));

      const existing = connectorDefinitions.find(
        (c) => c.name.toLowerCase() === connectorName.toLowerCase(),
      );

      let serviceType = connectorName;
      if (!existing) {
        const healthcheckConfig = dc?.healthcheck_url
          ? { url: dc.healthcheck_url, method: 'GET', expected_status: 200 }
          : null;

        await createConnectorDefinition({
          name: connectorName,
          label: connectorLabel,
          category: dc?.category || 'api',
          color: dc?.color || '#6366f1',
          fields: JSON.stringify(fields),
          healthcheck_config: JSON.stringify(healthcheckConfig),
          services: JSON.stringify([]),
          events: JSON.stringify([]),
          metadata: JSON.stringify({
            template_enabled: true,
            setup_instructions: description,
            summary: `Auto-discovered credential for ${connectorLabel}`,
            universal_source_url: serviceUrl,
          }),
          is_builtin: false,
        });
      } else {
        serviceType = existing.name;
      }

      const cleanValues: Record<string, string> = {};
      for (const [key, val] of Object.entries(session.extractedValues)) {
        if (!key.startsWith('__')) {
          cleanValues[key] = val;
        }
      }

      await createCredential({
        name: session.credentialName.trim() || `${connectorLabel} Credential`,
        service_type: serviceType,
        data: cleanValues,
        healthcheck_passed: session.healthResult?.success === true,
      });

      await fetchCredentials();
      session.reset();
      setPhase('input');
      onComplete();
    } catch (err) {
      logger.error('Universal save failed', { error: String(err) });
      setUniversalSaving(false);
    }
  }, [
    universalSaving, session, connectorDefinitions, createConnectorDefinition,
    createCredential, fetchCredentials, description, serviceUrl, onComplete,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && isValidUrl) {
      e.preventDefault();
      handleStart();
    }
  };

  if (phase === 'input') {
    return (
      <UniversalAutoCredInputPhase
        serviceUrl={serviceUrl}
        onServiceUrlChange={setServiceUrl}
        description={description}
        onDescriptionChange={setDescription}
        isValidUrl={isValidUrl}
        modeChecked={modeChecked}
        mode={mode}
        onStart={handleStart}
        onCancel={onCancel}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <UniversalAutoCredRunningPhase
      session={session}
      mode={mode}
      universalSaving={universalSaving}
      onUniversalSave={handleUniversalSave}
      onCancel={handleCancel}
      onComplete={onComplete}
    />
  );
}
