import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { BuildPhase } from './studioBuildModel';

// Stepper: a vertical timeline — each phase is a node on a connecting line that
// fills as phases complete. Journey / progress metaphor. `stagger` cascades the
// rows in on mount (used by the goals rail, which appears all at once). `draft`
// draws every node dashed: goals sketched ahead of the real plan. `focusable`
// puts the phase in progress in the tab order, so the keyboard can reach it.
export default function StudioChecklistStepper({
  phases,
  stagger = false,
  draft = false,
  focusable = false,
  caption,
}: {
  phases: BuildPhase[];
  stagger?: boolean;
  draft?: boolean;
  focusable?: boolean;
  /** The line under a title; the phase's own note when not given. */
  caption?: (p: BuildPhase) => ReactNode;
}) {
  const { shouldAnimate } = useMotion();
  const cascade = stagger && shouldAnimate;

  return (
    <ol>
      {phases.map((p, i) => {
        const line = caption ? caption(p) : p.note;
        return (
          <motion.li
            key={p.id}
            data-status={p.status}
            data-active={p.status === 'active'}
            tabIndex={focusable && p.status === 'active' ? 0 : undefined}
            className="relative flex gap-3 rounded-interactive pb-4 outline-none last:pb-0 focus-visible:ring-2 focus-visible:ring-primary"
            initial={cascade ? { opacity: 0, x: 10 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.045, 0.4), duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {i < phases.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-[7px] top-4 h-full w-px ${p.status === 'done' ? 'bg-primary/50' : 'bg-border'}`}
              />
            )}
            <span
              className={`relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                draft
                  ? 'border-dashed border-primary/60 bg-background'
                  : p.status === 'done'
                    ? 'border-primary bg-primary text-background'
                    : p.status === 'active'
                      ? 'border-primary bg-primary/20'
                      : 'border-border bg-background'
              }`}
            >
              {p.status === 'done' && <Check className="h-2.5 w-2.5" />}
              {p.status === 'active' && (
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  animate={shouldAnimate ? { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] } : undefined}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={`typo-body ${p.status === 'pending' && !draft ? 'text-foreground/50' : 'text-foreground'} ${p.status === 'active' ? 'font-medium' : ''}`}
              >
                {p.title}
              </div>
              {line && <div className={`typo-caption ${p.status === 'active' ? 'text-primary' : ''}`}>{line}</div>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
