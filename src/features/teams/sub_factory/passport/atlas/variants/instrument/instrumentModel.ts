// Passport Atlas, Instrument figure - the data each line and cell encodes.
//
// - `nameParts`: 74 of 102 projects are named `Gig · <discipline> · <brief>`
//   (cut at 86 characters by the importer). In a nowrap name cell only the word
//   "Gig" survived. Split, the discipline becomes a kicker and the brief
//   becomes the name, wrapped over two lines.
// - `meterOf`: the rung a value stands on (reached / steps), so a cell draws
//   HOW FAR a dimension got rather than only which of six states it is in.
// - `setCount`: what a set with no ladder prints in place of a meter.
import { AUTOMATION_SCALE, PROD_BAND_SCALE, type AppPassport } from '../../../passportModel';
import type { CellValue } from '../../../passportRows';
import { countInk, type AtlasInk } from '../../atlasModel';
import type { AtlasNames } from '../../atlasFigure';

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

/** The project's worst state: unknown, then any failing, then any attention. */
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

/** What a ladderless value (a set) prints instead of a meter: how many it holds. */
export function setCount(v: CellValue): string {
  if (v.kind === 'chips') return v.items.length ? String(v.items.length) : '-';
  if (v.kind === 'counts') { const n = v.items.reduce((s, i) => s + i.count, 0); return n === 0 ? '-' : `${n}`; }
  return '-';
}

/** Entrance delay for line `pi`: the first screenful cascades, the rest arrive at once. */
export function lineDelay(pi: number, step = 0.022, cap = 18): number {
  return Math.min(pi, cap) * step;
}
