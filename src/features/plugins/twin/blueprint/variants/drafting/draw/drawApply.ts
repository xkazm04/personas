/**
 * Putting a plan onto the page (spark twin-portable-blueprint, round 2): the
 * schedule written onto the parts once per mount, the same plan as a loop,
 * and the guard that keeps the engine's own animation events away from React.
 */
import type { DrawPlan } from './drawPlan';
import { LOOP_LAST_START_SHARE, LOOP_MIN_CYCLE } from './drawTiming';

/**
 * Writes the plan onto the parts. `shift` is how long the drawing has already
 * been on screen: a part that appears after the first paint starts its own
 * animation then, so its delay is moved back by that much (a negative delay
 * lands it mid-draw or drawn). `onlyNew` keeps parts already planned as they
 * are, so nothing that has drawn is ever un-drawn by a later pass.
 */
export function applyPlan(plan: DrawPlan, shift: number, onlyNew: boolean): void {
  for (const it of plan.items) {
    if (onlyNew && it.el.hasAttribute('data-draw-at')) continue;
    it.el.setAttribute('data-draw-at', String(Math.round(it.at)));
    it.el.setAttribute('data-draw-for', String(Math.round(it.dur)));
    if (it.depth !== null) it.el.setAttribute('data-draw-depth', String(it.depth));
    it.el.style.setProperty('--draw-at', String(Math.round(it.at - shift)));
    it.el.style.setProperty('--draw-for', String(Math.round(it.dur)));
    if (it.kind === 'write') it.el.style.setProperty('--draw-letters', String(Math.max(1, it.letters)));
  }
}

/**
 * The same plan as a loop (`data-loop-at`, never matched by the one-shot
 * rules): one shared cycle, long enough that the last part starts before the
 * first one lifts, so each turn shows the whole plan drawn for a moment.
 * Returns the cycle in ms.
 */
export function applyLoop(plan: DrawPlan, root: HTMLElement): number {
  const last = plan.items.reduce((m, i) => Math.max(m, i.at), 0);
  const cycle = Math.max(LOOP_MIN_CYCLE, Math.ceil(last / LOOP_LAST_START_SHARE));
  root.style.setProperty('--draw-cycle', String(cycle));
  for (const it of plan.items) {
    it.el.setAttribute('data-loop-at', String(Math.round(it.at)));
    it.el.style.setProperty('--draw-at', String(Math.round(it.at)));
  }
  return cycle;
}

const ENGINE_EVENTS = ['animationstart', 'animationend', 'animationiteration', 'animationcancel'] as const;
function keepInside(e: Event) {
  if ('animationName' in e && typeof e.animationName === 'string' && e.animationName.startsWith('twd-draw-')) e.stopPropagation();
}

/**
 * Keeps the engine's own animation events from reaching React. React listens
 * for animation events at its root, in the capture phase and the bubble
 * phase, and would dispatch every one of these (two per part and per letter,
 * a couple of thousand on a rich sheet) to no listener: under 4x CPU
 * throttling that dispatch was most of each frame's script time. The guard
 * sits on the document in the capture phase, above React's root, and stops
 * only events of the engine's own keyframes (`twd-draw-*`); nothing listens
 * for those. Reference-counted per document: two drawings can be mounted at
 * once (the Detail page under the training overlay), and the DOM dedupes the
 * same listener, so the guard is added by the first drawing and removed only
 * when the last one unmounts.
 */
const installs = new WeakMap<Document, number>();

export function keepEngineEvents(doc: Document): () => void {
  const count = installs.get(doc) ?? 0;
  if (count === 0) for (const type of ENGINE_EVENTS) doc.addEventListener(type, keepInside, true);
  installs.set(doc, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (installs.get(doc) ?? 1) - 1;
    installs.set(doc, left);
    if (left === 0) for (const type of ENGINE_EVENTS) doc.removeEventListener(type, keepInside, true);
  };
}
