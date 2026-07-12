/**
 * Shared pieces for a Layer-1 projects × connectors assignment matrix. Generic
 * over which binding it reads/writes: the caller supplies `getCredId` (which
 * project field holds the assignment) + `assign` (the write) + label strings, so
 * the same matrix drives both LLM-observability (llm_tracking_credential_id) and
 * app-monitoring (monitoring_credential_id) tabs.
 */
import { Plug } from 'lucide-react';
import { CONNECTOR_META } from '@/lib/connectors/connectorMeta';
import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

/** Caller-resolved copy so the matrix stays i18n-agnostic. */
export interface MatrixLabels {
  /** e.g. "projects instrumented" / "projects monitored" (after the count). */
  coverage: string;
  /** e.g. "gap" — shown on an unwired tile. */
  gap: string;
  /** The "— not wired —" option at the top of the picker. */
  notWired: string;
  /** Placeholder for the picker when nothing is selected. */
  wirePlaceholder: string;
}

/** Data the matrix renders from (supplied by the page wrapper). */
export interface AssignmentMatrixProps {
  projects: DevProject[];
  creds: PersonaCredential[];
  /** Which credential id this project is bound to (or null). */
  getCredId: (p: DevProject) => string | null;
  assign: (projectId: string, credId: string | null) => void;
  labels: MatrixLabels;
  /** data-testid prefix for each project's socket (default "assign"). */
  testIdPrefix?: string;
  /** data-testid for the matrix container. */
  testId?: string;
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
  creds: PersonaCredential[],
  getCredId: (p: DevProject) => string | null,
): PersonaCredential | undefined {
  const id = getCredId(project);
  return id ? creds.find((c) => c.id === id) : undefined;
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
  creds,
  onChange,
  testId,
  placeholder,
  notWiredLabel,
  className,
}: {
  value: string | null;
  creds: PersonaCredential[];
  onChange: (credId: string | null) => void;
  testId?: string;
  placeholder: string;
  notWiredLabel: string;
  className?: string;
}) {
  const options: ThemedSelectOption[] = [
    { value: '', label: notWiredLabel },
    ...creds.map((c): ThemedSelectOption => {
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
        placeholder={placeholder}
      />
    </span>
  );
}
