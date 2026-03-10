import { AlertTriangle, Check } from 'lucide-react';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { PROVIDERS } from './engineCapabilities';
import type { CliOperation } from './engineCapabilities';
import type { CliEngine } from '@/lib/types/types';

interface EngineCapabilityBadgeProps {
  /** Which CLI operation this UI dispatches */
  operation: CliOperation;
  /** Compact mode — just icon + provider name */
  compact?: boolean;
}

/**
 * Shows the current engine and whether it's capable of handling the given operation.
 * Drop this into any TerminalStrip consumer or CLI dispatch UI.
 */
export function EngineCapabilityBadge({ operation, compact = false }: EngineCapabilityBadgeProps) {
  const { isEnabled, loaded } = useEngineCapabilities();
  const engineSetting = useAppSetting('cli_engine', 'claude_code');

  if (!loaded || !engineSetting.loaded) return null;

  const activeEngine = (engineSetting.value || 'claude_code') as CliEngine;
  const provider = PROVIDERS.find((p) => p.id === activeEngine);
  const capable = isEnabled(operation, activeEngine);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
          capable
            ? 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20'
            : 'bg-amber-500/10 text-amber-400/80 border-amber-500/20'
        }`}
        title={
          capable
            ? `${provider?.shortLabel ?? activeEngine} is verified for this operation`
            : `${provider?.shortLabel ?? activeEngine} may produce unparseable output for this operation`
        }
      >
        {capable ? (
          <Check className="w-2.5 h-2.5" />
        ) : (
          <AlertTriangle className="w-2.5 h-2.5" />
        )}
        {provider?.shortLabel ?? activeEngine}
      </span>
    );
  }

  if (capable) return null; // Only show warning when engine is not capable

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/8 border-b border-amber-500/15 text-[11px] text-amber-400/80">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span>
        <strong>{provider?.shortLabel ?? activeEngine}</strong> has not passed integration tests for this
        operation. Results may be unparseable.
      </span>
    </div>
  );
}
