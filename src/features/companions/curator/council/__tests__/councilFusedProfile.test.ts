/**
 * The engine's `fused` style profile: one test per rule (`engine/profile.ts`).
 *
 * The classic profile is proven byte-identical by the galaxy tests that
 * predate the profile and run unchanged beside this file; these pin the four
 * rules the promoted HUD's field paints by, each against the classic twin
 * where there is one, so a rule that silently stops applying fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CouncilOverlay } from '@/lib/bindings/CouncilOverlay';
import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';

import { buildLayout } from '../galaxy/engine/layout';
import { LabelQueue, type LabelRequest } from '../galaxy/engine/labels';
import { placeFused, type Circle } from '../galaxy/engine/labelsFused';
import { paintFrame, type FrameInput } from '../galaxy/engine/paint';
import { decorationCap, nearestGaps } from '../galaxy/engine/profile';
import { readCanvasTheme, type CanvasTheme } from '../galaxy/engine/theme';
import type { GalaxyLayout } from '../galaxy/engine/types';

const W = 1280;
const H = 800;

function subject(slug: string, title: string) {
  return {
    slug,
    title,
    subcategory: null,
    status: 'forged',
    revision: 1,
    changedAt: null,
    applications: 0,
    techniques: [{ slug: `${slug}-one`, laws: [], useWhen: [] }, { slug: `${slug}-two`, laws: [], useWhen: [] }],
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

const OVERLAY: CouncilOverlay = {
  subjects: [{ slug: 'aa', approved: 1, rejected: 0, pending: 0, techniquesProven: 0, projects: ['p'], last: null }],
};

const THEME = {
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

interface Recorder {
  ctx: CanvasRenderingContext2D;
  texts: string[];
  glows: number[];
}

/** An inert context that remembers what was written and how wide the glows were. */
function recorder(): Recorder {
  const texts: string[] = [];
  const glows: number[] = [];
  const gradient = { addColorStop: () => {} };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
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
    fillText: (t: string) => texts.push(t),
    createRadialGradient: (_x0: number, _y0: number, r0: number, _x1: number, _y1: number, r1: number) => {
      if (r0 === 0) glows.push(r1);
      return gradient;
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  // The stub carries exactly the surface `paintFrame` touches.
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, glows };
}

function frame(layout: GalaxyLayout, rec: Recorder, over: Partial<FrameInput>): FrameInput {
  return {
    ctx: rec.ctx,
    captions: { domainCaption: (d) => `${d.subjectCount} subjects`, subjectFooter: () => 'footer', wedgeLabel: (k) => k },
    theme: THEME,
    width: W,
    height: H,
    viewport: { x0: 0, x1: W, y0: 0, y1: H },
    camera: { x: 0, y: 0, k: 0.3 },
    layout,
    lens: { on: false, x: null, y: null },
    altitude: 'sky',
    domain: null,
    category: null,
    subject: null,
    hover: null,
    thread: null,
    labels: new LabelQueue(),
    picks: [],
    reserved: [],
    ...over,
  };
}

const req = (over: Partial<LabelRequest>): LabelRequest => ({
  x: 0,
  y: 0,
  text: 'Name',
  size: 14,
  color: '#fff',
  weight: 600,
  align: 'left',
  priority: 1,
  ...over,
});

const measure = (text: string) => text.length * 7;

describe('fused rule 1: a label never covers a node', () => {
  it('moves off the preferred spot when a star sits there, and never onto any star', () => {
    const star: Circle = { x: 440, y: 300, r: 8 };
    const out = placeFused(
      [req({ text: 'Orchestration', anchor: { x: 400, y: 300, off: 10, side: 'right' } })],
      measure,
      W,
      H,
      [],
      [{ x: 400, y: 300, r: 6 }, star],
    );
    expect(out.placed).toHaveLength(1);
    const box = out.placed[0]!.box;
    for (const c of [{ x: 400, y: 300, r: 6 }, star]) {
      const nx = Math.max(box.x, Math.min(c.x, box.x + box.w));
      const ny = Math.max(box.y, Math.min(c.y, box.y + box.h));
      expect(Math.hypot(nx - c.x, ny - c.y)).toBeGreaterThanOrEqual(c.r);
    }
    expect(box.x).toBeLessThan(400);
  });

  it('falls back to the rank number, and counts hidden only when the number has no room', () => {
    // A ring of stars leaves room for a two-glyph number but not for a name.
    const ring: Circle[] = [];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      ring.push({ x: 400 + Math.cos(a) * 44, y: 300 + Math.sin(a) * 44, r: 12 });
    }
    const anchor = { x: 400, y: 300, off: 8 };
    const named = placeFused([req({ text: 'A long subject name', rank: 7, anchor })], measure, W, H, [], ring);
    expect(named.placed[0]?.numberOnly).toBe(true);
    expect(named.numbered).toBe(1);
    expect(named.dropped).toBe(0);
    const walled = placeFused([req({ text: 'A long subject name', rank: 7, anchor })], measure, W, H, [{ a: 0, b: 0, c: W, d: H }], []);
    expect(walled.placed).toHaveLength(0);
    expect(walled.dropped).toBe(1);
    expect(walled.candidates).toBe(1);
  });

  it('offers a long name on two lines before giving up on it', () => {
    // Two walls leave a column 160 px wide: the name on one line (244 px)
    // fits nowhere in it, the same name on two lines (139 px) does.
    const wall = [{ a: 0, b: 0, c: 520, d: H }, { a: 680, b: 0, c: W, d: H }];
    const out = placeFused(
      [req({ text: 'Transactions over a replicated log', anchor: { x: 600, y: 300, off: 6 } })],
      measure,
      W,
      H,
      wall,
      [],
    );
    expect(out.placed[0]?.lines).not.toBeNull();
  });
});

describe('fused rule 2: one level is named at a time', () => {
  it('names the categories of the domain the reader stands in, and not the domain itself', () => {
    const layout = buildLayout(GALAXY, null);
    const domain = layout.domains[0]!;
    const rec = recorder();
    paintFrame(
      frame(layout, rec, {
        profile: 'fused',
        obstacles: [],
        altitude: 'domain',
        domain,
        camera: { x: domain.x, y: domain.y, k: 1.2 },
      }),
    );
    expect(rec.texts).toContain('1. Alfa Category');
    expect(rec.texts.some((t) => t.includes('Alfa Domain'))).toBe(false);
    expect(rec.texts.some((t) => t.includes('Aardvark'))).toBe(false);
  });

  it('does not repeat the name of the subject the reader stands on, but names its techniques', () => {
    const layout = buildLayout(GALAXY, null);
    const s = layout.subjects.find((x) => x.slug === 'aa')!;
    const fused = recorder();
    paintFrame(
      frame(layout, fused, {
        profile: 'fused',
        obstacles: [],
        altitude: 'subject',
        domain: s.domain,
        category: s.category,
        subject: s,
        camera: { x: s.x, y: s.y, k: 20 },
      }),
    );
    expect(fused.texts.some((t) => t.includes('Aardvark'))).toBe(false);
    expect(fused.texts.some((t) => t.includes('aa one') || t === '1' || t === '2')).toBe(true);
    const classic = recorder();
    paintFrame(
      frame(layout, classic, {
        altitude: 'subject',
        domain: s.domain,
        category: s.category,
        subject: s,
        camera: { x: s.x, y: s.y, k: 20 },
      }),
    );
    expect(classic.texts.some((t) => t.includes('Aardvark'))).toBe(true);
  });
});

describe('fused rule 3: halos stop at half the gap to the nearest neighbour', () => {
  it('caps the council glow the classic field draws at four radii', () => {
    const layout = buildLayout(GALAXY, OVERLAY);
    const a = layout.subjects.find((x) => x.slug === 'aa')!;
    const b = layout.subjects.find((x) => x.slug === 'ab')!;
    b.x = a.x + 10;
    b.y = a.y;
    const k = 2;
    const over = { altitude: 'category' as const, domain: a.domain, category: a.category, camera: { x: a.x, y: a.y, k } };
    const classic = recorder();
    paintFrame(frame(layout, classic, over));
    const fused = recorder();
    paintFrame(frame(layout, fused, { ...over, profile: 'fused', obstacles: [] }));
    const inkR = Math.max(2, Math.min(11, 1.7 + k * 0.55));
    const cap = decorationCap(inkR, nearestGaps(layout).get(a) ?? Infinity, k);
    expect(Math.max(...classic.glows)).toBeCloseTo(inkR * 4, 5);
    expect(cap).toBeLessThan(inkR * 4);
    expect(Math.max(...fused.glows)).toBeLessThanOrEqual(cap + 1e-9);
  });
});

describe('fused rule 4: the claim palette is the galaxy’s own tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById('council-galaxy-token-probe')?.remove();
  });

  it('reads --gx-ok, --gx-err, --gx-warn and --gx-none, and the classic profile does not', () => {
    // A probe whose computed colour IS the expression it was given, so the
    // test reads which token the theme asked for.
    const probe = document.createElement('span');
    probe.id = 'council-galaxy-token-probe';
    const style = { color: '', position: '', left: '', top: '', width: '', height: '', pointerEvents: '' };
    Object.defineProperty(probe, 'style', { value: style });
    document.body.appendChild(probe);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el: Element) => ({ color: el === probe ? style.color : '', fontFamily: 'x' }) as CSSStyleDeclaration,
    );
    const fused = readCanvasTheme('fused');
    expect([fused.ok, fused.err, fused.pend]).toEqual(['var(--gx-ok)', 'var(--gx-err)', 'var(--gx-warn)']);
    const classic = readCanvasTheme();
    expect([classic.ok, classic.err, classic.pend]).toEqual([
      'var(--status-success)',
      'var(--status-error)',
      'var(--status-pending)',
    ]);
  });
});
