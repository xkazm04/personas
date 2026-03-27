import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Globe, Sparkles, ArrowRight, CheckCircle2, Link2, MessageSquareText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred');
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { TRANSITION_SLOW } from '@/features/templates/animationPresets';
import type { CredentialDesignResult, CredentialDesignConnector } from '@/hooks/design/credential/useCredentialDesign';
import type { AutoCredMode } from '../helpers/types';
import { useAutoCredSession } from '../helpers/useAutoCredSession';
import { tauriPlaywrightAdapter, tauriGuidedAdapter } from '../helpers/TauriPlaywrightAdapter';
import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredBrowserError } from './AutoCredBrowserError';
import { AutoCredErrorDisplay } from '../display/AutoCredErrorDisplay';
import { UniversalAutoCredReview } from './UniversalAutoCredReview';
import { useVaultStore } from '@/stores/vaultStore';

type Phase = 'input' | 'running';

interface UniversalAutoCredPanelProps {
  onComplete: () => void;
  onCancel: () => void;
}

/** Build a synthetic CredentialDesignResult for universal mode. */
function buildUniversalDesignResult(serviceUrl: string, description: string): CredentialDesignResult {
  // Derive a label from the URL
  let label = 'Service';
  try {
    const hostname = new URL(serviceUrl).hostname.replace('www.', '');
    const parts = hostname.split('.');
    label = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1);
  } catch { /* use default */ }

  const connector: CredentialDesignConnector = {
    name: `__universal_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    label,
    category: 'api',
    color: '#6366f1',
    fields: [],
    healthcheck_config: null,
    services: [],
    events: [],
  };

  return {
    match_existing: null,
    connector,
    setup_instructions: description,
    summary: `Universal credential for ${label}`,
    // Attach universal mode metadata for the adapter
    _universalServiceUrl: serviceUrl,
    _universalDescription: description,
  } as CredentialDesignResult & { _universalServiceUrl: string; _universalDescription: string };
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
      .then((available) => {
        setMode(available ? 'playwright' : 'guided');
        setModeChecked(true);
      })
      .catch(() => {
        setMode('guided');
        setModeChecked(true);
      });
  }, []);

  const adapter = mode === 'guided' ? tauriGuidedAdapter : tauriPlaywrightAdapter;
  const session = useAutoCredSession({ adapter });

  // Kill running browser session on unmount
  const sessionPhaseRef = useRef(session.phase);
  sessionPhaseRef.current = session.phase;
  const cancelBrowserRef = useRef(session.cancelBrowser);
  cancelBrowserRef.current = session.cancelBrowser;
  useEffect(() => {
    return () => {
      if (sessionPhaseRef.current === 'browser') {
        cancelBrowserRef.current();
      }
    };
  }, []);

  const isValidUrl = useMemo(() => {
    try {
      const url = new URL(serviceUrl);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, [serviceUrl]);

  const handleStart = useCallback(() => {
    if (!isValidUrl || !modeChecked) return;

    const designResult = buildUniversalDesignResult(serviceUrl, description);
    // Inject the universal mode context into the design result's connector context
    // by extending buildConnectorContext to recognize _universalServiceUrl
    session.init(designResult);
    setPhase('running');
  }, [serviceUrl, description, isValidUrl, modeChecked, session]);

  // Once init is called and phase is consent, auto-start browser
  // (skip consent for universal mode since the user already confirmed by clicking Start)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (phase === 'running' && session.phase === 'consent' && !autoStarted.current) {
      autoStarted.current = true;
      session.startBrowser();
    }
  }, [phase, session.phase, session.startBrowser]);

  const handleCancel = () => {
    session.reset();
    autoStarted.current = false;
    setPhase('input');
  };

  /** Save for universal mode: create connector definition + credential. */
  const handleUniversalSave = useCallback(async () => {
    if (universalSaving) return;
    setUniversalSaving(true);

    try {
      const dc = session.discoveredConnector;
      const df = session.discoveredFields;
      const connectorName = dc?.name || `universal_${Date.now()}`;
      const connectorLabel = dc?.label || 'Service';

      // Build fields for the connector definition
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

      // Check for existing connector with the same name
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

      // Filter out internal keys
      const cleanValues: Record<string, string> = {};
      for (const [key, val] of Object.entries(session.extractedValues)) {
        if (!key.startsWith('__')) {
          cleanValues[key] = val;
        }
      }

      // Create the credential
      await createCredential({
        name: session.credentialName.trim() || `${connectorLabel} Credential`,
        service_type: serviceType,
        data: cleanValues,
      });

      await fetchCredentials();
      // Manually transition the session to done phase
      // We can't call session.save because it uses the synthetic connector name
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
      <div
        className="animate-fade-slide-in space-y-5"
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
          <div className="w-12 h-12 rounded-xl border border-indigo-500/30 bg-indigo-500/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Universal Auto-Setup
            </h3>
            <p className="text-sm text-muted-foreground/80 mt-1">
              Connect to <em>any</em> web service. Provide a URL and description, and AI will navigate the site to discover and create API credentials automatically.
            </p>
          </div>
        </div>

        {/* Service URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-muted-foreground/60" />
            Service URL
          </label>
          <input
            type="url"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://app.example.com or https://developer.example.com"
            className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
            autoFocus
          />
          {serviceUrl && !isValidUrl && (
            <p className="text-xs text-red-400/80">Please enter a valid URL starting with http:// or https://</p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/90 flex items-center gap-1.5">
            <MessageSquareText className="w-3.5 h-3.5 text-muted-foreground/60" />
            What do you need?
            <span className="text-muted-foreground/40 font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. I need an API key for their REST API to read and write data. The developer portal has an API Keys section under Settings."
            rows={3}
            className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none transition-colors"
          />
        </div>

        {/* Mode badge */}
        {modeChecked && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
            <Globe className="w-3 h-3" />
            {mode === 'playwright'
              ? 'Playwright browser automation available'
              : 'Guided mode (no browser automation)'}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!isValidUrl || !modeChecked}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-elevation-3 shadow-indigo-600/20"
          >
            <Sparkles className="w-4 h-4" />
            Discover Credentials
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const phaseTransition = {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0, transition: TRANSITION_SLOW },
    exit: { opacity: 0, x: -24, transition: { ...TRANSITION_SLOW, duration: 0.25 } },
  };

  // Running phase -- reuse existing AutoCred components
  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <motion.div key="starting" {...phaseTransition} className="flex items-center justify-center py-8">
            <LoadingSpinner size="xl" className="text-indigo-400" />
          </motion.div>
        )}

        {session.phase === 'browser' && (
          <motion.div key="browser" {...phaseTransition}>
            <AutoCredBrowser
              logs={session.logs}
              onCancel={session.cancelBrowser}
              mode={mode}
            />
          </motion.div>
        )}

        {session.phase === 'browser-error' && session.error && (
          <motion.div key="browser-error" {...phaseTransition}>
            <AutoCredBrowserError
              logs={session.logs}
              error={session.error}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
            />
          </motion.div>
        )}

        {session.phase === 'review' && session.designResult && (
          <motion.div key="review" {...phaseTransition}>
            <UniversalAutoCredReview
              designResult={session.designResult}
              credentialName={session.credentialName}
              onCredentialNameChange={session.setCredentialName}
              extractedValues={session.extractedValues}
              onValueChange={session.updateValue}
              onSave={handleUniversalSave}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
              isSaving={universalSaving}
              isPartial={session.isPartial}
              discoveredFields={session.discoveredFields}
              discoveredConnector={session.discoveredConnector}
            />
          </motion.div>
        )}

        {session.phase === 'saving' && (
          <motion.div
            key="saving"
            {...phaseTransition}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <LoadingSpinner size="2xl" className="text-indigo-400" />
            <p className="text-sm text-muted-foreground/90">Saving credential & connector...</p>
          </motion.div>
        )}

        {session.phase === 'done' && (
          <motion.div
            key="done"
            {...phaseTransition}
            className="flex flex-col items-center justify-center py-10 gap-4"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">Credential Saved</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {session.discoveredConnector?.label ?? 'Service'} credential has been securely stored.
              </p>
            </div>
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-xl text-sm font-medium transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && session.error && (
          <motion.div key="error" {...phaseTransition}>
            <AutoCredErrorDisplay
              error={session.error}
              logs={session.logs}
              onRetry={session.startBrowser}
              onCancel={handleCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
