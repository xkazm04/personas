/**
 * bp's Morning deck as Personas reads it (spark roadmap S6, G6): bp's computed `MorningDeck` (wire morning-deck-1,
 * bp packages/core/src/companion/morning.ts), held to the fields the Monitor's Morning tab shows, and what a card lets
 * Personas do. bp builds the deck; Personas only reads it, and decides a decision card through its own
 * `lens_scan_decide` (into the store bp reads), never through bp's POST /api/companion/morning (bp's human path).
 *
 *   Approve        every decision card
 *   Decline        only when the card's brief recommends it (a repeat of a declined idea), with the brief's note
 *   Enter          the recommended answer (owner decision D14): Decline on a repeat, else Approve
 *   Defer / Hold   stay in bp (they write bp's steering log): a link opens the card there
 *
 * React-free.
 */
import { readFocusPlace, type FocusPlace } from '../../blueprint/model/focus';

export type CardKind = 'open' | 'agents' | 'built' | 'release' | 'quiet' | 'decision' | 'close';
export type Tone = 'good' | 'warn' | 'bad' | 'calm';
const KINDS: readonly CardKind[] = ['open', 'agents', 'built', 'release', 'quiet', 'decision', 'close'];
const TONES: readonly Tone[] = ['good', 'warn', 'bad', 'calm'];

export interface CardBriefView {
  lines: string[];
  short: string;
  advice: string;
  /** 'decline' only on a repeat of a declined idea; `note` is then what a Decline writes to the store. */
  recommend?: 'decline';
  note?: string;
}
export interface MorningCardView {
  id: string;
  kind: CardKind;
  product?: string;
  productName?: string;
  headline: string;
  lines: { text: string; tone?: Tone }[];
  tone: Tone;
  place?: FocusPlace;
  decision?: { proposal: string; tier?: number; steered?: string; brief?: CardBriefView };
  news?: true;
}
export interface MorningDeckView {
  since: string;
  until: string;
  cards: MorningCardView[];
  skipped: { product: string; why: string }[];
  news: number;
}

const str = (v: unknown): v is string => typeof v === 'string';
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function briefOf(v: unknown): CardBriefView | undefined {
  const b = rec(v);
  if (!b) return undefined;
  const lines = Array.isArray(b.lines) ? b.lines.filter(str) : [];
  return {
    lines,
    short: str(b.short) ? b.short : lines[0] ?? '',
    advice: str(rec(b.advice)?.say) ? (rec(b.advice)!.say as string) : '',
    ...(b.recommend === 'decline' && str(b.note) ? { recommend: 'decline' as const, note: b.note } : {}),
  };
}

function cardOf(v: unknown): MorningCardView | null {
  const c = rec(v);
  if (!c || !str(c.id) || !str(c.headline) || !KINDS.includes(c.kind as CardKind)) return null;
  const lines = Array.isArray(c.lines)
    ? c.lines.flatMap((l) => { const o = rec(l); return o && str(o.text) ? [{ text: o.text, ...(TONES.includes(o.tone as Tone) ? { tone: o.tone as Tone } : {}) }] : []; })
    : [];
  const place = c.place === undefined ? undefined : readFocusPlace(c.place);
  const d = rec(c.decision);
  const steered = rec(d?.steered);
  const brief = briefOf(d?.brief);
  return {
    id: c.id,
    kind: c.kind as CardKind,
    ...(str(c.product) ? { product: c.product } : {}),
    ...(str(c.productName) ? { productName: c.productName } : {}),
    headline: c.headline,
    lines,
    tone: TONES.includes(c.tone as Tone) ? (c.tone as Tone) : 'calm',
    ...(place && typeof place !== 'string' ? { place } : {}),
    ...(d && str(d.proposal)
      ? { decision: { proposal: d.proposal, ...(typeof d.tier === 'number' ? { tier: d.tier } : {}), ...(steered && str(steered.verdict) ? { steered: steered.verdict } : {}), ...(brief ? { brief } : {}) } }
      : {}),
    ...(c.news === true ? { news: true as const } : {}),
  };
}

/** bp's deck, or null when it is not one. A card that is not a card is left out, never guessed at. */
export function readMorningDeck(v: unknown): MorningDeckView | null {
  const o = rec(v);
  if (!o || !str(o.since) || !str(o.until) || !Array.isArray(o.cards)) return null;
  const skipped = Array.isArray(o.skipped) ? o.skipped.flatMap((s) => { const r = rec(s); return r && str(r.product) && str(r.why) ? [{ product: r.product, why: r.why }] : []; }) : [];
  const news = typeof rec(o.news)?.count === 'number' ? (rec(o.news)!.count as number) : 0;
  return { since: o.since, until: o.until, cards: o.cards.map(cardOf).filter((c): c is MorningCardView => c !== null), skipped, news };
}

/** A decision card still open to Personas: not steered in bp this morning (bp already keeps those marked). */
export const decidable = (c: MorningCardView): boolean => c.kind === 'decision' && !!c.decision && !c.decision.steered;
/** Decline is offered on a repeat only: the brief recommends it, with the note it writes. */
export const declinable = (c: MorningCardView): boolean => decidable(c) && c.decision?.brief?.recommend === 'decline';
/** The recommended answer (D14): Decline when the brief recommends it on a repeat, else Approve. */
export const recommended = (c: MorningCardView): 'approve' | 'decline' => (declinable(c) ? 'decline' : 'approve');

/** bp's own page at this card, where Defer and Hold live (they write bp's steering log). */
export function bpCardUrl(base: string, slug: string, cardId: string): string {
  const q = new URLSearchParams({ product: slug, morning: cardId });
  return `${base}/?${q.toString()}`;
}
