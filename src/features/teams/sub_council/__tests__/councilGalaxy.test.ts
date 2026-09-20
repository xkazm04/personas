// The pure half of the galaxy: layout ranks, the fit-to-set camera, the label
// occupancy pass, the pressure ramp and the one gate rule.
//
// These are the parts a screenshot cannot certify. The canvas itself is
// verified by comparing rendered shots against
// `docs/design/council-reference/shots/`.
import { describe, expect, it } from 'vitest';

import type { CouncilOverlay } from '@/lib/bindings/CouncilOverlay';
import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';

import { decidable, pressureRamp } from '../councilRules';
import { fitToSet, sameCamera, tweenCamera, type Viewport } from '../galaxy/engine/camera';
import { allocateLabels, MIN_LABEL_PX, type LabelRequest } from '../galaxy/engine/labels';
import { normaliseFixtureTitle } from '../galaxy/fixture';
import { buildLayout, markOf } from '../galaxy/engine/layout';
import { applyLens, LENS_M, LENS_R } from '../galaxy/engine/lens';

const VIEWPORT: Viewport = { x0: 0, x1: 1280, y0: 0, y1: 800 };

function technique(slug: string, laws: string[] = []) {
  return { slug, laws, useWhen: [] };
}

function subject(slug: string, title: string, subcategory: string | null = null) {
  return {
    slug,
    title,
    subcategory,
    status: 'forged',
    revision: 1,
    changedAt: null,
    applications: 0,
    techniques: [technique(`${slug}-b`), technique(`${slug}-a`)],
  };
}

const GALAXY: RegistryGalaxy = {
  registryRoot: '/tmp/registry',
  headSha: null,
  totals: { domains: 2, categories: 2, subjects: 4, techniques: 8, applications: 0, laws: 0 },
  domains: [
    {
      slug: 'zulu',
      title: 'Zulu Domain',
      laws: [],
      categories: [
        {
          id: 'zc',
          title: 'Zulu Category',
          subjects: [subject('zed', 'Zed'), subject('alpha', 'Alpha')],
        },
      ],
    },
    {
      slug: 'alfa',
      title: 'Alfa Domain',
      laws: [],
      categories: [
        {
          id: 'ac',
          title: 'Alfa Category',
          subjects: [subject('mike', 'Mike', 'second'), subject('bravo', 'Bravo', 'first')],
        },
      ],
    },
  ],
};

const OVERLAY: CouncilOverlay = {
  subjects: [
    { slug: 'alpha', approved: 1, rejected: 0, pending: 0, techniquesProven: 2, projects: ['p'], last: null },
    { slug: 'zed', approved: 0, rejected: 1, pending: 0, techniquesProven: 0, projects: ['p'], last: null },
  ],
};

describe('buildLayout', () => {
  const layout = buildLayout(GALAXY, OVERLAY);

  it('numbers domains 1..n in NAME order, not the order the reader gave them', () => {
    expect(layout.domains.map((d) => [d.rank, d.title])).toEqual([
      [1, 'Alfa Domain'],
      [2, 'Zulu Domain'],
    ]);
  });

  it('ranks subjects and techniques 1-based in name order inside their parent', () => {
    const zulu = layout.domains[1]!;
    const subjects = zulu.categories[0]!.subjects;
    expect(subjects.map((s) => [s.rank, s.title])).toEqual([
      [1, 'Alpha'],
      [2, 'Zed'],
    ]);
    expect(subjects[0]!.techniques.map((t) => [t.rank, t.slug])).toEqual([
      [1, 'alpha-a'],
      [2, 'alpha-b'],
    ]);
  });

  it('keeps every cluster clear of every other one', () => {
    for (let i = 0; i < layout.domains.length; i += 1) {
      for (let j = i + 1; j < layout.domains.length; j += 1) {
        const a = layout.domains[i]!;
        const b = layout.domains[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it('cuts a category into subcategory wedges A to Z, clockwise from twelve', () => {
    const alfa = layout.domains[0]!.categories[0]!;
    expect(alfa.wedges.map((w) => w.key)).toEqual(['first', 'second']);
    expect(alfa.wedges[0]!.a0).toBeCloseTo(-Math.PI / 2);
    expect(alfa.wedges[1]!.a1).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
  });

  it('carries the council mark onto the star and counts it on the cluster', () => {
    const zulu = layout.domains[1]!;
    expect(layout.bySlug.get('alpha')!.mark).toBe('approved');
    expect(layout.bySlug.get('zed')!.mark).toBe('rejected');
    expect(zulu.counts).toEqual({ none: 0, approved: 1, rejected: 1, pending: 0 });
  });

  it('treats a subject absent from the overlay as never councilled, not as zero', () => {
    expect(layout.bySlug.get('mike')!.mark).toBe('none');
    expect(layout.bySlug.get('mike')!.overlay).toBeNull();
    expect(markOf(null)).toBe('none');
    expect(markOf({ approved: 0, rejected: 0, pending: 0 })).toBe('none');
  });
});

describe('fitToSet — the council-focus camera', () => {
  it('frames the whole set, centred on it', () => {
    const camera = fitToSet(VIEWPORT, [
      { x: -100, y: -50 },
      { x: 300, y: 150 },
    ])!;
    expect(camera.x).toBeCloseTo(100);
    expect(camera.y).toBeCloseTo(50);
    // Every point must land inside the viewport at that scale.
    const halfW = (VIEWPORT.x1 - VIEWPORT.x0) / 2 / camera.k;
    expect(halfW).toBeGreaterThan(200);
  });

  it('returns null for an empty set rather than a camera pointing nowhere', () => {
    expect(fitToSet(VIEWPORT, [])).toBeNull();
  });

  it('zooms OUT for a wider set, never in', () => {
    const tight = fitToSet(VIEWPORT, [{ x: 0, y: 0 }, { x: 10, y: 10 }])!;
    const wide = fitToSet(VIEWPORT, [{ x: 0, y: 0 }, { x: 4000, y: 4000 }])!;
    expect(wide.k).toBeLessThan(tight.k);
  });
});

describe('tweenCamera', () => {
  it('interpolates scale in LOG space, so a long flight reads as one movement', () => {
    const half = tweenCamera({ x: 0, y: 0, k: 0.1 }, { x: 0, y: 0, k: 10 }, 0.5);
    expect(half.k).toBeCloseTo(1, 5);
  });

  it('lands exactly on the target, which is what Esc restoring a view depends on', () => {
    const target = { x: 12.5, y: -7.25, k: 3.5 };
    expect(sameCamera(tweenCamera({ x: 0, y: 0, k: 0.3 }, target, 1), target)).toBe(true);
  });
});

describe('allocateLabels — labels are an allocation, and it counts what it hid', () => {
  const measure = (text: string, size: number) => text.length * size * 0.5;
  const at = (x: number, y: number, text: string, priority = 5): LabelRequest => ({
    x,
    y,
    text,
    size: 15,
    color: '#fff',
    weight: 600,
    align: 'center',
    priority,
  });

  it('places the higher priority and drops the collision, counting it', () => {
    const { placed, dropped } = allocateLabels([at(100, 100, 'winner', 0), at(100, 100, 'loser', 5)], measure, 1280, 800);
    expect(placed.map((p) => p.text)).toEqual(['winner']);
    expect(dropped).toBe(1);
  });

  it('hidden is always candidates minus placed, for any N and K', () => {
    // Six candidates in view, stacked on three anchors: three can be placed.
    const requests = [
      at(200, 100, 'a', 0),
      at(200, 100, 'b', 1),
      at(600, 300, 'c', 0),
      at(600, 300, 'd', 1),
      at(900, 600, 'e', 0),
      at(900, 600, 'f', 1),
    ];
    const { placed, dropped, candidates } = allocateLabels(requests, measure, 1280, 800);
    expect(candidates).toBe(requests.length);
    expect(placed).toHaveLength(3);
    expect(dropped).toBe(candidates - placed.length);
  });

  it('never counts an off-stage candidate: the view could not have named it', () => {
    const { placed, dropped, candidates } = allocateLabels(
      [
        at(100, 100, 'visible', 0),
        at(100, 5000, 'far below'),
        at(-4000, 100, 'far left'),
        at(9000, 100, 'far right'),
        at(100, -900, 'far above'),
      ],
      measure,
      1280,
      800,
    );
    expect(placed.map((p) => p.text)).toEqual(['visible']);
    expect(candidates).toBe(1);
    expect(dropped).toBe(0);
  });

  it('reserves the chrome BEFORE placing, so a caption moves out from under a HUD card', () => {
    const card = { a: 0, b: 0, c: 400, d: 200 };
    const underTheCard = at(200, 100, 'under the card', 0);
    const clear = at(900, 600, 'in the open', 1);
    const { placed, dropped, candidates } = allocateLabels([underTheCard, clear], measure, 1280, 800, [card]);
    expect(placed.map((p) => p.text)).toEqual(['in the open']);
    expect(candidates).toBe(2);
    expect(dropped).toBe(1);
    // Without the reservation the same caption is placed, and painted behind
    // the card — which is the defect the reservation exists to remove.
    expect(allocateLabels([underTheCard, clear], measure, 1280, 800).placed).toHaveLength(2);
  });

  it('never renders below the type floor', () => {
    const { placed } = allocateLabels(
      [{ x: 100, y: 100, text: 'tiny', size: 9, color: '#fff', weight: 600, align: 'center', priority: 0 }],
      measure,
      1280,
      800,
    );
    expect(placed[0]!.size).toBe(MIN_LABEL_PX);
  });
});

describe('normaliseFixtureTitle — the fixture only', () => {
  it('upper-cases the initialisms the Rust reader upper-cases for real data', () => {
    expect(normaliseFixtureTitle('Llm Agent')).toBe('LLM Agent');
    expect(normaliseFixtureTitle('Ui Surfaces')).toBe('UI Surfaces');
    expect(normaliseFixtureTitle('Api And Sql')).toBe('API And SQL');
    expect(normaliseFixtureTitle('P2p Networking')).toBe('P2P Networking');
  });

  it('leaves every other word exactly as the fixture wrote it', () => {
    expect(normaliseFixtureTitle('Backend Platform')).toBe('Backend Platform');
    expect(normaliseFixtureTitle('Civic Source Adapters')).toBe('Civic Source Adapters');
  });
});

describe('the lens', () => {
  it('is the identity when it is off', () => {
    expect(applyLens({ on: false, x: 100, y: 100 }, 110, 100)).toEqual([110, 100, 1]);
  });

  it('never shrinks anything inside its circle', () => {
    for (let d = 1; d < LENS_R; d += 1) {
      const [, , m] = applyLens({ on: true, x: 0, y: 0 }, d, 0);
      expect(m).toBeGreaterThanOrEqual(1);
    }
  });

  it('magnifies the centre by LENS_M + 1', () => {
    const [, , m] = applyLens({ on: true, x: 0, y: 0 }, 0.001, 0);
    expect(m).toBeCloseTo(LENS_M + 1, 1);
  });

  it('leaves everything outside the circle alone', () => {
    expect(applyLens({ on: true, x: 0, y: 0 }, LENS_R + 1, 0)).toEqual([LENS_R + 1, 0, 1]);
  });
});

describe('pressureRamp', () => {
  it('names its denominator and leaves the unreached majority as its own stop', () => {
    const ramp = pressureRamp({ approved: 2, rejected: 1, pending: 1, none: 96 }, 100);
    expect(ramp.denominator).toBe(100);
    expect(ramp.approved).toBeCloseTo(0.02);
    expect(ramp.rejected).toBeCloseTo(0.01);
    expect(ramp.pending).toBeCloseTo(0.01);
    expect(ramp.notMeasured).toBeCloseTo(0.96);
    expect(ramp.approved + ramp.rejected + ramp.pending + ramp.notMeasured).toBeCloseTo(1);
  });

  it('reads a corpus no council has reached as fully not-measured, not as zero progress', () => {
    const ramp = pressureRamp({ approved: 0, rejected: 0, pending: 0, none: 471 }, 471);
    expect(ramp.notMeasured).toBe(1);
  });

  it('refuses to divide by an empty cluster', () => {
    expect(pressureRamp({ approved: 0, rejected: 0, pending: 0, none: 0 }, 0)).toEqual({
      denominator: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      notMeasured: 0,
    });
  });
});

describe('decidable — the one gate rule', () => {
  it('opens only for a ready MAJOR feature or a ready architecture subject', () => {
    expect(decidable({ state: 'ready', tier: 'major', kind: 'use_case' })).toBe(true);
    expect(decidable({ state: 'ready', tier: null, kind: 'architecture' })).toBe(true);
  });

  it('stays closed for a standard-tier machine pass and for every unready state', () => {
    expect(decidable({ state: 'ready', tier: 'standard', kind: 'use_case' })).toBe(false);
    expect(decidable({ state: 'machine_pass', tier: 'major', kind: 'use_case' })).toBe(false);
    for (const state of ['none', 'fail', 'incomplete', 'stalled', 'approved', 'approved_drifted', 'rejected']) {
      expect(decidable({ state, tier: 'major', kind: 'use_case' })).toBe(false);
    }
  });
});
