/**
 * Shared pieces for the Layer-1 assignment matrix: the props shape, connector-
 * brand lookup, and two reusable leaves (a brand chip + the connector picker).
 */
import { Plug } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CONNECTOR_META } from '@/lib/connectors/connectorMeta';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

/** Data the matrix renders from (supplied by the page wrapper). */
export interface LlmOverviewMatrixProps {
  projects: DevProject[];
  llmCreds: PersonaCredential[];
  assign: (projectId: string, credId: string | null) => void;
}

export interface ConnectorBrand {
  label: string;
  color: string;
  iconUrl: string | null;
}

/** Brand (label / colour / icon) for a connector service type, with a safe fallback. */
export function connectorBrand(serviceType: string): ConnectorBrand {
  const m = CONNECTOR_META[serviceType.toLowerCase()];
  return {
    label: m?.label ?? serviceType,
    color: m?.color ?? '#8B5CF6',
    iconUrl: m?.iconUrl ?? null,
  };
}

/** The credential currently assigned to a project (or undefined). */
export function assignedCred(
  project: DevProject,
  llmCreds: PersonaCredential[],
): PersonaCredential | undefined {
  return project.llm_tracking_credential_id
    ? llmCreds.find((c) => c.id === project.llm_tracking_credential_id)
    : undefined;
}

/** A compact brand chip: connector icon + label. */
export function ConnectorChip({
  serviceType,
  name,
  className,
}: {
  serviceType: string;
  name?: string;
  className?: string;
}) {
  const b = connectorBrand(serviceType);
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className ?? ''}`}>
      {b.iconUrl ? (
        <img
          src={b.iconUrl}
          alt=""
          className="w-3.5 h-3.5 shrink-0 rounded-[3px] object-contain p-px"
          style={{ background: `${b.color}1f` }}
        />
      ) : (
        <Plug className="w-3.5 h-3.5 shrink-0" style={{ color: b.color }} />
      )}
      <span className="truncate">{name ?? b.label}</span>
    </span>
  );
}

/** The connector picker — a themed select whose options carry brand icons. */
export function ConnectorSocket({
  value,
  llmCreds,
  onChange,
  testId,
  placeholder,
  className,
}: {
  value: string | null;
  llmCreds: PersonaCredential[];
  onChange: (credId: string | null) => void;
  testId?: string;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const options: ThemedSelectOption[] = [
    { value: '', label: t.plugins.dev_tools.llm_not_wired },
    ...llmCreds.map((c): ThemedSelectOption => {
      const b = connectorBrand(c.serviceType);
      return {
        value: c.id,
        label: c.name,
        description: b.label,
        iconUrl: b.iconUrl ?? undefined,
        iconColor: b.color,
      };
    }),
  ];
  return (
    <span data-testid={testId} className={className}>
      <ThemedSelect
        options={options}
        value={value ?? ''}
        onValueChange={(v) => onChange(v || null)}
        filterable
        hideSearch
        placeholder={placeholder ?? t.plugins.dev_tools.llm_wire_placeholder}
      />
    </span>
  );
}
