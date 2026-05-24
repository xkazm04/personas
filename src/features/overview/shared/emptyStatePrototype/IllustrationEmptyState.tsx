import { motion } from 'framer-motion';
import { MOTIF_ACCENTS, type EmptyStateContent, type EmptyStateMotif } from './types';
import { getIllustration } from './illustrations';
import { EmptyStateActions, EmptyStateCopy } from './parts';

/**
 * Illustration variant — a Leonardo-generated hero image is the dominant focal
 * point, sitting on a soft radial glow halo, with copy + CTAs below. Reads as a
 * premium, editorial empty state rather than a diagram.
 *
 * Until the asset is generated, a styled placeholder stands in (the module's
 * lucide glyph on the accent halo) so the layout is reviewable now.
 */
export function IllustrationEmptyState({
  motif,
  content,
}: {
  motif: EmptyStateMotif;
  content: EmptyStateContent;
}) {
  const accent = MOTIF_ACCENTS[motif];
  const { src } = getIllustration(motif);
  const Icon = content.icon;

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
        {src ? (
          // Dark-bg hero: a radial mask fades the square edges into the app
          // background so the glowing subject reads as a frameless hero.
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="relative w-[244px] h-[244px] object-contain"
            style={{
              maskImage: 'radial-gradient(circle at 50% 50%, #000 52%, transparent 74%)',
              WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 52%, transparent 74%)',
            }}
          />
        ) : (
          // Placeholder until the Leonardo hero is generated (task #8).
          <div className={`relative flex flex-col items-center justify-center gap-3 w-[208px] h-[208px] rounded-3xl border ${accent.border} ${accent.soft}`}>
            <div className={`flex items-center justify-center w-20 h-20 rounded-2xl border ${accent.border} bg-background/40 ${accent.text}`}>
              <Icon className="w-10 h-10" strokeWidth={1.5} />
            </div>
            <span className="typo-caption uppercase tracking-wider text-foreground/40">AI illustration</span>
          </div>
        )}
      </motion.div>

      <EmptyStateCopy title={content.title} subtitle={content.subtitle} />

      <EmptyStateActions action={content.action} secondaryAction={content.secondaryAction} />
      {content.children ? <div className="pt-1">{content.children}</div> : null}
    </div>
  );
}
