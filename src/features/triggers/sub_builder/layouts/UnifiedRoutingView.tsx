/**
 * Event Routing Table
 *
 * Row classification:
 *   • SYS row  — event type IS in EVENT_SOURCE_CATEGORIES (catalog)
 *   • USR row  — persona-emitted event, keyed by (sourcePersona, eventType)
 *   • EXT row  — external-source event (webhook, smee, cloud)
 *
 * THE SUBSCRIPTION-DIRECTION GAP
 * ──────────────────────────────
 * `persona_event_subscriptions` rows have NO direction field. Templates write
 * publish-intent events into them with descriptions saying "Emitted when..."
 * (see scripts/templates/.../*.json — `suggested_event_subscriptions` is a
 * misnomer; in many templates the listed events are what the persona PUBLISHES).
 * The build session at build_sessions.rs:799 defaults `direction = "subscribe"`,
 * so every templated event is stored as a listener — even ones the persona
 * never receives (e.g. `agent_memory`, which is a protocol message, not a
 * dispatched event).
 *
 * The runtime at engine/background.rs:655-665 then dispatches subscriptions
 * AS LISTENERS, so these dead-listener rows just sit there.
 *
 * To recover the user's mental model, we infer direction per subscription:
 *   - Catalog event_type            → listener (infra emits these; subs are real)
 *   - source_id of any recent event matches sub.persona_id → emitter
 *   - source_id of any recent event ≠ sub.persona_id      → listener
 *   - No event history at all       → emitter (template default intent)
 *
 * Source persona resolution (deterministic when possible):
 *   1. Chain trigger config.source_persona_id (chain.rs:46) — definitive
 *   2. PersonaEvent.source_id matched to a known persona — runtime truth
 *   3. Inferred-emitter subscriptions (the heuristic above)
 *
 * Connected Personas (real listeners):
 *   • Inferred-listener subscriptions
 *   • event_listener triggers (always explicit listening intent)
 *   • Chain trigger target persona (with chain condition badge)
 *
 * "Add Persona" creates an `event_listener` trigger directly (not a
 * subscription) — that way the new persona is unambiguously a listener and
 * can't accidentally be reclassified by the inference heuristic later.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MoreHorizontal, Plus, Pencil, Search,
  Radio, RefreshCw, Wand2,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import {
  listAllTriggers,
  deleteTrigger,
  linkPersonaToEvent,
  unlinkPersonaFromEvent,
  initializeEventHandlersForPersona,
  renameEventType,
} from '@/api/pipeline/triggers';
import {
  listEvents,
  listAllSubscriptions,
  deleteSubscription,
} from '@/api/overview/events';
import { findTemplateByEventType } from '../libs/eventCanvasConstants';
import { AddPersonaModal } from './AddPersonaModal';
import { DisconnectDialog } from './DisconnectDialog';
import { RenameEventDialog } from './RenameEventDialog';
import {
  resolveIcon, PersonaChip, buildEventRows,
  type Connection, type EventRow,
} from './routingHelpers';

// ── Props ────────────────────────────────────────────────────────────────

interface Props {
  initialTriggers: PersonaTrigger[];
  initialEvents: PersonaEvent[];
  personas: Persona[];
  groups: PersonaGroup[];
}

// ── Component ────────────────────────────────────────────────────────────

export function UnifiedRoutingView({ initialTriggers, initialEvents, personas, groups }: Props) {
  const { t } = useTranslation();
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>(initialEvents);
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string>('all'); // 'all' | 'common' | personaId
  const [eventSearch, setEventSearch] = useState('');
  const [actionMenuRow, setActionMenuRow] = useState<string | null>(null);
  const [addPersonaForEvent, setAddPersonaForEvent] = useState<{ eventType: string } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<{ connection: Connection; personaName: string; eventLabel: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    eventType: string;
    reserved: boolean;
    sources: number;
    connections: number;
  } | null>(null);

  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setAllTriggers(initialTriggers); }, [initialTriggers]);
  useEffect(() => { setRecentEvents(initialEvents); }, [initialEvents]);

  useEffect(() => {
    let stale = false;
    listAllSubscriptions()
      .then(subs => { if (!stale) setSubscriptions(subs); })
      .catch(() => { /* non-critical */ });
    return () => { stale = true; };
  }, []);

  const reload = useCallback(async () => {
    try {
      const [triggers, events, subs] = await Promise.all([
        listAllTriggers(),
        listEvents(1000).catch(() => [] as PersonaEvent[]),
        listAllSubscriptions().catch(() => [] as PersonaEventSubscription[]),
      ]);
      setAllTriggers(triggers);
      setRecentEvents(events);
      setSubscriptions(subs);
    } catch { /* best-effort */ }
  }, []);

  const personaMap = useMemo(() => {
    const m = new Map<string, Persona>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  // ── Build rows — delegated to buildEventRows in routingHelpers ──

  const rows: EventRow[] = useMemo(
    () => buildEventRows(allTriggers, recentEvents, subscriptions, personaMap),
    [allTriggers, recentEvents, subscriptions, personaMap],
  );

  // ── Source filter options ──

  const sourceOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: 'all', label: 'All Sources' },
      { value: 'common', label: 'Common (SYS)' },
    ];
    const personaSources = new Set<string>();
    for (const row of rows) {
      for (const s of row.sourcePersonas) personaSources.add(s.personaId);
    }
    const personaItems: { value: string; label: string }[] = [];
    for (const pid of personaSources) {
      const p = personaMap.get(pid);
      if (p) personaItems.push({ value: p.id, label: p.name });
    }
    personaItems.sort((a, b) => a.label.localeCompare(b.label));
    return [...opts, ...personaItems];
  }, [rows, personaMap]);

  // ── Filtered rows ──

  const filteredRows = useMemo(() => {
    const q = eventSearch.toLowerCase().trim();
    return rows.filter(row => {
      if (sourceFilter === 'common' && row.sourceClass !== 'common') return false;
      if (sourceFilter !== 'all' && sourceFilter !== 'common') {
        if (!row.sourcePersonas.some(s => s.personaId === sourceFilter)) return false;
      }
      if (q) {
        const label = (row.template?.label ?? row.eventType).toLowerCase();
        const type = row.eventType.toLowerCase();
        if (!label.includes(q) && !type.includes(q)) return false;
      }
      return true;
    });
  }, [rows, sourceFilter, eventSearch]);

  // ── Actions ──

  // Backfill: seed eventHandlers for every persona that already has event_listener
  // triggers but no matching handler entries yet. Idempotent — safe to re-run.
  // This lets users import templates or old personas and bring them up to date
  // with the new event-routing contract in one click.
  const [isBackfilling, setIsBackfilling] = useState(false);
  const handleInitializeHandlers = useCallback(async () => {
    setIsBackfilling(true);
    try {
      // Walk all personas referenced by listener or chain triggers / subscriptions.
      const personaIds = new Set<string>();
      for (const t of allTriggers) {
        if (t.trigger_type === 'event_listener') personaIds.add(t.persona_id);
      }
      for (const sub of subscriptions) personaIds.add(sub.persona_id);

      let total = 0;
      for (const pid of personaIds) {
        try {
          total += await initializeEventHandlersForPersona(pid);
        } catch { /* best-effort per persona */ }
      }
      // Lightweight feedback via console — the builder reload shows the actual state.
      // eslint-disable-next-line no-console
      console.info(`[builder] initialized ${total} event handler entries across ${personaIds.size} personas`);
      await reload();
    } finally {
      setIsBackfilling(false);
    }
  }, [allTriggers, subscriptions, reload]);

  const handleAddPersona = useCallback(async (personaId: string) => {
    if (!addPersonaForEvent) return;
    const { eventType } = addPersonaForEvent;
    setAddPersonaForEvent(null);
    try {
      // Use the atomic link command: one transaction creates the
      // event_listener trigger AND patches persona.structured_prompt.eventHandlers
      // with a handler instruction. This guarantees the persona actually
      // reacts to the event at runtime — see docs/design/event-routing-proposal.md.
      await linkPersonaToEvent(personaId, eventType);
      await reload();
    } catch { /* best-effort */ }
  }, [addPersonaForEvent, reload]);

  const handleRename = useCallback(
    async (newEventType: string) => {
      if (!renameTarget) return;
      // The backend throws on validation/collision/reserved. We propagate
      // the error up so the dialog can show it inline — don't swallow it here.
      await renameEventType(renameTarget.eventType, newEventType);
      setRenameTarget(null);
      await reload();
    },
    [renameTarget, reload],
  );

  const handleDisconnect = useCallback(async () => {
    if (!disconnectTarget) return;
    const { connection } = disconnectTarget;
    try {
      if (connection.kind === 'subscription' && connection.subscriptionId) {
        // Legacy subscription row — cascades to paired trigger in backend.
        await deleteSubscription(connection.subscriptionId);
      } else if (connection.kind === 'trigger-listener' && connection.triggerId) {
        // Builder-managed event_listener — atomic unlink (trigger + handler).
        await unlinkPersonaFromEvent(connection.triggerId);
      } else if (connection.triggerId) {
        // Chain trigger — just delete the trigger (no handler patch).
        await deleteTrigger(connection.triggerId, connection.personaId);
      }
      await reload();
    } catch { /* best-effort */ }
    setDisconnectTarget(null);
  }, [disconnectTarget, reload]);

  useEffect(() => {
    if (!actionMenuRow) return;
    function handleClick(e: MouseEvent) {
      if (actionMenuRow && actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuRow(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [actionMenuRow]);

  const connectedPersonaIdsForRow = useMemo(() => {
    if (!addPersonaForEvent) return new Set<string>();
    const row = rows.find(r => r.eventType === addPersonaForEvent.eventType);
    if (!row) return new Set<string>();
    // Exclude both existing listeners AND the source personas — both are
    // already "wired" to the event.
    const ids = new Set<string>(row.connections.map(c => c.personaId));
    for (const s of row.sourcePersonas) ids.add(s.personaId);
    return ids;
  }, [addPersonaForEvent, rows]);

  const totalConnections = rows.reduce((sum, r) => sum + r.connections.length, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-card/30 max-w-[1280px]">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={eventSearch}
            onChange={e => setEventSearch(e.target.value)}
            placeholder={t.triggers.builder.filter_events_placeholder}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-400/40"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground/50 tabular-nums">
            {filteredRows.length} event{filteredRows.length !== 1 ? 's' : ''} · {totalConnections} connection{totalConnections !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => void handleInitializeHandlers()}
            disabled={isBackfilling}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t.triggers.builder.init_handlers_title}
          >
            <Wand2 className={`w-4 h-4 ${isBackfilling ? 'animate-pulse' : ''}`} />
          </button>
          <button
            onClick={() => void reload()}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors"
            title={t.triggers.builder.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Table header ── */}
      <div className="flex items-center px-4 py-2.5 border-b border-primary/10 bg-card/20 max-w-[1280px]">
        <span className="w-14 typo-label text-foreground/80">{t.triggers.builder.source}</span>
        <div className="w-[260px] min-w-[260px] pl-3">
          <ColumnDropdownFilter
            label="Source Personas"
            value={sourceFilter}
            options={sourceOptions}
            onChange={(v) => setSourceFilter(v || 'all')}
          />
        </div>
        <span className="w-[300px] min-w-[300px] typo-label text-foreground/80 pl-3">Event</span>
        <span className="flex-1 typo-label text-foreground/80">{t.triggers.builder.connected_personas}</span>
        <span className="w-10" />
      </div>

      {/* ── Table body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filteredRows.length === 0 && (
          <div className="flex items-center justify-center py-16 text-center">
            <div>
              <Radio className="w-8 h-8 text-muted-foreground/15 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground/50">
                {eventSearch ? t.triggers.builder.no_matching_events : t.triggers.builder.no_events_filter}
              </p>
            </div>
          </div>
        )}

        {filteredRows.map((row, idx) => {
          const Icon = resolveIcon(row.template);
          const hasContent = row.connections.length + row.sourcePersonas.length > 0;
          const isActionOpen = actionMenuRow === row.eventType;

          const badgeStyle = {
            common: 'bg-cyan-500/10 text-cyan-400/70',
            persona: 'bg-violet-500/10 text-violet-400/70',
            external: 'bg-amber-500/10 text-amber-400/70',
          }[row.sourceClass];
          const badgeLabel = {
            common: 'SYS',
            persona: 'USR',
            external: 'EXT',
          }[row.sourceClass];

          return (
            <div
              key={row.eventType}
              className={`
                flex items-center px-4 py-3 border-b border-primary/5 transition-colors max-w-[1280px]
                ${idx % 2 === 0 ? 'bg-white/[0.015]' : ''}
                ${hasContent ? 'hover:bg-white/[0.05]' : 'hover:bg-white/[0.03] opacity-60 hover:opacity-80'}
              `}
            >
              {/* Source badge */}
              <div className="w-14 flex-shrink-0">
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${badgeStyle}`}>
                  {badgeLabel}
                </span>
              </div>

              {/* Source personas — list of chips, same component as Connected Personas */}
              <div className="w-[260px] min-w-[260px] flex-shrink-0 flex flex-wrap items-center gap-1.5 pl-3 min-h-[32px]">
                {row.sourcePersonas.length > 0 ? (
                  row.sourcePersonas.map(s => (
                    <PersonaChip
                      key={s.personaId}
                      persona={s.persona}
                      personaIdFallback={s.personaId}
                    />
                  ))
                ) : row.externalSourceLabels.length > 0 ? (
                  <span className="text-xs text-muted-foreground/50 italic">
                    {row.externalSourceLabels.join(', ')}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground/25">—</span>
                )}
              </div>

              {/* Event info */}
              <div className="w-[300px] min-w-[300px] flex-shrink-0 flex items-center gap-2.5 pl-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${row.template ? 'bg-cyan-500/10' : 'bg-violet-500/10'}`}>
                  <Icon className={`w-4 h-4 ${row.template?.color ?? 'text-violet-400'}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground truncate">{row.template?.label ?? row.eventType}</div>
                  <div className="text-xs text-muted-foreground/40 truncate">{row.eventType}</div>
                </div>
              </div>

              {/* Connected personas */}
              <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[32px]">
                {row.connections.length === 0 && (
                  <span className="text-sm text-muted-foreground/30 italic">{t.triggers.builder.no_personas_connected}</span>
                )}
                {row.connections.map(conn => (
                  <PersonaChip
                    key={conn.subscriptionId ?? conn.triggerId ?? conn.personaId}
                    persona={conn.persona}
                    personaIdFallback={conn.personaId}
                    badge={conn.kind === 'chain' ? {
                      text: conn.chainCondition ?? 'chain',
                      title: `Chained after ${conn.chainCondition ?? 'any'} condition`,
                    } : undefined}
                    onRemove={() => setDisconnectTarget({
                      connection: conn,
                      personaName: conn.persona?.name ?? conn.personaId.slice(0, 8),
                      eventLabel: row.template?.label ?? row.eventType,
                    })}
                  />
                ))}
              </div>

              {/* Three-dot action menu */}
              <div className="w-10 flex-shrink-0 flex items-center justify-center relative">
                <button
                  onClick={() => setActionMenuRow(isActionOpen ? null : row.eventType)}
                  className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {isActionOpen && (
                  <div
                    ref={actionMenuRef}
                    className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-background border border-primary/15 shadow-elevation-4 shadow-black/30 py-1 z-30"
                  >
                    <button
                      onClick={() => {
                        setActionMenuRow(null);
                        setAddPersonaForEvent({ eventType: row.eventType });
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-secondary/40 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-400" />
                      {t.triggers.builder.add_persona_action}
                    </button>
                    <button
                      onClick={() => {
                        setActionMenuRow(null);
                        setRenameTarget({
                          eventType: row.eventType,
                          // Catalog (SYS) events are infrastructure-emitted
                          // and the backend rejects renaming them. We disable
                          // the dialog's input on the frontend too so the
                          // user sees why before submitting.
                          reserved: row.sourceClass === 'common',
                          sources: row.sourcePersonas.length,
                          connections: row.connections.length,
                        });
                      }}
                      disabled={row.sourceClass === 'common'}
                      title={
                        row.sourceClass === 'common'
                          ? 'Built-in events cannot be renamed'
                          : 'Rename this event across all stores'
                      }
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground/80 hover:bg-secondary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <Pencil className="w-3.5 h-3.5 text-cyan-400" />
                      {t.triggers.builder.rename_event_action}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add Persona Modal ── */}
      <AddPersonaModal
        open={!!addPersonaForEvent}
        personas={personas}
        groups={groups}
        alreadyActiveIds={connectedPersonaIdsForRow}
        eventLabel={addPersonaForEvent ? (findTemplateByEventType(addPersonaForEvent.eventType)?.label ?? addPersonaForEvent.eventType) : ''}
        onAdd={handleAddPersona}
        onClose={() => setAddPersonaForEvent(null)}
      />

      {/* ── Disconnect Confirmation ── */}
      <DisconnectDialog
        open={!!disconnectTarget}
        personaName={disconnectTarget?.personaName ?? ''}
        eventLabel={disconnectTarget?.eventLabel ?? ''}
        onConfirm={handleDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />

      {/* ── Rename Event Dialog ── */}
      <RenameEventDialog
        open={!!renameTarget}
        oldEventType={renameTarget?.eventType ?? ''}
        reserved={renameTarget?.reserved ?? false}
        affectedCounts={{
          sources: renameTarget?.sources ?? 0,
          connections: renameTarget?.connections ?? 0,
        }}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />
    </div>
  );
}
