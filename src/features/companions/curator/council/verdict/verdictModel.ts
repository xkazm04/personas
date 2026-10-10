// What the verdict card reads off the round on screen: the must-address
// lines, and the items they become.
//
// A must-address line is a sentence; the card turns each one into an ITEM
// and shows the two that matter most. Three shapes exist in the real data:
//   floor      - "robustness scored 0.4 below its floor of 0.5": the line that
//                stopped the round. Shown first.
//   finding    - "craft: Q#3 answered YES ..." matches one of that member's
//                findings (usually character for character, the title), so
//                it carries that finding's severity.
//   unmeasured - "value is unmeasured: ...". Several members unmeasured for
//                the SAME reason are one item, not three copies of a sentence.
import type { Finding, Seat } from '../table/runModel';

export interface MustAddressItem {
  /** The member that raised it, when the line names one ("craft: ..."). */
  member: string | null;
  text: string;
}

function parseArray(json: string): unknown[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    // A blob that will not parse holds no items; it never becomes a fabricated one.
    return [];
  }
}

const MEMBER_PREFIX = /^(value|craft|rivalry|robustness|economics|reversibility)\b\s*(?:is unmeasured)?\s*:\s*/i;

/** `must_address` lines are written "member: text"; the prefix becomes the member. */
export function parseMustAddress(json: string): MustAddressItem[] {
  return parseArray(json)
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((line) => {
      const m = MEMBER_PREFIX.exec(line);
      return m?.[1] ? { member: m[1].toLowerCase(), text: line.slice(m[0].length) } : { member: null, text: line };
    });
}

export type CardKind = 'floor' | 'finding' | 'unmeasured' | 'note';

export interface MustCard {
  key: string;
  kind: CardKind;
  /** One member, or several for a merged unmeasured item. Empty for a line naming none. */
  members: string[];
  text: string;
  finding: Finding | null;
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, med: 1, low: 2 };
const KIND_ORDER: Record<CardKind, number> = { floor: 0, finding: 1, note: 2, unmeasured: 3 };

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(' ')
      .filter((w) => w.length > 2),
  );
}

function overlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  wa.forEach((w) => {
    if (wb.has(w)) shared += 1;
  });
  return shared / Math.min(wa.size, wb.size);
}

/** The finding a must-address line was written from, when one fits closely enough. */
export function matchFinding(text: string, seats: Seat[]): { seat: Seat; finding: Finding } | null {
  const target = norm(text);
  let best: { seat: Seat; finding: Finding; score: number } | null = null;
  for (const seat of seats) {
    for (const finding of seat.findings) {
      const title = norm(finding.title);
      const score =
        title === target || title.includes(target) || target.includes(title) ? 2 : overlap(text, finding.title);
      if (score >= 0.6 && (!best || score > best.score)) best = { seat, finding, score };
    }
  }
  return best ? { seat: best.seat, finding: best.finding } : null;
}

const FLOOR_LINE = /^([a-z]+)\s+scored\b/i;

/** The must-address lines as items, the ones that matter most first. */
export function buildCards(items: MustAddressItem[], seats: Seat[]): MustCard[] {
  const byName = new Map(seats.map((s) => [s.name, s]));
  const cards: MustCard[] = [];
  const unmeasured = new Map<string, MustCard>();

  items.forEach((item, i) => {
    const floorMember = item.member ? null : FLOOR_LINE.exec(item.text)?.[1]?.toLowerCase();
    const memberName = item.member ?? floorMember ?? null;
    const seat = memberName ? (byName.get(memberName) ?? null) : null;
    const key = `ma-${i}`;

    if (floorMember && seat) {
      cards.push({ key, kind: 'floor', members: [seat.name], text: item.text, finding: null });
      return;
    }
    if (seat && seat.score == null) {
      const reason = norm(item.text);
      const merged = unmeasured.get(reason);
      if (merged) {
        merged.members.push(seat.name);
        return;
      }
      const card: MustCard = { key, kind: 'unmeasured', members: [seat.name], text: item.text, finding: null };
      unmeasured.set(reason, card);
      cards.push(card);
      return;
    }
    const match = matchFinding(item.text, seat ? [seat] : seats);
    if (match) {
      cards.push({ key, kind: 'finding', members: [match.seat.name], text: item.text, finding: match.finding });
      return;
    }
    cards.push({ key, kind: 'note', members: seat ? [seat.name] : [], text: item.text, finding: null });
  });

  return cards.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (SEVERITY_ORDER[a.finding?.severity ?? 'low'] ?? 3) - (SEVERITY_ORDER[b.finding?.severity ?? 'low'] ?? 3),
  );
}
