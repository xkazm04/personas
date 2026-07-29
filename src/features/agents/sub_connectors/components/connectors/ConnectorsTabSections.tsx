import { Link, CheckCircle2, AlertCircle, RefreshCw, AlertTriangle, Clock, ShieldQuestion, Filter } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConnectorStatusCard } from './ConnectorStatusCard';
import type { ConnectorStatus, ConnectorHealthFilter } from '../../libs/connectorTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { getAlternatives } from '@/lib/credentials/connectorRoles';

interface ReadinessWarningsProps {
  unlinked: number;
  unhealthy: number;
}

export function ReadinessWarnings({ unlinked, unhealthy }: ReadinessWarningsProps) {
  const { t, tx } = useTranslation();
  return (
    <>
      {unlinked > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-modal bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" />
          <div className="typo-body">
            <p className="font-medium text-amber-400/80">{tx(t.agents.connectors.st_unlinked_warn, { count: unlinked })}</p>
            <p className="text-amber-400/50 mt-0.5">{t.agents.connectors.st_unlinked_hint}</p>
          </div>
        </div>
      )}
      {unlinked === 0 && unhealthy > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-modal bg-red-500/5 border border-red-500/15">
          <AlertCircle className="w-4 h-4 text-red-400/70 flex-shrink-0 mt-0.5" />
          <div className="typo-body">
            <p className="font-medium text-red-400/80">{tx(t.agents.connectors.st_unhealthy_warn, { count: unhealthy })}</p>
            <p className="text-red-400/50 mt-0.5">{t.agents.connectors.st_unhealthy_hint}</p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A count pill that doubles as a filter toggle. The counts were already the
 * summary of the list below; making them the control means focusing one health
 * state needs no second row of chrome — and an agent with a dozen connectors
 * can finally isolate the two that are broken.
 */
function FilterPill({
  count, variant, icon, label, value, active, onToggle,
}: {
  count: number;
  variant: 'success' | 'error' | 'warning' | 'neutral';
  icon: React.ReactNode;
  label: string;
  value: ConnectorHealthFilter;
  active: ConnectorHealthFilter | null;
  onToggle?: (value: ConnectorHealthFilter | null) => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  const isActive = active === value;
  const badge = (
    <StatusBadge
      variant={variant}
      pill
      className={`px-2 py-0.5 typo-body ${isActive ? 'ring-1 ring-primary/40' : ''}`}
      icon={icon}
    >
      {label}
    </StatusBadge>
  );
  if (!onToggle) return badge;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      title={isActive ? t.agents.connectors.st_filter_clear : t.agents.connectors.st_filter_toggle}
      onClick={() => onToggle(isActive ? null : value)}
      className={`rounded-full transition-opacity cursor-pointer ${isActive ? '' : 'opacity-80 hover:opacity-100'}`}
    >
      {badge}
    </button>
  );
}

interface ConnectorsSectionProps {
  roleGroups: { roleLabel: string; items: ConnectorStatus[] }[];
  requiredCredTypes: string[];
  healthy: number;
  unhealthy: number;
  unlinked: number;
  /** Linked, but the connector exposes no live probe — never counted healthy. */
  unverifiable: number;
  /** Rows whose only evidence is a restored healthcheck past the staleness cutoff. */
  staleCount: number;
  testableCount: number;
  testingAll: boolean;
  credentials: CredentialMetadata[];
  linkingConnector: string | null;
  onTestAll: () => void;
  onTestConnector: (name: string, credId: string) => void;
  onToggleLinking: (name: string | null) => void;
  onLink: (connectorName: string, credentialId: string, credentialName: string) => void;
  onAddCredential: (connectorName: string) => void;
  onClearLinkError: (connectorName: string) => void;
  onSwap: (currentName: string, newName: string) => void;
  /** Active health filter, or null for "show everything". */
  healthFilter?: ConnectorHealthFilter | null;
  onHealthFilterChange?: (value: ConnectorHealthFilter | null) => void;
}

export function ConnectorsSection({
  roleGroups, requiredCredTypes, healthy, unhealthy, unlinked, unverifiable, staleCount,
  testableCount, testingAll, credentials, linkingConnector,
  onTestAll, onTestConnector, onToggleLinking, onLink,
  onAddCredential, onClearLinkError, onSwap,
  healthFilter = null, onHealthFilterChange,
}: ConnectorsSectionProps) {
  const { t, tx } = useTranslation();

  if (requiredCredTypes.length === 0) return null;

  return (
    <div className="space-y-3">
      <SectionHeader
        prominent
        icon={<Link className="w-5 h-5" />}
        label={tx(t.agents.connectors.st_required, { count: requiredCredTypes.length })}
        badge={(
          <>
            <FilterPill count={healthy} variant="success" value="healthy" active={healthFilter} onToggle={onHealthFilterChange}
              icon={<CheckCircle2 className="w-2.5 h-2.5" />} label={tx(t.agents.connectors.st_healthy, { count: healthy })} />
            <FilterPill count={unhealthy} variant="error" value="unhealthy" active={healthFilter} onToggle={onHealthFilterChange}
              icon={<AlertCircle className="w-2.5 h-2.5" />} label={tx(t.agents.connectors.st_failed, { count: unhealthy })} />
            <FilterPill count={unlinked} variant="warning" value="unlinked" active={healthFilter} onToggle={onHealthFilterChange}
              icon={<AlertCircle className="w-2.5 h-2.5" />} label={tx(t.agents.connectors.st_missing, { count: unlinked })} />
            <FilterPill count={unverifiable} variant="neutral" value="unverifiable" active={healthFilter} onToggle={onHealthFilterChange}
              icon={<ShieldQuestion className="w-2.5 h-2.5" />} label={tx(t.agents.connectors.st_unverifiable, { count: unverifiable })} />
            <FilterPill count={staleCount} variant="warning" value="stale" active={healthFilter} onToggle={onHealthFilterChange}
              icon={<Clock className="w-2.5 h-2.5" />} label={tx(t.agents.connectors.st_stale, { count: staleCount })} />
          </>
        )}
        trailing={testableCount > 0 ? (
          <button type="button" onClick={onTestAll} disabled={testingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-modal border border-primary/20 text-foreground hover:bg-secondary/50 hover:text-foreground/95 transition-colors duration-snap disabled:opacity-40">
            {testingAll ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3 h-3" />} {t.agents.connectors.st_test_all}
          </button>
        ) : undefined}
      />
      {roleGroups.length === 0 && healthFilter && onHealthFilterChange ? (
        <ScenarioEmptyState
          icon={Filter}
          title={t.agents.connectors.st_filter_empty}
          action={{ label: t.agents.connectors.st_filter_clear, onClick: () => onHealthFilterChange(null) }}
        />
      ) : (
      <div className="space-y-2">
        {roleGroups.map((group) => (
          <div key={group.items.map((s) => s.name).join(',')} className="space-y-2">
            {group.roleLabel && group.items.length > 1 && (
              <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider px-1 pt-1">{group.roleLabel}</p>
            )}
            {group.items.map((status, i) => (
              <ConnectorStatusCard
                // Composite key: persona configs can carry duplicate connector
                // names (e.g. test-seeded adoptions), which made a name-only
                // key collide and spam dup-key warnings on every render.
                key={`${status.name}-${i}`} status={status}
                isLinking={linkingConnector === status.name}
                credentials={credentials}
                onTest={(name, credId) => void onTestConnector(name, credId)}
                onToggleLinking={onToggleLinking}
                onLinkCredential={onLink}
                onAddCredential={onAddCredential}
                onClearLinkError={onClearLinkError}
                roleLabel={group.roleLabel || undefined}
                alternatives={getAlternatives(status.name)}
                onSwap={onSwap}
              />
            ))}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
