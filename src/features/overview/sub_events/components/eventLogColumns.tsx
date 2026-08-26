import { useMemo } from 'react';
import { Bot, HardDrive, Webhook, CalendarClock, KeyRound, HeartPulse, CloudUpload, Brain, ClipboardCheck, UserCheck, User, Cog, FlaskConical, Workflow, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };

const TRIGGER_ICON_MAP: Record<string, { icon: LucideIcon; tone: string }> = {
  persona:         { icon: Bot,            tone: 'text-violet-400' },
  user:            { icon: User,           tone: 'text-sky-400' },
  system:          { icon: Cog,            tone: 'text-foreground' },
  scheduler:       { icon: CalendarClock,  tone: 'text-amber-400' },
  local_drive:     { icon: HardDrive,      tone: 'text-emerald-400' },
  webhook:         { icon: Webhook,        tone: 'text-cyan-400' },
  trigger_engine:  { icon: Workflow,       tone: 'text-amber-400' },
  vault:           { icon: KeyRound,       tone: 'text-amber-300' },
  health_monitor:  { icon: HeartPulse,     tone: 'text-rose-400' },
  cloud_deploy:    { icon: CloudUpload,    tone: 'text-blue-400' },
  memory_engine:   { icon: Brain,          tone: 'text-fuchsia-400' },
  review_pipeline: { icon: ClipboardCheck, tone: 'text-emerald-400' },
  manual_review:   { icon: UserCheck,      tone: 'text-emerald-400' },
  test:            { icon: FlaskConical,   tone: 'text-foreground' },
};

const FALLBACK_TRIGGER_ICON = { icon: HelpCircle, tone: 'text-foreground' };

function resolveTriggerIcon(sourceType: string): { icon: LucideIcon; tone: string } {
  if (sourceType.startsWith('persona:')) return TRIGGER_ICON_MAP.persona ?? FALLBACK_TRIGGER_ICON;
  if (sourceType.startsWith('trigger:')) return TRIGGER_ICON_MAP.trigger_engine ?? FALLBACK_TRIGGER_ICON;
  return TRIGGER_ICON_MAP[sourceType] ?? FALLBACK_TRIGGER_ICON;
}

interface FilterOption { value: string; label: string }

export interface EventLogColumnsArgs {
  t: Translations;
  sourceTypeLabels: Record<string, string>;
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
  t, sourceTypeLabels, personas, getPersona,
  triggerFilter, setTriggerFilter, triggerOptions,
  typeOptions, typeFilter, setTypeFilter,
  statusOptions, statusFilter, setStatusFilter,
  selectedPersonaId, setSelectedPersonaId,
}: EventLogColumnsArgs): TableColumn<PersonaEvent>[] {
  return useMemo(() => [
    {
      key: 'trigger',
      label: 'Trigger',
      width: 'minmax(100px, 0.6fr)',
      filterComponent: (
        <ColumnDropdownFilter
          label="Trigger"
          value={triggerFilter}
          options={triggerOptions}
          onChange={setTriggerFilter}
        />
      ),
      render: (event) => {
        const raw = event.source_type || '';
        const baseKey = raw.startsWith('persona:')
          ? 'persona'
          : raw.startsWith('trigger:')
            ? 'trigger_engine'
            : raw;
        const label = sourceTypeLabels[baseKey] ?? baseKey.replace(/_/g, ' ');
        const { icon: Icon, tone } = resolveTriggerIcon(raw);
        return (
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 ${tone}`}
            title={label}
            aria-label={label}
          >
            <Icon className="w-3.5 h-3.5" />
          </span>
        );
      },
    },
    {
      key: 'persona',
      // Widened (was minmax(160px, 1fr)) so roughly twice as much of a
      // persona's name is visible before the cell truncates.
      label: 'Persona',
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
      label: 'Event Name',
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
      label: 'Status',
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
      label: 'Created',
      width: 'minmax(120px, 0.8fr)',
      sortable: true,
      align: 'right' as const,
      render: (event) => (
        <RelativeTime timestamp={event.created_at} className="typo-body text-foreground" />
      ),
    },
  ], [
    t, sourceTypeLabels, personas, getPersona,
    triggerFilter, setTriggerFilter, triggerOptions,
    typeOptions, typeFilter, setTypeFilter,
    statusOptions, statusFilter, setStatusFilter,
    selectedPersonaId, setSelectedPersonaId,
  ]);
}
