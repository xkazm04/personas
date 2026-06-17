import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { sourceTableLabel } from '../libs/incidentTaxonomy';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';

interface Props {
  filters: IncidentFilters;
  onChange: (next: IncidentFilters) => void;
}

const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
const SOURCE_VALUES = [
  'fired_alerts',
  'tool_execution_audit_log',
  'credential_audit_log',
  'healing_audit_log',
  'provider_audit_log',
  'policy_events',
  'persona_healing_issues',
  'execution_error',
] as const;

const HOUR_MS = 3_600_000;

/** The inbox's resting state (open-only, no other narrowing) — what "Clear
 *  filters" resets to. Mirrors DEFAULT_FILTERS in IncidentsInbox. */
const OPEN_ONLY_FILTERS: IncidentFilters = {
  statuses: ['open'],
  severities: null,
  source_tables: null,
  persona_id: null,
  since: null,
};

/** Turn a friendly range key into the `since` timestamp the filter expects. */
function sinceFromRange(key: string): string | null {
  if (key === '24h') return new Date(Date.now() - 24 * HOUR_MS).toISOString();
  if (key === '7d') return new Date(Date.now() - 7 * 24 * HOUR_MS).toISOString();
  return null;
}

/** Map a `since` timestamp back to the range key that should read active. */
function activeRange(since: string | null | undefined): string {
  if (!since) return 'all';
  const age = Date.now() - new Date(since).getTime();
  if (age <= 25 * HOUR_MS) return '24h';
  if (age <= 7.5 * 24 * HOUR_MS) return '7d';
  return 'all';
}

/**
 * Compact filter bar for the incidents inbox: three single-select dropdowns
 * (severity / source / time) built on the shared themed `ColumnDropdownFilter`.
 * Status moved to the table's State column header, so it isn't duplicated here.
 * Each dropdown carries its own clear (×); a single "Clear filters" appears only
 * once the view is narrowed past the resting open-only state (which also covers
 * a status set from the State column or a persona_id from the detail-modal flow).
 */
export function IncidentsFilterBar({ filters, onChange }: Props) {
  const { t } = useTranslation();

  const severityValue = filters.severities?.[0] ?? 'all';
  const sourceValue = filters.source_tables?.[0] ?? 'all';
  const rangeValue = activeRange(filters.since);

  const severityOptions = [
    { value: 'all', label: t.overview.incidents.filter_severity_all },
    ...SEVERITY_VALUES.map((s) => ({ value: s, label: tokenLabel(t, 'severity', s) })),
  ];
  const sourceOptions = [
    { value: 'all', label: t.overview.incidents.filter_source_all },
    ...SOURCE_VALUES.map((s) => ({ value: s, label: sourceTableLabel(t, s) })),
  ];
  const rangeOptions = [
    { value: 'all', label: t.overview.incidents.range_all_time },
    { value: '24h', label: t.overview.incidents.range_24h },
    { value: '7d', label: t.overview.incidents.range_7d },
  ];

  const setSeverity = (v: string) => onChange({ ...filters, severities: v === 'all' ? null : [v] });
  const setSource = (v: string) => onChange({ ...filters, source_tables: v === 'all' ? null : [v] });
  const setRange = (v: string) => onChange({ ...filters, since: sinceFromRange(v) });

  // Narrowed = moved past the resting open-only view (any dropdown off its
  // default, a status set in the State column, or a persona drill-in).
  const statusNarrowed = !(filters.statuses?.length === 1 && filters.statuses[0] === 'open');
  const isNarrowed =
    statusNarrowed ||
    severityValue !== 'all' ||
    sourceValue !== 'all' ||
    rangeValue !== 'all' ||
    !!filters.persona_id;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 border-b border-primary/10 bg-secondary/10">
      <ColumnDropdownFilter
        label={t.overview.incidents.filter_severity_label}
        value={severityValue}
        options={severityOptions}
        onChange={setSeverity}
      />
      <ColumnDropdownFilter
        label={t.overview.incidents.filter_source_label}
        value={sourceValue}
        options={sourceOptions}
        onChange={setSource}
      />
      <ColumnDropdownFilter
        label={t.overview.incidents.range_all_time}
        value={rangeValue}
        options={rangeOptions}
        onChange={setRange}
      />

      {isNarrowed && (
        <button
          onClick={() => onChange(OPEN_ONLY_FILTERS)}
          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          {t.overview.incidents.filters_clear_all}
        </button>
      )}
    </div>
  );
}
