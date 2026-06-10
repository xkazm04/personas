/**
 * Rail card for one available system operation (Chain Studio right rail,
 * "System events" tab). Mirrors {@link TriggerOptionCard} / persona cards but
 * represents a built-in op target rather than a persona.
 */
import { Cog } from 'lucide-react';
import type { SystemOpKindMeta } from '@/api/systemOps';

export function SystemOpOptionCard({
  kind, active, onPick,
}: {
  kind: SystemOpKindMeta;
  active?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left rounded-card border transition-all flex items-center gap-3 px-2.5 py-2 ${
        active
          ? 'bg-primary/10 border-primary/40 shadow-elevation-1'
          : 'bg-background/80 border-border hover:bg-foreground/[0.04] hover:border-foreground/20'
      }`}
    >
      <div className="rounded-input flex items-center justify-center shrink-0 bg-secondary/60 w-8 h-8 text-violet-400">
        <Cog className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground truncate">{kind.label}</div>
        <div className="typo-body opacity-80 text-foreground truncate">{kind.description}</div>
      </div>
    </button>
  );
}
