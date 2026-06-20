/**
 * StudioPatchbayVariant — deep-merge variant A: "Patchbay".
 *
 * Connection-centric mental model. Every route — whether a committed live
 * binding or a pending draft — renders as one horizontal patch cable:
 *   [source] ──(middle)──▶ [target]
 * Draft cables (amber, dashed) carry Save/remove; live cables (solid) carry
 * disconnect + per-event add-listener/rename. One homogeneous list, draft vs
 * live distinguished only by state — the chain mental model made literal.
 *
 * Incomplete routes (an event with no listener — catalog noise / dangling
 * sources) are hidden by default behind a top-bar toggle. Chain routes carry
 * their true source on the connection, so A→B and C→B render as distinct
 * cables with the correct source persona.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Trash2, X, Plus, Unplug, Pencil, Globe, Filter, Eye, EyeOff, GitBranch } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { listEvents } from '@/api/overview/events';
import { silentCatch } from '@/lib/silentCatch';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { findTemplateByEventType } from '@/features/triggers/lib/eventSourceTemplates';
import { useStudioComposer } from './useStudioComposer';
import { StudioSourceRail, StudioTargetRail } from './StudioRails';
import { SourceChip, TargetChip, PatchEndChip } from './studioChips';
import { commitBlocker } from './libs/studioCommit';
import { conditionLabel } from './libs/studioLabels';
import { useRoutingState } from './routing/layouts/useRoutingState';
import { resolveIcon, type EventRow, type Connection } from './routing/layouts/routingHelpers';
import { SystemEventAutomationsPanel } from './system_ops/SystemEventAutomationsPanel';
import { SystemEventCommitModal } from './system_ops/SystemEventCommitModal';
import { AddPersonaModal } from './routing/layouts/AddPersonaModal';
import { DisconnectDialog } from './routing/layouts/DisconnectDialog';
import { RenameEventDialog } from './routing/layouts/RenameEventDialog';

interface LiveCable { row: EventRow; connection: Connection | null }

type StudioStrings = ReturnType<typeof useStudioComposer>['st'];

/** Label a live chain's backend condition token (any / success / failure). */
function chainCondLabel(st: StudioStrings, cond?: string | null): string {
  if (cond === 'success') return st.condition_on_success;
  if (cond === 'failure') return st.condition_on_failure;
  return st.condition_always;
}

export function StudioPatchbayVariant() {
  const personas = useAgentStore((s) => s.personas);
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [showUnconnected, setShowUnconnected] = useState(false);

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);
  useEffect(() => {
    let stale = false;
    Promise.all([listAllTriggers(), listEvents(1000).catch(() => [] as PersonaEvent[])])
      .then(([t, e]) => { if (!stale) { setTriggers(t); setEvents(e); } })
      .catch(silentCatch('features/triggers/sub_studio/StudioPatchbayVariant:load'));
    return () => { stale = true; };
  }, []);

  const routing = useRoutingState({ initialTriggers: triggers, initialEvents: events, personas, teams });
  const c = useStudioComposer(routing.reload);
  const { t, tx, st } = c;

  const openRename = useCallback((row: EventRow) => routing.setRenameTarget({
    eventType: row.eventType,
    reserved: row.sourceClass === 'common',
    sources: row.sourcePersonas.length,
    connections: row.connections.length,
  }), [routing]);

  // Split into complete edges (a listener) vs incomplete (event with no
  // listener — catalog noise / dangling sources). Incomplete hides by default.
  const { connected, unconnected } = useMemo(() => {
    const connectedCables: LiveCable[] = [];
    const unconnectedCables: LiveCable[] = [];
    for (const row of routing.rows) {
      if (row.connections.length === 0) unconnectedCables.push({ row, connection: null });
      else for (const conn of row.connections) connectedCables.push({ row, connection: conn });
    }
    return { connected: connectedCables, unconnected: unconnectedCables };
  }, [routing.rows]);

  const isEmpty = c.draft.links.length === 0 && connected.length === 0
    && c.automations.length === 0 && !c.armedSource && !c.armedTarget && !c.armedSystemOp;

  return (
    <div className="flex-1 flex min-h-0">
      <StudioSourceRail c={c} />

      {/* ── Unified ledger ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <h3 className="typo-heading text-foreground">{st.routes_title}</h3>
          <span className="typo-data text-status-success">{connected.length} {st.proto_live}</span>
          {c.draft.links.length > 0 && <span className="typo-data text-status-warning">{c.draft.links.length} {st.proto_pending}</span>}
          <div className="ml-auto flex items-center gap-2">
            {unconnected.length > 0 && (
              <button type="button" onClick={() => setShowUnconnected((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-interactive text-foreground hover:bg-secondary/60 transition-colors">
                {showUnconnected ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showUnconnected ? st.proto_hide_unconnected : tx(st.proto_show_unconnected, { count: unconnected.length })}
              </button>
            )}
            {c.committableLinks.length > 0 && (
              <button type="button" onClick={() => void c.commitAll()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-interactive text-status-success hover:bg-status-success/10 transition-colors">
                <Check className="w-3.5 h-3.5" /> {st.commit_all}
              </button>
            )}
            {c.draft.links.length > 0 && (
              <button type="button" onClick={c.clearAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body opacity-80 rounded-interactive text-foreground hover:text-status-error hover:bg-status-error/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> {st.clear_all}
              </button>
            )}
          </div>
        </div>

        {/* Pending patch strip */}
        <AnimatePresence>
          {(c.armedSource || c.armedTarget || c.armedSystemOp) && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
              className="mx-5 mt-3 px-4 py-2.5 rounded-card border border-primary/30 bg-primary/5 flex items-center gap-3">
              <PatchEndChip source={c.armedSource} personas={personas} kinds={c.systemOpKinds} placeholder={st.pick_a_source} />
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <PatchEndChip targetId={c.armedTarget} systemOpKind={c.armedSystemOp} personas={personas} kinds={c.systemOpKinds} placeholder={st.pick_a_target} />
              <button type="button" onClick={() => { c.setArmedSource(null); c.setArmedTarget(null); c.setArmedSystemOp(null); }}
                className="ml-auto p-1 rounded-interactive text-foreground hover:bg-secondary/60 transition-colors" aria-label={st.cancel_pending_route}>
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-2">
          <SystemEventAutomationsPanel automations={c.automations} onToggle={c.toggleAutomation} onRun={c.runAutomationNow} onDelete={c.removeAutomation} />

          {isEmpty && <EmptyState icon={Filter} title={st.no_routes_title} description={st.no_routes_desc} />}

          {/* Draft cables (pending, unsaved) */}
          {c.draft.links.map((link) => {
            const blocker = commitBlocker(link);
            const busy = c.committing.has(link.id);
            return (
              <div key={link.id} className="group flex items-center gap-3 px-4 py-2.5 rounded-card border border-dashed border-status-warning/40 bg-status-warning/5">
                <SourceChip source={link.source} personas={personas} completesLabel={st.persona_completes} />
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="h-px w-4 bg-border" />
                  <button type="button" onClick={() => c.cycleCondition(link.id)} title={st.cycle_condition_hint}
                    className={`typo-body opacity-80 px-2 py-0.5 rounded-input border transition-colors ${link.condition ? 'border-status-warning/40 text-status-warning bg-status-warning/10' : 'border-border text-foreground hover:border-foreground/30'}`}>
                    {conditionLabel(t, link.condition)}
                  </button>
                  <div className="h-px w-4 bg-border" />
                  <ArrowRight className="w-3.5 h-3.5 text-foreground" />
                </div>
                <TargetChip targetId={link.targetPersonaId} personas={personas} />
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => { if (!blocker) void c.commitLink(link); }} disabled={!!blocker || busy}
                    title={blocker === 'signal_source' ? st.commit_blocked_signal : blocker === 'output_match' ? st.commit_blocked_output_match : st.commit_route}
                    aria-label={st.commit_route}
                    className={`p-1.5 rounded-interactive transition-colors disabled:cursor-not-allowed ${blocker ? 'text-foreground opacity-40' : 'text-status-success/80 hover:text-status-success hover:bg-status-success/10 disabled:opacity-50'}`}>
                    {busy ? <LoadingSpinner size="sm" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => c.removeLink(link.id)} aria-label={st.remove_route}
                    className="p-1.5 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Live cables — complete edges (a real source→listener route) */}
          {connected.map((cb, i) => (
            <LiveCableRow key={`c-${cb.row.eventType}-${cb.connection?.personaId}-${cb.connection?.sourcePersonaId ?? ''}-${i}`}
              cb={cb} st={st} personas={personas}
              onRename={openRename}
              onAdd={(row) => routing.setAddPersonaForEvent({ eventType: row.eventType })}
              onDisconnect={(connection, row) => routing.setDisconnectTarget({ connection, personaName: connection.persona?.name ?? connection.personaId.slice(0, 8), eventLabel: row.template?.label ?? row.eventType })}
            />
          ))}

          {/* Incomplete edges — events with no listener, hidden by default */}
          {showUnconnected && unconnected.length > 0 && (
            <div className="pt-2 pb-1 px-1 typo-caption uppercase tracking-wide text-foreground">{tx(st.proto_show_unconnected, { count: unconnected.length })}</div>
          )}
          {showUnconnected && unconnected.map((cb, i) => (
            <LiveCableRow key={`u-${cb.row.eventType}-${i}`} cb={cb} st={st} personas={personas} dim
              onRename={openRename}
              onAdd={(row) => routing.setAddPersonaForEvent({ eventType: row.eventType })}
              onDisconnect={() => undefined}
            />
          ))}
        </div>
      </div>

      <StudioTargetRail c={c} />

      {/* Modals — composer (system-op) + live-route management */}
      <SystemEventCommitModal
        open={c.commit !== null}
        onClose={() => c.setCommit(null)}
        opKind={c.commit?.opKind ?? ''}
        triggerType={c.commit?.triggerType ?? 'schedule'}
        onCreated={() => { void c.refreshAutomations(); void routing.reload(); }}
      />
      <AddPersonaModal
        open={!!routing.addPersonaForEvent}
        personas={routing.personas}
        teams={routing.teams}
        alreadyActiveIds={routing.connectedPersonaIdsForRow}
        eventLabel={routing.addPersonaForEvent ? (findTemplateByEventType(routing.addPersonaForEvent.eventType)?.label ?? routing.addPersonaForEvent.eventType) : ''}
        onAdd={routing.handleAddPersona}
        onClose={() => routing.setAddPersonaForEvent(null)}
      />
      <DisconnectDialog
        open={!!routing.disconnectTarget}
        personaName={routing.disconnectTarget?.personaName ?? ''}
        eventLabel={routing.disconnectTarget?.eventLabel ?? ''}
        onConfirm={routing.handleDisconnect}
        onCancel={() => routing.setDisconnectTarget(null)}
      />
      <RenameEventDialog
        open={!!routing.renameTarget}
        oldEventType={routing.renameTarget?.eventType ?? ''}
        reserved={routing.renameTarget?.reserved ?? false}
        affectedCounts={{ sources: routing.renameTarget?.sources ?? 0, connections: routing.renameTarget?.connections ?? 0 }}
        onConfirm={routing.handleRename}
        onCancel={() => routing.setRenameTarget(null)}
      />
    </div>
  );
}

function LiveCableRow({ cb, st, personas, dim, onRename, onAdd, onDisconnect }: {
  cb: LiveCable; st: StudioStrings; personas: Persona[]; dim?: boolean;
  onRename: (row: EventRow) => void;
  onAdd: (row: EventRow) => void;
  onDisconnect: (connection: Connection, row: EventRow) => void;
}) {
  const { row, connection } = cb;
  const EventIcon = resolveIcon(row.template);
  return (
    <div className={`group flex items-center gap-3 px-4 py-2.5 rounded-card border border-border bg-background/60 hover:border-foreground/20 transition-colors ${dim ? 'opacity-70' : ''}`}>
      <LiveSourceEnd row={row} connection={connection} personas={personas} />
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="h-px w-4 bg-border" />
        {connection && connection.kind === 'chain' ? (
          // A chain's "event" is the source's completion — `chain_triggered` is
          // shared by every chain and renaming it would rewire all of them, so
          // show the run-condition (read-only) instead of a renameable event.
          <span title={st.proto_chain_route}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-input border border-border text-foreground">
            <GitBranch className="w-3.5 h-3.5 text-primary" />
            <span className="typo-body">{chainCondLabel(st, connection.chainCondition)}</span>
          </span>
        ) : (
          <button type="button" onClick={() => onRename(row)} title={st.proto_rename_event}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-input border border-border text-foreground hover:border-foreground/30 transition-colors">
            <EventIcon className="w-3.5 h-3.5 text-foreground" />
            <span className="typo-body truncate max-w-[10rem]">{row.template?.label ?? row.eventType}</span>
            <Pencil className="w-3 h-3 text-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
          </button>
        )}
        <div className="h-px w-4 bg-border" />
        <ArrowRight className="w-3.5 h-3.5 text-foreground" />
      </div>
      {connection ? (
        <span className="flex items-center gap-2 min-w-0 shrink">
          <PersonaIcon icon={connection.persona?.icon} color={connection.persona?.color} display="framed" frameSize="sm" />
          <span className="typo-body font-medium text-foreground truncate">{connection.persona?.name ?? connection.personaId.slice(0, 8)}</span>
        </span>
      ) : (
        <span className="typo-body text-foreground italic">{st.proto_no_listeners}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={() => onAdd(row)} title={st.proto_add_listener}
          className="p-1.5 rounded-interactive text-foreground opacity-60 hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all">
          <Plus className="w-3.5 h-3.5" />
        </button>
        {connection && (
          <button type="button" onClick={() => onDisconnect(connection, row)} title={st.proto_disconnect}
            className="p-1.5 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-all">
            <Unplug className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function LiveSourceEnd({ row, connection, personas }: { row: EventRow; connection: Connection | null; personas: Persona[] }) {
  // Chain routes carry their true source on the connection (all chains share
  // the `chain_triggered` row, so the row-level source list can't attribute it).
  if (connection?.kind === 'chain' && connection.sourcePersonaId) {
    const p = personas.find((x) => x.id === connection.sourcePersonaId);
    return (
      <span className="flex items-center gap-1.5 min-w-0 shrink">
        <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
        <span className="typo-body text-foreground truncate max-w-[7rem]">{p?.name ?? connection.sourcePersonaId.slice(0, 8)}</span>
      </span>
    );
  }
  if (row.sourcePersonas.length > 0) {
    const entry = row.sourcePersonas[0];
    const first = entry?.persona;
    return (
      <span className="flex items-center gap-1.5 min-w-0 shrink">
        <PersonaIcon icon={first?.icon} color={first?.color} display="framed" frameSize="sm" />
        <span className="typo-body text-foreground truncate max-w-[7rem]">{first?.name ?? entry?.personaId.slice(0, 8)}</span>
        {row.sourcePersonas.length > 1 && <span className="typo-caption text-foreground">+{row.sourcePersonas.length - 1}</span>}
      </span>
    );
  }
  if (row.externalSourceLabels.length > 0) {
    return (
      <span className="flex items-center gap-1.5 min-w-0 shrink">
        <Globe className="w-4 h-4 text-sky-400 shrink-0" />
        <span className="typo-body text-foreground truncate max-w-[7rem]">{row.externalSourceLabels[0]}</span>
      </span>
    );
  }
  const Icon = resolveIcon(row.template);
  return (
    <span className="flex items-center gap-1.5 min-w-0 shrink text-foreground">
      <Icon className="w-4 h-4 shrink-0" />
      <span className="typo-body italic">{row.sourceClass}</span>
    </span>
  );
}
