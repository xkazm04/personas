/**
 * The keys, always on screen: a binding nobody can see is not a binding.
 *
 * But it is a footnote, not a toolbar. It used to be a banded strip of six
 * keycaps under its own border, competing with the hand for the eye at the
 * bottom of the table; it is now one quiet caption line, the caps set in the
 * mono face rather than raised chrome.
 */

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
    <p
      className="flex-shrink-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-6 pb-2 typo-caption"
      data-testid="xo-keys"
    >
      {items.map(([cap, label], i) => (
        <span key={cap} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="w-1 h-1 mr-1.5 rounded-pill bg-foreground/30" />}
          <kbd className="typo-code text-foreground">{cap}</kbd>
          {label}
        </span>
      ))}
    </p>
  );
}

export default KeyLegend;
