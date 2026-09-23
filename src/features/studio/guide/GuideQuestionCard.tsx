import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDecisionKeys } from '../useDecisionKeys';

// The question card (contest A/3): large, informative, grows out of the orb's
// corner and shrinks back when answered. It says what Athena is asking, why (her
// last beat), and every option on its own keyed row. When the question is about
// an element, the preview's ring points at it (StudioPreviewFrames).
export default function GuideQuestionCard({
  question,
  options,
  reason,
  step,
  lastTurnSecs,
  pointsAtElement,
  onAnswer,
  onHide,
}: {
  question: string;
  options: string[];
  reason: string | null;
  step: number;
  lastTurnSecs: number | null;
  pointsAtElement: boolean;
  onAnswer: (answer: string) => void;
  onHide: () => void;
}) {
  const { t, tx } = useTranslation();
  const g = t.studio.guide;
  const { shouldAnimate } = useMotion();
  useDecisionKeys(options, onAnswer);

  return (
    <motion.section
      role="group"
      aria-label={g.needs_you}
      initial={shouldAnimate ? { opacity: 0, scale: 0.6, x: -120, y: 80 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={shouldAnimate ? { opacity: 0, scale: 0.6, x: -120, y: 80 } : { opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      style={{ transformOrigin: 'bottom left' }}
      className="pointer-events-auto w-[min(34rem,92%)] overflow-hidden rounded-modal border border-status-warning/40 bg-gradient-to-b from-secondary to-background shadow-elevation-4"
    >
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span className="h-2 w-2 rounded-full bg-status-warning" />
        <span className="typo-body font-semibold text-status-warning">{g.needs_you}</span>
        {lastTurnSecs !== null && (
          <span className="typo-caption text-foreground/90">
            {tx(g.after_step, { step, minutes: Math.max(1, Math.round(lastTurnSecs / 60)) })}
          </span>
        )}
        <button
          type="button"
          onClick={onHide}
          className="ml-auto flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-caption text-foreground/90 hover:bg-secondary/60 hover:text-foreground"
        >
          <kbd className="rounded border border-border px-1.5 font-mono text-xs">Esc</kbd>
          {g.look_around}
        </button>
      </header>
      <div className="px-5 pb-5 pt-4">
        {reason && <p className="border-l-2 border-primary/50 pl-3 typo-body text-foreground/90">{reason}</p>}
        <h3 className="mt-3 typo-heading-lg text-foreground">{question}</h3>
        {pointsAtElement && <p className="mt-1 typo-caption text-primary">{g.points_at_element}</p>}
        {options.length > 0 ? (
          <ol className="mt-4 space-y-2">
            {options.map((o, i) => (
              <li key={`${i}-${o}`}>
                <button
                  type="button"
                  onClick={() => onAnswer(o)}
                  className="flex w-full items-center gap-3 rounded-card border border-border bg-background/50 px-4 py-3 text-left transition-colors hover:border-primary/70 hover:bg-primary/10 focus-visible:border-primary focus-visible:outline-none"
                >
                  <kbd className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border font-mono text-sm text-foreground/90">
                    {i + 1}
                  </kbd>
                  <span className="typo-body-lg font-medium text-foreground">{o}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="mt-3 typo-caption text-foreground/90">
          {options.length > 0 ? tx(g.answer_keys, { count: options.length }) : g.answer_free}
        </p>
      </div>
    </motion.section>
  );
}
