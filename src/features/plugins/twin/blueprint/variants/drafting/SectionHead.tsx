import { BookUser, Brain, GraduationCap, MessagesSquare, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { TWIN_GLYPH_PATHS } from '../../../TwinGlyph';
import type { SectionId } from '../../blueprintContract';
import { Balloon, Letter } from './Lettering';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';
import { appHeadings, useDraftingTheme } from './draftingTheme';

/**
 * The "Personas blueprint" level's section icons: the app's own twin slot icons
 * (`shared/twinStatus.ts`: identity, tone, brain) and the training CTA's.
 * The twin's brand glyph is the title card's identity mark (`TwinMark`).
 */
const ICONS: Record<SectionId, LucideIcon> = {
  identity: BookUser,
  voice: MessagesSquare,
  knowledge: Brain,
  training: GraduationCap,
};

/**
 * The mark a section is named by, by theme level (round 3 WP-D): a drafting
 * balloon on the blueprint (the cyanotype, "Personas touch", and on the cards
 * of "Half and half"); in the "Personas blueprint" the section's icon in a lit
 * chip. Drawn as its container's first content: the chip's outline, its glow,
 * then the icon.
 */
export function SectionMark({ section, number, inked, size = 28 }: { section: SectionId; number: number; inked: boolean; size?: number }) {
  const theme = useDraftingTheme();
  if (theme !== 'native') return <Balloon number={number} inked={inked} size={size} />;
  const Icon = ICONS[section];
  return (
    <Chip size={size} section={section}>
      <span data-draw="mark" className="relative inline-flex">
        <Icon width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} strokeWidth={1.8} />
      </span>
    </Chip>
  );
}

/**
 * The twin's brand glyph as the native title card's identity mark, where a
 * drafter puts the maker's mark: its two facing profiles traced stroke by
 * stroke, as the pen would draw them.
 */
export function TwinMark({ size = 40 }: { size?: number }) {
  const glyph = Math.round(size * 0.66);
  return (
    <Chip size={size} section="identity">
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" className="relative overflow-visible" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {TWIN_GLYPH_PATHS.map((d) => (
          <path key={d} d={d} pathLength={100} data-draw="stroke" />
        ))}
      </svg>
    </Chip>
  );
}

/**
 * A lit chip, as large as the balloon it stands in for (so a section head is
 * no taller than on paper): its outline is traced (a stroke of its
 * container), then its glow rises.
 */
function Chip({ size, section, children }: { size: number; section: SectionId; children: ReactNode }) {
  return (
    <span
      aria-hidden
      data-section-icon={section}
      className="twd-icon relative inline-flex shrink-0 items-center justify-center rounded-interactive"
      style={{ width: size, height: size }}
    >
      <DrawFrame kind="stroke" stroke="var(--twd-icon-line)" edge={0} />
      <span data-draw="rise" className="twd-icon-fill absolute inset-0 rounded-interactive" />
      {children}
    </span>
  );
}

/**
 * A section's name: drafting lettering on the cyanotype and in "Personas
 * touch", the app's (primary-tinted) title from "Half and half" on. `text`
 * replaces the bare name in lettering (L2 says "Detail of ..." there, as a
 * drawing names a detail).
 */
export function SectionName({ section, text, className = '' }: { section: SectionId; text?: string; className?: string }) {
  const theme = useDraftingTheme();
  const { t } = useTranslation();
  const name = text ?? t.twin.blueprint.sections[section];
  if (!appHeadings(theme)) {
    return (
      <Letter strong className={className}>
        {name}
      </Letter>
    );
  }
  return <Write text={t.twin.blueprint.sections[section]} className={`typo-title ${className}`} />;
}
