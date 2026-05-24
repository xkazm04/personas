import { motion } from 'framer-motion';
import { useIsDarkTheme } from '@/stores/themeStore';
import { MOTIF_ACCENTS, type EmptyStateContent, type MotionMotif } from './types';
import { MOTIF_COMPONENTS } from './motifs';
import { EmptyStateActions, EmptyStateCopy } from './parts';

/**
 * Motion variant — an animated framer-motion + SVG motif in a glowing accent
 * frame above the copy. Reads as an in-app, technical, diagram-like empty
 * state. All animation is entry-only (plays once on mount).
 *
 * In light themes the motif strokes swap to a darker accent (accent.strokeLight)
 * so the line work keeps contrast against the light background.
 */
export function MotionEmptyState({
  motif,
  content,
}: {
  motif: MotionMotif;
  content: EmptyStateContent;
}) {
  const isDark = useIsDarkTheme();
  const base = MOTIF_ACCENTS[motif];
  const accent = isDark ? base : { ...base, stroke: base.strokeLight };
  const Motif = MOTIF_COMPONENTS[motif];

  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-8">
      <motion.div
        className={`relative flex items-center justify-center rounded-2xl border ${accent.border} ${accent.soft}`}
        style={{ width: 200, height: 200 }}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {/* accent glow behind the motif (dark theme only — washes out on white) */}
        {isDark && (
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
            style={{ background: `radial-gradient(circle at 50% 45%, ${base.glow}, transparent 70%)` }}
          />
        )}
        <div className="relative">
          <Motif accent={accent} size={168} />
        </div>
      </motion.div>

      <EmptyStateCopy title={content.title} subtitle={content.subtitle} />

      <EmptyStateActions action={content.action} secondaryAction={content.secondaryAction} />
      {content.children ? <div className="pt-1">{content.children}</div> : null}
    </div>
  );
}
