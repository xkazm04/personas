/**
 * Four clicks down, four Escapes back to the exact camera.
 *
 * This is the owner's fourth note pinned at the only place it can be pinned:
 * the real engine, driven by real `click` events at coordinates computed from
 * its own camera. A screenshot cannot say "a click descended"; a store test
 * cannot either, because the click logic lives in the engine and the engine
 * is deliberately not React.
 *
 * The canvas is a stub. Everything the painter asks a 2D context for is
 * answered with something inert, because what is under test is WHERE THE
 * PICKS LAND, not what colour they were. `measureText` is the one stub that
 * has to be plausible: the label pass allocates by box, and the current
 * node's own title becomes a CLICK TARGET once it is placed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';

import { GalaxyEngine } from '../galaxy/engine/GalaxyEngine';
import { buildLayout } from '../galaxy/engine/layout';
import { sameCamera } from '../galaxy/engine/camera';
import { CHILD_HIT_R } from '../galaxy/engine/paint';
import { applyLens, LENS_M, LENS_R } from '../galaxy/engine/lens';
import type { CameraState, CategoryNode, DomainNode, GalaxyFocus, SubjectNode } from '../galaxy/engine/types';
import type { CanvasTheme } from '../galaxy/engine/theme';

const W = 1280;
const H = 800;

function technique(slug: string) {
  return { slug, laws: [], useWhen: [] };
}

function subject(slug: string, title: string) {
  return {
    slug,
    title,
    subcategory: null,
    status: 'forged',
    revision: 1,
    changedAt: null,
    applications: 0,
    techniques: [technique(`${slug}-one`), technique(`${slug}-two`)],
  };
}

const GALAXY: RegistryGalaxy = {
  registryRoot: '/tmp/registry',
  headSha: null,
  totals: { domains: 2, categories: 2, subjects: 4, techniques: 8, applications: 0, laws: 0 },
  domains: [
    {
      slug: 'alfa',
      title: 'Alfa Domain',
      laws: [],
      categories: [{ id: 'ac', title: 'Alfa Category', subjects: [subject('aa', 'Aardvark'), subject('ab', 'Beaver')] }],
    },
    {
      slug: 'zulu',
      title: 'Zulu Domain',
      laws: [],
      categories: [{ id: 'zc', title: 'Zulu Category', subjects: [subject('za', 'Zebra'), subject('zb', 'Zorilla')] }],
    },
  ],
};

const THEME: CanvasTheme = {
  light: false,
  font: 'sans-serif',
  sky: '#000',
  ink1: '#fff',
  ink2: '#ccc',
  ink3: '#aaa',
  ink4: '#888',
  hair: '#222',
  hair2: '#333',
  dust: '#444',
  accent: '#0ff',
  purple: '#a0f',
  ok: '#0f0',
  err: '#f00',
  pend: '#ff0',
  uncouncilled: '#555',
  rimTrack: '#111',
  domainGlow: '#123',
  lensFill: '#0ff',
} as CanvasTheme;

/** Everything `paint.ts` asks of a context, answered inertly. */
function stubContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    fillRect: () => {},
    setLineDash: () => {},
    strokeText: () => {},
    fillText: () => {},
    createRadialGradient: () => gradient,
    // Roughly a proportional face at half an em per glyph. The label pass
    // only needs a width that grows with the text.
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  // The stub implements exactly the surface `paintFrame` touches; a full
  // CanvasRenderingContext2D is a hundred members this test never reaches.
  return ctx as unknown as CanvasRenderingContext2D;
}

interface Harness {
  engine: GalaxyEngine;
  canvas: HTMLCanvasElement;
  settle: () => void;
  focus: () => GalaxyFocus;
  pinned: () => { pinned: boolean } | null;
  /** Where the engine is currently drawing this world point. */
  screen: (p: { x: number; y: number }) => { x: number; y: number };
  clickAt: (p: { x: number; y: number }) => void;
}

function harness(): Harness {
  let clock = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame;
    nextFrame += 1;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal('performance', { now: () => clock });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );

  /** Run scheduled frames with the clock past any flight, so each lands. */
  const settle = () => {
    for (let i = 0; i < 40 && frames.size > 0; i += 1) {
      clock += 5000;
      const batch = [...frames.entries()];
      frames.clear();
      for (const [, cb] of batch) cb(clock);
    }
  };

  const canvas = document.createElement('canvas');
  canvas.getContext = (() => stubContext()) as HTMLCanvasElement['getContext'];
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  let focus: GalaxyFocus = { kind: 'none' };
  let pinned: { pinned: boolean } | null = null;
  const engine = new GalaxyEngine(
    {
      onFocusChange: (next) => {
        focus = next;
      },
      onHoverChange: () => {},
      onCounts: () => {},
      onPointerTarget: (target) => {
        pinned = target;
      },
    },
    {
      domainCaption: (d: DomainNode) => d.title,
      subjectFooter: (s: SubjectNode) => s.title,
      wedgeLabel: (key: string) => key,
    },
  );
  engine.mount(canvas);
  engine.setTheme(THEME);
  // The lens is ON by default and displaces whatever it is over. Parking the
  // pointer off-stage keeps the descent test about clicks; the lens gets its
  // own test below, where displacement is the point.
  engine.setLens(false);
  engine.setData(buildLayout(GALAXY, null));
  settle();

  const screen = (p: { x: number; y: number }) => {
    const camera: CameraState = engine.getCamera();
    return { x: (p.x - camera.x) * camera.k + W / 2, y: (p.y - camera.y) * camera.k + H / 2 };
  };

  const clickAt = (p: { x: number; y: number }) => {
    canvas.dispatchEvent(new MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true }));
    settle();
  };

  return { engine, canvas, settle, focus: () => focus, pinned: () => pinned, screen, clickAt };
}

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => {
  h.engine.destroy();
  vi.unstubAllGlobals();
});

describe('one click always uncovers the layer under what you clicked', () => {
  it('reaches a technique from the sky in four clicks, with no zoom gesture', () => {
    const domain = GALAXY.domains[0];
    expect(domain).toBeDefined();

    // 1 — the sky: a domain.
    h.clickAt(h.screen(node('alfa')));
    expect(h.focus()).toMatchObject({ kind: 'node', domainSlug: 'alfa', categoryId: null });

    // 2 — the domain: one of its categories.
    h.clickAt(h.screen(category('alfa', 'ac')));
    expect(h.focus()).toMatchObject({ domainSlug: 'alfa', categoryId: 'ac', subjectSlug: null });

    // 3 — the category: one of its subjects.
    h.clickAt(h.screen(subjectNode('alfa', 'ac', 'aa')));
    expect(h.focus()).toMatchObject({ domainSlug: 'alfa', categoryId: 'ac', subjectSlug: 'aa' });

    // 4 — the subject: one of its techniques. There is no layer under a
    // technique, so the click pins its card instead of flying anywhere.
    const tech = subjectNode('alfa', 'ac', 'aa').techniques[0];
    expect(tech).toBeDefined();
    h.clickAt(h.screen(tech!));
    expect(h.pinned()).toMatchObject({ pinned: true });
    expect(h.pinned()).toMatchObject({ node: { kind: 'technique' } });
    // and the focus did NOT move: a technique is not an altitude
    expect(h.focus()).toMatchObject({ subjectSlug: 'aa' });
  });

  it('four Escapes return to the EXACT camera the descent started from', () => {
    const before = h.engine.getCamera();

    h.clickAt(h.screen(node('alfa')));
    h.clickAt(h.screen(category('alfa', 'ac')));
    h.clickAt(h.screen(subjectNode('alfa', 'ac', 'aa')));
    const tech = subjectNode('alfa', 'ac', 'aa').techniques[0];
    h.clickAt(h.screen(tech!));
    expect(h.engine.getCamera()).not.toEqual(before);

    // one Escape per click: the card, then three layers
    expect(h.engine.climb()).toBe(true);
    expect(h.pinned()).toBeNull();
    expect(h.engine.climb()).toBe(true);
    h.settle();
    expect(h.engine.climb()).toBe(true);
    h.settle();
    expect(h.engine.climb()).toBe(true);
    h.settle();

    expect(sameCamera(h.engine.getCamera(), before)).toBe(true);
    expect(h.focus()).toEqual({ kind: 'none' });
  });

  it('clicking the title of the node you are standing in climbs out of it', () => {
    h.clickAt(h.screen(node('alfa')));
    h.clickAt(h.screen(category('alfa', 'ac')));
    const inCategory = h.engine.getCamera();
    const s = subjectNode('alfa', 'ac', 'aa');
    h.clickAt(h.screen(s));
    expect(h.focus()).toMatchObject({ subjectSlug: 'aa' });

    // The open subject's title sits above its disc and carries the climb.
    const centre = h.screen(s);
    const camera = h.engine.getCamera();
    const r = Math.max(2, Math.min(11, 1.7 + camera.k * 0.55));
    h.clickAt({ x: centre.x, y: centre.y - r * 2.9 - 4 });
    expect(h.focus()).toMatchObject({ subjectSlug: null, categoryId: 'ac' });
    expect(sameCamera(h.engine.getCamera(), inCategory)).toBe(true);
  });
});

describe('a child of the node you are standing on is always clickable', () => {
  it('offers at least a 24 px target however little ink it is drawn with', () => {
    // A technique is the smallest thing the field draws, and at subject
    // altitude it is a child. The engine accepts a click a full CHILD_HIT_R
    // away from where it is painted.
    h.clickAt(h.screen(node('alfa')));
    h.clickAt(h.screen(category('alfa', 'ac')));
    h.clickAt(h.screen(subjectNode('alfa', 'ac', 'aa')));

    const tech = subjectNode('alfa', 'ac', 'aa').techniques[1];
    expect(tech).toBeDefined();
    const at = h.screen(tech!);
    // Offset by just under the radius, on a diagonal, so this is a genuine
    // statement about the disc and not about its centre.
    const offset = (CHILD_HIT_R - 1) / Math.SQRT2;
    h.clickAt({ x: at.x + offset, y: at.y + offset });
    expect(h.pinned()).toMatchObject({ pinned: true });
  });

  it('CHILD_HIT_R is a radius, so the smallest target is 24 px across', () => {
    expect(CHILD_HIT_R * 2).toBeGreaterThanOrEqual(24);
  });
});

describe('the softened lens', () => {
  it('is half the manipulation it was, at every radius inside the circle', () => {
    expect(LENS_M).toBe(2.6);
    const former = 5.2;
    const lens = { on: true, x: 100, y: 100 };
    for (const d of [5, 10, 20, 30, 40, 49]) {
      const [x] = applyLens(lens, 100 + d, 100);
      const pushed = x - (100 + d);
      const t = d / LENS_R;
      const formerPushed = (100 + d * (((former + 1) * t) / (former * t + 1) / t)) - (100 + d);
      expect(Math.abs(pushed)).toBeLessThan(Math.abs(formerPushed));
    }
  });

  it('a star inside it is clickable WHERE IT IS DRAWN, not where it lives', () => {
    // Down to subject altitude, where a technique is the smallest thing on
    // screen and the lens displaces it further than its own hit radius - so
    // this distinguishes "the pick followed the ink" from "the target is
    // simply generous".
    h.clickAt(h.screen(node('alfa')));
    h.clickAt(h.screen(category('alfa', 'ac')));
    h.clickAt(h.screen(subjectNode('alfa', 'ac', 'aa')));
    const tech = subjectNode('alfa', 'ac', 'aa').techniques[1];
    expect(tech).toBeDefined();
    const home = h.screen(tech!);

    h.engine.setLens(true);
    const lensAt = { x: home.x - 20, y: home.y };
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: lensAt.x, clientY: lensAt.y, bubbles: true }));
    h.settle();

    const [lx, ly] = applyLens({ on: true, ...lensAt }, home.x, home.y);
    const pushed = Math.hypot(lx - home.x, ly - home.y);
    // The premise of the test: the displacement EXCEEDS the hit radius, so
    // the two positions cannot both be right.
    expect(pushed).toBeGreaterThan(CHILD_HIT_R);

    h.clickAt({ x: lx, y: ly });
    expect(h.pinned()).toMatchObject({ node: { slug: tech!.slug }, pinned: true });

    h.engine.climb();
    h.settle();
    expect(h.pinned()).toBeNull();

    // And the place it would be WITHOUT the lens is now empty of it.
    h.clickAt(home);
    const after = h.pinned() as { node: { slug: string } } | null;
    expect(after?.node.slug).not.toBe(tech!.slug);
  });
});

// ── fixture readers ────────────────────────────────────────────────────────
// The layout is rebuilt per lookup rather than cached, because `buildLayout`
// is pure and deterministic: the same galaxy always produces the same
// coordinates, which is exactly the property the descent test leans on.

function layout() {
  return buildLayout(GALAXY, null);
}

function node(slug: string): DomainNode {
  const d = layout().domains.find((x) => x.slug === slug);
  if (!d) throw new Error(`no domain ${slug}`);
  return d;
}

function category(domainSlug: string, id: string): CategoryNode {
  const c = node(domainSlug).categories.find((x) => x.id === id);
  if (!c) throw new Error(`no category ${id}`);
  return c;
}

function subjectNode(domainSlug: string, categoryId: string, slug: string): SubjectNode {
  const s = category(domainSlug, categoryId).subjects.find((x) => x.slug === slug);
  if (!s) throw new Error(`no subject ${slug}`);
  return s;
}
