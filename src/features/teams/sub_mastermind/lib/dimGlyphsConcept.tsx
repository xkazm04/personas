// CONCEPT — the third dimension glyph set. Forge restyled the SAME metaphors;
// this set re-asks what each dimension actually MEASURES and picks a new
// signifier for it. Same construction law as Forge (solid masses, full bleed,
// evenodd knockouts, currentColor), different vocabulary:
//
//   db        strata, not a cylinder — the signal is LAYERED, versioned data
//   monitoring eye, not a heart monitor — the level measured is observability
//   ci        merging branches, not a refresh loop — CI is INTEGRATION
//   tests     coverage grid, not a flask — a flask is research, tests are cover
//   security  scanned shield — the ladder is policy→scanning→supply-chain
//   hosting   cloud, not a server rack — hosts are Vercel/Fly/AWS, not steel
//   auth      ID badge, not a key — auth is IDENTITY; a key is a secret (vault)
//   agents    geared bolt, not a robot — the value is L1-L5 AUTOMATION, not "a
//             bot exists"
//   skills    puzzle piece, not a wand — skills are installable MODULES, and a
//             wand reads "generate with magic"
//   llm       flame, not a brain — the dimension is LLM COST, i.e. burn rate
//   kpi       target, not a gauge — a KPI is attainment against a goal
//   ideas     magnifier + spark, not a bulb — the value is scan freshness
import type { DimKey } from './types';

const S = 'currentColor';

/** Circle as a subpath — evenodd knockout. */
const hole = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

const f = (n: number) => n.toFixed(2);

/** n radial teeth around (12,12) — rects standing on the gear's pitch circle. */
function gearTeeth(n: number, r: number, w: number, h: number): string {
  let d = '';
  for (let k = 0; k < n; k++) {
    const a = (k * 2 * Math.PI) / n;
    const ux = Math.cos(a), uy = Math.sin(a);
    const vx = -uy, vy = ux;
    const cx = 12 + r * ux, cy = 12 + r * uy;
    const pt = (su: number, sv: number) =>
      `${f(cx + (h / 2) * su * ux + (w / 2) * sv * vx)} ${f(cy + (h / 2) * su * uy + (w / 2) * sv * vy)}`;
    d += `M${pt(-1, -1)}L${pt(1, -1)}L${pt(1, 1)}L${pt(-1, 1)}Z`;
  }
  return d;
}

/** 3×3 coverage matrix — `filled` cells solid, the rest hollow rings. */
function coverage(filled: Set<number>): string {
  const C = 6.2, G = 1.5, O = 1.2, R = 1.4;
  let d = '';
  for (let i = 0; i < 9; i++) {
    const x = O + (i % 3) * (C + G), y = O + Math.floor(i / 3) * (C + G);
    d += `M${x + R} ${y}h${C - R * 2}a${R} ${R} 0 0 1 ${R} ${R}v${C - R * 2}a${R} ${R} 0 0 1 ${-R} ${R}h${-(C - R * 2)}a${R} ${R} 0 0 1 ${-R} ${-R}v${-(C - R * 2)}a${R} ${R} 0 0 1 ${R} ${-R}Z`;
    if (!filled.has(i)) {
      // inset ring — the cell reads as uncovered
      const ix = x + 1.6, iy = y + 1.6, IC = C - 3.2, IR = 0.7;
      d += `M${ix + IR} ${iy}h${IC - IR * 2}a${IR} ${IR} 0 0 1 ${IR} ${IR}v${IC - IR * 2}a${IR} ${IR} 0 0 1 ${-IR} ${IR}h${-(IC - IR * 2)}a${IR} ${IR} 0 0 1 ${-IR} ${-IR}v${-(IC - IR * 2)}a${IR} ${IR} 0 0 1 ${IR} ${-IR}Z`;
    }
  }
  return d;
}

/** One data plate at top `t` — a rounded parallelogram seen in perspective. */
const PLATE = (t: number) =>
  `M7 ${t}H21.4a1.6 1.6 0 0 1 1.25 2.6l-2.2 2.8a1.6 1.6 0 0 1-1.25.6H4.6a1.6 1.6 0 0 1-1.25-2.6l2.2-2.8A1.6 1.6 0 0 1 7 ${t}Z`;

const GEAR = gearTeeth(8, 8.6, 3.6, 3.8);
const COVER = coverage(new Set([0, 1, 3, 5, 6, 7]));

export const CONCEPT_GLYPH: Record<DimKey, () => React.ReactNode> = {
  // Strata — layered, versioned data at rest. Rounded plates in perspective;
  // sharp bars at this size read as a menu, not as layers.
  db: () => <path d={PLATE(1.8) + PLATE(9.2) + PLATE(16.6)} />,
  // Eye — observability: can we see what this project is doing?
  monitoring: () => (
    <>
      <path fillRule="evenodd" d={`M.8 12Q6 4.6 12 4.6T23.2 12Q18 19.4 12 19.4T.8 12Z${hole(12, 12, 4.3)}`} />
      <circle cx="12" cy="12" r="2.2" />
    </>
  ),
  // Merge — two branches integrating into one trunk.
  ci: () => (
    <>
      <path d="M4.2 5.4H8.4C12.4 5.4 12.4 12 16.2 12H19.4M4.2 18.6H8.4C12.4 18.6 12.4 12 16.2 12H19.4" fill="none" stroke={S} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="4" cy="5.4" r="2.8" />
      <circle cx="4" cy="18.6" r="2.8" />
      <circle cx="19.8" cy="12" r="3.4" />
    </>
  ),
  // Coverage matrix — how much of the surface is actually covered.
  tests: () => <path fillRule="evenodd" d={COVER} />,
  // Shield under a scan band — the ladder is policy → scanning → supply-chain.
  security: () => (
    <path
      fillRule="evenodd"
      d={`M12 1.2 22.2 5.1V12.4C22.2 18.2 17.9 21.7 12 23.2 6.1 21.7 1.8 18.2 1.8 12.4V5.1Z
          M3.6 10.9h16.8v2.7H3.6Z`}
    />
  ),
  // Cloud on a platform — modern hosting is a provider, not a rack.
  hosting: () => (
    <>
      <circle cx="8.1" cy="12.4" r="5" />
      <circle cx="15.4" cy="11.2" r="6.2" />
      <circle cx="19.2" cy="15.2" r="3.6" />
      <path d="M6 13.6h13.2v5.6H6Z" />
      <path d="M4.6 21h14.8a1.2 1.2 0 0 1 0 2.4H4.6a1.2 1.2 0 0 1 0-2.4Z" />
    </>
  ),
  // ID badge — auth is identity; a key would say "secret" (that is the vault).
  auth: () => (
    <path
      fillRule="evenodd"
      d={`M5.4 1.4H18.6A2.8 2.8 0 0 1 21.4 4.2V19.8A2.8 2.8 0 0 1 18.6 22.6H5.4A2.8 2.8 0 0 1 2.6 19.8V4.2A2.8 2.8 0 0 1 5.4 1.4Z
          M9.6 4.2h4.8a1 1 0 0 1 0 2H9.6a1 1 0 0 1 0-2Z
          ${hole(12, 11.4, 3.1)}
          M6.3 19.4A5.7 5.7 0 0 1 17.7 19.4Z`}
    />
  ),
  // Geared bolt — the measure is how much runs itself (L1 → L5).
  agents: () => (
    <>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="6.4" fill="none" stroke={S} strokeWidth="3.4" />
      <path d="M13.1 6.9 8.9 12.9h2.8l-.8 4.2 4.2-6h-2.8Z" />
    </>
  ),
  // Puzzle piece — a skill is an installable module that clicks in. The knob
  // must break the silhouette or the piece reads as a rounded square.
  skills: () => <path d="M2.4 5H8.9a3.1 3.1 0 0 1 6.2 0H21.6V11a3.1 3.1 0 0 0 0 6.2V22.6H2.4Z" />,
  // Flame — LLM cost is burn rate.
  llm: () => (
    <path d="M12 1.4C15.8 6.2 20.4 8.4 20.4 14.2A8.4 8.4 0 0 1 3.6 14.2C3.6 10.4 6 8 8.2 5.2 8.2 8.4 9.8 9.9 11.1 10.1 12.8 10.3 13.4 6.6 12 1.4Z" />
  ),
  // Target — a KPI is attainment against a goal, not a speed.
  kpi: () => (
    <>
      <circle cx="12" cy="12" r="9.2" fill="none" stroke={S} strokeWidth="2.8" />
      <circle cx="12" cy="12" r="4.9" fill="none" stroke={S} strokeWidth="2.6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M20.6 3.4 13.4 10.6" fill="none" stroke={S} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17.6 2.2 22.6 1.4 21.8 6.4Z" />
    </>
  ),
  // Magnifier with a spark — the dimension is idea-scan freshness.
  ideas: () => (
    <>
      <circle cx="10" cy="10" r="7" fill="none" stroke={S} strokeWidth="3" />
      <path d="M15.6 15.6 21.8 21.8" fill="none" stroke={S} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M10 5.4Q10.6 9.4 14.6 10 10.6 10.6 10 14.6 9.4 10.6 5.4 10 9.4 9.4 10 5.4Z" />
    </>
  ),
};
