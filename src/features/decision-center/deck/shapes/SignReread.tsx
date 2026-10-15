/**
 * The head of a re-read Sign card's body: why the mandate asks to be read
 * again (the reason is already the card's title), what the re-read suggests,
 * and the marker a previous keep left. Keep (`A`) leaves the envelope as
 * signed; Edit (`E`) opens it with the suggestion applied.
 */
import { RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateReread } from '@/lib/bindings/MandateReread';
import { rereadSuggestion, rereadWhy } from '../../mandate/rereadItem';

export function SignReread({ info }: { info: MandateReread }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const suggestion = rereadSuggestion(info, m, tx);
  return (
    <section className="flex max-w-[68ch] flex-col gap-2" data-testid="sign-reread" data-code={info.code}>
      <p className="typo-body-lg text-foreground [text-wrap:pretty]">{rereadWhy(info, m)}</p>
      {suggestion && (
        <p className="flex items-start gap-2" data-testid="sign-reread-suggest">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
          <span className="typo-body text-foreground">{suggestion}</span>
        </p>
      )}
      {info.keptAtActs !== null && (
        <p className="flex items-start gap-2">
          <RotateCcw className="mt-0.5 h-4 w-4 flex-shrink-0 au-quiet" aria-hidden />
          <span className="typo-caption">{tx(m.ml_reread_kept_line, { count: info.keptAtActs, acts: info.acts })}</span>
        </p>
      )}
    </section>
  );
}
