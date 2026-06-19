import { Check, Circle } from 'lucide-react';
import type { BuildPhase } from './studioBuildModel';

// Cards: each phase is a compact info card with a status badge + golden-output
// note. Denser; surfaces what each phase is actually for.
export default function StudioChecklistCards({ phases }: { phases: BuildPhase[] }) {
  return (
    <div className="space-y-2">
      {phases.map((p) => (
        <div
          key={p.id}
          className={`rounded-card border px-3 py-2 ${
            p.status === 'active'
              ? 'border-primary/40 bg-primary/5'
              : p.status === 'done'
                ? 'border-border bg-secondary/30'
                : 'border-border/60'
          }`}
        >
          <div className="flex items-center gap-2">
            {p.status === 'done' ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <Circle
                className={`h-3.5 w-3.5 shrink-0 ${p.status === 'active' ? 'fill-primary/30 text-primary' : 'text-border'}`}
              />
            )}
            <span
              className={`flex-1 text-md ${p.status === 'pending' ? 'text-foreground/50' : 'text-foreground'}`}
            >
              {p.title}
            </span>
            <span className="text-xs uppercase tracking-wide text-foreground/45">{p.status}</span>
          </div>
          {p.note && <div className="typo-caption mt-1 pl-6">{p.note}</div>}
        </div>
      ))}
    </div>
  );
}
