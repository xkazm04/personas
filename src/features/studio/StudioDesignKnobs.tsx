import { useTranslation } from '@/i18n/useTranslation';
import { useStudioStore } from './studioStore';

// C6 — design adjustment knobs: quick dials that nudge the whole design via a
// templated build instruction (the Claude Design "knob" UX at the global level).
// Per-element knobs need the cross-origin preview-agent, deferred with A3.
// Labels are i18n keys under `studio`; the prompts are instructions to the
// model and stay English.
type KnobKey =
  | 'knob_spacing' | 'knob_tighter' | 'knob_airier'
  | 'knob_corners' | 'knob_sharper' | 'knob_rounder'
  | 'knob_type' | 'knob_smaller' | 'knob_bigger'
  | 'knob_vibe' | 'knob_calmer' | 'knob_bolder';
const KNOBS: { label: KnobKey; opts: { label: KnobKey; prompt: string }[] }[] = [
  {
    label: 'knob_spacing',
    opts: [
      { label: 'knob_tighter', prompt: 'Tighten the spacing and density across the whole site a notch.' },
      { label: 'knob_airier', prompt: 'Open up the spacing and whitespace across the whole site a notch.' },
    ],
  },
  {
    label: 'knob_corners',
    opts: [
      { label: 'knob_sharper', prompt: 'Make the corner radii sharper and more squared across the UI.' },
      { label: 'knob_rounder', prompt: 'Make the corner radii rounder and softer across the UI.' },
    ],
  },
  {
    label: 'knob_type',
    opts: [
      { label: 'knob_smaller', prompt: 'Tighten the type scale down a notch across the site.' },
      { label: 'knob_bigger', prompt: 'Bump the type scale up a notch across the site for more presence.' },
    ],
  },
  {
    label: 'knob_vibe',
    opts: [
      { label: 'knob_calmer', prompt: 'Make the overall visual tone calmer and more restrained.' },
      { label: 'knob_bolder', prompt: 'Make the overall visual tone bolder and more expressive.' },
    ],
  },
];

export default function StudioDesignKnobs({ id, onApply }: { id: string; onApply?: () => void }) {
  const { t } = useTranslation();
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const apply = (prompt: string) => {
    void sendTurn(id, prompt);
    onApply?.();
  };
  return (
    <div className="space-y-2">
      {KNOBS.map((k) => (
        <div key={k.label} className="flex items-center justify-between gap-2">
          <span className="typo-caption">{t.studio[k.label]}</span>
          <div className="flex gap-1">
            {k.opts.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => apply(o.prompt)}
                className="rounded-interactive bg-secondary/40 px-2 py-0.5 typo-label text-foreground/90 transition-colors hover:bg-primary/20 hover:text-primary"
              >
                {t.studio[o.label]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
