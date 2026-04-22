/**
 * ExpandedDrawer — the slide-down panel below an expanded event row.
 *
 * Full detail that the compact row's avatar stacks hide:
 *   • Every source persona with name
 *   • Every listener persona with chain / capability badges + disconnect
 *   • Inline Add listener / Rename event actions
 *
 * Kept out of the row to keep EventRow.tsx focused on layout.
 */
import { Plus, Pencil, X as XIcon } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import type { Connection, EventRow } from '../routingHelpers';

interface Props {
  row: EventRow;
  onAdd: () => void;
  onRename: () => void;
  onDisconnect: (conn: Connection) => void;
}

export function ExpandedDrawer({ row, onAdd, onRename, onDisconnect }: Props) {
  const isCommon = row.sourceClass === 'common';
  return (
    <div className="px-3 pb-3 pt-1 bg-background/40 border-t border-primary/5">
      {row.sourcePersonas.length > 0 && (
        <div className="mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/50">Sources</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {row.sourcePersonas.map(s => (
              <div key={s.personaId} className="flex items-center gap-1.5 px-2 py-1 rounded-card bg-violet-500/10 border border-violet-500/25">
                <PersonaIcon icon={s.persona?.icon ?? null} color={s.persona?.color ?? null} display="framed" frameSize="sm" />
                <span className="text-xs text-foreground">{s.persona?.name ?? s.personaId.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/50">Listeners</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {row.connections.length === 0 && (
            <span className="text-xs text-foreground/50 italic">No listeners connected.</span>
          )}
          {row.connections.map(conn => (
            <ConnectionChip key={conn.subscriptionId ?? conn.triggerId ?? `${conn.personaId}:${conn.useCaseId ?? 'all'}`}
                            conn={conn}
                            onDisconnect={onDisconnect} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-primary/5">
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-card text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add listener
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          disabled={isCommon}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-card text-xs text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title={isCommon ? 'Built-in events cannot be renamed' : 'Rename event'}
        >
          <Pencil className="w-3 h-3" /> Rename
        </button>
      </div>
    </div>
  );
}

function ConnectionChip({ conn, onDisconnect }: { conn: Connection; onDisconnect: (c: Connection) => void }) {
  let capTitle: string | undefined;
  if (conn.useCaseId && conn.persona) {
    const ucs = parseDesignContext(conn.persona.design_context).useCases ?? [];
    const uc = ucs.find(u => u.id === conn.useCaseId);
    capTitle = uc?.title ?? conn.useCaseId;
  }
  return (
    <div className="group/chip flex items-center gap-1.5 px-2 py-1 rounded-card bg-emerald-500/10 border border-emerald-500/25">
      <PersonaIcon icon={conn.persona?.icon ?? null} color={conn.persona?.color ?? null} display="framed" frameSize="sm" />
      <span className="text-xs text-foreground">{conn.persona?.name ?? conn.personaId.slice(0, 8)}</span>
      {conn.kind === 'chain' && (
        <span className="text-[9px] font-semibold uppercase text-violet-300 px-1 rounded bg-violet-500/10">
          chain:{conn.chainCondition ?? 'any'}
        </span>
      )}
      {capTitle && (
        <span className="text-[9px] font-semibold uppercase text-cyan-300 px-1 rounded bg-cyan-500/10" title={`Scoped to: ${capTitle}`}>
          {capTitle}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDisconnect(conn); }}
        className="p-0.5 rounded opacity-0 group-hover/chip:opacity-100 hover:bg-red-500/15 text-red-400/60 hover:text-red-400 transition-all"
        title="Disconnect"
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
}
