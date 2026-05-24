import { motion } from 'framer-motion';
import { MOTIF_ACCENTS, type EmptyStateContent, type EmptyStateMotif } from './types';
import { MOTIF_COMPONENTS } from './motifs';
import { EmptyStateActions, EmptyStateCopy } from './parts';

/**
 * Motion variant — the "coded illustration". A framer-motion + SVG motif sits
 * in a glowing accent frame above the copy. Reads as an in-app, technical,
 * diagram-like empty state. All animation is entry-only (plays once on mount).
 */
export function MotionEmptyState({
  motif,
  content,
}: {
  motif: EmptyStateMotif;
  content: EmptyStateContent;
}) {
  const accent = MOTIF_ACCENTS[motif];
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
        {/* accent glow behind the motif */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
          style={{ background: `radial-gradient(circle at 50% 45%, ${accent.glow}, transparent 70%)` }}
        />
        <div className={`relative ${accent.text}`}>
          <Motif accent={accent} size={168} />
        </div>
      </motion.div>

      <EmptyStateCopy title={content.title} subtitle={content.subtitle} />

      <EmptyStateActions action={content.action} secondaryAction={content.secondaryAction} />
      {content.children ? <div className="pt-1">{content.children}</div> : null}
    </div>
  );
}
