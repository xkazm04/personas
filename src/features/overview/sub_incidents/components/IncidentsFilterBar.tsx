import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { sourceTableLabel } from '../libs/incidentTaxonomy';
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
  'execution_error',
] as const;

const RANGE_OPTIONS = ['all', '24h', '7d'] as const;
const HOUR_MS = 3_600_000;

/** Turn a friendly range chip into the `since` timestamp the filter expects. */
function sinceFromRange(key: string): string | null {
  if (key === '24h') return new Date(Date.now() - 24 * HOUR_MS).toISOString();
  if (key === '7d') return new Date(Date.now() - 7 * 24 * HOUR_MS).toISOString();
  return null;
}

/** Map a `since` timestamp back to the chip that should read active. */
function activeRange(since: string | null | undefined): string {
  if (!since) return 'all';
  const age = Date.now() - new Date(since).getTime();
  if (age <= 25 * HOUR_MS) return '24h';
  if (age <= 7.5 * 24 * HOUR_MS) return '7d';
  return 'all';
}

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

  const currentRange = activeRange(filters.since);
  const setRange = (key: string) => onChange({ ...filters, since: sinceFromRange(key) });

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
                : 'text-foreground border-transparent hover:bg-secondary/40'
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
        labelFor={(option) => tokenLabel(t, 'severity', option)}
      />

      <div className="h-5 w-px bg-primary/10" />

      {/* Source multi-select */}
      <MultiSelectChips
        label={t.overview.incidents.filter_source_label}
        allLabel={t.overview.incidents.filter_source_all}
        options={SOURCE_OPTIONS as readonly string[]}
        selected={filters.source_tables ?? []}
        onChange={setSourceTables}
        labelFor={(option) => sourceTableLabel(t, option)}
      />

      <div className="h-5 w-px bg-primary/10" />

      {/* Time range */}
      <div className="flex items-center gap-1">
        {RANGE_OPTIONS.map((key) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`px-3 py-1 typo-caption rounded-card border transition-colors focus-ring ${
              currentRange === key
                ? 'bg-primary/15 text-primary border-primary/25'
                : 'text-foreground border-transparent hover:bg-secondary/40'
            }`}
          >
            {rangeLabel(t, key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function rangeLabel(t: ReturnType<typeof useTranslation>['t'], key: string): string {
  switch (key) {
    case '24h': return t.overview.incidents.range_24h;
    case '7d': return t.overview.incidents.range_7d;
    default: return t.overview.incidents.range_all_time;
  }
}

interface MultiSelectChipsProps {
  label: string;
  allLabel: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Resolve an option token to its friendly, user-facing label. */
  labelFor: (option: string) => string;
}

function MultiSelectChips({ label, allLabel, options, selected, onChange, labelFor }: MultiSelectChipsProps) {
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
      <span className="typo-caption text-foreground">{label}:</span>
      <button
        onClick={() => onChange([])}
        className={`px-2 py-0.5 typo-caption rounded-card border transition-colors focus-ring ${
          allSelected
            ? 'bg-primary/15 text-primary border-primary/25'
            : 'text-foreground border-transparent hover:bg-secondary/40'
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
                : 'text-foreground border-transparent hover:bg-secondary/40'
            }`}
          >
            {labelFor(option)}
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
