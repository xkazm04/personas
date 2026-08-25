import { useState } from 'react';
import { useQuickDispatchController } from './quickDispatchController';
import { QuickDispatchBaseline } from './QuickDispatchBaseline';
import { QuickDispatchConsole } from './QuickDispatchConsole';
import { QuickDispatchFlightDeck } from './QuickDispatchFlightDeck';

/**
 * Quick Dispatch overlay — PROTOTYPING SCAFFOLD (throwaway, /prototype skill).
 *
 * The controller (all behavior) is instantiated once here and handed to the
 * active variant, so switching tabs keeps the composer state and each variant
 * is pure presentation. The tab strip is the disposable A/B switcher — it
 * never ships, which is why its labels are hardcoded and it is exempt from
 * the shared-catalog rule. Consolidation (Phase 5) deletes this strip, the
 * loser files and this comment.
 *
 * Baseline stays the default so nothing changes on load.
 */

type VariantId = 'baseline' | 'console' | 'flightdeck';

const VARIANTS: Array<{ id: VariantId; label: string; sub: string }> = [
  { id: 'baseline', label: 'Baseline', sub: 'shipped layout (control — has the shake)' },
  { id: 'console', label: 'Console', sub: 'bottom deck · panels grow up, out of flow' },
  { id: 'flightdeck', label: 'Flight Deck', sub: 'fixed frame · context rail swaps in place' },
];

export default function QuickDispatchOverlay() {
  const c = useQuickDispatchController();
  const [variant, setVariant] = useState<VariantId>('baseline');

  if (!c.open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      data-testid="quick-dispatch-overlay"
    >
      <div
        className="animate-fade-slide-in absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={c.closeQuickDispatch}
        aria-label={c.quickT.close}
      />

      {/* Throwaway variant switcher — top-center, above every variant. */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full border border-foreground/10 bg-secondary/70 p-1 shadow-elevation-2">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            title={v.sub}
            className={`px-2.5 py-1 rounded-full typo-caption transition-colors ${
              variant === v.id
                ? 'bg-primary/15 text-primary'
                : 'text-foreground/70 hover:bg-secondary/60 hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {variant === 'baseline' && <QuickDispatchBaseline c={c} />}
      {variant === 'console' && <QuickDispatchConsole c={c} />}
      {variant === 'flightdeck' && <QuickDispatchFlightDeck c={c} />}
    </div>
  );
}
