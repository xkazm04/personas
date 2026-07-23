// FORGE — the Mastermind-native dimension glyph set (round 15).
//
// Design language, derived from a generated reference sheet then hand-authored
// as exact geometry (raster can't live in a zoomable SVG canvas, and only
// `currentColor` geometry can take the status ink):
//   • SOLID MASSES, not hairlines — lucide's 1.6px strokes go weedy when a cell
//     blows an icon up to 54px; filled silhouettes stay poster-bold at every band.
//   • FULL BLEED — glyphs occupy ~0–24 of the 24-unit box (lucide pads to ~2–22),
//     so the same cell reads ~15% larger.
//   • KNOCKOUTS, not overlays — interior detail is punched with `fillRule
//     evenodd`, so a glyph is one shape that works on any cell fill/theme.
//   • Linework, where a mass would read as a blob (pulse, cycle, gauge), runs at
//     2.4–3.6 stroke — heavy enough to belong to the same family.
import type { DimKey } from './types';

/** Circle as a path subpath — used for evenodd knockouts (holes). */
const hole = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

const S = 'currentColor';

/** One rack unit at top `t` — chassis with an LED and two vent slots punched
 *  out. Three SEPARATED units read as stacked hardware; three rows inside one
 *  box read as a bulleted list (caught in the first render pass). */
const rackUnit = (t: number) =>
  `M2.6 ${t}H21.4A1.8 1.8 0 0 1 23.2 ${t + 1.8}V${t + 4.4}A1.8 1.8 0 0 1 21.4 ${t + 6.2}H2.6A1.8 1.8 0 0 1 .8 ${t + 4.4}V${t + 1.8}A1.8 1.8 0 0 1 2.6 ${t}Z` +
  hole(5.2, t + 3.1, 1.25) +
  `M10.6 ${t + 2.2}H14.6a.9 .9 0 0 1 0 1.8H10.6a.9 .9 0 0 1 0-1.8Z` +
  `M16.4 ${t + 2.2}H20.4a.9 .9 0 0 1 0 1.8H16.4a.9 .9 0 0 1 0-1.8Z`;

export const FORGE_GLYPH: Record<DimKey, () => React.ReactNode> = {
  // Cylinder stack — silhouette with two curved seams punched out.
  db: () => (
    <path
      fillRule="evenodd"
      d={`M2 4.4A10 3.1 0 0 1 22 4.4L22 19.6A10 3.1 0 0 1 2 19.6Z
          M2 8.2A10 3.1 0 0 0 22 8.2L22 9.7A10 3.1 0 0 1 2 9.7Z
          M2 13.8A10 3.1 0 0 0 22 13.8L22 15.3A10 3.1 0 0 1 2 15.3Z`}
    />
  ),
  // Vitals monitor — heavy frame, pulse trace across it.
  monitoring: () => (
    <>
      <rect x="1.4" y="3.4" width="21.2" height="17.2" rx="4.2" fill="none" stroke={S} strokeWidth="2.8" />
      <path d="M5.2 12h2.6l2.1-4.6 3.1 9 2.1-4.4h3.7" fill="none" stroke={S} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Continuous integration — a 305° cycle closed by a solid arrowhead.
  ci: () => (
    <>
      <path d="M12 3.2A8.8 8.8 0 1 1 5 6.8" fill="none" stroke={S} strokeWidth="3" strokeLinecap="round" />
      <path d="M12 0 17.4 3.2 12 6.4Z" />
    </>
  ),
  // Flask — solid vessel, bubbles punched out.
  tests: () => (
    <path
      fillRule="evenodd"
      d={`M8.8 1.4H15.2V3.8H13.7V9.2L20.8 20.1A2.2 2.2 0 0 1 18.9 23.4H5.1A2.2 2.2 0 0 1 3.2 20.1L10.3 9.2V3.8H8.8Z
          ${hole(10.6, 17.6, 1.5)}${hole(14.6, 19.6, 1.15)}${hole(11.4, 21.2, 0.95)}`}
    />
  ),
  // Shield — check punched through the plate.
  security: () => (
    <path
      fillRule="evenodd"
      d={`M12 1.2 22.2 5.1V12.4C22.2 18.2 17.9 21.7 12 23.2 6.1 21.7 1.8 18.2 1.8 12.4V5.1Z
          M7 12.2 4.9 14.3 10.9 20.3 19.1 12.1 17 10 10.9 16.1Z`}
    />
  ),
  // Rack — three stacked chassis units, LEDs and vents punched out.
  hosting: () => <path fillRule="evenodd" d={rackUnit(1.2) + rackUnit(8.9) + rackUnit(16.6)} />,
  // Key — ring bow over a toothed shaft.
  auth: () => (
    <>
      <circle cx="12" cy="7.2" r="5.2" fill="none" stroke={S} strokeWidth="3.8" />
      <path d="M10 11.5h4v11.4h-4ZM14 15.4h5v2.8h-5ZM14 19.4h3.8v2.7H14Z" />
    </>
  ),
  // Agent — antenna, ears, punched face.
  agents: () => (
    <>
      <path d="M11.05.6h1.9v5.2h-1.9Z" />
      <circle cx="12" cy="1.7" r="1.9" />
      <path d="M.6 10.4h1.9v5H.6ZM21.5 10.4h1.9v5h-1.9Z" />
      <path
        fillRule="evenodd"
        d={`M5.6 5.4H18.4A3 3 0 0 1 21.4 8.4V19.2A3 3 0 0 1 18.4 22.2H5.6A3 3 0 0 1 2.6 19.2V8.4A3 3 0 0 1 5.6 5.4Z
            ${hole(9, 11.6, 2)}${hole(15, 11.6, 2)}
            M8.2 16.6H15.8a1.1 1.1 0 0 1 0 2.2H8.2a1.1 1.1 0 0 1 0-2.2Z`}
      />
    </>
  ),
  // Skills — wand with a four-point spark.
  skills: () => (
    <>
      <path d="M18.4.8Q19.2 4.8 23.2 5.6 19.2 6.4 18.4 10.4 17.6 6.4 13.6 5.6 17.6 4.8 18.4.8Z" />
      <path d="M1.3 20.3 3.7 22.7 15.9 10.5 13.5 8.1Z" />
      <path d="M20.4 15.4Q20.9 17.9 23.4 18.4 20.9 18.9 20.4 21.4 19.9 18.9 17.4 18.4 19.9 17.9 20.4 15.4Z" />
    </>
  ),
  // LLM — a model as its network: layered nodes and links.
  llm: () => (
    <>
      <path d="M4.6 5 19.4 9M4.6 12 19.4 9M4.6 12 19.4 17M4.6 19 19.4 17" fill="none" stroke={S} strokeWidth="1.7" />
      <circle cx="4.6" cy="5" r="3.1" />
      <circle cx="4.6" cy="12" r="3.1" />
      <circle cx="4.6" cy="19" r="3.1" />
      <circle cx="19.4" cy="9" r="3.1" />
      <circle cx="19.4" cy="17" r="3.1" />
    </>
  ),
  // KPI — gauge sweep, needle, hub.
  kpi: () => (
    <>
      <path d="M1.8 18.4A10.2 10.2 0 0 1 22.2 18.4" fill="none" stroke={S} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M12 18.4 18.8 10.6" fill="none" stroke={S} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="12" cy="18.4" r="2.9" />
    </>
  ),
  // Ideas — bulb with a punched filament, on its base rings.
  ideas: () => (
    <>
      <path
        fillRule="evenodd"
        d={`M12 1.2A7.6 7.6 0 0 1 16.4 15V17.2H7.6V15A7.6 7.6 0 0 1 12 1.2Z
            M8.8 8.6 10.2 8 12 11.6 13.8 8 15.2 8.6 12 14.4Z`}
      />
      <path d="M7.9 18.3h8.2v2H7.9ZM9 21.4h6v2H9Z" />
    </>
  ),
};
