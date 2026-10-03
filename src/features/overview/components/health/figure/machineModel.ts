/**
 * The arithmetic behind the machine figure (kit batch home-3, builder FG, doctrine 6c).
 *
 * Strata's law, which is the reason its plates stay comparable over time: **every scale is a
 * DECLARED domain, never the sample's own min/max.** The same holds here. The deck line is fixed,
 * the base line is fixed, a course is always one check, and a pier's girth comes off a declared
 * `GIRTH_FULL_AT` rather than off whichever section happens to have the most checks today - so a
 * machine drawn now and the same machine drawn after a seventh check is added read the same way.
 *
 * Nothing in this file renders. It turns the six `HealthSectionState`s into the geometry the SVG
 * draws, so the drawing is a projection of numbers and not a pile of hand-placed rectangles.
 */
import type { HealthCheckItem } from '@/api/system/system';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

import { bySeverity, tally, worstStatus, type HealthSectionId } from '../healthModel';
import type { HealthSectionState } from '../useHealthSections';

/**
 * The drawing's own coordinate space. `preserveAspectRatio="none"` stretches X alone, so the view
 * box's own aspect decides whether a view unit is square on screen: this one is 120 x 26 = 4.6,
 * against the plot's measured 5.2 at a 1920 window and 4.0 at 1440, so a unit is within about 13%
 * of square at either. The first draft was 120 x 100 and stretched almost 6:1 - every support came
 * out wider than it was tall and the figure read as a bar chart, which is the failure mode 6c is
 * about. Measure the plot before changing these two numbers.
 */
export const VIEW_W = 120;
export const VIEW_H = 26;
/** One column per environment. Columns are EQUAL so the flat callout rail under the drawing stays
 *  put while the six sections land on their own cycles (law 6); the girth inside a column is what
 *  varies. */
export const COL_W = VIEW_W / 6;
/** Where a pier starts inside its column: the figure's own reading line, which the callout under
 *  it shares, so a pier and its name have one left edge and the alignment needs no measuring. */
export const PIER_X = 0.9;
/** The deck's resting line and the base line (this machine). Both fixed: a readiness line that
 *  moved with the data would say nothing. */
export const DECK_Y = 1.7;
export const BASE_Y = 22.6;
/** Courses are drawn at or above this height; past `COURSE_CAP` checks the pier shows strata's
 *  overflow mark instead of hairlines. Real sections carry one to four. */
export const COURSE_CAP = 8;
/** A pier reaches full girth at this many checks (a declared domain, not the sample's max). */
export const GIRTH_FULL_AT = 4;
const GIRTH_MIN = 6;
const GIRTH_MAX = 13.2;

/** How far the deck sags over a pier, by the worst thing under it. Severity as geometry: the
 *  silhouette alone says where the machine is weak, before any colour is read. */
const DROP: Record<HealthCheckStatus, number> = {
  ok: 0,
  info: 0,
  inactive: 1.6,
  warn: 3.2,
  error: 6.4,
};
/** A section whose command rejected: nothing is known, so the deck is drawn at its deepest. */
const DROP_FAILED = 6.4;

export type CourseKind = HealthCheckStatus | 'ghost';
export type DeckKind = 'solid' | 'sagging' | 'broken' | 'planned' | 'ghost';

export interface Course {
  key: string;
  kind: CourseKind;
  /** Course box in view units, bottom-up within the pier. */
  y: number;
  h: number;
}

export interface Pier {
  id: HealthSectionId;
  /** Column box in view units; the callout rail uses the same six equal columns. */
  colX: number;
  /** The pier's own box: girth is its substance (how many checks the environment IS). */
  x: number;
  w: number;
  top: number;
  courses: Course[];
  /** Checks beyond `COURSE_CAP`, drawn as an overflow mark rather than as hairlines. */
  overflow: number;
  deck: DeckKind;
  deckY: number;
  worst: HealthCheckStatus;
  ok: number;
  total: number;
  loading: boolean;
  failed: boolean;
}

/** Girth from the check count, on the declared domain: a one-check environment is a post, a
 *  four-check one is a pillar, and the deck visibly rests on supports of different substance. */
function girth(count: number): number {
  const share = Math.min(1, count / GIRTH_FULL_AT);
  return GIRTH_MIN + (GIRTH_MAX - GIRTH_MIN) * share;
}

function deckKind(worst: HealthCheckStatus): DeckKind {
  if (worst === 'error') return 'broken';
  if (worst === 'warn') return 'sagging';
  if (worst === 'inactive') return 'planned';
  return 'solid';
}

/**
 * The courses of one pier, worst at the TOP: the break sits directly under the deck it fails to
 * carry, which is the whole claim the figure makes.
 */
function courses(items: readonly HealthCheckItem[], top: number): { courses: Course[]; overflow: number } {
  const shown = bySeverity(items).slice(0, COURSE_CAP);
  const overflow = Math.max(0, items.length - COURSE_CAP);
  const n = shown.length;
  if (n === 0) return { courses: [], overflow };
  const gap = 0.45;
  const h = (BASE_Y - top - gap * (n - 1)) / n;
  return {
    courses: shown.map((item, i) => ({
      key: `${item.id}:${i}`,
      kind: item.status as CourseKind,
      y: top + i * (h + gap),
      h,
    })),
    overflow,
  };
}

/** Three ghost courses at the resting deck line: the pier holds its geometry while its own
 *  section's cycle runs, and no pier waits on another's (law 6). */
function ghostCourses(top: number): Course[] {
  const gap = 0.45;
  const h = (BASE_Y - top - gap * 2) / 3;
  return [0, 1, 2].map((i) => ({ key: `g${i}`, kind: 'ghost' as const, y: top + i * (h + gap), h }));
}

export function piers(sections: readonly HealthSectionState[]): Pier[] {
  return sections.map((sec, i) => {
    const colX = i * COL_W;
    const counts = tally(sec.items);
    const worst = worstStatus(sec.items);
    const loading = sec.loading;
    const failed = sec.failed;
    const drop = loading ? 0 : failed ? DROP_FAILED : DROP[worst];
    const top = DECK_Y + drop;
    const w = loading || failed ? girth(2) : girth(sec.items.length);
    const built = loading ? { courses: ghostCourses(top), overflow: 0 } : failed ? { courses: [], overflow: 0 } : courses(sec.items, top);
    return {
      id: sec.id,
      colX,
      x: colX + PIER_X,
      w,
      top,
      courses: built.courses,
      overflow: built.overflow,
      deck: loading ? 'ghost' : failed ? 'broken' : deckKind(worst),
      deckY: top,
      worst,
      ok: counts.ok,
      total: counts.total,
      loading,
      failed,
    };
  });
}
