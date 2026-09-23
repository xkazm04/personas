import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isFreeKey } from '../useDecisionKeys';
import type { GuideCard } from './guideModel';

// Athena's next moves after a finished step: 2-3 cards, each a real turn. Enter
// takes the first, 1-3 pick, X passes on the first. Keys are ignored while the
// user is typing or a popover is open (same guards as the question card).
export default function GuideDeck({
  cards,
  estimate,
  onAccept,
  onDecline,
}: {
  cards: GuideCard[];
  estimate: string;
  onAccept: (card: GuideCard) => void;
  onDecline: (card: GuideCard) => void;
}) {
  const { t, tx } = useTranslation();
  const g = t.studio.guide;
  const { shouldAnimate } = useMotion();

  useAppKeyboard(
    (e) => {
      if (!isFreeKey(e)) return false;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= cards.length) onAccept(cards[n - 1]!);
      else if (e.key === 'Enter' && (document.activeElement as HTMLElement | null)?.tagName !== 'BUTTON') onAccept(cards[0]!);
      else if (e.key === 'x' || e.key === 'X') onDecline(cards[0]!);
      else return false;
      e.preventDefault();
      return true;
    },
    { enabled: cards.length > 0, priority: ROUTE_DECISION_PRIORITY },
  );

  const title = (c: GuideCard) =>
    ({
      continue: c.goal ? tx(g.card_continue, { goal: c.goal }) : g.card_plan,
      refine: tx(g.card_refine, { goal: c.goal ?? '' }),
      devices: g.card_devices,
      tour: g.card_tour,
      research: tx(g.card_research, { goal: c.goal ?? '' }),
      polish: g.card_polish,
    })[c.kind];
  const why = (c: GuideCard) =>
    ({
      continue: c.goal ? g.why_continue : g.why_plan,
      refine: g.why_refine,
      devices: g.why_devices,
      tour: g.why_tour,
      research: g.why_research,
      polish: g.why_polish,
    })[c.kind];

  return (
    <div className="pointer-events-auto flex w-full flex-col items-center gap-2">
      <p className="rounded-full border border-border bg-background/80 px-3 py-1 typo-caption text-foreground/90 backdrop-blur">
        <span className="font-medium text-primary">{g.suggests}</span> {g.suggests_keys}
      </p>
      <div className="flex w-full justify-center gap-3">
        {cards.map((c, i) => (
          <motion.article
            key={c.key}
            initial={shouldAnimate ? { opacity: 0, y: 24 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.07 * i }}
            className="flex w-72 flex-col rounded-card border border-primary/25 bg-gradient-to-b from-secondary/95 to-background/95 p-4 shadow-elevation-3 backdrop-blur"
          >
            {c.goal && <p className="typo-caption text-foreground/90">{tx(g.serves, { goal: c.goal })}</p>}
            <h3 className="mt-1 typo-body-lg font-semibold text-foreground">{title(c)}</h3>
            <p className="mt-1 line-clamp-2 typo-body text-foreground/90">{why(c)}</p>
            <p className="mt-2 typo-caption text-foreground/90">{estimate}</p>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => onAccept(c)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 typo-body font-medium transition-colors ${
                  i === 0 ? 'bg-primary text-background hover:bg-primary/90' : 'border border-border text-foreground hover:border-primary/60'
                }`}
              >
                {i === 0 ? g.do_it : g.yes}
                <kbd className="rounded border border-current/40 px-1 font-mono text-xs">{i + 1}</kbd>
              </button>
              <button type="button" onClick={() => onDecline(c)} className="typo-body text-foreground/90 hover:text-foreground">
                {g.not_now}
              </button>
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
