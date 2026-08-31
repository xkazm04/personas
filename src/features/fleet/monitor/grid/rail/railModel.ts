// railModel — ONE row shape for all three Activity rail tabs.
//
// The three tabs answer three different questions (what must I decide, what
// must I send, what just happened) from three unrelated data layers: the
// unified triage queue, `dev_tools_undispatched_ideas`, and the shared channel
// cache. Before this file each one arrived with its own component, its own
// vertical rhythm and its own idea of where a timestamp goes — three lists in
// one 320px column that looked like three different apps stacked.
//
// The fix is NOT a shared stylesheet. It is a shared MODEL: every source is
// adapted into `RailRow` here, and the presentation layer never learns which
// tab it is drawing. That is what makes "unify the styling" a one-place change
// instead of three parallel edits that drift on the next feature.
//
// Rules this file keeps:
//  1. React-free and store-free — adapters take their lookups as arguments, the
//     same contract `triageTypes` holds for the deck.
//  2. Labels arrive PRE-TRANSLATED. The model carries no i18n keys, so a
//     variant can resolve copy however it likes.
//  3. Tone is semantic (`TriageTone`), never a palette class. The class maps at
//     the bottom are the only place a colour is named, and they are the deck's
//     own (`DeckChips`) so a `danger` row is the same red on both surfaces.

import type { LucideIcon } from 'lucide-react';
import { Activity, AlertCircle, Bookmark, CheckCircle2, Inbox, MessageSquare } from 'lucide-react';
import type { TriageItem, TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import { KIND_META } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import type { Persona } from '@/lib/bindings/Persona';
import { AUTHOR_KIND_META, authorName, isAuthorKind } from '@/features/teams/sub_collab/collabRender';
import { resolveCompact } from '../../channels/MergedRow';
import type { TaggedItem } from '../../channels/types';
import { cleanName } from '../fleetGridModel';

export type { TriageTone };

/**
 * One row, whatever produced it.
 *
 * The field names are deliberately about MEANING, not about position: a variant
 * decides whether `kind` is a chip, a gutter column or a section header, and no
 * adapter has to be touched when that decision changes.
 */
export interface RailRow {
  /** Unique within its tab. */
  id: string;
  /** Semantic urgency/colour intent. Never a class. */
  tone: TriageTone;
  /** 2–3 character kind mark — the ledger variant's gutter column. */
  code: string;
  /** Full kind label, pre-translated — chips and section headers. */
  kind: string;
  icon: LucideIcon;
  /** The thing being read. Always present. */
  title: string;
  /** Who/where it came from — persona, project, team. */
  source: string | null;
  /** Sortable + renderable instant. ISO string or epoch ms. */
  at: string | number | null;
  /** The second line, when the row has one. Clamped by every variant. */
  body: string | null;
  /** Accent colour of the producing persona/team, for variants that tint. */
  accent: string | null;
  /** The persona that produced it, for variants that show a face. */
  persona: { icon: string | null; color: string | null } | null;
  /** True → the row has not been seen (Messages). */
  unread: boolean;
  /** True → the row carries a checkbox (Dispatch). */
  selectable: boolean;
  /**
   * True → the row can be accepted or rejected from the rail itself, without
   * opening anything. Only the triage queue qualifies: a dispatchable idea is
   * *selected* rather than decided, and a channel message is not a decision at
   * all. The row renders the two verdict buttons off this flag alone, so a
   * source that has no verdict cannot accidentally grow one.
   */
  decidable: boolean;
  /**
   * Whether `kind` may be PAINTED, or is carried for assistive tech only.
   *
   * The channel feed's kinds are the words "directive", "decision", "channel",
   * "memory · decision" — and at rail width they cost the row a chunk of its
   * title to restate what the icon and the tone already say. So channel rows
   * set this false: the kind still rides in `kind` for the screen reader and
   * the modal, and the eye reads it off the glyph. Triage and dispatch rows
   * keep it true, because "Idea" vs "Review" is not derivable from a colour a
   * reader has not been taught.
   */
  showKind: boolean;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------


/**
 * Markdown → the first ~200 characters of readable prose.
 *
 * NOT a parser and not trying to be: the rail shows one clamped line, so the
 * job is to remove the marks that read as noise at that size — fences, heading
 * hashes, list bullets, emphasis, link syntax — and collapse the whitespace.
 * Anything more (tables, nested quotes) degrades to its own text, which is the
 * right failure for a preview.
 */
function plainify(md: string | null | undefined): string | null {
  if (!md) return null;
  const flat = md
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code
    .replace(/`([^`]*)`/g, '$1')          // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links + images → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')    // heading hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, '')     // list bullets
    .replace(/^\s{0,3}>\s?/gm, '')         // block quotes
    .replace(/\*\*|__|\*|_/g, '')          // emphasis
    .replace(/\s+/g, ' ')
    .trim();
  return flat ? flat.slice(0, 200) : null;
}

/** A 3-letter gutter code per triage kind. Stable, ASCII, never translated —
 *  it is a column marker, not prose (the full label rides in `kind`). */
const TRIAGE_CODE: Record<string, string> = {
  review: 'REV', idea: 'IDE', practice: 'PRA',
  question: 'ASK', policy: 'POL', evolution: 'EVO', goal: 'GOA',
};

/** The triage queue — the Reviews tab. `kindLabel` is injected so this module
 *  never touches the translation proxy (rule 2). */
export function triageToRow(item: TriageItem, kindLabel: string): RailRow {
  const meta = KIND_META[item.kind];
  return {
    id: item.id,
    tone: meta.tone,
    code: TRIAGE_CODE[item.kind] ?? '···',
    kind: kindLabel,
    icon: meta.icon,
    title: item.title,
    source: item.source.label || null,
    at: item.createdAt,
    // `body` is MARKDOWN and can be kilobytes long. Two things have to happen
    // before it can be a meta line, and both are here rather than in three
    // variants: it is flattened to prose (a rail row that opens `## Summary` is
    // showing the reader the syntax instead of the sentence — measured live),
    // and it is bounded, so the clamp is not the only thing standing between a
    // 4KB string and the DOM.
    body: plainify(item.reasoning) || plainify(item.body) || null,
    accent: item.source.color ?? null,
    persona: null,
    unread: false,
    selectable: false,
    decidable: true,
    showKind: true,
  };
}

/** Accepted-but-never-dispatched ideas — the Dispatch tab. */
export function ideaToRow(row: UndispatchedIdea, kindLabel: string): RailRow {
  return {
    id: row.id,
    tone: 'accent',
    code: 'DSP',
    kind: kindLabel,
    icon: Inbox,
    title: row.title,
    source: row.projectName ?? null,
    at: row.acceptedAt,
    body: null,
    accent: null,
    persona: null,
    unread: false,
    selectable: true,
    decidable: false,
    showKind: true,
  };
}

/**
 * Channel items — the Messages tab.
 *
 * The projection is `resolveCompact`, the Timeline's own, so a step / event /
 * memory / directive / post reads identically wherever it appears. The tone is
 * derived from that projection's `alert` and `isError` flags rather than from
 * the item kind, because "a step failed" and "a step is held" are the only two
 * things in this feed that are urgent, and neither is a kind.
 *
 * THE ROW IS CONTENT-FIRST. `title` is the MESSAGE, not the author — what was
 * said is the thing being read, and the author is context for it. The previous
 * shape put the author on the title line and pushed the sentence into the muted
 * second line, which spent the row's most legible space on a name that repeats
 * down the whole column.
 */
export function channelToRow(
  tagged: TaggedItem,
  personaOf: (id: string) => Persona | undefined,
  lastSeenAt: string | null,
): RailRow {
  const { item, team } = tagged;
  const persona = item.personaId ? personaOf(item.personaId) : undefined;
  const { event, message, isError, alert } = resolveCompact(item);
  const meta = channelKindMeta(item, isError, alert);
  const author = cleanName(authorName(item, persona));
  return {
    id: `${team.teamId}:${item.id}`,
    tone: meta.tone,
    code: 'MSG',
    // Carried, never painted (see `showKind`): the glyph and the tone say this
    // on screen, and the word survives for assistive tech and the modal.
    kind: event,
    icon: meta.icon,
    title: message?.trim() || event,
    // Author AND team: the rail merges every project's channel, so a message
    // without its team is a quote with no room attached to it.
    source: [author, cleanName(team.teamName)].filter(Boolean).join(' · '),
    at: item.at,
    body: null,
    accent: team.teamColor,
    persona: persona ? { icon: persona.icon, color: persona.color } : null,
    // The channel slice's own definition, applied per row: newer than the
    // watermark and not written by the user (see `countUnread`).
    unread: item.kind !== 'directive' && (lastSeenAt === null || item.at > lastSeenAt),
    selectable: false,
    decidable: false,
    showKind: false,
  };
}

/**
 * Glyph + tone for one channel row — the two channels through which a row's
 * KIND reaches the reader now that the word is not printed.
 *
 * Urgency outranks authorship on purpose: a failed step is a failed step
 * whoever produced it, so `isError`/`alert` win the tone before the author kind
 * is consulted. The glyph still follows the voice, because "who is talking"
 * stays useful even when the news is bad.
 */
function channelKindMeta(
  item: TaggedItem['item'],
  isError: boolean,
  alert: boolean,
): { icon: LucideIcon; tone: TriageTone } {
  const tone: TriageTone = isError
    ? 'danger'
    : alert
      ? 'warning'
      : item.kind === 'directive' || item.kind === 'athena'
        ? 'accent'
        : item.kind === 'memory'
          ? 'success'
          : 'neutral';

  if (isError || alert) return { icon: AlertCircle, tone };
  if (isAuthorKind(item.kind)) return { icon: AUTHOR_KIND_META[item.kind].Icon, tone };
  switch (item.kind) {
    case 'memory':
      return { icon: Bookmark, tone };
    case 'event':
      return { icon: Activity, tone };
    case 'step':
      return { icon: CheckCircle2, tone };
    default:
      return { icon: MessageSquare, tone };
  }
}

// ---------------------------------------------------------------------------
// Tone → class. The deck's maps, re-exported rather than re-picked, so the two
// surfaces cannot disagree about what `danger` looks like.
// ---------------------------------------------------------------------------

export { TONE_TEXT, TONE_FILL, TONE_BORDER } from '@/features/agents/quick-answer/triage/deck/DeckChips';
