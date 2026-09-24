import { motion } from 'framer-motion';
import { Check, Circle, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { SiteSketch } from '@/lib/bindings/SiteSketch';
import type { SetupStepKey, SetupStepState } from './guideModel';
import { guideStrings } from './guideCopy';
import { clock, useElapsed } from './useGuideRuntime';

const GRID: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(color-mix(in srgb, var(--primary) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--primary) 9%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--primary) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--primary) 4%, transparent) 1px, transparent 1px)',
  backgroundSize: '96px 96px, 96px 96px, 24px 24px, 24px 24px',
};

// The plan sheet during setup (contest A/3's idea-to-plan drawing, on real
// data): the sketch lane's pages drawn as page outlines, each region drawn in
// turn with its purpose, while the project is created and the preview boots.
// Before the sketch lands the outlines are empty (a real wait, seconds); the
// setup timeline under them says what is actually running and for how long.
export default function GuideSketchSheet({
  name,
  sketch,
  sketchState,
  steps,
  startedAt,
}: {
  name: string;
  sketch: SiteSketch | null;
  sketchState: 'loading' | 'ready' | 'failed' | null;
  steps: { key: SetupStepKey; state: SetupStepState }[];
  startedAt: number | null;
}) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const { shouldAnimate } = useMotion();
  const elapsed = useElapsed(steps.some((s) => s.state === 'running') ? startedAt : null);
  const pages = sketch?.pages ?? [];
  const [home, ...rest] = pages;

  const draw = (i: number) =>
    shouldAnimate
      ? {
          initial: { clipPath: 'inset(0 100% 0 0)', opacity: 0.3 },
          animate: { clipPath: 'inset(0 0% 0 0)', opacity: 1 },
          transition: { duration: 0.5, delay: 0.18 * i, ease: [0.22, 1, 0.36, 1] as const },
        }
      : {};
  const stepLabel: Record<SetupStepKey, string> = {
    sketch: g.setup_step_sketch,
    create: g.setup_step_create,
    preview: g.setup_step_preview,
    plan: g.setup_step_plan,
  };
  let order = 0;

  return (
    <div className="absolute inset-0 overflow-hidden bg-background" style={GRID}>
      <div className="flex h-full gap-6 p-6">
        <section className="flex min-w-0 flex-1 flex-col">
          <p className="typo-label uppercase tracking-wider text-primary/80">{tx(g.sheet_title, { name })}</p>
          {home ? (
            <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
              <PageOutline title={home.title}>
                {home.regions.map((r) => (
                  <motion.div key={r.title} {...draw(order++)} className="rounded-interactive border border-primary/45 bg-primary/5 px-3 py-2">
                    <p className="typo-title text-primary">{r.title}</p>
                    {r.purpose && <p className="typo-caption text-foreground/90">{r.purpose}</p>}
                  </motion.div>
                ))}
              </PageOutline>
              <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
                {rest.map((p) => (
                  <PageOutline key={p.title} title={p.title} route={p.route}>
                    {p.regions.map((r) => (
                      <motion.div key={r.title} {...draw(order++)} className="rounded-interactive border border-primary/35 px-3 py-1.5">
                        <p className="typo-title text-primary">{r.title}</p>
                      </motion.div>
                    ))}
                  </PageOutline>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6" aria-hidden>
              <div className="rounded-card border border-dashed border-primary/35" />
              <div className="flex flex-col gap-4">
                <div className="h-1/3 rounded-card border border-dashed border-primary/25" />
                <div className="h-1/4 rounded-card border border-dashed border-primary/20" />
              </div>
            </div>
          )}
          <ol className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label={g.setup_label}>
            {steps.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 typo-caption text-foreground/90">
                {s.state === 'done' ? (
                  <Check className="h-3.5 w-3.5 text-status-success" />
                ) : s.state === 'failed' ? (
                  <X className="h-3.5 w-3.5 text-status-error" />
                ) : (
                  <Circle className={`h-3 w-3 ${s.state === 'running' ? 'fill-primary text-primary' : 'text-border'}`} />
                )}
                <span className={s.state === 'running' ? 'text-foreground' : undefined}>{stepLabel[s.key]}</span>
              </li>
            ))}
            {startedAt !== null && elapsed > 0 && (
              <li className="ml-auto font-mono typo-caption text-foreground/90">{tx(g.setup_elapsed, { elapsed: clock(elapsed) })}</li>
            )}
          </ol>
        </section>
        <aside className="flex w-72 shrink-0 flex-col gap-3 pt-7" aria-label={g.notes_label}>
          <motion.div
            initial={shouldAnimate ? { opacity: 0, y: -8, rotate: -1.2 } : false}
            animate={{ opacity: 1, y: 0, rotate: -0.6 }}
            className="rounded-card border border-status-warning/30 bg-gradient-to-br from-secondary/90 to-secondary/60 p-3 shadow-elevation-2"
          >
            <p className="typo-label uppercase tracking-wider text-status-warning/90">{g.sketch_understood}</p>
            <p className="mt-1 typo-body text-foreground">
              {sketch?.summary || (sketchState === 'failed' ? g.sketch_failed : g.sketch_loading)}
            </p>
          </motion.div>
          {sketch && <p className="typo-caption text-foreground/90">{g.sketch_draft}</p>}
        </aside>
      </div>
    </div>
  );
}

function PageOutline({ title, route, children }: { title: string; route?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded-card border border-primary/40 bg-background/40 p-3">
      <p className="mb-2 flex items-baseline gap-2">
        <span className="typo-title text-foreground">{title}</span>
        {route && <span className="font-mono typo-caption text-foreground/90">{route}</span>}
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">{children}</div>
    </div>
  );
}
