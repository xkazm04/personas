import { useStudioStore } from './studioStore';

// C6 — design adjustment knobs: quick dials that nudge the whole design via a
// templated build instruction (the Claude Design "knob" UX at the global level).
// Per-element knobs need the cross-origin preview-agent, deferred with A3.
const KNOBS: { label: string; opts: { label: string; prompt: string }[] }[] = [
  {
    label: 'Spacing',
    opts: [
      { label: 'Tighter', prompt: 'Tighten the spacing and density across the whole site a notch.' },
      { label: 'Airier', prompt: 'Open up the spacing and whitespace across the whole site a notch.' },
    ],
  },
  {
    label: 'Corners',
    opts: [
      { label: 'Sharper', prompt: 'Make the corner radii sharper and more squared across the UI.' },
      { label: 'Rounder', prompt: 'Make the corner radii rounder and softer across the UI.' },
    ],
  },
  {
    label: 'Type',
    opts: [
      { label: 'Smaller', prompt: 'Tighten the type scale down a notch across the site.' },
      { label: 'Bigger', prompt: 'Bump the type scale up a notch across the site for more presence.' },
    ],
  },
  {
    label: 'Vibe',
    opts: [
      { label: 'Calmer', prompt: 'Make the overall visual tone calmer and more restrained.' },
      { label: 'Bolder', prompt: 'Make the overall visual tone bolder and more expressive.' },
    ],
  },
];

export default function StudioDesignKnobs({ id, onApply }: { id: string; onApply?: () => void }) {
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const apply = (prompt: string) => {
    void sendTurn(id, prompt);
    onApply?.();
  };
  return (
    <div className="space-y-2">
      {KNOBS.map((k) => (
        <div key={k.label} className="flex items-center justify-between gap-2">
          <span className="typo-caption text-foreground/70">{k.label}</span>
          <div className="flex gap-1">
            {k.opts.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => apply(o.prompt)}
                className="rounded-interactive bg-secondary/40 px-2 py-0.5 text-xs text-foreground/60 transition-colors hover:bg-primary/20 hover:text-primary"
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
