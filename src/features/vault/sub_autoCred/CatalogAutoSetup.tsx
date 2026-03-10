import { useCallback, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plug, ArrowLeft, Bot, MessageSquare, Monitor } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { useCredentialDesign } from '@/hooks/design/useCredentialDesign';
import { AutoCredPanel } from './AutoCredPanel';
import { AnalyzingPhase } from '@/features/vault/sub_design/AnalyzingPhase';
import { usePersonaStore } from '@/stores/personaStore';
import { checkPlaywrightAvailable } from '@/api/autoCredBrowser';
import { isDesktopBridge } from '@/lib/utils/connectors';
import { lookupRecipeAsDesignResult } from '@/lib/credentials/credentialRecipeRegistry';
import type { AutoCredMode } from './types';

type Phase = 'analyzing' | 'auto';

interface CatalogAutoSetupProps {
  connector: ConnectorDefinition;
  onComplete: () => void;
  onCancel: () => void;
}

/** Build a synthetic CredentialDesignResult from a catalog ConnectorDefinition. */
function buildDesignResult(connector: ConnectorDefinition): CredentialDesignResult {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const setupInstructions =
    typeof metadata.setup_instructions === 'string' ? metadata.setup_instructions : '';

  return {
    match_existing: connector.name,
    connector: {
      name: connector.name,
      label: connector.label,
      category: connector.category,
      color: connector.color,
      fields: (connector.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
        helpText: f.helpText,
      })),
      healthcheck_config: connector.healthcheck_config ?? null,
      services: [],
      events: [],
    },
    setup_instructions: setupInstructions,
    summary: `${connector.label} credential`,
  };
}

export function CatalogAutoSetup({ connector, onComplete, onCancel }: CatalogAutoSetupProps) {
  // Desktop bridge connectors should not use online auto-setup
  if (isDesktopBridge(connector)) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-secondary/40 backdrop-blur-sm border border-orange-500/15 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center border bg-orange-500/10 border-orange-500/20">
            <Monitor className="w-5 h-5 text-orange-400" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-foreground">{connector.label} is a desktop app</h4>
            <p className="text-sm text-muted-foreground/80">
              This connector uses a local desktop bridge, not an online API. Use the Desktop Apps panel to detect and connect it.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-muted-foreground/80 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            Back
          </button>
        </div>
      </motion.div>
    );
  }

  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const hasSetupInstructions = typeof metadata.setup_instructions === 'string' && metadata.setup_instructions.length > 0;
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);

  // If connector already has setup instructions, go directly to auto phase
  // Otherwise, use AI to discover them first
  const [phase, setPhase] = useState<Phase>(hasSetupInstructions ? 'auto' : 'analyzing');
  const [designResult, setDesignResult] = useState<CredentialDesignResult | null>(
    hasSetupInstructions ? buildDesignResult(connector) : null,
  );

  const [mode, setMode] = useState<AutoCredMode>('playwright');

  // Check Playwright availability for badge display
  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => setMode(available ? 'playwright' : 'guided'))
      .catch(() => setMode('guided'));
  }, []);

  const design = useCredentialDesign();
  const recipeLookedUpRef = useRef(false);

  // Start analysis: check recipe cache first, fall back to AI analysis
  useEffect(() => {
    if (phase !== 'analyzing' || design.phase !== 'idle') return;
    if (recipeLookedUpRef.current) {
      // Recipe lookup already ran and missed â€” proceed with AI
      design.start(`Analyze ${connector.label} (${connector.name}) connector and discover setup procedures for creating API credentials.`);
      return;
    }
    recipeLookedUpRef.current = true;

    void lookupRecipeAsDesignResult(connector.name).then((cached) => {
      if (cached) {
        setDesignResult({ ...cached, match_existing: connector.name });
        setPhase('auto');
      } else {
        // No recipe â€” fall back to AI analysis
        design.start(`Analyze ${connector.label} (${connector.name}) connector and discover setup procedures for creating API credentials.`);
      }
    });
  }, [phase]);

  // When AI analysis completes, merge result and go to auto phase
  useEffect(() => {
    if (phase === 'analyzing' && design.phase === 'preview' && design.result) {
      // Use AI result but keep the existing connector's match_existing reference
      const merged: CredentialDesignResult = {
        ...design.result,
        match_existing: connector.name,
      };
      setDesignResult(merged);
      setPhase('auto');
    }
  }, [phase, design.phase, design.result, connector.name]);

  // Handle AI error â€” fall back to synthetic result
  useEffect(() => {
    if (phase === 'analyzing' && design.phase === 'error') {
      setDesignResult(buildDesignResult(connector));
      setPhase('auto');
    }
  }, [phase, design.phase, connector]);

  const handleComplete = useCallback(() => {
    void fetchCredentials().then(() => onComplete());
  }, [fetchCredentials, onComplete]);

  const handleCancel = useCallback(() => {
    if (phase === 'analyzing') design.cancel();
    onCancel();
  }, [phase, design, onCancel]);

  return (
    <motion.div
      key="auto-setup"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleCancel}
          className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground/60" />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${connector.color}15`,
            borderColor: `${connector.color}30`,
          }}
        >
          {connector.icon_url ? (
            <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-5 h-5" />
          ) : (
            <Plug className="w-5 h-5" style={{ color: connector.color }} />
          )}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">Auto-Setup {connector.label}</h4>
          <p className="text-sm text-muted-foreground/80">
            {phase === 'analyzing' ? 'Analyzing connector setup procedures...' : 'Browser automation will guide credential creation'}
          </p>
        </div>
        {mode === 'guided' ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <MessageSquare className="w-3 h-3 text-violet-400" />
            <span className="text-xs font-medium text-violet-400">Guided</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Bot className="w-3 h-3 text-cyan-400" />
            <span className="text-xs font-medium text-cyan-400">Playwright MCP</span>
          </div>
        )}
      </div>

      {/* Content */}
      {phase === 'analyzing' && (
        <AnalyzingPhase outputLines={design.outputLines} onCancel={handleCancel} />
      )}

      {phase === 'auto' && designResult && (
        <AutoCredPanel
          designResult={designResult}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      )}
    </motion.div>
  );
}
