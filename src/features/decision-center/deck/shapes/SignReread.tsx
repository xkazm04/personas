/**
 * The head of a re-read Sign card's body: what the re-read suggests (or, when
 * it suggests nothing, why the mandate asks to be read again; the reason
 * itself is already the card's title).
 * The suggestion is the why made concrete, so the two never both take a line
 * of a card that must be decidable without scrolling. The marker a previous
 * keep left is the rail's Kept fact beside Acts, so the body does not repeat
 * it. Keep (`A`) leaves the envelope as signed; Edit (`E`) opens it with the
 * suggestion applied.
 */
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateReread } from '@/lib/bindings/MandateReread';
import { rereadSuggestion, rereadWhy } from '../../mandate/rereadItem';

export function SignReread({ info }: { info: MandateReread }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const suggestion = rereadSuggestion(info, m, tx);
  return (
    <section className="flex max-w-[68ch] flex-col gap-2" data-testid="sign-reread" data-code={info.code}>
      {!suggestion && <p className="typo-body-lg text-foreground [text-wrap:pretty]">{rereadWhy(info, m)}</p>}
      {suggestion && (
        <p className="flex items-start gap-2" data-testid="sign-reread-suggest">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
          <span className="typo-body text-foreground">{suggestion}</span>
        </p>
      )}
    </section>
  );
}
