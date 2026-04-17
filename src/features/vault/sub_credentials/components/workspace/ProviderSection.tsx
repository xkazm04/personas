import {
  ArrowLeft,
  Globe,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { useWorkspaceConnect } from './useWorkspaceConnect';
import type { WorkspaceProvider } from './workspaceProviders';
import { ServiceCheckbox, ProvisionProgress } from './WorkspaceSubComponents';
import { useTranslation } from '@/i18n/useTranslation';

interface ProviderSectionProps {
  provider: WorkspaceProvider;
  onBack: () => void;
  onComplete: () => void;
}

export function ProviderSection({
  provider,
  onBack,
  onComplete,
}: ProviderSectionProps) {
  const { t, tx } = useTranslation();
  const ws = useWorkspaceConnect(provider);
  const wp = t.vault.workspace_panel;

  const isSelectPhase = ws.phase === 'select';
  const isDone = ws.phase === 'done';
  const isError = ws.phase === 'error';
  const createdCount = ws.provisionStates.filter((s) => s.status === 'created').length;

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
            className="w-8 h-8 rounded-card flex items-center justify-center"
            style={{ backgroundColor: `${provider.color}15` }}
          >
            <Globe className="w-4 h-4" style={{ color: provider.color }} />
          </div>
          <div>
            <h3 className="typo-heading font-semibold text-foreground">{provider.label}</h3>
            <p className="typo-caption text-foreground">
              {isSelectPhase && wp.select_services}
              {ws.phase === 'authorizing' && wp.browser_sign_in}
              {ws.phase === 'provisioning' && wp.creating_credentials}
              {isDone && wp.all_created}
              {isError && wp.some_failed}
            </p>
          </div>
        </div>
      </div>

      {/* Select phase -- service checkboxes */}
      {isSelectPhase && (
        <>
          <div className="flex items-center justify-between">
            <span className="typo-caption text-foreground">
              {tx(wp.selected_count, { selected: ws.selectedServices.length, total: provider.services.length })}
            </span>
            {ws.selectedServices.length < provider.services.length && (
              <Button
                onClick={ws.selectAll}
                variant="link"
                size="xs"
                className="text-blue-400 hover:text-blue-300"
              >
                {wp.select_all}
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
            {tx(ws.selectedServices.length === 1 ? wp.connect_services_one : wp.connect_services_other, { count: ws.selectedServices.length })}
          </Button>
        </>
      )}

      {/* Authorizing phase */}
      {ws.phase === 'authorizing' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <LoadingSpinner size="2xl" className="text-blue-400" />
          <p className="typo-body text-foreground text-center">
            {wp.sign_in_browser}
            <br />
            <span className="typo-caption text-foreground">
              {tx(ws.selectedServices.length === 1 ? wp.granting_access_one : wp.granting_access_other, { count: ws.selectedServices.length })}
            </span>
          </p>
        </div>
      )}

      {/* Provisioning / Done / Error -- show per-service progress */}
      {(ws.phase === 'provisioning' || isDone || isError) && (
        <>
          <ProvisionProgress states={ws.provisionStates} />

          {isDone && (
            <div className="flex items-center gap-2 p-3 rounded-modal border border-emerald-500/20 bg-emerald-500/5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="typo-body text-emerald-400">
                {tx(createdCount === 1 ? wp.credentials_created_one : wp.credentials_created_other, { count: createdCount })}
              </p>
            </div>
          )}

          {isError && ws.error && (
            <div className="flex items-center gap-2 p-3 rounded-modal border border-red-500/20 bg-red-500/5">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="typo-body text-red-400">{ws.error}</p>
            </div>
          )}

          <div className="flex gap-2">
            {(isDone || isError) && (
              <Button
                onClick={onComplete}
                variant="secondary"
                size="md"
                block
                className="py-2 rounded-modal"
              >
                {t.common.done}
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
                {t.common.try_again}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
