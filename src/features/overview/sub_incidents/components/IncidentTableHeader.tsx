import { useTranslation } from '@/i18n/useTranslation';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { SortableColumnHeader } from '@/features/shared/components/forms/SortableColumnHeader';
import { ColumnResizeHandle, type ColumnWidthsApi } from '@/features/shared/components/display/ColumnResize';
import type { Persona } from '@/lib/bindings/Persona';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';
import { statusLabel } from '../libs/incidentTaxonomy';

const STATUS_VALUES = ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'] as const;

interface Props {
  filters: IncidentFilters;
  onChange: (next: IncidentFilters) => void;
  personas: Persona[];
  /** True when sorted oldest-first; drives the Days column's sort arrow. */
  oldestFirst: boolean;
  onToggleSort: () => void;
  gridTemplate: string;
  colWidths: ColumnWidthsApi;
}

/**
 * Sticky column header for the incidents table. Each column owns its own
 * filter/sort affordance built from the shared Overview table primitives
 * (PersonaColumnFilter / ColumnDropdownFilter / SortableColumnHeader), so the
 * Persona and State columns are filterable and Days is sortable in place — the
 * pattern used by the Activity (GlobalExecutionList) and Events tables.
 */
export function IncidentTableHeader({
  filters,
  onChange,
  personas,
  oldestFirst,
  onToggleSort,
  gridTemplate,
  colWidths,
}: Props) {
  const { t } = useTranslation();

  const statusValue = filters.statuses?.length === 1 ? filters.statuses[0]! : 'all';
  const statusOptions = [
    { value: 'all', label: t.overview.incidents.filter_status_all },
    ...STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(t, s) })),
  ];
  const setStatus = (v: string) => onChange({ ...filters, statuses: v === 'all' ? null : [v] });

  return (
    <div
      role="row"
      className="sticky top-0 z-30 grid h-9 items-center border-b border-primary/10 bg-background/95 backdrop-blur-sm"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div role="columnheader" className="relative flex items-center px-4 typo-label text-foreground">
        {t.overview.incidents.col_incident}
        <ColumnResizeHandle
          label={t.shared.resize_column}
          onBeginResize={(w, x) => colWidths.beginResize('incident', w, x)}
          onReset={() => colWidths.clearColumn('incident')}
        />
      </div>

      <div role="columnheader" className="relative flex items-center px-4">
        <PersonaColumnFilter
          value={filters.persona_id ?? ''}
          onChange={(id) => onChange({ ...filters, persona_id: id || null })}
          personas={personas}
          label={t.overview.incidents.filter_persona_label}
        />
        <ColumnResizeHandle
          label={t.shared.resize_column}
          onBeginResize={(w, x) => colWidths.beginResize('persona', w, x)}
          onReset={() => colWidths.clearColumn('persona')}
        />
      </div>

      <div role="columnheader" className="relative flex items-center px-4">
        <ColumnDropdownFilter
          label={t.overview.incidents.filter_status_label}
          value={statusValue}
          options={statusOptions}
          onChange={setStatus}
        />
        <ColumnResizeHandle
          label={t.shared.resize_column}
          onBeginResize={(w, x) => colWidths.beginResize('state', w, x)}
          onReset={() => colWidths.clearColumn('state')}
        />
      </div>

      <div role="columnheader" className="relative flex items-center justify-end px-4">
        <SortableColumnHeader
          label={t.overview.incidents.col_days}
          direction={oldestFirst ? 'desc' : 'asc'}
          onToggle={onToggleSort}
          align="right"
        />
        <ColumnResizeHandle
          label={t.shared.resize_column}
          onBeginResize={(w, x) => colWidths.beginResize('days', w, x)}
          onReset={() => colWidths.clearColumn('days')}
        />
      </div>

      <div role="columnheader" className="flex items-center justify-end px-4 typo-label text-foreground">
        {t.common.actions}
      </div>
    </div>
  );
}
