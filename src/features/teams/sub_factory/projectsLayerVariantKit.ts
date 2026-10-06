// /prototype ProjectsLayer (2026-10-06) - what the three variants share.
//
// Every variant keeps the Atlas exactly as it is organised (head, stat strip,
// lens / search / sort toolbar, legend, one project per line x one dimension
// per column, readout, drawer, passport). What they redesign is the components
// inside the matrix, so the pieces here are the data each of them encodes:
//
// - `nameParts`: 74 of 102 projects are named `Gig · <discipline> · <brief>`
//   (cut at 86 characters by the importer). In a 248px nowrap cell only the
//   word "Gig" survived. Split, the discipline becomes a kicker and the brief
//   becomes the name, wrapped over two lines.
// - `meterOf`: the rung a value stands on (reached / steps), so a cell can
//   draw HOW FAR a dimension got rather than only which of six states it is in.
// - `shortValue`: the value itself in a few characters, for cells that print it.
import { createContext } from 'react';
import type { AppPassport } from './passport/passportModel';
import { AUTOMATION_SCALE, PROD_BAND_SCALE } from './passport/passportModel';
import type { CellValue } from './passport/passportRows';
import { countInk, type AtlasInk } from './passport/atlas/atlasModel';
import type { AtlasNames } from './passport/atlas/atlasFigure';

export interface NameParts {
  /** The line above the name: a gig's discipline, a repo's owner, or null. */
  kicker: string | null;
  /** What the project is called, readable on its own. */
  title: string;
  /** The folder that tells same-named checkouts apart. */
  qualifier: string | null;
  /** The importer cut the brief mid-word. */
  cut: boolean;
}

const GIG = /^\s*gig\s*[-–—·]\s*/i;
const SEP = /\s+[-–—·]\s+/;

export function nameParts(p: AppPassport, names: AtlasNames): NameParts {
  const nm = names.get(p.identity.slug);
  const raw = nm?.name ?? p.identity.name;
  const qualifier = nm?.qualifier ?? null;
  if (GIG.test(raw)) {
    const rest = raw.replace(GIG, '');
    const [discipline, ...brief] = rest.split(SEP);
    const title = brief.join(' - ').trim();
    return title
      ? { kicker: (discipline ?? '').trim() || null, title, qualifier, cut: raw.length >= 85 }
      : { kicker: 'Gig', title: rest.trim(), qualifier, cut: raw.length >= 85 };
  }
  const slash = raw.indexOf('/');
  if (slash > 0) return { kicker: raw.slice(0, slash), title: raw.slice(slash + 1), qualifier, cut: false };
  return { kicker: null, title: raw, qualifier, cut: false };
}

/** The project's worst state, the same rule the baseline matrix uses. */
export function worstInk(p: AppPassport): AtlasInk {
  if (p.repoUnreadable) return 'unknown';
  if (countInk(p, 'bad')) return 'bad';
  if (countInk(p, 'warn')) return 'warn';
  return 'good';
}

/** Two letters that stand for the project when no favicon is known. */
export function monogram(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const [a = '', b = ''] = words;
  if (!a) return '?';
  return (b ? `${a.charAt(0)}${b.charAt(0)}` : a.slice(0, 2)).toUpperCase();
}

/** How far a value climbed: `reached` of `steps` rungs. Null when it has no ladder. */
export function meterOf(v: CellValue): { reached: number; steps: number } | null {
  switch (v.kind) {
    case 'level': return { reached: AUTOMATION_SCALE.indexOf(v.level) + 1, steps: AUTOMATION_SCALE.length };
    case 'band': return { reached: PROD_BAND_SCALE.indexOf(v.band) + 1, steps: PROD_BAND_SCALE.length };
    case 'ordinal': return v.steps ? { reached: v.reached ?? 0, steps: v.steps } : { reached: v.pos > 0 ? 1 : 0, steps: 1 };
    case 'pips': return { reached: v.items.filter((i) => i.on).length, steps: v.items.length };
    case 'env': return { reached: v.slots.filter((s) => s.label).length, steps: v.slots.length };
    case 'bool': return { reached: v.on ? 1 : 0, steps: 1 };
    case 'present': return { reached: v.label ? 1 : 0, steps: 1 };
    case 'cost': return { reached: v.state === 'known' ? 1 : 0, steps: 1 };
    case 'chips': case 'counts': return null;
  }
}

/** The value in a few characters, for a cell that prints it. */
export function shortValue(v: CellValue): string {
  switch (v.kind) {
    case 'level': return v.level;
    case 'band': return `${v.score}`;
    case 'ordinal': return v.label;
    case 'present': return v.label ?? '-';
    case 'chips': { const [first] = v.items; return first === undefined ? '-' : v.items.length === 1 ? first : `${first} +${v.items.length - 1}`; }
    case 'pips': return `${v.items.filter((i) => i.on).length}/${v.items.length}`;
    case 'bool': return v.on ? 'On' : 'Off';
    case 'counts': { const n = v.items.reduce((s, i) => s + i.count, 0); return n === 0 ? '-' : `${n}`; }
    case 'env': return `${v.slots.filter((s) => s.label).length}/${v.slots.length}`;
    case 'cost': return v.state === 'known' ? `${v.currency ?? ''}${Math.round(v.total ?? 0)}`.trim() : '-';
  }
}

/** Entrance delay for line `pi`: the first screenful cascades, the rest arrive at once. */
export function lineDelay(pi: number, step = 0.022, cap = 18): number {
  return Math.min(pi, cap) * step;
}

/** slug -> favicon data URL, probed by ProjectsLayer. The figure contract has
 *  no slot for it, so the variants read it from here. */
export const VariantFavicons = createContext<Map<string, string>>(new Map());

/** The words the variants add, in one list (the Factory's convention, see useFactoryWords). */
export const VARIANT_WORDS = {
  switcherLabel: 'ProjectsLayer prototype',
  cut: 'name cut by the importer',
  blockers: (n: number) => `${n} blocker${n === 1 ? '' : 's'}`,
  noBlockers: 'no blockers',
  unreadable: 'repo unreadable',
  provisional: 'not measured yet',
  auto: 'Auto',
  prod: 'Prod',
} as const;
