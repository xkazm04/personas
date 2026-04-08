import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Clock, Plug, ChevronUp, ChevronDown, Check, Zap, Table2, X, Search, Radio } from 'lucide-react';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useHealthyConnectors, type HealthyConnector } from './useHealthyConnectors';
import { useAgentStore } from '@/stores/agentStore';
import { listDbSchemaTables } from '@/api/vault/database/dbSchema';
import { getPersonaDetail } from '@/api/agents/personas';
import type { DbSchemaTable } from '@/lib/bindings/DbSchemaTable';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Frequency = 'daily' | 'weekly' | 'monthly';

const DAYS = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
] as const;

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

const INPUT_CLS = 'h-9 px-3 rounded-lg border border-primary/15 bg-secondary/20 text-sm text-foreground/80 outline-none focus-visible:border-primary/30 transition-colors';

export interface EventSubscription {
  personaId: string;
  personaName: string;
  triggerId: string;
  description: string;
}

export interface QuickConfigState {
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
  selectedConnectors: string[];
  /** Map of connector name -> selected table name for database connectors */
  connectorTables: Record<string, string>;
  /** Event subscriptions from other personas' event_listener triggers */
  selectedEvents: EventSubscription[];
}

export function serializeQuickConfig(state: QuickConfigState): string {
  const parts: string[] = [];

  if (state.frequency) {
    let schedule: string;
    if (state.frequency === 'daily') {
      schedule = `Daily at ${state.time || '09:00'}`;
    } else if (state.frequency === 'weekly') {
      const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d).join(', ');
      schedule = `Weekly on ${dayNames || 'Monday'} at ${state.time || '09:00'}`;
    } else {
      schedule = `Monthly on day ${state.monthDay} at ${state.time || '09:00'}`;
    }
    parts.push(`Schedule: ${schedule}`);
  }

  if (state.selectedConnectors.length > 0) {
    const serviceDescs = state.selectedConnectors.map((name) => {
      const table = state.connectorTables[name];
      return table ? `${name} (table: ${table})` : name;
    });
    parts.push(`Services: ${serviceDescs.join(', ')}`);
  }

  if (state.selectedEvents.length > 0) {
    const eventDescs = state.selectedEvents.map((e) => `${e.description} (from ${e.personaName})`);
    parts.push(`Event triggers: ${eventDescs.join(', ')}`);
  }

  return parts.length > 0 ? `\n---\n${parts.join('\n')}` : '';
}

/** Build human-readable trigger summary for cell preview (schedule + events) */
export function describeTriggerConfig(state: QuickConfigState): string[] {
  const lines: string[] = [];
  if (state.frequency === 'daily') {
    lines.push(`Daily at ${state.time || '09:00'}`);
  } else if (state.frequency === 'weekly') {
    const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d);
    lines.push(`Weekly: ${dayNames.join(', ') || 'Monday'}`);
    lines.push(`At ${state.time || '09:00'}`);
  } else if (state.frequency === 'monthly') {
    lines.push(`Monthly on day ${state.monthDay}`);
    lines.push(`At ${state.time || '09:00'}`);
  }
  // Include selected event triggers
  for (const ev of state.selectedEvents) {
    lines.push(`On ${ev.description}`);
  }
  return lines;
}

/** Build connector label list for cell preview */
export function describeSelectedConnectors(
  state: QuickConfigState,
  connectors: HealthyConnector[],
): string[] {
  return state.selectedConnectors.map((name) => {
    const c = connectors.find((h) => h.name === name);
    return c?.meta.label ?? name;
  });
}

// ---------------------------------------------------------------------------
// Schedule panel — label top, input bottom layout
// ---------------------------------------------------------------------------

function SchedulePanel({
  frequency, setFrequency,
  days, setDays,
  monthDay, setMonthDay,
  time, setTime,
}: {
  frequency: Frequency | null; setFrequency: (f: Frequency) => void;
  days: string[]; setDays: (d: string[]) => void;
  monthDay: number; setMonthDay: (d: number) => void;
  time: string; setTime: (t: string) => void;
}) {
  const toggleDay = (day: string) => {
    setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
  };

  return (
    <div className="grid grid-cols-[auto_auto_auto] items-start gap-x-6 gap-y-0 px-1" style={{ gridTemplateColumns: 'repeat(auto-fill, auto)' }}>
      <div className="flex flex-wrap items-end gap-6">
        {/* Frequency */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Frequency</span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/20 h-9">
            {(['daily', 'weekly', 'monthly'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`px-3.5 h-8 rounded-md text-xs font-medium transition-all duration-200 ${
                  frequency === f
                    ? 'bg-primary/15 text-primary shadow-elevation-1'
                    : 'text-muted-foreground/50 hover:text-muted-foreground/70'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Day selection (weekly) */}
        {frequency === 'weekly' && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Days</span>
            <div className="flex items-center gap-1 h-9">
              {DAYS.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  className={`w-9 h-9 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    days.includes(day.key)
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-secondary/15 text-muted-foreground/50 border border-transparent hover:border-primary/15'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Day of month (monthly) */}
        {frequency === 'monthly' && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Day of Month</span>
            <select
              value={monthDay}
              onChange={(e) => setMonthDay(Number(e.target.value))}
              className={INPUT_CLS}
            >
              {MONTH_DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Time picker */}
        {frequency && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services panel
// ---------------------------------------------------------------------------

const DATABASE_CATEGORIES = new Set(['database', 'spreadsheet']);

function TablePickerModal({
  isOpen, connectorName, connectors, tables, loading, selectedTable, onSelect, onClose,
}: {
  isOpen: boolean;
  connectorName: string | null;
  connectors: HealthyConnector[];
  tables: DbSchemaTable[];
  loading: boolean;
  selectedTable: string | null;
  onSelect: (tableName: string | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const conn = connectorName ? connectors.find((c) => c.name === connectorName) : null;

  const filtered = useMemo(() => {
    if (!search) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) =>
      t.table_name.toLowerCase().includes(q) || (t.display_label?.toLowerCase().includes(q)),
    );
  }, [tables, search]);

  // Reset search when modal opens
  useEffect(() => { if (isOpen) setSearch(''); }, [isOpen]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="table-picker-title" size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10">
        <div className="flex items-center gap-3">
          {conn && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10">
              <ConnectorIcon meta={conn.meta} size="w-4 h-4" />
            </div>
          )}
          <div>
            <h2 id="table-picker-title" className="text-sm font-semibold text-foreground/90">
              Select Table
            </h2>
            <p className="text-xs text-muted-foreground/50">{conn?.meta.label ?? connectorName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      {tables.length > 5 && (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20">
            <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables..."
              className="flex-1 bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground/30 outline-none"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Table list */}
      <div className="px-5 py-3 max-h-[50vh] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground/40">Loading tables...</div>
        ) : tables.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground/40">No tables found for this connector</div>
        ) : (
          <div className="space-y-0.5">
            {selectedTable && (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-muted-foreground/50 hover:bg-secondary/30 transition-colors italic"
              >
                Clear selection
              </button>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.table_name)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2.5 ${
                  selectedTable === t.table_name
                    ? 'bg-primary/8 text-primary font-medium'
                    : 'text-foreground/70 hover:bg-secondary/30'
                }`}
              >
                <Table2 className="w-3.5 h-3.5 flex-shrink-0 text-blue-400/60" />
                <span className="truncate">{t.display_label || t.table_name}</span>
                {selectedTable === t.table_name && (
                  <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-primary" />
                )}
              </button>
            ))}
            {filtered.length === 0 && search && (
              <div className="py-4 text-center text-xs text-muted-foreground/40">No tables matching &quot;{search}&quot;</div>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
}

function ServicesPanel({
  connectors,
  selectedConnectors,
  onToggle,
  connectorTables,
  onTableSelect,
}: {
  connectors: HealthyConnector[];
  selectedConnectors: string[];
  onToggle: (name: string) => void;
  connectorTables: Record<string, string>;
  onTableSelect: (connectorName: string, tableName: string | null) => void;
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [tablePopoverFor, setTablePopoverFor] = useState<string | null>(null);
  const [tables, setTables] = useState<DbSchemaTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);

  // Fetch tables when popover opens
  useEffect(() => {
    if (!tablePopoverFor) return;
    const conn = connectors.find((c) => c.name === tablePopoverFor);
    if (!conn) return;
    setTablesLoading(true);
    listDbSchemaTables(conn.credentialId)
      .then(setTables)
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [tablePopoverFor, connectors]);

  // Derive available categories from connectors that are present, sorted alphabetically
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const c of connectors) {
      if (c.category) cats.add(c.category);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [connectors]);

  // Filter + sort connectors
  const filtered = useMemo(() => {
    const list = activeCategory === 'all'
      ? connectors
      : connectors.filter((c) => c.category === activeCategory);
    return [...list].sort((a, b) => a.meta.label.localeCompare(b.meta.label));
  }, [connectors, activeCategory]);

  if (connectors.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/40 px-1 py-2">
        No connectors with healthy API keys found. Add credentials in the Vault first.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-1">
      {/* Category filter strip */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
            activeCategory === 'all'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground/40 hover:text-muted-foreground/60'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
              activeCategory === cat
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/40 hover:text-muted-foreground/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Connector grid — fixed card size */}
      <div className="flex flex-wrap gap-2.5">
        {filtered.map((c) => {
          const isSelected = selectedConnectors.includes(c.name);
          const isDbType = DATABASE_CATEGORIES.has(c.category);
          const selectedTable = connectorTables[c.name];
          return (
            <div key={c.name} className="relative">
              <button
                type="button"
                onClick={() => onToggle(c.name)}
                className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl transition-all duration-200 ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/25 shadow-elevation-1 shadow-primary/10'
                    : 'bg-secondary/10 border border-transparent hover:border-primary/15 hover:bg-secondary/20'
                }`}
                style={{ width: 100, height: 75 }}
              >
                {isSelected && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-elevation-1 animate-fade-slide-in">
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </div>
                )}
                <div className={`w-7 h-7 flex items-center justify-center transition-all duration-200 ${
                  isSelected ? 'scale-110' : 'group-hover:scale-105'
                }`}>
                  <ConnectorIcon meta={c.meta} size="w-6 h-6" />
                </div>
                <span className={`text-[10px] font-medium truncate max-w-[88px] text-center leading-tight transition-colors ${
                  isSelected ? 'text-foreground/80' : 'text-muted-foreground/50'
                }`}>
                  {selectedTable ? selectedTable : c.meta.label}
                </span>
              </button>

              {/* Table selector icon for database connectors */}
              {isDbType && isSelected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTablePopoverFor(c.name); }}
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center hover:bg-blue-500/30 transition-colors"
                  title="Select table"
                >
                  <Table2 className="w-2.5 h-2.5 text-blue-400" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Table picker modal */}
      <TablePickerModal
        isOpen={!!tablePopoverFor}
        connectorName={tablePopoverFor}
        connectors={connectors}
        tables={tables}
        loading={tablesLoading}
        selectedTable={tablePopoverFor ? connectorTables[tablePopoverFor] ?? null : null}
        onSelect={(tableName) => { if (tablePopoverFor) { onTableSelect(tablePopoverFor, tableName); setTablePopoverFor(null); } }}
        onClose={() => setTablePopoverFor(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events panel — subscribe to other personas' event_listener triggers
// ---------------------------------------------------------------------------

function EventsPanel({
  selectedEvents,
  onToggleEvent,
}: {
  selectedEvents: EventSubscription[];
  onToggleEvent: (event: EventSubscription) => void;
}) {
  const personas = useAgentStore((s) => s.personas);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [loading, setLoading] = useState(false);

  // Event subscriptions from the persona's design result (has specific names like stock.signal.strong_buy)
  const [designEvents, setDesignEvents] = useState<Array<{ event_type: string; description?: string }>>([]);

  // Load event_listener triggers + design event subscriptions for the selected persona
  useEffect(() => {
    if (!selectedPersonaId) { setTriggers([]); setDesignEvents([]); return; }
    setLoading(true);
    getPersonaDetail(selectedPersonaId)
      .then((detail) => {
        const eventTriggers = (detail.triggers ?? []).filter(
          (t: PersonaTrigger) => t.trigger_type === 'event_listener' && t.enabled,
        );
        setTriggers(eventTriggers);

        // Extract event subscriptions from last_design_result for specific names
        try {
          const dr = (detail as unknown as Record<string, unknown>).last_design_result;
          if (typeof dr === 'string') {
            const parsed = JSON.parse(dr) as Record<string, unknown>;
            const subs = (parsed.suggested_event_subscriptions ?? []) as Array<{ event_type?: string; description?: string }>;
            setDesignEvents(subs.filter((s) => s.event_type).map((s) => ({ event_type: s.event_type!, description: s.description })));
          } else {
            setDesignEvents([]);
          }
        } catch { setDesignEvents([]); }
      })
      .catch(() => { setTriggers([]); setDesignEvents([]); })
      .finally(() => setLoading(false));
  }, [selectedPersonaId]);

  const selectedPersona = selectedPersonaId ? personas.find((p) => p.id === selectedPersonaId) : null;

  return (
    <div className="flex gap-6 px-1">
      {/* Persona selector (left) */}
      <div className="flex flex-col gap-2 min-w-[160px]">
        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Source Agent</span>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {personas.filter((p) => p.enabled).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPersonaId(p.id === selectedPersonaId ? null : p.id)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all duration-200 ${
                selectedPersonaId === p.id
                  ? 'bg-primary/10 border border-primary/25'
                  : 'hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <PersonaIcon icon={p.icon} color={p.color} />
              <span className={`text-xs truncate ${selectedPersonaId === p.id ? 'text-primary font-medium' : 'text-muted-foreground/60'}`}>
                {p.name}
              </span>
            </button>
          ))}
          {personas.filter((p) => p.enabled).length === 0 && (
            <p className="text-xs text-muted-foreground/40 py-2">No agents available</p>
          )}
        </div>
      </div>

      {/* Event triggers (right) */}
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
          {selectedPersona ? `Events from ${selectedPersona.name}` : 'Select an agent'}
        </span>
        {loading ? (
          <p className="text-xs text-muted-foreground/40 py-2 animate-pulse">Loading events...</p>
        ) : designEvents.length === 0 && triggers.length === 0 ? (
          <p className="text-xs text-muted-foreground/40 py-2">
            {selectedPersonaId ? 'No event subscriptions found' : 'Choose an agent to see its events'}
          </p>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {/* Show events from design result (has specific names like stock.signal.strong_buy) */}
            {designEvents.map((de) => {
              const stableId = `design:${de.event_type}`;
              const isSelected = selectedEvents.some((e) => e.triggerId === stableId);
              const event: EventSubscription = {
                personaId: selectedPersonaId!,
                personaName: selectedPersona?.name ?? 'Agent',
                triggerId: stableId,
                description: de.event_type,
              };
              return (
                <button
                  key={stableId}
                  type="button"
                  onClick={() => onToggleEvent(event)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-teal-500/10 border border-teal-500/25'
                      : 'bg-secondary/10 border border-transparent hover:border-primary/15'
                  }`}
                >
                  <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-muted-foreground/40'}`} />
                  <div className="min-w-0 flex-1">
                    <span className={`text-xs font-mono block truncate ${isSelected ? 'text-teal-300 font-medium' : 'text-muted-foreground/70'}`}>
                      {de.event_type}
                    </span>
                    {de.description && (
                      <span className="text-[10px] text-muted-foreground/40 block truncate">{de.description}</span>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-3 h-3 ml-auto text-teal-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
            {/* Fallback: show triggers if no design events exist */}
            {designEvents.length === 0 && triggers.map((t) => {
              const eventLabel = (() => {
                try {
                  const cfg = t.config ? JSON.parse(t.config) as Record<string, unknown> : {};
                  if (cfg.event_type) return String(cfg.event_type);
                  if (cfg.description && String(cfg.description).length > 3) return String(cfg.description);
                } catch { /* fallback */ }
                return `${selectedPersona?.name ?? 'Agent'} event`;
              })();
              const isSelected = selectedEvents.some((e) => e.triggerId === t.id);
              const event: EventSubscription = {
                personaId: t.persona_id,
                personaName: selectedPersona?.name ?? 'Agent',
                triggerId: t.id,
                description: eventLabel,
              };
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggleEvent(event)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-teal-500/10 border border-teal-500/25'
                      : 'bg-secondary/10 border border-transparent hover:border-primary/15'
                  }`}
                >
                  <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-muted-foreground/40'}`} />
                  <span className={`text-xs font-mono ${isSelected ? 'text-teal-300 font-medium' : 'text-muted-foreground/60'}`}>
                    {eventLabel}
                  </span>
                  {isSelected && (
                    <Check className="w-3 h-3 ml-auto text-teal-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main toolbar overlay
// ---------------------------------------------------------------------------

interface DimensionQuickConfigProps {
  onChange: (state: QuickConfigState) => void;
}

export function DimensionQuickConfig({ onChange }: DimensionQuickConfigProps) {
  const healthyConnectors = useHealthyConnectors();
  const [collapsed, setCollapsed] = useState(false);
  const [openPanel, setOpenPanel] = useState<'conditions' | 'services' | null>(null);

  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [days, setDays] = useState<string[]>(['mon']);
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState('09:00');
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [connectorTables, setConnectorTables] = useState<Record<string, string>>({});
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);

  // Notify parent on change
  useEffect(() => {
    onChange({ frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents });
  }, [frequency, days, monthDay, time, selectedConnectors, connectorTables, selectedEvents, onChange]);

  const toggleConnector = useCallback((name: string) => {
    setSelectedConnectors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const handleTableSelect = useCallback((connectorName: string, tableName: string | null) => {
    setConnectorTables((prev) => {
      if (tableName === null) {
        const next = { ...prev };
        delete next[connectorName];
        return next;
      }
      return { ...prev, [connectorName]: tableName };
    });
  }, []);

  const toggleEvent = useCallback((event: EventSubscription) => {
    setSelectedEvents((prev) =>
      prev.some((e) => e.triggerId === event.triggerId)
        ? prev.filter((e) => e.triggerId !== event.triggerId)
        : [...prev, event],
    );
  }, []);

  const togglePanel = (panel: 'conditions' | 'services') => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  };

  // Animated panel height
  const conditionsRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const [conditionsHeight, setConditionsHeight] = useState(0);
  const [servicesHeight, setServicesHeight] = useState(0);

  // Track panel content height with ResizeObserver so async-loaded content
  // (e.g. event triggers loading after persona selection) expands the panel.
  useEffect(() => {
    if (openPanel !== 'conditions' || !conditionsRef.current) return;
    const el = conditionsRef.current;
    setConditionsHeight(el.scrollHeight);
    const ro = new ResizeObserver(() => {
      setConditionsHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openPanel]);

  useEffect(() => {
    if (openPanel !== 'services' || !servicesRef.current) return;
    const el = servicesRef.current;
    setServicesHeight(el.scrollHeight);
    const ro = new ResizeObserver(() => {
      setServicesHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openPanel]);

  return (
    <div className="w-full min-w-[1100px]">
      <div className="rounded-xl border border-primary/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Zap className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Quick Setup</span>

          {!collapsed && (
            <div className="flex items-center gap-2 ml-2">
              <button
                type="button"
                onClick={() => togglePanel('conditions')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  openPanel === 'conditions'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Clock className="w-3 h-3" />
                Start Conditions
                {(frequency || selectedEvents.length > 0) && (
                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-primary/20 text-primary leading-none">
                    {(frequency ? 1 : 0) + selectedEvents.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('services')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  openPanel === 'services'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Plug className="w-3 h-3" />
                Apps & Services
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setCollapsed(!collapsed); setOpenPanel(null); }}
            className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-1"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Start Conditions panel — schedule + event triggers unified */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'conditions' ? conditionsHeight : 0,
            opacity: openPanel === 'conditions' ? 1 : 0,
          }}
        >
          <div ref={conditionsRef} className="border-t border-primary/8 px-4 py-4">
            <div className="flex gap-6">
              {/* Time-based schedule (left) */}
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-2 block">Time Schedule</span>
                <SchedulePanel
                  frequency={frequency} setFrequency={setFrequency}
                  days={days} setDays={setDays}
                  monthDay={monthDay} setMonthDay={setMonthDay}
                  time={time} setTime={setTime}
                />
              </div>
              {/* Divider */}
              <div className="w-px bg-primary/8 self-stretch" />
              {/* Event-based triggers from other agents (right) */}
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider mb-2 block">Event Triggers</span>
                <EventsPanel
                  selectedEvents={selectedEvents}
                  onToggleEvent={toggleEvent}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Services dropdown panel */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'services' ? servicesHeight : 0,
            opacity: openPanel === 'services' ? 1 : 0,
          }}
        >
          <div ref={servicesRef} className="border-t border-primary/8 px-4 py-4">
            <ServicesPanel
              connectors={healthyConnectors}
              selectedConnectors={selectedConnectors}
              onToggle={toggleConnector}
              connectorTables={connectorTables}
              onTableSelect={handleTableSelect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
