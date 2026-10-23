import { Check, ExternalLink, SkipForward, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Branch, Later, Verdict } from '@/features/decision-center/deck/DeckDock';
import { ReasonPrompt } from '@/features/decision-center/deck/ReasonPrompt';
import { askCopy } from './askCopy';
import type { NeedsYou } from './useNeedsYou';

/**
 * The fixed verdict dock at the rail's foot: the deck's own parts, imported,
 * never copied. The verdict pair with its key inside each button (A / R), the
 * ask's branches as full-width rows with digits (a suggested action, a
 * question's options, Open in builder), and Later (S). A reject or an answer
 * swaps the dock for the deck's `ReasonPrompt` ("Why?", optional; Enter with
 * nothing typed sends no reason). No raw coloured buttons.
 */
export function AskDock({ ny }: { ny: NeedsYou }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const ask = ny.ask;
  if (!ask) return null;
  if (ny.prompt) {
    return <ReasonPrompt prompt={ny.prompt} min={0} onSubmit={ny.submitPrompt} onCancel={ny.cancelPrompt} />;
  }
  const copy = askCopy(m, ask);
  const complex = ask.kind === 'question' && ask.complex;
  const icon = (I: typeof Check) => <I className="h-4 w-4" strokeWidth={2.5} aria-hidden />;
  return (
    <div className="flex flex-col gap-2" data-testid="ask-dock">
      {!complex && (
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <Verdict k="A" label={copy.accept} yes tone="success" icon={icon(Check)} pair disabled={ny.busy} onClick={ny.accept} />
          <Verdict
            k="R"
            label={copy.reject}
            yes={false}
            tone={ask.kind === 'review' ? 'danger' : 'accent'}
            icon={ask.kind === 'review' ? icon(X) : icon(SkipForward)}
            pair
            disabled={ny.busy}
            onClick={ny.reject}
          />
        </div>
      )}
      {ny.branches.map((label, i) => (
        <Branch
          key={label}
          k={String(i + 1)}
          label={label}
          accent={ask.kind === 'review' || complex}
          icon={complex ? <ExternalLink className="h-4 w-4" aria-hidden /> : undefined}
          hint={ask.kind === 'review' ? m.quick_carry_out_hint : complex ? m.quick_open_builder_hint : undefined}
          onClick={() => ny.branch(i + 1)}
        />
      ))}
      <Later label={m.triage_defer} onSkip={ny.skip} />
    </div>
  );
}
