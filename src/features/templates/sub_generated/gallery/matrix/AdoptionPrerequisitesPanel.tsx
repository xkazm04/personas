import { useMemo } from 'react';
import {
  CheckCircle2,
  Plus,
  Plug,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import type { ConnectorReadinessStatus, AgentIR, SuggestedConnector } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { useTranslation } from '@/i18n/useTranslation';

// -- Types ------------------------------------------------------------

export interface PrerequisiteItem {
  connectorName: string;
  status: ConnectorReadinessStatus;
  suggestedConnector: SuggestedConnector | null;
  connectorDefinition: ConnectorDefinition | null;
}

export type PrerequisiteOverall = 'ready' | 'partial' | 'blocked';

function deriveOverall(items: PrerequisiteItem[]): PrerequisiteOverall {
  if (items.length === 0) return 'ready';
  const readyCount = items.filter((i) => i.status.health === 'ready').length;
  if (readyCount === items.length) return 'ready';
  if (readyCount > 0) return 'partial';
  return 'blocked';
}

// -- Component --------------------------------------------------------

interface AdoptionPrerequisitesPanelProps {
  designResult: AgentIR | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onAddCredential: (
    connectorName: string,
    suggestedConnector: SuggestedConnector | null,
    connectorDefinition: ConnectorDefinition | null,
  ) => void;
  onAdopt: () => void;
}

export function AdoptionPrerequisitesPanel({
  designResult,
  credentials,
  connectorDefinitions,
  onAddCredential,
  onAdopt,
}: AdoptionPrerequisitesPanelProps) {
  const { t } = useTranslation();
  const items = useMemo<PrerequisiteItem[]>(() => {
    if (!designResult?.suggested_connectors?.length) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    const statuses = deriveConnectorReadiness(designResult.suggested_connectors, installedNames, credTypes);

    return statuses.map((status) => ({
      connectorName: status.connector_name,
      status,
      suggestedConnector: designResult.suggested_connectors?.find((sc) => sc.name === status.connector_name) ?? null,
      connectorDefinition: connectorDefinitions.find((d) => d.name === status.connector_name) ?? null,
    }));
  }, [designResult, credentials, connectorDefinitions]);

  const overall = deriveOverall(items);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Plug className="w-4 h-4 text-muted-foreground/70" />
        <SectionLabel className="mb-0">{t.templates.matrix_grid.prerequisites}</SectionLabel>
        <OverallBadge overall={overall} total={items.length} ready={items.filter((i) => i.status.health === 'ready').length} />
      </div>

      {/* Connector list */}
      <div className="grid gap-2">
        {items.map((item) => (
          <ConnectorPrerequisiteRow
            key={item.connectorName}
            item={item}
            onSetup={() => onAddCredential(item.connectorName, item.suggestedConnector, item.connectorDefinition)}
          />
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={onAdopt}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
          overall === 'ready'
            ? 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
            : 'bg-violet-500/10 text-violet-300/80 border-violet-500/20 hover:bg-violet-500/20'
        }`}
      >
        {overall === 'ready' ? (
          <>
            <ShieldCheck className="w-4 h-4" />
            {t.templates.matrix_grid.all_set_start}
          </>
        ) : (
          <>
            <ArrowRight className="w-4 h-4" />
            {t.templates.matrix_grid.continue_to_adoption}
            <span className="text-muted-foreground/50 text-sm ml-1">
              {t.templates.matrix_grid.setup_in_wizard}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

// -- Sub-components ---------------------------------------------------

function OverallBadge({ overall, total, ready }: { overall: PrerequisiteOverall; total: number; ready: number }) {
  const config = {
    ready: { className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', label: `${ready}/${total} ready` },
    partial: { className: 'bg-amber-500/10 border-amber-500/20 text-amber-400', label: `${ready}/${total} ready` },
    blocked: { className: 'bg-red-500/10 border-red-500/20 text-red-400', label: `0/${total} ready` },
  }[overall];

  return (
    <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full border ${config.className}`}>
      {config.label}
    </span>
  );
}

function ConnectorPrerequisiteRow({ item, onSetup }: { item: PrerequisiteItem; onSetup: () => void }) {
  const { t } = useTranslation();
  const meta = getConnectorMeta(item.connectorName);
  const isReady = item.status.health === 'ready';

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-colors ${
        isReady
          ? 'border-emerald-500/15 bg-emerald-500/5'
          : 'border-amber-500/15 bg-amber-500/5'
      }`}
    >
      {/* Connector icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${meta.color}18` }}
      >
        <ConnectorIcon meta={meta} size="w-4.5 h-4.5" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground/80 block truncate">{meta.label}</span>
        <span className={`text-sm ${isReady ? 'text-emerald-400/70' : 'text-amber-400/70'}`}>
          {isReady
            ? 'Credential configured'
            : !item.status.installed
              ? t.templates.matrix_grid.connector_not_installed
              : t.templates.matrix_grid.needs_credential}
        </span>
      </div>

      {/* Status / Action */}
      {isReady ? (
        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
      ) : (
        <button
          onClick={onSetup}
          className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-colors flex-shrink-0"
        >
          <Plus className="w-3 h-3" />
          Setup
        </button>
      )}
    </div>
  );
}
