import { motion, AnimatePresence } from 'framer-motion';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { ModelProfile } from '@/lib/types/frontendTypes';

interface UseCaseModelOverrideFormProps {
  visible: boolean;
  customConfig: ModelProfile;
  onFieldChange: (field: keyof ModelProfile, value: string) => void;
}

export function UseCaseModelOverrideForm({ visible, customConfig, onFieldChange }: UseCaseModelOverrideFormProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-2">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Provider</label>
              <ThemedSelect
                value={customConfig.provider || 'anthropic'}
                onChange={(e) => onFieldChange('provider', e.target.value)}
                className="py-1.5"
              >
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama (local)</option>
                <option value="litellm">LiteLLM (proxy)</option>
                <option value="custom">Custom URL</option>
              </ThemedSelect>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Model Name</label>
              <input
                type="text"
                value={customConfig.model || ''}
                onChange={(e) => onFieldChange('model', e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Base URL</label>
              <input
                type="text"
                value={customConfig.base_url || ''}
                onChange={(e) => onFieldChange('base_url', e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">Auth Token</label>
              <input
                type="password"
                value={customConfig.auth_token || ''}
                onChange={(e) => onFieldChange('auth_token', e.target.value)}
                placeholder="Bearer token"
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
