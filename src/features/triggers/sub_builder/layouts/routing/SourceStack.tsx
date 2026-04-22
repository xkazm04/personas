/**
 * SourceStack — the left side of the row spine.
 *
 * Round-3 redesign: show the first one or two source personas as full name
 * chips (avatar + readable name) rather than bare avatars. The column width
 * was doubled to 320px min, which gives the chip room for ~18 characters
 * before truncation — enough for the common persona-naming conventions
 * in this app (e.g. "inbox-cleaner", "slack-router").
 *
 * External sources (webhooks, smee) still render as amber uppercase tags.
 */
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';
import type { EventRow } from '../routingHelpers';

const NAME_CHIP_MAX = 2; // show up to N name chips; the rest collapse to a +N pill.

interface NameChipProps {
  persona: Persona | undefined;
  personaIdFallback: string;
}

function NameChip({ persona, personaIdFallback }: NameChipProps) {
  return (
    <div
      className="flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-card bg-violet-500/10 border border-violet-500/25 max-w-[200px] min-w-0"
      title={persona?.name ?? personaIdFallback}
    >
      <PersonaIcon
        icon={persona?.icon ?? null}
        color={persona?.color ?? null}
        display="framed"
        frameSize="sm"
      />
      <span className="text-xs text-foreground truncate">
        {persona?.name ?? personaIdFallback.slice(0, 8)}
      </span>
    </div>
  );
}

export function SourceStack({ row }: { row: EventRow }) {
  // External-only: amber tag stack
  if (row.sourcePersonas.length === 0 && row.externalSourceLabels.length > 0) {
    const shown = row.externalSourceLabels.slice(0, 2);
    const overflow = row.externalSourceLabels.length - shown.length;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map(lbl => (
          <span
            key={lbl}
            className="inline-flex items-center px-1.5 py-0.5 rounded-card bg-amber-500/10 border border-amber-500/30 text-[10px] font-semibold uppercase tracking-wider text-amber-400 max-w-[140px] truncate"
            title={lbl}
          >
            {lbl}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-xs text-foreground/50 tabular-nums">+{overflow}</span>
        )}
      </div>
    );
  }

  if (row.sourcePersonas.length === 0) {
    return <span className="text-xs text-foreground/40 italic">no source</span>;
  }

  const shown = row.sourcePersonas.slice(0, NAME_CHIP_MAX);
  const overflow = row.sourcePersonas.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      {shown.map(s => (
        <NameChip key={s.personaId} persona={s.persona} personaIdFallback={s.personaId} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-card bg-card border border-primary/20 text-[10px] font-semibold text-foreground/70 tabular-nums">
          +{overflow}
        </span>
      )}
    </div>
  );
}
