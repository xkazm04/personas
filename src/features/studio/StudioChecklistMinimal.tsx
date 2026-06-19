import { Check, Circle } from 'lucide-react';
import type { BuildPhase } from './studioBuildModel';

// Minimal: a clean tick list — status icon + title only. Ambient, lowest-noise.
export default function StudioChecklistMinimal({ phases }: { phases: BuildPhase[] }) {
  return (
    <ul className="space-y-2">
      {phases.map((p) => (
        <li key={p.id} className="flex items-center gap-2.5">
          {p.status === 'done' ? (
            <Check className="h-4 w-4 shrink-0 text-primary" />
          ) : p.status === 'active' ? (
            <Circle className="h-4 w-4 shrink-0 fill-primary/30 text-primary" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-border" />
          )}
          <span
            className={`text-md ${
              p.status === 'pending'
                ? 'text-foreground/50'
                : p.status === 'active'
                  ? 'font-medium text-foreground'
                  : 'text-foreground/90'
            }`}
          >
            {p.title}
          </span>
        </li>
      ))}
    </ul>
  );
}
