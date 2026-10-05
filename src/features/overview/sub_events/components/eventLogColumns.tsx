import { useMemo } from 'react';
import type { Translations } from '@/i18n/en';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaColumnFilter } from '@/features/agents/components/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { EVENT_STATUS_COLORS, getEventTypeColor } from '@/lib/utils/formatters';
import { getEventStatusIcon } from '@/lib/design/eventTokens';
import type { PersonaEvent, Persona } from '@/lib/types/types';
import { eventTypeLabel } from '../libs/eventTypeLabel';
import { resolveEventSource } from '../libs/eventSourceRegistry';

// Fallback for a status token EVENT_STATUS_COLORS does not know. Amber means
// "unexpected", so it reads through the status palette rather than a raw hue.
const defaultStatus = { bg: 'bg-status-warning/10', text: 'text-status-warning', border: 'border-status-warning/20' };

// The source icon/label/tone map used to live here, 15 keys wide, with a
// `HelpCircle` fallback — and it was missing the three sources that produced
// two thirds of the real rows. It now lives in `libs/eventSourceRegistry.ts`,
// enumerated from the Rust emit sites and gated by its own test. See that
// file's header for the measurement.

interface FilterOption { value: string; label: string }

export interface EventLogColumnsArgs {
  t: Translations;
  personas: Persona[];
  getPersona: (id: string | null) => Persona | null;
  triggerFilter: string;
  setTriggerFilter: (v: string) => void;
  triggerOptions: FilterOption[];
  typeOptions: FilterOption[];
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  statusOptions: FilterOption[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  selectedPersonaId: string;
  setSelectedPersonaId: (v: string) => void;
}

/**
 * Column model for the events UnifiedTable — extracted from EventLogList so
 * the list component stays at orchestration altitude. Pure presentation: all
 * filter state comes in via args.
 */
export function useEventLogColumns({
  t, personas, getPersona,
  triggerFilter, setTriggerFilter, triggerOptions,
  typeOptions, typeFilter, setTypeFilter,
  statusOptions, statusFilter, setStatusFilter,
  selectedPersonaId, setSelectedPersonaId,
}: EventLogColumnsArgs): TableColumn<PersonaEvent>[] {
  return useMemo(() => [
    {
      // The column key stays `trigger` so a user's saved width for this table
      // (UnifiedTable `tableId`) survives the rename of its header.
      key: 'trigger',
      // Headed "Source", not "Trigger": the field is `source_type`, and most
      // rows are not triggers at all (an incident, an overnight autopilot run
      // and a context scan are none of them). The owner names it Source too.
      label: t.overview.events.source,
      // Widened from minmax(100px, 0.6fr): the cell now prints the label beside
      // the glyph, so a bare 7x7 mark no longer forces a hover to answer "what
      // is this". The column is user-resizable, so it can afford the text.
      width: 'minmax(170px, 1fr)',
      filterComponent: (
        <ColumnDropdownFilter
          label={t.overview.events.source}
          value={triggerFilter}
          options={triggerOptions}
          onChange={setTriggerFilter}
        />
      ),
      render: (event) => {
        // One registry, enumerated from the Rust emit sites. `tone` is the
        // ORIGIN's colour, not the source's: four meaningful hues (you / an
        // agent / the app / outside) replace eleven decorative ones, now that
        // the label carries identity and colour is free to carry origin.
        const { icon: Icon, tone, label, originLabel, known } =
          resolveEventSource(t, event.source_type || '');
        return (
          <span
            className="inline-flex items-center gap-2 min-w-0 max-w-full"
            title={`${label} · ${originLabel}`}
            aria-label={`${label} · ${originLabel}`}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
            {/* typo-body like every other value cell. An unregistered source
                takes the warning colour on the text too, so it reads as a
                defect rather than as a valid state — and it still prints the
                raw token, because this cell is never allowed to be empty. */}
            <span className={`block truncate typo-body ${known ? 'text-foreground' : 'text-status-warning'}`}>
              {label}
            </span>
          </span>
        );
      },
    },
    {
      key: 'persona',
      // Widened (was minmax(160px, 1fr)) so roughly twice as much of a
      // persona's name is visible before the cell truncates.
      label: t.overview.events.col_persona,
      width: 'minmax(320px, 2fr)',
      filterComponent: (
        <PersonaColumnFilter
          value={selectedPersonaId}
          onChange={(v) => setSelectedPersonaId(v)}
          personas={personas}
        />
      ),
      render: (event) => {
        const raw = event.source_type || '';
        const isPersonaTrigger = raw === 'persona' || raw.startsWith('persona:');
        if (!isPersonaTrigger) {
          return <span className="typo-body text-foreground">—</span>;
        }

        const personaId = raw.startsWith('persona:')
          ? raw.slice('persona:'.length)
          : event.source_id;
        const persona = getPersona(personaId ?? null);
        if (persona) {
          // No truncation — the full persona name is always shown (wraps if
          // the column is too narrow). Users can drag the column wider.
          return <span className="typo-body text-foreground break-words">{persona.name}</span>;
        }
        if (personaId) {
          // Show the full id — the column is wide (minmax(320px, 2fr)), so long
          // ids wrap rather than truncate, matching the resolved-name case above.
          // Same typo-body as every other value cell: this table uses ONE type
          // scale across columns (no mono/caption variance).
          return (
            <span className="typo-body text-foreground break-all" title={personaId}>
              {personaId}
            </span>
          );
        }
        return <span className="typo-body text-foreground">—</span>;
      },
    },
    {
      key: 'type',
      label: t.overview.events.col_event_name,
      width: 'minmax(180px, 1.2fr)',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (event) => {
        const typeColor = getEventTypeColor(event.event_type).tailwind;
        // `block truncate` (not inline): the cell wrapper is a min-w-0 grid
        // cell, so only a block-level span actually clips overflow. typo-body
        // matches every other column's value font — the raw technical id
        // stays reachable via the title tooltip.
        return (
          <span className={`block max-w-full truncate typo-body ${typeColor}`} title={event.event_type}>
            {eventTypeLabel(t, event.event_type)}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: t.overview.events.col_status,
      width: 'minmax(140px, 0.8fr)',
      filterOptions: statusOptions,
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (event) => {
        const statusStyle = EVENT_STATUS_COLORS[event.status] ?? defaultStatus;
        const StatusIcon = getEventStatusIcon(event.status);
        // typo-body like every other value cell — the pill carries the status
        // colour, it does not need a second (smaller) type scale to do it.
        return (
          <span className={`inline-flex items-center gap-1.5 typo-body px-2 py-0.5 rounded-card ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
            {event.status === 'processing'
              ? <LoadingSpinner size="xs" />
              : <StatusIcon className="w-3 h-3" />}
            {event.status}
          </span>
        );
      },
    },
    {
      key: 'created',
      label: t.overview.events.col_created,
      width: 'minmax(120px, 0.8fr)',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <RelativeTime timestamp={event.created_at} className="typo-body text-foreground" />
      ),
    },
  ], [
    t, personas, getPersona,
    triggerFilter, setTriggerFilter, triggerOptions,
    typeOptions, typeFilter, setTypeFilter,
    statusOptions, statusFilter, setStatusFilter,
    selectedPersonaId, setSelectedPersonaId,
  ]);
}
