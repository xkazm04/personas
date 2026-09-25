/**
 * THE NINE - a closed vocabulary.
 *
 * Six thin marks and three measures, in the scan's own weight order. Display
 * order is the weights' own for the six; the three that carry a value of their
 * own follow, because a range, a name and a clock each need room a 36px column
 * cannot give them.
 *
 * The channel IS the registry's `CuratorReasonCode`. Nothing here invents a
 * category: the map below is a rendering order over a typed enum, so a clause
 * the registry adds shows up as a missing channel rather than a silent drop.
 */
import type { CuratorReasonCode } from '@/lib/bindings/CuratorReasonCode';

export type ChannelId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ChannelSpec {
  readonly id: ChannelId;
  /** The mark. A glyph is a mark, not text: it carries no type role. */
  readonly glyph: string;
  readonly code: Exclude<CuratorReasonCode, 'none'>;
  /** Per-unit weight, as the registry's own scan scores it. */
  readonly weight: number;
  /** Whether the weight multiplies by the clause's leading count. */
  readonly multiplied: boolean;
  /** A thin icon-headed column, or a measure that carries its own value. */
  readonly group: 'mark' | 'measure';
}

export const CHANNELS: readonly ChannelSpec[] = [
  { id: 1, glyph: '⊗', code: 'citation_gone', weight: 6, multiplied: true, group: 'mark' },
  { id: 2, glyph: '▢', code: 'no_application', weight: 6, multiplied: false, group: 'mark' },
  { id: 3, glyph: '⧖', code: 'expired_application', weight: 5, multiplied: true, group: 'mark' },
  { id: 4, glyph: '▤', code: 'thin_techniques', weight: 4, multiplied: false, group: 'mark' },
  { id: 5, glyph: '◌', code: 'never_swept', weight: 3, multiplied: false, group: 'mark' },
  { id: 6, glyph: '∅', code: 'missing_use_when', weight: 2, multiplied: true, group: 'mark' },
  { id: 7, glyph: '≠', code: 'deviation', weight: 4, multiplied: true, group: 'measure' },
  { id: 8, glyph: '▮', code: 'single_stack', weight: 2, multiplied: false, group: 'measure' },
  { id: 9, glyph: '◷', code: 'at_risk_application', weight: 1, multiplied: true, group: 'measure' },
] as const;

export const CHANNEL_ORDER: readonly ChannelId[] = CHANNELS.map((c) => c.id);

/** The two channels consumers write. Where nobody reports, they are UNKNOWN. */
export const DEMAND_FED: readonly ChannelId[] = [1, 7];

const BY_CODE = new Map<CuratorReasonCode, ChannelSpec>(CHANNELS.map((c) => [c.code, c]));
const BY_ID = new Map<ChannelId, ChannelSpec>(CHANNELS.map((c) => [c.id, c]));

export function channelOfCode(code: CuratorReasonCode): ChannelSpec | null {
  return BY_CODE.get(code) ?? null;
}

export function channelSpec(id: ChannelId): ChannelSpec {
  const spec = BY_ID.get(id);
  // The map is built from CHANNELS itself and ChannelId is its own key type, so
  // this is unreachable; it throws rather than returning a stand-in, because a
  // stand-in channel would draw someone else's colour under someone else's glyph.
  if (!spec) throw new Error(`unknown blueprint channel ${String(id)}`);
  return spec;
}

/** `--cb-ch<n>`: this page's ramp across the app's five brand tokens. */
export function channelColour(id: ChannelId): string {
  return `var(--cb-ch${String(id)})`;
}
