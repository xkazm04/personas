/**
 * LiveCableRow — one committed route (or an event with no listener) on the
 * Studio ledger: [source] ──(event | condition)──▶ [target], its pulse and its
 * verbs. Extracted from StudioPatchbay.
 *
 * A connected cable carries its vitals (libs/cableVitals): a paused route is
 * drawn as paused, never as live, and a Pause/Resume switch flips `enabled` on
 * the governing row without deleting anything. The pulse shows when the route
 * last fired; route kinds whose fires the backend never records show none.
 */
import { ArrowRight, Plus, Unplug, Pencil, Globe, GitBranch } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { useStudioComposer } from './useStudioComposer';
import { SourceChip } from './studioChips';
import { conditionLabel } from './libs/studioLabels';
import type { CableVitals } from './libs/cableVitals';
import { resolveIcon, type EventRow, type Connection } from './routing/layouts/routingHelpers';

export interface LiveCable { row: EventRow; connection: Connection | null }

type StudioStrings = ReturnType<typeof useStudioComposer>['st'];
type StudioT = ReturnType<typeof useStudioComposer>['t'];

export function LiveCableRow({ cb, t, st, personas, dim, vitals, toggling, onRename, onAdd, onDisconnect, onSetPaused }: {
  cb: LiveCable; t: StudioT; st: StudioStrings; personas: Persona[]; dim?: boolean;
  vitals?: CableVitals;
  toggling?: boolean;
  onRename: (row: EventRow) => void;
  onAdd: (row: EventRow) => void;
  onDisconnect: (connection: Connection, row: EventRow) => void;
  onSetPaused?: (connection: Connection, paused: boolean) => void;
}) {
  const { row, connection } = cb;
  const EventIcon = resolveIcon(row.template);
  const paused = vitals?.state === 'paused';
  return (
    <div
      data-testid="studio-live-cable"
      data-cable-state={vitals?.state}
      className={`group flex items-center gap-3 px-4 py-2.5 max-w-[calc(100%-50px)] rounded-card border bg-background/60 hover:border-foreground/20 transition-colors ${paused ? 'border-dashed border-border' : 'border-border'} ${dim ? 'opacity-70' : ''}`}
    >
      <div className={`flex items-center gap-3 min-w-0 ${paused ? 'opacity-60' : ''}`}>
        <LiveSourceEnd row={row} connection={connection} personas={personas} completesLabel={st.persona_completes} />
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`h-px w-4 ${paused ? 'border-t border-dashed border-border' : 'bg-border'}`} />
          {connection?.kind === 'chain' && connection.route ? (
            // A chain's "event" is the source's completion — `chain_triggered` is
            // shared by every chain and renaming it would rewire all of them, so
            // show the run-condition (read-only) instead of a renameable event.
            <span title={st.proto_chain_route}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-input border border-border text-foreground">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              <span className="typo-body">{conditionLabel(t, connection.route.condition)}</span>
            </span>
          ) : (
            <button type="button" onClick={() => onRename(row)} title={st.proto_rename_event}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-input border border-border text-foreground hover:border-foreground/30 transition-colors">
              <EventIcon className="w-3.5 h-3.5 text-foreground" />
              <span className="typo-body truncate max-w-[10rem]">{row.template?.label ?? row.eventType}</span>
              <Pencil className="w-3 h-3 text-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          )}
          <div className={`h-px w-4 ${paused ? 'border-t border-dashed border-border' : 'bg-border'}`} />
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
      </div>
      {vitals && <CablePulse vitals={vitals} st={st} />}
      <div className="ml-auto flex items-center gap-1">
        {connection && vitals && onSetPaused && (
          <AccessibleToggle
            size="sm"
            checked={!paused}
            disabled={toggling}
            label={paused ? st.resume_route : st.pause_route}
            onChange={() => onSetPaused(connection, !paused)}
            className="mr-1"
            data-testid="studio-cable-pause-toggle"
          />
        )}
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

/** "Paused" and/or when the route last fired; nothing when fires are not recorded. */
function CablePulse({ vitals, st }: { vitals: CableVitals; st: StudioStrings }) {
  const paused = vitals.state === 'paused';
  if (!paused && !vitals.firesTracked) return null;
  return (
    <span className="flex items-center gap-2 shrink-0 typo-caption text-foreground">
      {paused && <span className="px-1.5 py-0.5 rounded-input border border-status-warning/40 text-status-warning">{st.route_paused}</span>}
      {vitals.firesTracked && (vitals.lastFiredAt
        ? <span>{st.last_fired} <RelativeTime timestamp={vitals.lastFiredAt} /></span>
        : <span className="italic">{st.never_fired}</span>)}
    </span>
  );
}

function LiveSourceEnd({ row, connection, personas, completesLabel }: { row: EventRow; connection: Connection | null; personas: Persona[]; completesLabel: string }) {
  // A route renders its true source (chains share `chain_triggered`, signal
  // routes `trigger_fired`, so the row cannot attribute them). A plain
  // event_listener's real source is whoever emits the event: the row's emitters.
  const route = connection?.route;
  if (route && !(route.source.kind === 'trigger' && route.source.triggerType === 'event_listener')) {
    return <SourceChip source={route.source} personas={personas} completesLabel={completesLabel} />;
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
