import { useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { useStudioStore } from './studioStore';
import type { BuildEffort, BuildStyle } from '@/api/webbuild';

// C1 effort knob + C4 voice/style picker — per-project build controls in a small
// popover off the chat input. Writes to the active runtime so every turn (manual,
// seed, or autonomous) picks them up. Effort trades speed for quality; voice sets
// how much Athena explains as she works.
const EFFORTS: { value: BuildEffort; label: string }[] = [
  { value: 'low', label: 'Fast' },
  { value: 'medium', label: 'Balanced' },
  { value: 'high', label: 'Deep' },
  { value: 'xhigh', label: 'Max' },
];
const STYLES: { value: BuildStyle; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'teaching', label: 'Teaching' },
];

export default function StudioBuildSettings({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const effort = useStudioStore((s) => s.runtimes[id]?.effort ?? 'xhigh');
  const style = useStudioStore((s) => s.runtimes[id]?.style ?? 'balanced');
  const setBuildSettings = useStudioStore((s) => s.setBuildSettings);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Build settings"
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          open
            ? 'bg-secondary/60 text-primary'
            : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
        }`}
      >
        <Settings2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-11 right-0 z-30 w-60 rounded-modal border border-border bg-background/95 p-3 shadow-elevation-4 backdrop-blur">
          <Row label="Effort" hint="speed ↔ quality">
            {EFFORTS.map((o) => (
              <Seg
                key={o.value}
                active={effort === o.value}
                onClick={() => setBuildSettings(id, { effort: o.value })}
              >
                {o.label}
              </Seg>
            ))}
          </Row>
          <Row label="Voice" hint="how much Athena explains">
            {STYLES.map((o) => (
              <Seg
                key={o.value}
                active={style === o.value}
                onClick={() => setBuildSettings(id, { style: o.value })}
              >
                {o.label}
              </Seg>
            ))}
          </Row>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="typo-caption text-foreground/70">{label}</span>
        <span className="text-[10px] text-foreground/40">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-interactive px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-primary/20 text-primary' : 'bg-secondary/40 text-foreground/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
