import {
  ArrowLeft,
  Globe,
  Check,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { GOOGLE_WORKSPACE } from './workspaceProviders';
import { useWorkspaceConnect } from './useWorkspaceConnect';
import type { WorkspaceService, WorkspaceProvider } from './workspaceProviders';
import type { ServiceProvisionState } from './useWorkspaceConnect';

interface WorkspaceConnectPanelProps {
  onBack: () => void;
  onComplete: () => void;
}

function ServiceCheckbox({
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

function ProvisionProgress({ states }: { states: ServiceProvisionState[] }) {
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

function ProviderSection({
  provider,
  onBack,
  onComplete,
}: {
  provider: WorkspaceProvider;
  onBack: () => void;
  onComplete: () => void;
}) {
  const ws = useWorkspaceConnect(provider);

  const isSelectPhase = ws.phase === 'select';
  const isDone = ws.phase === 'done';
  const isError = ws.phase === 'error';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          onClick={isSelectPhase ? onBack : ws.reset}
          variant="ghost"
          size="icon-sm"
          icon={<ArrowLeft className="w-4 h-4" />}
        />
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${provider.color}15` }}
          >
            <Globe className="w-4 h-4" style={{ color: provider.color }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
            <p className="text-xs text-muted-foreground/60">
              {isSelectPhase && 'Select services to connect'}
              {ws.phase === 'authorizing' && 'Complete sign-in in your browser...'}
              {ws.phase === 'provisioning' && 'Creating credentials...'}
              {isDone && 'All credentials created'}
              {isError && 'Some credentials failed'}
            </p>
          </div>
        </div>
      </div>

      {/* Select phase -- service checkboxes */}
      {isSelectPhase && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground/50">
              {ws.selectedServices.length} of {provider.services.length} selected
            </span>
            {ws.selectedServices.length < provider.services.length && (
              <Button
                onClick={ws.selectAll}
                variant="link"
                size="xs"
                className="text-blue-400 hover:text-blue-300"
              >
                Select all
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {provider.services.map((svc) => (
              <ServiceCheckbox
                key={svc.serviceType}
                service={svc}
                checked={ws.selectedServices.some((s) => s.serviceType === svc.serviceType)}
                onToggle={() => ws.toggleService(svc.serviceType)}
                disabled={false}
              />
            ))}
          </div>

          <Button
            onClick={ws.startConnect}
            disabled={ws.selectedServices.length === 0}
            variant="primary"
            size="lg"
            block
            data-testid="vault-workspace-connect"
            className="bg-blue-600 hover:bg-blue-500"
          >
            Connect {ws.selectedServices.length} service{ws.selectedServices.length !== 1 ? 's' : ''} with one login
          </Button>
        </>
      )}

      {/* Authorizing phase */}
      {ws.phase === 'authorizing' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <LoadingSpinner size="2xl" className="text-blue-400" />
          <p className="text-sm text-muted-foreground/70 text-center">
            Sign in with your Google account in the browser window.
            <br />
            <span className="text-xs text-muted-foreground/60">
              This will grant access to {ws.selectedServices.length} service{ws.selectedServices.length !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
      )}

      {/* Provisioning / Done / Error -- show per-service progress */}
      {(ws.phase === 'provisioning' || isDone || isError) && (
        <>
          <ProvisionProgress states={ws.provisionStates} />

          {isDone && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-400">
                {ws.provisionStates.filter((s) => s.status === 'created').length} credential{ws.provisionStates.filter((s) => s.status === 'created').length !== 1 ? 's' : ''} created from a single login.
              </p>
            </div>
          )}

          {isError && ws.error && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/5">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{ws.error}</p>
            </div>
          )}

          <div className="flex gap-2">
            {(isDone || isError) && (
              <Button
                onClick={onComplete}
                variant="secondary"
                size="md"
                block
                className="py-2 rounded-xl"
              >
                Done
              </Button>
            )}
            {isError && (
              <Button
                onClick={ws.reset}
                variant="accent"
                accentColor="blue"
                size="md"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Retry
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function WorkspaceConnectPanel({ onBack, onComplete }: WorkspaceConnectPanelProps) {
  return (
    <div
      className="animate-fade-slide-in bg-secondary/35 border border-primary/15 rounded-xl p-4"
      data-testid="vault-workspace-container"
    >
      <ProviderSection
        provider={GOOGLE_WORKSPACE}
        onBack={onBack}
        onComplete={onComplete}
      />
    </div>
  );
}
