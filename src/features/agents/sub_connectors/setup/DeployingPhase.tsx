import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AutomationPlatform } from '@/lib/bindings/PersonaAutomation';
import { PLATFORM_CONFIG } from '../libs/automationTypes';

interface DeployingPhaseProps {
  platform: AutomationPlatform;
}

export function DeployingPhase({ platform }: DeployingPhaseProps) {
  return (
    <motion.div key="deploying" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground/90">
          Deploying to {PLATFORM_CONFIG[platform]?.label}...
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {platform === 'n8n' && 'Creating workflow and activating on your n8n instance'}
          {platform === 'github_actions' && 'Setting up repository dispatch integration'}
          {platform === 'zapier' && 'Validating and connecting catch hook'}
          {platform === 'custom' && 'Saving automation configuration'}
        </p>
      </div>
    </motion.div>
  );
}
