// THROWAWAY — /prototype A/B tab strip for the MID band's island body.
//
// Deleted at consolidation with the losing variant. An SVG canvas has nowhere
// sensible to put a tab strip inside an island, so the switcher rides the
// canvas chrome instead, in the same `.mm-chrome` surface as the toolbar and
// zoom cluster. It only renders while the camera is actually AT the mid band —
// a switcher for a layer you cannot see is just clutter, and this way selecting
// a variant always changes something visible.
import { MID_VARIANTS, setMidVariant, useMidVariant } from './midVariantStore';

export function MidVariantSwitcher({ atMid }: { atMid: boolean }) {
  const active = useMidVariant();
  if (!atMid) return null;
  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 p-1 rounded-interactive mm-chrome surface-blur-tooltip"
      role="group"
      aria-label="Mid-zoom island body — prototype variants"
      data-testid="mm-mid-variant-switcher"
    >
      <span className="px-2 typo-caption text-foreground/50 select-none">MID</span>
      {MID_VARIANTS.map((v) => {
        const on = active === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => setMidVariant(v.id)}
            aria-pressed={on}
            title={v.hint}
            data-testid={`mm-mid-variant-${v.id}`}
            className={`px-2.5 py-1.5 rounded-interactive typo-caption font-medium transition-colors focus-ring ${
              on ? 'bg-primary/20 text-foreground' : 'text-foreground/65 hover:bg-primary/10 hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
