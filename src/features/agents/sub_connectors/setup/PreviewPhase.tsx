import {
  Zap, CheckCircle2, AlertCircle, GitBranch, Rocket,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { PLATFORM_CONFIG } from '../libs/automationTypes';
import { AdvancedSettings } from './AdvancedSettings';

interface PreviewPhaseProps {
  designResult: {
    platform_reasoning?: string;
    setup_steps?: string[];
    handles_connectors?: string[];
    workflow_definition?: unknown;
  };
  name: string;
  setName: (v: string) => void;
  platform: AutomationPlatform;
  inputSchema: string;
  setInputSchema: (v: string) => void;
  timeoutSecs: number;
  setTimeoutSecs: (v: number) => void;
  fallbackMode: AutomationFallbackMode;
  setFallbackMode: (v: AutomationFallbackMode) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  hasPlatformCredential: boolean;
  platformCredentials: CredentialMetadata[];
  platformCredentialId: string | null;
  githubRepo: string | null;
  deployError: string | null;
}

export function PreviewPhase({
  designResult,
  name, setName,
  platform,
  inputSchema, setInputSchema,
  timeoutSecs, setTimeoutSecs,
  fallbackMode, setFallbackMode,
  showAdvanced, setShowAdvanced,
  hasPlatformCredential,
  platformCredentials, platformCredentialId,
  githubRepo,
  deployError,
}: PreviewPhaseProps) {
  return (
    <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
      {/* AI reasoning */}
      {designResult.platform_reasoning && (
        <div className="px-3.5 py-2.5 rounded-xl bg-accent/5 border border-accent/15">
          <p className="text-sm text-foreground/80">
            <span className="font-medium text-accent">AI recommendation:</span>{' '}
            {designResult.platform_reasoning}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1.5 px-3 py-2 text-sm rounded-xl border border-border bg-secondary/20 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Platform</label>
            <div className="mt-1.5">
              <span className={`inline-flex items-center px-2.5 py-1 text-sm font-medium rounded-xl border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
                {PLATFORM_CONFIG[platform]?.label ?? platform}
              </span>
            </div>
          </div>

          {/* Platform-specific info */}
          {platform === 'n8n' && (
            <div className="px-3 py-2.5 rounded-xl bg-brand-amber/5 border border-brand-amber/15">
              <p className="text-sm text-foreground/80">
                <Rocket className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />
                Workflow will be created and activated on your n8n instance automatically.
              </p>
            </div>
          )}
          {platform === 'github_actions' && githubRepo && (
            <div className="px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-sm text-foreground/80">
                <GitBranch className="w-3.5 h-3.5 inline mr-1 text-primary" />
                Repository dispatch configured for <span className="font-medium">{githubRepo}</span>
              </p>
              {!!designResult.workflow_definition && !!(designResult.workflow_definition as Record<string, unknown>).event_type && (
                <p className="text-sm text-muted-foreground mt-1">
                  Event type: <code className="px-1 py-0.5 rounded bg-secondary/40 text-sm">{String((designResult.workflow_definition as Record<string, unknown>).event_type)}</code>
                </p>
              )}
            </div>
          )}
          {platform === 'zapier' && (
            <div className="px-3 py-2.5 rounded-xl bg-brand-amber/5 border border-brand-amber/15">
              <p className="text-sm text-foreground/80">
                <Zap className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />
                Catch hook will be validated and connected.
              </p>
            </div>
          )}
          {platform === 'custom' && (
            <div className="px-3 py-2.5 rounded-xl bg-secondary/20 border border-border/40">
              <p className="text-sm text-muted-foreground">Manual setup required. Automation will be saved as draft.</p>
            </div>
          )}

          {/* Credential display */}
          <div>
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Credential</label>
            {hasPlatformCredential ? (
              <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-emerald/5 border border-brand-emerald/15">
                <CheckCircle2 className="w-3.5 h-3.5 text-brand-emerald/70 flex-shrink-0" />
                <span className="text-sm text-foreground/80">{platformCredentials.find((c) => c.id === platformCredentialId)?.name ?? platformCredentials[0]?.name}</span>
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">None selected</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {designResult.setup_steps && designResult.setup_steps.length > 0 && (
            <div>
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">What will happen</label>
              <div className="mt-1.5 space-y-1.5">
                {designResult.setup_steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-secondary/20 border border-border/40">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-foreground/80 leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {designResult.handles_connectors && designResult.handles_connectors.length > 0 && (
            <div>
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Replaces connectors</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {designResult.handles_connectors.map((c) => (
                  <span key={c} className="px-2 py-0.5 text-sm rounded-lg bg-secondary/40 border border-border/40 text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <AdvancedSettings
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        inputSchema={inputSchema}
        setInputSchema={setInputSchema}
        timeoutSecs={timeoutSecs}
        setTimeoutSecs={setTimeoutSecs}
        fallbackMode={fallbackMode}
        setFallbackMode={setFallbackMode}
      />

      {/* Deploy error inline */}
      {deployError && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
          <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-brand-rose/80">Deployment failed</p>
            <p className="text-sm text-brand-rose/50 mt-0.5">{deployError}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
