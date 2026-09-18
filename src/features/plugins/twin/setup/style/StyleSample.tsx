/**
 * A style replying to the fixed gallery prompt, framed as a tiny exchange so
 * every card answers the SAME question and the styles compare side by side.
 */

import { useTranslation } from '@/i18n/useTranslation';

export function StyleSample({ reply }: { reply: string }) {
  const { t } = useTranslation();
  const ts = t.twin.style.gallery;
  return (
    <figure className="rounded-input bg-secondary/30 px-3 py-2 space-y-1" aria-label={ts.sampleLabel}>
      <figcaption className="typo-caption">{ts.sampleQuestion}</figcaption>
      <p className="typo-body text-foreground whitespace-pre-line">{reply}</p>
    </figure>
  );
}

export default StyleSample;
