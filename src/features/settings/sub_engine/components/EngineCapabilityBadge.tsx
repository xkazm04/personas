import { AlertTriangle, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { PROVIDERS } from '../libs/engineCapabilities';
import type { CliOperation } from '../libs/engineCapabilities';
import type { CliEngine } from '@/lib/types/types';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface EngineCapabilityBadgeProps {
  /** Which CLI operation this UI dispatches */
  operation: CliOperation;
  /** Compact mode -- just icon + provider name */
  compact?: boolean;
}

/**
 * Shows the current engine and whether it's capable of handling the given operation.
 * Drop this into any TerminalStrip consumer or CLI dispatch UI.
 */
export function EngineCapabilityBadge({ operation, compact = false }: EngineCapabilityBadgeProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.engine;
  const { isEnabled, loaded } = useEngineCapabilities();
  const engineSetting = useAppSetting('cli_engine', 'claude_code');

  if (!loaded || !engineSetting.loaded) return null;

  const activeEngine = (engineSetting.value || 'claude_code') as CliEngine;
  const provider = PROVIDERS.find((p) => p.id === activeEngine);
  const capable = isEnabled(operation, activeEngine);
  const providerLabel = provider?.shortLabel ?? activeEngine;

  if (compact) {
    return (
      <Tooltip content={tx(capable ? s.engine_verified_title : s.engine_unparseable_title, { provider: providerLabel })}><span
        className={`inline-flex items-center gap-1 typo-caption font-mono px-1.5 py-0.5 rounded-full border ${
          capable
            ? 'bg-status-success/10 text-status-success border-status-success/20'
            : 'bg-status-warning/10 text-status-warning border-status-warning/20'
        }`}
      >
        {capable ? (
          <Check className="w-2.5 h-2.5" />
        ) : (
          <AlertTriangle className="w-2.5 h-2.5" />
        )}
        {providerLabel}
      </span></Tooltip>
    );
  }

  if (capable) return null; // Only show warning when engine is not capable

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-status-warning/10 border-b border-status-warning/20 typo-caption text-status-warning">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span>
        {tx(s.engine_not_capable, { provider: providerLabel })}
      </span>
    </div>
  );
}
