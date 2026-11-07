import { Check, X, Minus, Lock } from 'lucide-react';
import { PROVIDERS, DEFAULT_CAPABILITIES } from '../libs/engineCapabilities';
import type { CliOperation } from '../libs/engineCapabilities';
import type { CliEngine } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
  const { t, tx } = useTranslation();
  const s = t.settings.engine;
  return (
    <tr className="group even:bg-surface-1 hover:bg-primary/[0.06] transition-colors">
      <td className="sticky left-0 z-10 bg-background group-hover:bg-primary/[0.06] py-2.5 pr-4 pl-3 border-b border-hair border-r border-r-primary/10 transition-colors">
        <div className="flex flex-col">
          <span className="typo-body text-foreground">{label}</span>
          <span className="typo-caption text-foreground">{description}</span>
        </div>
      </td>
      {PROVIDERS.map((p) => {
        const installed = installedProviders.has(p.id);
        const defaultEnabled = DEFAULT_CAPABILITIES[operation]?.[p.id] ?? false;
        const enabled = isEnabled(operation, p.id);
        const locked = !defaultEnabled;

        return (
          <td key={p.id} className="py-2.5 px-2 text-center border-b border-hair">
            {!installed ? (
              <div className="flex justify-center">
                <span className="w-6 h-6 rounded-interactive bg-surface-1 border border-hair flex items-center justify-center cursor-not-allowed">
                  <Minus className="w-3 h-3 text-foreground" />
                </span>
              </div>
            ) : locked ? (
              <div className="flex justify-center">
                <Tooltip content={tx(s.op_unsupported_title, { label, provider: p.shortLabel })}><span
                  className="w-6 h-6 rounded-interactive bg-status-error/10 border border-status-error/20 flex items-center justify-center cursor-not-allowed"
                >
                  <Lock className="w-2.5 h-2.5 text-status-error/40" />
                </span></Tooltip>
              </div>
            ) : (
              <div className="flex justify-center">
                <Button
                  type="button"
                  onClick={() => onToggle(operation, p.id)}
                  variant={enabled ? 'accent' : 'danger'}
                  tone={enabled ? 'success' : undefined}
                  size="xs"
                  tooltip={tx(enabled ? s.op_disable_title : s.op_enable_title, { label, provider: p.shortLabel })}
                >
                  {enabled ? (
                    <Check className="w-3 h-3 text-status-success" />
                  ) : (
                    <X className="w-3 h-3 text-status-error/60" />
                  )}
                </Button>
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
