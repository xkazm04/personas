import { Check } from 'lucide-react';
import type { BuildPhase } from './studioBuildModel';

// Stepper: a vertical timeline — each phase is a node on a connecting line that
// fills as phases complete. Journey / progress metaphor.
export default function StudioChecklistStepper({ phases }: { phases: BuildPhase[] }) {
  return (
    <ol>
      {phases.map((p, i) => (
        <li key={p.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < phases.length - 1 && (
            <span
              className={`absolute left-[7px] top-4 h-full w-px ${p.status === 'done' ? 'bg-primary/50' : 'bg-border'}`}
            />
          )}
          <span
            className={`relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
              p.status === 'done'
                ? 'border-primary bg-primary text-background'
                : p.status === 'active'
                  ? 'border-primary bg-primary/20'
                  : 'border-border bg-background'
            }`}
          >
            {p.status === 'done' && <Check className="h-2.5 w-2.5" />}
            {p.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={`text-md ${p.status === 'pending' ? 'text-foreground/50' : 'text-foreground'} ${p.status === 'active' ? 'font-medium' : ''}`}
            >
              {p.title}
            </div>
            {p.note && <div className="typo-caption">{p.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
