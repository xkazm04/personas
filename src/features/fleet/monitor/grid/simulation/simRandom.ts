// simRandom — the simulated fleet's determinism, and its vocabulary.
//
// A mock board that reshuffles on every render is not a fixture, it is noise:
// two screenshots of the same state would differ, and a driver that asserts
// "the third tile of Aurora Ledger is failed" would be flaky by construction.
// Every generator in this folder draws from ONE seeded stream built here, so
// the same build always paints the same board — while still looking varied
// enough to exercise each component's real branches.
//
// The names are deliberately fictional and obviously so. A simulated fleet
// that borrowed the operator's real project names would be indistinguishable
// from live data in a screenshot, which is the one thing a simulation must
// never be.

/** Mulberry32 — 32 bits of state, uniform enough for fixtures, four lines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

/** An integer in `[min, max]`, both ends included. */
export function int(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick<T>(rand: Rand, xs: readonly T[]): T {
  // `xs` is always a non-empty literal in this folder; the `!` is that fact,
  // not an assumption about a value crossing a boundary.
  return xs[Math.floor(rand() * xs.length) % xs.length]!;
}

/** True with probability `p`. */
export function chance(rand: Rand, p: number): boolean {
  return rand() < p;
}

/** The board's shape, fixed by the brief: 20 projects, 3 agents in each. */
export const SIM_PROJECTS = 20;
export const SIM_AGENTS_PER_PROJECT = 3;
/** The usage strip is built for five plan slots (`UsageStripShell.PLAN_SLOTS`). */
export const SIM_PLANS = 5;

/** One seed per generator, so adding sessions never reshuffles the roster. */
export const SEED = {
  fleet: 0x5eed_1a7e,
  cards: 0x0b0a_2d15,
  sessions: 0x53_5510,
  plans: 0x91a5_0001,
  rail: 0x7a11_0005,
  bubbles: 0xbbb1_e500,
} as const;

/** Twenty fictional projects. One team and one `dev_project` per name. */
export const PROJECT_NAMES: readonly string[] = [
  'Aurora Ledger', 'Beacon Relay', 'Cinder Atlas', 'Driftwood', 'Ember Harbor',
  'Foundry Line', 'Glasshouse', 'Halcyon Deck', 'Ironwood', 'Juniper Mesh',
  'Kestrel Loop', 'Lantern Bay', 'Meridian', 'Northgate', 'Obsidian Trail',
  'Pinecrest', 'Quarry Road', 'Riverstone', 'Saltmarsh', 'Tidewater',
];

/**
 * The pool the three agents of each project are named from.
 *
 * A persona's name does NOT carry its project, and that is a real property of
 * this board rather than a shortening: the column header already says which
 * project a tile is in, so repeating it inside a 152px tile spends the name's
 * whole width restating the heading above it and truncates the part that
 * distinguishes one agent from another.
 *
 * Eleven names against a stride of three, so a project's three are always
 * distinct (consecutive indices) while the triple itself only repeats every
 * eleven projects — a board where every column reads the same three names
 * would hide any bug that swaps one tile for another.
 */
export const ROLE_NAMES: readonly string[] = [
  'Dev Clone', 'QA Guardian', 'Release Scout', 'Docs Keeper', 'Perf Warden',
  'Schema Smith', 'Triage Owl', 'Build Pilot', 'Security Sentry', 'Data Curator',
  'UX Critic',
];

/**
 * Team accent colours. Hex because that is what `persona_teams.color` holds in
 * SQLite and what `colorWithAlpha` is handed on the real path — these rows
 * imitate database rows, not a stylesheet, so a semantic token here would be
 * simulating something the backend never sends.
 */
export const TEAM_COLORS: readonly string[] = [
  '#7c9cf5', '#59c2a8', '#e0a33e', '#d9758f', '#8f7ce0',
  '#4fb0d9', '#c98a5b', '#6fbf73', '#b98cd6', '#5b9bd5',
];
