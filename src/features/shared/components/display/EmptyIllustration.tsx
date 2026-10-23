import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyArt, type EmptyArtMotif } from './emptyArt/EmptyArt';
import { motifForIcon } from './emptyArt/iconMotif';

interface EmptyIllustrationProps {
  icon: LucideIcon;
  /** The illustration; defaults to the motif `icon` maps to, else the icon badge. */
  art?: EmptyArtMotif;
  heading: string;
  description: string;
  cta?: ReactNode;
  className?: string;
}

/**
 * @catalog Compact empty state for a card or panel: small animated art (from `art` or the icon), heading, caption.
 *
 * A compact empty state for panels and cards: illustration, a heading at full
 * ink and a caption-tier description (the same ramp as
 * ScenarioEmptyState `size="sm"`).
 */
export function EmptyIllustration({ icon: Icon, art, heading, description, cta, className = '' }: EmptyIllustrationProps) {
  const motif = art ?? motifForIcon(Icon);
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {motif ? (
        <EmptyArt motif={motif} size="sm" className="mb-3" />
      ) : (
        <div className="rounded-2xl border border-dashed border-primary/10 p-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-secondary/40 flex items-center justify-center">
            <Icon className="w-6 h-6 text-foreground" />
          </div>
        </div>
      )}
      <h4 className="typo-heading text-foreground">{heading}</h4>
      <p className="typo-caption mt-1 max-w-xs mx-auto">
        {description}
      </p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
