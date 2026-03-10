import { CheckCircle2, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import type { DeployAutomationResult } from '@/api/agents/automations';
import { PLATFORM_CONFIG } from '../libs/automationTypes';

interface SuccessPhaseProps {
  platform: AutomationPlatform;
  deployResult: DeployAutomationResult;
  onDone: () => void;
}

export function SuccessPhase({ platform, deployResult, onDone }: SuccessPhaseProps) {
  return (
    <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-12 h-12 rounded-full bg-brand-emerald/10 border border-brand-emerald/20 flex items-center justify-center">
        <CheckCircle2 className="w-5 h-5 text-brand-emerald" />
      </div>
      <div className="text-center max-w-md">
        <p className="text-sm font-medium text-foreground/90">Automation deployed successfully</p>
        <p className="text-sm text-muted-foreground mt-1">{deployResult.deploymentMessage}</p>
      </div>
      {deployResult.platformUrl && (
        <a
          href={deployResult.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-accent/15 border border-accent/25 text-foreground/80 hover:bg-accent/25 transition-colors"
        >
          View on {PLATFORM_CONFIG[platform]?.label}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <button
        onClick={onDone}
        className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors"
      >
        Done
      </button>
    </motion.div>
  );
}
