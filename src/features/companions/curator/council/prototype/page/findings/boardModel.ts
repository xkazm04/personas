// PROTOTYPE ROUND (spark council-readout, direction G - Findings board).
// What the board draws, derived once from the round on screen.
//
// A must-address line is a sentence; the board turns each one into a CARD
// that carries its own proof. Three shapes exist in the real data and each
// reads differently:
//   floor      - "robustness scored 0.4 below its floor of 0.5": the line that
//                stopped the round. Drawn first, with the member's bar.
//   finding    - "craft: Q#3 answered YES ..." matches one of that member's
//                findings (usually character for character, the title). The
//                card shows the finding's detail and the evidence whose file
//                the detail names.
//   unmeasured - "value is unmeasured: ...". Several members unmeasured for
//                the SAME reason are one card, not three copies of a sentence.
import type { Finding, EvidenceItem, Seat } from '../../../table/runModel';
import type { MustAddressItem } from '../../protoModel';

export type CardKind = 'floor' | 'finding' | 'unmeasured' | 'note';

export interface BoardCard {
  key: string;
  kind: CardKind;
  /** One member, or several for a merged unmeasured card. Empty for a line naming none. */
  members: string[];
  text: string;
  seat: Seat | null;
  finding: Finding | null;
  evidence: EvidenceItem[];
  /** The member's other high-severity findings no card already shows. */
  alsoHigh: Finding[];
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, med: 1, low: 2 };
const KIND_ORDER: Record<CardKind, number> = {
  floor: 0,
  finding: 1,
  note: 2,
  unmeasured: 3,
};

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

function fileOf(ref: string): string {
  const path = ref.replace(/:[\d,\s-]+$/, '');
  return path.split(/[\\/]/).pop() ?? path;
}

/** The evidence a finding's own prose points at: its file named in the detail. */
export function evidenceFor(finding: Finding, seat: Seat, cap = 6): EvidenceItem[] {
  const prose = `${finding.title} ${finding.detail}`;
  const hits = seat.evidence.filter((e) => {
    const file = fileOf(e.ref);
    return file.length > 3 && prose.includes(file);
  });
  // A ref whose exact line range is quoted in the prose first.
  hits.sort((a, b) => Number(prose.includes(b.ref)) - Number(prose.includes(a.ref)));
  return hits.slice(0, cap);
}

const FLOOR_LINE = /^([a-z]+)\s+scored\b/i;

export function buildCards(items: MustAddressItem[], seats: Seat[]): BoardCard[] {
  const byName = new Map(seats.map((s) => [s.name, s]));
  const cards: BoardCard[] = [];
  const unmeasured = new Map<string, BoardCard>();

  items.forEach((item, i) => {
    const floorMember = item.member ? null : FLOOR_LINE.exec(item.text)?.[1]?.toLowerCase();
    const memberName = item.member ?? floorMember ?? null;
    const seat = memberName ? (byName.get(memberName) ?? null) : null;
    const base = { key: `ma-${i}`, text: item.text, alsoHigh: [] as Finding[] };

    if (floorMember && seat) {
      cards.push({
        ...base,
        kind: 'floor',
        members: [seat.name],
        seat,
        finding: null,
        evidence: [],
      });
      return;
    }
    if (seat && seat.score == null) {
      const key = norm(item.text);
      const merged = unmeasured.get(key);
      if (merged) {
        merged.members.push(seat.name);
        return;
      }
      const card: BoardCard = {
        ...base,
        kind: 'unmeasured',
        members: [seat.name],
        seat,
        finding: null,
        evidence: [],
      };
      unmeasured.set(key, card);
      cards.push(card);
      return;
    }
    const match = matchFinding(item.text, seat ? [seat] : seats);
    if (match) {
      cards.push({
        ...base,
        kind: 'finding',
        members: [match.seat.name],
        seat: match.seat,
        finding: match.finding,
        evidence: evidenceFor(match.finding, match.seat),
      });
      return;
    }
    cards.push({
      ...base,
      kind: 'note',
      members: seat ? [seat.name] : [],
      seat,
      finding: null,
      evidence: [],
    });
  });

  cards.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (SEVERITY_ORDER[a.finding?.severity ?? 'low'] ?? 3) - (SEVERITY_ORDER[b.finding?.severity ?? 'low'] ?? 3),
  );

  // Each member's remaining high findings ride on that member's first card.
  const shown = new Set(cards.flatMap((c) => (c.finding ? [c.finding.id] : [])));
  const placed = new Set<string>();
  for (const card of cards) {
    const seat = card.seat;
    if (!seat || placed.has(seat.name)) continue;
    placed.add(seat.name);
    card.alsoHigh = seat.findings.filter((f) => f.severity === 'high' && !shown.has(f.id));
  }
  return cards;
}

/** A member's findings, severest first, without the ones a card already carries. */
export function memberFindings(seat: Seat, cards: BoardCard[]): Finding[] {
  const shown = new Set(cards.flatMap((c) => [...(c.finding ? [c.finding.id] : []), ...c.alsoHigh.map((f) => f.id)]));
  return seat.findings
    .filter((f) => !shown.has(f.id))
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
}

/**
 * When the council asks for little, the board does not stand half empty: the
 * severest findings no card carries come next, high then medium, heavier
 * members first. Low findings never fill; they wait behind the member chips.
 */
export function nextInLine(seats: Seat[], cards: BoardCard[], limit: number): { seat: Seat; finding: Finding }[] {
  if (limit <= 0) return [];
  return seats
    .flatMap((seat) => memberFindings(seat, cards).map((finding) => ({ seat, finding })))
    .filter(({ finding }) => finding.severity !== 'low')
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.finding.severity] ?? 3) - (SEVERITY_ORDER[b.finding.severity] ?? 3) ||
        b.seat.weight - a.seat.weight ||
        b.finding.recurrence - a.finding.recurrence,
    )
    .slice(0, limit);
}

export function severityCounts(findings: Finding[]): Record<'high' | 'med' | 'low', number> {
  const counts = { high: 0, med: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** The unmeasured reason a member's payload carries (not on `Seat`; read from the row). */
export function unmeasuredReasons(verdicts: { dimension: string; payloadJson: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of verdicts) {
    const root = parseObject(v.payloadJson);
    const reason = root?.unmeasuredReason;
    if (typeof reason === 'string' && reason.length > 0) out[v.dimension] = reason;
  }
  return out;
}

function parseObject(json: string): Record<string, unknown> | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    // An unreadable payload has no reason to show; the seat already reads NOT MEASURED.
    return null;
  }
  // Narrowed to a plain object on this line, so the record view below is safe.
  return root && typeof root === 'object' && !Array.isArray(root) ? (root as Record<string, unknown>) : null;
}

const MEMBER_LEAD = /^(Value|Craft|Rivalry|Robustness|Economics|Reversibility)\b/;

/**
 * The council's summary is one dense paragraph that walks the members in
 * turn ("Value 0.45 (med): ... Craft 0.45 ..."). Split at the sentence that
 * opens on a member's name, so the reading becomes a lede plus one short
 * paragraph per member - the same words, broken where the prose already
 * changes subject.
 */
export function splitReading(summary: string): { lede: string; parts: { member: string; text: string }[] } {
  const sentences = summary.split(/(?<=[.;:])\s+(?=[A-Z])/);
  const lede: string[] = [];
  const parts: { member: string; text: string }[] = [];
  for (const sentence of sentences) {
    const m = MEMBER_LEAD.exec(sentence);
    const last = parts[parts.length - 1];
    if (m?.[1]) {
      // The member's name heads the paragraph as a label; the prose need not repeat it.
      const rest = sentence.slice(m[0].length).replace(/^\s+(?:is\s+)?/, '');
      parts.push({ member: m[1].toLowerCase(), text: rest.charAt(0).toUpperCase() + rest.slice(1) });
    } else if (last) last.text = `${last.text} ${sentence}`;
    else lede.push(sentence);
  }
  return { lede: lede.join(' '), parts };
}
