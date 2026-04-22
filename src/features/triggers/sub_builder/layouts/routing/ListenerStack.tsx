/**
 * ListenerStack — the right side of the row spine.
 *
 * Kept as a compact avatar stack (not named chips) so the collapsed row
 * stays scannable at N listeners. Full names live in the expanded drawer.
 */
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { EventRow } from '../routingHelpers';

const AVATAR_LIMIT = 4;

export function ListenerStack({ row }: { row: EventRow }) {
  if (row.connections.length === 0) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-card text-[10px] font-semibold uppercase tracking-wider bg-secondary/40 text-foreground/50 border border-primary/10">
        none
      </span>
    );
  }

  const shown = row.connections.slice(0, AVATAR_LIMIT);
  const overflow = row.connections.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center -space-x-1.5">
        {shown.map(c => (
          <div
            key={c.subscriptionId ?? c.triggerId ?? c.personaId}
            className="ring-2 ring-background rounded-full"
            title={c.persona?.name ?? c.personaId}
          >
            <PersonaIcon
              icon={c.persona?.icon ?? null}
              color={c.persona?.color ?? null}
              display="framed"
              frameSize="sm"
            />
          </div>
        ))}
        {overflow > 0 && (
          <span className="ring-2 ring-background inline-flex w-5 h-5 rounded-full bg-card items-center justify-center text-[9px] font-semibold text-foreground/70 tabular-nums">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-xs text-foreground/60 tabular-nums">{row.connections.length}</span>
    </div>
  );
}
