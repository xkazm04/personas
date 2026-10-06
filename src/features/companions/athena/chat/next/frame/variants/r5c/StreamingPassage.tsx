/**
 * Folio · her reply while she writes it. Words appear the way ink does: each
 * new word settles in from a soft blur, once, and a pen nib rests after the
 * last one, lifting gently while she is still writing. Her current step is a
 * gloss in the margin beside the passage. Machine directives never show: the
 * text is stripped as it arrives and a half-typed directive line is held back
 * (`writtenSoFar`). The finished reply replaces the passage in the same place.
 */

import { Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from '../../../../../athenaStore';
import { FOLIO_COPY as C } from './copy';
import { writtenSoFar } from './marks';

function paragraphs(text: string): string[][] {
  return text
    .replace(/\*\*|__|`/g, '')
    .split(/\n{2,}/)
    .map((p) => p.split(/\s+/).filter(Boolean))
    .filter((p) => p.length > 0);
}

export function StreamingPassage({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const streaming = useAthenaStore((s) => s.streaming);
  const text = useAthenaStore((s) => s.streamingText);
  const beat = useAthenaStore((s) => s.streamingBeat);
  if (!streaming) return null;
  const paras = paragraphs(writtenSoFar(text));
  const ink = shouldAnimate ? ' r5c-ink-in' : '';

  return (
    <section className="r5c-turn r5c-streaming" aria-busy data-testid="companion-r5c-streaming">
      <div className="r5c-speech her">
        <div className="r5c-speaker">
          <span className="r5c-sc typo-label text-primary">{C.her}</span>
          <span className="r5c-sc typo-label r5c-when">{C.writing}</span>
          {beat && <span className="typo-caption italic r5c-beat">{beat}</span>}
          <Button
            variant="ghost"
            size="xs"
            onClick={onStop}
            aria-label={t.athena.stop_turn}
            data-testid="companion-stop-turn"
            icon={<Square className="w-2.5 h-2.5" fill="currentColor" aria-hidden />}
          >
            <span className="typo-caption">{C.stop}</span>
          </Button>
        </div>
        <div className="r5c-words typo-body-lg text-foreground r5c-prose r5c-writing">
          {paras.length === 0 ? (
            <p>
              <Nib animate={shouldAnimate} />
            </p>
          ) : (
            paras.map((words, pi) => (
              <p key={pi}>
                {words.map((w, wi) => (
                  <span key={wi} className={`r5c-word${ink}`}>
                    {w}{' '}
                  </span>
                ))}
                {pi === paras.length - 1 && <Nib animate={shouldAnimate} />}
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/** The pen's nib, resting after her last word. */
function Nib({ animate }: { animate: boolean }) {
  return (
    <svg className={`r5c-nib${animate ? ' r5c-loop' : ''}`} width="12" height="18" viewBox="0 0 12 18" aria-hidden>
      <path d="M2 16 L9 3 L11 4.2 L4 17 Z" />
      <path className="slit" d="M5.4 12.6 L8.6 6.4" />
    </svg>
  );
}
