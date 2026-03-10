import { ChevronDown, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import { FALLBACK_OPTIONS } from '../libs/automationSetupConstants';

interface AdvancedSettingsProps {
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  inputSchema: string;
  setInputSchema: (v: string) => void;
  timeoutSecs: number;
  setTimeoutSecs: (v: number) => void;
  fallbackMode: AutomationFallbackMode;
  setFallbackMode: (v: AutomationFallbackMode) => void;
}

export function AdvancedSettings({
  showAdvanced, setShowAdvanced,
  inputSchema, setInputSchema,
  timeoutSecs, setTimeoutSecs,
  fallbackMode, setFallbackMode,
}: AdvancedSettingsProps) {
  return (
    <>
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        {showAdvanced ? 'Hide' : 'Show'} advanced settings
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden space-y-4"
          >
            <div>
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Input Schema</label>
              <textarea
                placeholder='{ "file_url": "string" }'
                value={inputSchema}
                onChange={(e) => setInputSchema(e.target.value)}
                rows={3}
                className="w-full mt-1.5 px-3 py-2 text-sm rounded-xl border border-border bg-secondary/20 text-foreground placeholder:text-muted-foreground/50 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">On failure</label>
              <div className="mt-1.5 space-y-1.5">
                {FALLBACK_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${fallbackMode === opt.value ? 'border-primary/30 bg-primary/5' : 'border-border/60 hover:border-border'}`}>
                    <input type="radio" name="fallbackMode" checked={fallbackMode === opt.value} onChange={() => setFallbackMode(opt.value)} className="mt-0.5 accent-primary" />
                    <div>
                      <p className="text-sm text-foreground/80">{opt.label}</p>
                      <p className="text-sm text-muted-foreground/60">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Timeout</label>
              <div className="flex items-center gap-2 mt-1.5">
                <input type="number" min={1} max={300} value={timeoutSecs} onChange={(e) => setTimeoutSecs(Number(e.target.value) || 30)} className="w-20 px-3 py-2 text-sm rounded-xl border border-border bg-secondary/20 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40" />
                <span className="text-sm text-muted-foreground">seconds</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
