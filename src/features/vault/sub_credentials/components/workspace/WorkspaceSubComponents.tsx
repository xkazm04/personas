import { Check, AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import type { WorkspaceService } from './workspaceProviders';
import type { ServiceProvisionState } from './useWorkspaceConnect';

export function ServiceCheckbox({
  service,
  checked,
  onToggle,
  disabled,
}: {
  service: WorkspaceService;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      onClick={onToggle}
      disabled={disabled}
      variant="ghost"
      size="md"
      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full ${
        checked
          ? 'bg-secondary/50 border-primary/25'
          : 'bg-secondary/15 border-primary/10 opacity-60'
      } ${disabled ? 'cursor-not-allowed' : 'hover:bg-secondary/60 hover:border-primary/30'}`}
    >
      <div
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
          checked ? 'border-blue-500 bg-blue-500' : 'border-primary/25 bg-transparent'
        }`}
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </div>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${service.color}15` }}
      >
        <div
          className="w-4 h-4 rounded-sm"
          style={{ backgroundColor: service.color }}
        />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{service.label}</div>
        <div className="text-xs text-muted-foreground/60 truncate">{service.description}</div>
      </div>
    </Button>
  );
}

export function ProvisionProgress({ states }: { states: ServiceProvisionState[] }) {
  return (
    <div className="space-y-2">
      {states.map((s) => (
        <div
          key={s.service.serviceType}
          className="flex items-center gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20"
        >
          <div className="flex-shrink-0">
            {s.status === 'pending' && <LoadingSpinner className="text-blue-400" />}
            {s.status === 'created' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {s.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-400" />}
          </div>
          <div
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${s.service.color}15` }}
          >
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: s.service.color }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{s.service.label}</div>
            {s.status === 'failed' && s.error && (
              <div className="text-xs text-red-400 truncate">{s.error}</div>
            )}
          </div>
          <div className="text-xs text-muted-foreground/50 flex-shrink-0">
            {s.status === 'pending' && 'Creating...'}
            {s.status === 'created' && 'Connected'}
            {s.status === 'failed' && 'Failed'}
          </div>
        </div>
      ))}
    </div>
  );
}
