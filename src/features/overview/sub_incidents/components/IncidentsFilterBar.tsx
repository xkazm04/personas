import { useTranslation } from '@/i18n/useTranslation';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';

interface Props {
  filters: IncidentFilters;
  onChange: (next: IncidentFilters) => void;
}

const STATUS_OPTIONS = ['all', 'open', 'acknowledged', 'resolved', 'dismissed'] as const;
const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'] as const;
const SOURCE_OPTIONS = [
  'fired_alerts',
  'tool_execution_audit_log',
  'credential_audit_log',
  'healing_audit_log',
  'provider_audit_log',
  'policy_events',
  'persona_healing_issues',
] as const;

export function IncidentsFilterBar({ filters, onChange }: Props) {
  const { t } = useTranslation();

  const currentStatus = filters.statuses?.[0] ?? 'all';
  const setStatus = (status: string) => {
    onChange({
      ...filters,
      statuses: status === 'all' ? null : [status],
    });
  };

  const setSeverities = (severities: string[]) => {
    onChange({
      ...filters,
      severities: severities.length === 0 ? null : severities,
    });
  };

  const setSourceTables = (sources: string[]) => {
    onChange({
      ...filters,
      source_tables: sources.length === 0 ? null : sources,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-primary/10 bg-secondary/10">
      {/* Status pills */}
      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => setStatus(status)}
            className={`px-3 py-1 typo-caption rounded-card border transition-colors focus-ring ${
              currentStatus === status
                ? 'bg-primary/15 text-primary border-primary/25'
                : 'text-foreground/70 border-transparent hover:bg-secondary/40'
            }`}
          >
            {statusButtonLabel(t, status)}
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-primary/10" />

      {/* Severity multi-select */}
      <MultiSelectChips
        label={t.overview.incidents.filter_severity_label}
        allLabel={t.overview.incidents.filter_severity_all}
        options={SEVERITY_OPTIONS as readonly string[]}
        selected={filters.severities ?? []}
        onChange={setSeverities}
      />

      <div className="h-5 w-px bg-primary/10" />

      {/* Source multi-select */}
      <MultiSelectChips
        label={t.overview.incidents.filter_source_label}
        allLabel={t.overview.incidents.filter_source_all}
        options={SOURCE_OPTIONS as readonly string[]}
        selected={filters.source_tables ?? []}
        onChange={setSourceTables}
      />
    </div>
  );
}

interface MultiSelectChipsProps {
  label: string;
  allLabel: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function MultiSelectChips({ label, allLabel, options, selected, onChange }: MultiSelectChipsProps) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const allSelected = selected.length === 0;
  return (
    <div className="flex items-center gap-2">
      <span className="typo-caption text-foreground/60">{label}:</span>
      <button
        onClick={() => onChange([])}
        className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
          allSelected
            ? 'bg-primary/15 text-primary border-primary/25'
            : 'text-foreground/70 border-transparent hover:bg-secondary/40'
        }`}
      >
        {allLabel}
      </button>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            onClick={() => toggle(option)}
            className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
              active
                ? 'bg-primary/15 text-primary border-primary/25'
                : 'text-foreground/70 border-transparent hover:bg-secondary/40'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function statusButtonLabel(t: ReturnType<typeof useTranslation>['t'], status: string): string {
  switch (status) {
    case 'all': return t.overview.incidents.filter_status_all;
    case 'open': return t.overview.incidents.filter_status_open;
    case 'acknowledged': return t.overview.incidents.filter_status_acknowledged;
    case 'resolved': return t.overview.incidents.filter_status_resolved;
    case 'dismissed': return t.overview.incidents.filter_status_dismissed;
    default: return status;
  }
}
