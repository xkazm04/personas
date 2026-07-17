/** cinemaShared — primitives shared by the two build-loading "cinema"
 *  layouts (`GlyphCinemaLayout`'s fullscreen crowd and
 *  `GlyphDialogueCinemaLayout`'s below-content reel).
 *
 *  Both variants cast a crowd of abstract persona silhouettes down to a
 *  small finalist pool, then crown a winner as the real persona identity
 *  streams in. The casting *choreography* differs enough between the two
 *  (different phase model, different fast-forward behavior) that it stays
 *  per-file — but the silhouette geometry/rendering, the palette, and the
 *  connector-name dedup used to be near-identical copies. Import from here
 *  instead so a fix (e.g. to the silhouette shape or the dedup rule) only
 *  has to be made once.
 */
import type { PersonaResolution } from "@/lib/types/buildTypes";

type PersonaResolutionConnector = NonNullable<PersonaResolution["connectors"]>[number];

/** Head/torso geometry per silhouette "form" — cycled across candidates so
 *  the crowd reads as varied individuals rather than clones. */
export const CINEMA_FORMS = [
  { hr: 7, hy: 12, tw: 14 },
  { hr: 6.4, hy: 11, tw: 12 },
  { hr: 7.6, hy: 13, tw: 16 },
  { hr: 6, hy: 11, tw: 13 },
  { hr: 8, hy: 13.5, tw: 15 },
] as const;

/** Candidate accent colors, cycled across the crowd. */
export const CINEMA_PALETTE = [
  "#60A5FA", "#818CF8", "#22D3EE", "#34D399", "#FBBF24",
  "#FB7185", "#2DD4BF", "#FB923C", "#A78BFA", "#F472B6",
];

/** A single abstract persona silhouette (head + shoulders), used for both
 *  crowd members and the crowned winner. */
export function CinemaSilhouette({
  form, color, size, dead, deadOpacity = 0.5,
}: {
  form: number; color: string; size: number; dead?: boolean; deadOpacity?: number;
}) {
  const f = CINEMA_FORMS[form] ?? CINEMA_FORMS[0]!;
  const c = dead ? "var(--muted-foreground)" : color;
  const shoulder = f.hy + f.hr;
  return (
    <svg viewBox="0 0 44 48" width={size} height={size} aria-hidden style={{ opacity: dead ? deadOpacity : 1 }}>
      <circle cx={22} cy={f.hy} r={f.hr} fill={c} />
      <path
        d={`M ${22 - f.tw} 48 C ${22 - f.tw} ${shoulder + 5}, ${22 - f.tw + 2} ${shoulder}, 22 ${shoulder} C ${22 + f.tw - 2} ${shoulder}, ${22 + f.tw} ${shoulder + 5}, ${22 + f.tw} 48 Z`}
        fill={c}
      />
    </svg>
  );
}

/** De-dupe a persona's resolved connectors down to a display name list
 *  (case-insensitive on service_type/name, first-seen order preserved). */
export function dedupeConnectorNames(
  connectors: readonly PersonaResolutionConnector[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of connectors ?? []) {
    const key = (c.service_type || c.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c.service_type || c.name);
  }
  return out;
}

/** Resolve the ordered list of resolved capability titles from the build
 *  store's capability map + order array. */
export function capabilityTitles(
  order: readonly string[],
  capabilities: Record<string, { title?: string } | undefined>,
): string[] {
  return order.map((id) => capabilities[id]?.title).filter((x): x is string => !!x);
}
