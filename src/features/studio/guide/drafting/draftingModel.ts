import type { CSSProperties } from 'react';
import type { SiteSketch } from '@/lib/bindings/SiteSketch';
import type { SketchRegion } from '@/lib/bindings/SketchRegion';
import type { BuildPhase } from '../../studioBuildModel';

// The drafting sheet (contest A/3 "Blueprint", brought into Personas as a
// second sheet style): what it draws is decided here, as pure functions, so the
// components only paint.

/** Drafting lettering: mono, upper case, spaced. No type token has this voice. */
export const LETTERING: CSSProperties = {
  font: '600 12px/1.25 var(--font-mono)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const STOP = new Set(['page', 'section', 'the', 'and', 'with', 'your', 'site', 'build', 'make', 'add', 'area', 'for']);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/s$/, ''));

/**
 * The region a goal is about, by the words they share ("Daily menu" is about
 * the "Menu grid"), or -1. The plan and the sketch name the same site in the
 * same words often enough; when they do not, nothing is highlighted rather
 * than the wrong thing.
 */
export function regionForGoal(goal: string, regions: Pick<SketchRegion, 'title' | 'purpose'>[]): number {
  const g = new Set(words(goal));
  if (g.size === 0) return -1;
  let best = -1;
  let bestScore = 0;
  regions.forEach((r, i) => {
    const score = words(`${r.title} ${r.purpose}`).filter((w) => g.has(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** How tall each region is drawn: bars are thin, a hero or banner is tall. */
export function regionWeights(titles: string[]): number[] {
  return titles.map((t) => {
    const s = t.toLowerCase();
    if (/\b(nav|navigation|top bar|header|footer|bar)\b/.test(s)) return 1;
    if (/\b(hero|banner|intro|welcome)\b/.test(s)) return 3;
    return 2;
  });
}

/**
 * The real page seen through the plan (`done` 0..1): a deep cyanotype proof
 * while the plan is in work, warming a little as goals get done, and developing
 * into full colour only when the last goal is done, with the stamp. A proof
 * that fades in step with progress reads as washed out rather than as a proof.
 */
export function proofFilter(done: number): string {
  const d = Math.min(1, Math.max(0, done));
  const p = d >= 1 ? 0 : 1 - 0.35 * d;
  if (p === 0) return 'none';
  const f = (n: number) => Math.round(n * 100) / 100;
  return `grayscale(${f(p)}) sepia(${f(p)}) hue-rotate(${Math.round(178 * p)}deg) saturate(${f(1 + 2.2 * p)}) brightness(${f(1 - 0.4 * p)}) contrast(${f(1 + 0.25 * p)})`;
}

export type SheetMoment = 'template' | 'sketch' | 'plan';

/** What the sheet draws on page 1: never a part it has nothing for. */
export type SheetDrawing = 'sketch' | 'plan' | 'template' | 'skeleton';

/**
 * - the sketch, when it has any page with regions;
 * - else the plan itself (its goals as frames), when there is one;
 * - else, for a project being created, the stock Next.js page;
 * - else (an opened project whose plan has not loaded) unlabelled ghost frames.
 * A reopened project never shows the stock page: its labels would be made up.
 */
export function drawingOf(a: { sketch: SiteSketch | null; planned: boolean; opened: boolean }): SheetDrawing {
  if (a.sketch?.pages.some((p) => p.regions.length > 0)) return 'sketch';
  if (a.planned) return 'plan';
  return a.opened ? 'skeleton' : 'template';
}

/** Which drawing the sheet shows: the stock template, the sketch, or the plan being built. */
export function sheetMoment(hasSketch: boolean, phases: BuildPhase[], placeholder: boolean): SheetMoment {
  if (!placeholder && phases.length > 0) return 'plan';
  return hasSketch ? 'sketch' : 'template';
}

/** Share of the plan that is done (0..1). */
export function doneShare(phases: BuildPhase[]): number {
  if (phases.length === 0) return 0;
  return phases.filter((p) => p.status === 'done').length / phases.length;
}
