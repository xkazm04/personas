// The level explainer shown at the top of a multi-level row's cell popover:
// the full scale as a stepped bar with each rung labelled, the current rung
// highlighted, and a one-line note on how to climb. Turns an opaque score into
// "here's what this level means and what the next one takes".
import { ordinalTint, type AppPassport } from '../passportModel';
import { ladderFor } from './levels';

export function LevelLadder({ rowKey, passport }: { rowKey: string; passport: AppPassport }) {
  const ladder = ladderFor(rowKey, passport);
  if (!ladder) return null;
  const { title, steps, currentIndex, note } = ladder;
  const pos = steps.length > 1 ? currentIndex / (steps.length - 1) : 0;
  const tint = ordinalTint(pos);

  return (
    <div className="rounded-interactive border border-primary/10 bg-secondary/15 p-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="typo-caption font-medium text-foreground">{title} — current level</span>
        <span className={`typo-caption font-semibold ${tint.text}`}>{steps[currentIndex]}</span>
      </div>
      <div className="flex items-stretch gap-0.5" aria-hidden>
        {steps.map((label, i) => (
          <div key={label} className="flex-1 min-w-0">
            <div
              className="h-1.5 rounded-full"
              style={{ background: i <= currentIndex ? tint.hex : 'color-mix(in srgb, var(--foreground) 12%, transparent)' }}
            />
            <span
              className={`block mt-1 typo-label leading-tight truncate text-center ${i === currentIndex ? `${tint.text} font-semibold` : 'text-foreground/40'}`}
              title={label}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="typo-caption text-foreground/55 mt-1.5 leading-snug" style={{ fontWeight: 400 }}>{note}</p>
    </div>
  );
}
