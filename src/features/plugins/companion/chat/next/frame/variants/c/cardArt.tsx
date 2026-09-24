/**
 * Card art vocabulary for Halo · Spread: one glyph per waiting-item kind, a
 * stable hue per project (for monograms and bands), and the ornate CSS pieces
 * (corner filigree, foil, card-back weave) shared by the binder tiles and the
 * spread's cards. Everything is CSS variables in inline styles, never raw hex.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import {
  ClipboardList,
  Map as MapIcon,
  MessageSquareMore,
  OctagonAlert,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { WorkItemKind } from '../../../useWorkforce';

export const KIND_GLYPH: Record<WorkItemKind, LucideIcon> = {
  session_request: MessageSquareMore,
  decision: Scale,
  approval: ShieldCheck,
  plan: MapIcon,
  failure: OctagonAlert,
  warning: TriangleAlert,
  nudge: Sparkles,
  assignment: ClipboardList,
};

const HUES = [
  'var(--brand-cyan)',
  'var(--brand-purple)',
  'var(--brand-emerald)',
  'var(--brand-amber)',
  'var(--brand-rose)',
  'var(--status-info)',
];

/** A stable hue per project label, so its tile and its cards agree. */
export function projectHue(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function monogram(label: string): string {
  const words = label.split(/[\s\-_/.]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (label.slice(0, 2) || '?').replace(/^./, (c) => c.toUpperCase());
}

export const mix = (color: string, pct: number, into = 'transparent') => `color-mix(in srgb, ${color} ${pct}%, ${into})`;

/** The double-ring border: a metallic sweep in the card's colour. */
export function ringGradient(color: string): string {
  return `linear-gradient(135deg, ${color} 0%, ${mix(color, 35)} 22%, ${mix(color, 90, 'var(--foreground)')} 48%, ${mix(color, 35)} 74%, ${color} 100%)`;
}

/**
 * One corner of filigree, drawn for the top-left corner (mirror with scale for
 * the others): a quarter ring, a small diamond and two tapering rails.
 */
export function filigreeStyle(color: string, size: number): CSSProperties {
  const c = mix(color, 85);
  const r = Math.round(size * 0.42);
  return {
    width: size,
    height: size,
    backgroundImage: [
      `radial-gradient(circle at 0 0, transparent ${r - 2}px, ${c} ${r - 1}px, ${c} ${r}px, transparent ${r + 1}px)`,
      `radial-gradient(circle at ${r}px ${r}px, ${c} 1.5px, transparent 2.5px)`,
      `linear-gradient(90deg, ${c}, transparent)`,
      `linear-gradient(180deg, ${c}, transparent)`,
      `conic-gradient(from 45deg at 5px 5px, ${c} 0 90deg, transparent 90deg)`,
    ].join(', '),
    backgroundSize: `100% 100%, 100% 100%, ${size}px 1px, 1px ${size}px, 10px 10px`,
    backgroundPosition: `0 0, 0 0, ${r + 3}px 2px, 2px ${r + 3}px, 0 0`,
    backgroundRepeat: 'no-repeat',
  };
}

export const CORNERS = [
  { key: 'tl', className: 'top-0 left-0', transform: 'none' },
  { key: 'tr', className: 'top-0 right-0', transform: 'scaleX(-1)' },
  { key: 'bl', className: 'bottom-0 left-0', transform: 'scaleY(-1)' },
  { key: 'br', className: 'bottom-0 right-0', transform: 'scale(-1, -1)' },
] as const;

/** The card back's woven pattern. */
export function weaveStyle(color: string): CSSProperties {
  return {
    backgroundColor: mix(color, 14, 'var(--background)'),
    backgroundImage: [
      `radial-gradient(circle at 50% 50%, ${mix(color, 45)} 0 18%, transparent 19%)`,
      `repeating-conic-gradient(from 0deg at 50% 50%, ${mix(color, 18)} 0 10deg, transparent 10deg 20deg)`,
      `repeating-linear-gradient(45deg, ${mix(color, 10)} 0 1px, transparent 1px 7px)`,
      `repeating-linear-gradient(-45deg, ${mix(color, 10)} 0 1px, transparent 1px 7px)`,
    ].join(', '),
  };
}
