import { motion } from 'framer-motion';
import { useIsDarkTheme } from '@/stores/themeStore';
import { MOTIF_ACCENTS, type EmptyStateContent, type IllustrationMotif } from './types';
import { getIllustration } from './illustrations';
import { EmptyStateActions, EmptyStateCopy } from './parts';

/**
 * Illustration variant — a Leonardo-generated hero image is the dominant focal
 * point, seated on a soft radial glow halo with copy + CTAs below. Reads as a
 * premium, editorial empty state rather than a diagram.
 *
 * A radial mask fades the square image edges into the app background, so the
 * glowing subject reads as a frameless hero on both themes. In light themes the
 * component swaps to the light-alternate asset (srcLight) when present.
 */
export function IllustrationEmptyState({
  motif,
  content,
}: {
  motif: IllustrationMotif;
  content: EmptyStateContent;
}) {
  const isDark = useIsDarkTheme();
  const accent = MOTIF_ACCENTS[motif];
  const { src, srcLight } = getIllustration(motif);
  const heroSrc = !isDark && srcLight ? srcLight : src;

  return (
    <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
      <motion.div
        className="relative flex items-center justify-center"
        style={{ width: 248, height: 248 }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        {/* hero halo — reinforces the image's own glow and seats it on the bg */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(circle at 50% 50%, ${accent.glow}, transparent 70%)` }}
        />
        {/* Radial mask fades the square edges into the app background so the
            glowing subject reads as a frameless hero. */}
        <img
          src={heroSrc}
          alt=""
          aria-hidden="true"
          className="relative w-[244px] h-[244px] object-contain"
          style={{
            maskImage: 'radial-gradient(circle at 50% 50%, #000 52%, transparent 74%)',
            WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 52%, transparent 74%)',
          }}
        />
      </motion.div>

      <EmptyStateCopy title={content.title} subtitle={content.subtitle} />

      <EmptyStateActions action={content.action} secondaryAction={content.secondaryAction} />
      {content.children ? <div className="pt-1">{content.children}</div> : null}
    </div>
  );
}
