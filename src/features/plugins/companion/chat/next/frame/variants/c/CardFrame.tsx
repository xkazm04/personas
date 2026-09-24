/**
 * The collectible card of Halo · Spread: `CardFace` (the ornate front) and
 * `CardBack` (the woven back the deck, the discard pile and the flip show).
 *
 * R4 (owner, 2026-09-24): no hover tilt or any hover movement, no header band
 * (kind / number / title), and no card inside the card: the face frames a
 * card-native `CardBody` (Oracle / Ledger / Runes) that expresses the content
 * directly; only kinds without a native body still show `WorkItemBody`.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import { motion } from 'framer-motion';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { CardBody } from './bodies/CardBody';
import { hasNativeBody, type BodyVariant } from './bodies/model';
import { CORNERS, KIND_GLYPH, filigreeStyle, mix, monogram, projectHue, ringGradient, weaveStyle } from './cardArt';
import { SPREAD_COPY as S } from './copy';

function Filigree({ color, size }: { color: string; size: number }) {
  return (
    <div className="absolute inset-[7px] pointer-events-none" aria-hidden>
      {CORNERS.map((c) => (
        <span key={c.key} className={`absolute ${c.className}`} style={{ ...filigreeStyle(color, size), transform: c.transform }} />
      ))}
    </div>
  );
}

/** The woven back. Fills its parent. */
export function CardBack({ color = 'var(--primary)', compact = false }: { color?: string; compact?: boolean }) {
  return (
    <div className="w-full h-full rounded-card p-[2px] shadow-elevation-2" style={{ background: ringGradient(color) }}>
      <div className="relative w-full h-full rounded-card overflow-hidden" style={weaveStyle(color)}>
        <div className="absolute inset-[4px] rounded-card border pointer-events-none" style={{ borderColor: mix(color, 45) }} />
        {!compact && <Filigree color={color} size={18} />}
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <span
            className={`grid place-items-center rounded-full border typo-heading text-foreground ${compact ? 'w-6 h-6 typo-caption' : 'w-12 h-12'}`}
            style={{ borderColor: mix(color, 70), background: mix(color, 22, 'var(--background)'), boxShadow: `0 0 18px -4px ${color}` }}
          >
            A
          </span>
        </div>
      </div>
    </div>
  );
}

/** The art window: her portrait for her own cards, a monogram for a project's. */
function ArtWindow({ item, color, height }: { item: WorkItem; color: string; height: number }) {
  const Glyph = KIND_GLYPH[item.kind];
  const hue = item.project ? projectHue(item.project) : 'var(--primary)';
  return (
    <div
      className="relative mx-4 mt-4 shrink-0 rounded-card overflow-hidden border"
      style={{
        height,
        borderColor: mix(color, 55),
        background: `radial-gradient(120% 140% at 50% 0%, ${mix(color, 38, 'var(--background)')} 0%, ${mix(hue, 16, 'var(--background)')} 60%, var(--background) 100%)`,
      }}
    >
      {item.project ? (
        <span
          className="absolute -right-2 -bottom-6 typo-hero select-none"
          style={{ fontSize: height * 1.1, lineHeight: 1, color: mix('var(--foreground)', 10) }}
          aria-hidden
        >
          {monogram(item.project)}
        </span>
      ) : (
        <img
          src="/athena/athena_baseline.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-55"
          style={{ objectPosition: '50% 22%', maskImage: 'linear-gradient(90deg, transparent, black 30%, black 70%, transparent)' }}
        />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="grid place-items-center rounded-full border-2"
          style={{
            width: Math.min(64, height - 16),
            height: Math.min(64, height - 16),
            borderColor: color,
            background: mix(color, 20, 'var(--background)'),
            boxShadow: `0 0 26px -6px ${color}, inset 0 0 12px -4px ${color}`,
          }}
        >
          <Glyph className="w-1/2 h-1/2 text-foreground" aria-hidden />
        </span>
      </div>
      <span
        className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 typo-caption text-foreground bg-background/80"
        style={{ borderColor: mix(hue, 60) }}
      >
        <span className="grid place-items-center w-5 h-5 rounded-full typo-label text-foreground" style={{ background: mix(hue, 40) }}>
          {item.project ? monogram(item.project) : 'A'}
        </span>
        {item.project ?? S.athenaOwn}
      </span>
    </div>
  );
}

/** The ornate front of one card: frame, filigree, art and a card-native body. */
export function CardFace({
  item,
  body,
  waiting,
  compact,
  sheen,
  onSend,
  onSetAside,
}: {
  item: WorkItem;
  /** Which card-native treatment renders the content. */
  body: BodyVariant;
  /** Cards still in the deck behind this one. */
  waiting: number;
  /** A short stage: a slimmer art window. */
  compact: boolean;
  /** Play the one-time foil sweep. */
  sheen: boolean;
  onSend: (text: string) => void;
  onSetAside: () => void;
}) {
  const color = KIND_VAR[item.kind];
  const art = <ArtWindow item={item} color={color} height={compact ? 56 : body === 'runes' ? 72 : 96} />;
  return (
    <div className="relative w-full h-full rounded-modal p-[3px] shadow-elevation-4" style={{ background: ringGradient(color), boxShadow: `0 24px 60px -18px ${mix(color, 55)}` }}>
      <div className="relative w-full h-full rounded-modal bg-background overflow-hidden flex flex-col">
        <div className="absolute inset-[5px] rounded-card border pointer-events-none" style={{ borderColor: mix(color, 45) }} aria-hidden />
        <Filigree color={color} size={30} />

        <CardBody variant={body} item={item} color={color} art={art} deckWaiting={waiting} onSend={onSend} />

        <div className="relative mx-5 mb-3 mt-1 shrink-0 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSetAside}
            className="rounded-interactive border border-foreground/15 px-3 py-1 typo-body text-foreground hover:bg-foreground/[0.06] focus-ring"
          >
            {S.setAside}
          </button>
          <span className="typo-body text-foreground/85">{hasNativeBody(item.kind) ? S.keysBody : S.keysHint}</span>
        </div>

        {sheen && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(105deg, transparent 35%, ${mix(color, 28, 'var(--foreground)')} 48%, transparent 62%)`, mixBlendMode: 'overlay' }}
            initial={{ x: '-110%', opacity: 0.9 }}
            animate={{ x: '110%', opacity: 0.4 }}
            transition={{ duration: 0.9, ease: [0.3, 0.6, 0.2, 1] }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
