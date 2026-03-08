import { Check, X, Minus, Lock } from 'lucide-react';
import { PROVIDERS, DEFAULT_CAPABILITIES } from '../libs/engineCapabilities';
import type { CliOperation } from '../libs/engineCapabilities';
import type { CliEngine } from '@/lib/types/types';

interface OperationRowProps {
  operation: CliOperation;
  label: string;
  description: string;
  installedProviders: Set<CliEngine>;
  isEnabled: (op: CliOperation, p: CliEngine) => boolean;
  onToggle: (op: CliOperation, p: CliEngine) => void;
}

export function OperationRow({
  operation,
  label,
  description,
  installedProviders,
  isEnabled,
  onToggle,
}: OperationRowProps) {
  return (
    <tr className="border-b border-primary/5 hover:bg-primary/[0.02] transition-colors">
      <td className="py-2.5 pr-4">
        <div className="flex flex-col">
          <span className="text-sm text-foreground/90">{label}</span>
          <span className="text-[11px] text-muted-foreground/50 leading-tight">{description}</span>
        </div>
      </td>
      {PROVIDERS.map((p) => {
        const installed = installedProviders.has(p.id);
        const defaultEnabled = DEFAULT_CAPABILITIES[operation]?.[p.id] ?? false;
        const enabled = isEnabled(operation, p.id);
        const locked = !defaultEnabled;

        return (
          <td key={p.id} className="py-2.5 px-2 text-center">
            {!installed ? (
              <div className="flex justify-center">
                <span className="w-6 h-6 rounded bg-secondary/20 border border-primary/5 flex items-center justify-center cursor-not-allowed">
                  <Minus className="w-3 h-3 text-muted-foreground/20" />
                </span>
              </div>
            ) : locked ? (
              <div className="flex justify-center">
                <span
                  className="w-6 h-6 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center cursor-not-allowed"
                  title={`${label} is not supported by ${p.shortLabel} — failed integration tests`}
                >
                  <Lock className="w-2.5 h-2.5 text-rose-400/40" />
                </span>
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  onClick={() => onToggle(operation, p.id)}
                  className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${
                    enabled
                      ? 'bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/30'
                      : 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20'
                  }`}
                  title={`${enabled ? 'Disable' : 'Enable'} ${label} for ${p.shortLabel}`}
                >
                  {enabled ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <X className="w-3 h-3 text-rose-400/60" />
                  )}
                </button>
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
