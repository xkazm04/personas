import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guideCopy';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { BLUEPRINT_GRID } from './blueprintGrid';
import type { BuildPhase } from '../studioBuildModel';
import type { StudioMessage, StudioPhase } from '../studioStore';

// Idea through planning is a drawing (contest A/3, made non-technical): the plan
// is drafted onto grid paper goal by goal, with Athena's notes pinned beside it,
// before a single file is built. Real data only: the frames are the BUILD_PLAN
// phases and their notes, the pinned notes are her latest reply beats.
export default function GuideBlueprint({
  name,
  phase,
  phases,
  messages,
}: {
  name: string;
  phase: StudioPhase;
  phases: BuildPhase[];
  messages: StudioMessage[];
}) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const { shouldAnimate } = useMotion();
  const notes = messages.slice(-3);
  // Only a project with a plan reaches the blueprint (a project without one
  // draws the setup sheet instead); it replays the plan while the preview boots.
  const booting = phase !== 'live';

  const draw = (i: number) =>
    shouldAnimate
      ? {
          initial: { clipPath: 'inset(0 100% 0 0)', opacity: 0.4 },
          animate: { clipPath: 'inset(0 0% 0 0)', opacity: 1 },
          transition: { duration: 0.55, delay: 0.12 * i, ease: [0.22, 1, 0.36, 1] as const },
        }
      : {};

  return (
    <div className="absolute inset-0 overflow-hidden bg-background" style={BLUEPRINT_GRID}>
      <div className="flex h-full gap-6 p-6">
        <section className="flex min-w-0 flex-1 flex-col">
          <p className="typo-label uppercase tracking-wider text-primary/80">{tx(g.sheet_title, { name })}</p>
          {booting && <p className="mt-2 typo-body text-foreground/90">{g.preview_booting_plan}</p>}
          <ol className="mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-4 overflow-y-auto pr-1">
            {phases.map((p, i) => {
              const status = p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : 'pending';
              return (
                <motion.li
                  key={p.id}
                  {...draw(i)}
                  className={`relative rounded-card border p-4 ${
                    status === 'done'
                      ? 'border-status-success/60 bg-status-success/5'
                      : status === 'active'
                        ? 'border-primary bg-primary/10 shadow-elevation-2'
                        : 'border-dashed border-primary/40 bg-background/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/50 font-mono text-xs text-primary">
                      {status === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <p className="typo-title text-foreground">{p.title}</p>
                  </div>
                  <p className="mt-2 typo-body text-foreground/90">
                    {p.note || (status === 'active' ? g.goal_now : g.frame_pending)}
                  </p>
                </motion.li>
              );
            })}
          </ol>
        </section>
        {notes.length > 0 && (
          <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden pt-7" aria-label={g.notes_label}>
            {notes.map((m, i) => (
              <motion.div
                key={m.id}
                initial={shouldAnimate ? { opacity: 0, y: -8, rotate: -1.5 } : false}
                animate={{ opacity: 1, y: 0, rotate: i % 2 ? 0.8 : -0.6 }}
                transition={{ duration: 0.35, delay: 0.1 * i }}
                className="rounded-card border border-status-warning/30 bg-gradient-to-br from-secondary/90 to-secondary/60 p-3 shadow-elevation-2"
              >
                <p className="typo-label uppercase tracking-wider text-status-warning/90">
                  {i === 0 && notes.length > 1 ? g.note_found : g.note_athena}
                </p>
                <p className="mt-1 line-clamp-5 typo-body text-foreground">{m.text}</p>
              </motion.div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
