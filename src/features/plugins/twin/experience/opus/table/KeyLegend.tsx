/** The keys, always on screen: a binding nobody can see is not a binding. */

import { useTranslation } from '@/i18n/useTranslation';

export function KeyLegend() {
  const { t } = useTranslation();
  const keys = t.twin.experience_opus.keys;
  const items: Array<[string, string]> = [
    ['1 2 3', keys.pick],
    ['← →', keys.move],
    ['↵', keys.play],
    ['E', keys.edit],
    ['S', keys.skip],
    ['Esc', keys.close],
  ];

  return (
    <div
      className="flex-shrink-0 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-6 py-2 border-t border-primary/10 bg-background/60"
      data-testid="xo-keys"
    >
      {items.map(([cap, label]) => (
        <span key={cap} className="inline-flex items-center gap-1.5 typo-caption">
          <kbd className="xo-key typo-label text-foreground">{cap}</kbd>
          {label}
        </span>
      ))}
    </div>
  );
}

export default KeyLegend;
