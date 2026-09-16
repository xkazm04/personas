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
import { Activity, Inbox, MessageSquare, Users } from 'lucide-react';
import type { TriageItem, TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import { KIND_META } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import type { Persona } from '@/lib/bindings/Persona';
import { authorName } from '@/features/teams/sub_collab/collabRender';
import { resolveCompact } from '../../channels/MergedRow';
import { cleanName } from '../fleetGridModel';
import type { MessageThread } from './messageThreads';

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
  /** How many unseen messages the row stands for (a Messages thread). */
  unreadCount?: number;
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
   * The label that OPENS a group, or null.
   *
   * No live feed sets it since the Messages tab became a thread list
   * (2026-09-16); the band stays a row capability rather than being ripped
   * out of the height authority.
   *
   * Non-null on the FIRST row of a run of rows sharing a project, and null
   * on every other row — including the rest of that same run. One field
   * rather than a `group` on every row plus a derived `isFirst`, because two
   * fields that must agree are two fields that can disagree, and the row is
   * the only thing that knows whether it is drawing a header.
   *
   * Set before paging, on the whole ordered list, so a page boundary falling
   * inside a group leaves the continuation rows correctly headerless — their
   * header is already on screen above them.
   */
  groupHeader: string | null;
  /**
   * Whether the row's instant is worth printing.
   *
   * False for reviews and dispatchable ideas, and that is a judgement about
   * what those queues ARE: they are backlogs, worked from the top, and
   * "3 days ago" on every line is a column of noise that pushes the title
   * into truncation without changing a single decision. A message feed is
   * the opposite — it is a chronology, and an undated one is unreadable.
   */
  showTime: boolean;
  /**
   * Whether this row's feed has a read watermark, so a row that is NOT
   * `unread` has genuinely been seen.
   *
   * Distinct from `!unread`, which is also what a review row reports — and a
   * review has not been "read", it simply has no such concept. Dimming those
   * would dim the entire Reviews tab to mean nothing at all.
   */
  tracksRead: boolean;
  /**
   * Whether `kind` may be PAINTED, or is carried for assistive tech only.
   *
   * The channel feed's kinds are the words "directive", "decision", "channel",
   * "memory · decision" — and at rail width they cost the row a chunk of its
   * title to restate what the icon and the tone already say. So channel rows
   * set this false: the kind still rides in `kind` for the screen reader and
   * the modal, and the eye reads it off the glyph.
   *
   * REVIEWS JOINED THEM (2026-09-01). The argument for keeping it true there
   * was that "Idea" vs "Review" is not derivable from a colour a reader has
   * not been taught — which was answering the wrong question, because the
   * kind is not carried by the colour, it is carried by the ICON on line 1,
   * which is `KIND_META[kind].icon` and is per-kind by construction. The word
   * was restating the glyph directly above it. Dispatch keeps it, and there
   * the word IS redundant with the tab name — left alone deliberately rather
   * than swept in, since nobody asked and it is one line to change.
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
    groupHeader: null,
    showTime: false,
    tracksRead: false,
    showKind: false,
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
    groupHeader: null,
    showTime: false,
    tracksRead: false,
    showKind: true,
  };
}

/**
 * One conversation thread — a row of the Messages tab.
 *
 * The grouping (who a message belongs to, what is unread) is
 * `messageThreads`'; this only projects a finished thread into the one row
 * shape. Line 1 is the COUNTERPART (persona, team, or the system), line 2 the
 * latest thing said, so the list reads like a messenger inbox: who, then what.
 *
 * `preview` is injected pre-translated (rule 2): it prefixes the author where
 * the thread has more than one voice, and marks the user's own last word.
 */
export function threadToRow(
  thread: MessageThread,
  personaOf: (id: string) => Persona | undefined,
  preview: (message: string, author: string | null, mine: boolean) => string,
): RailRow {
  const { item, team } = thread.latest;
  const { event, message, isError, alert } = resolveCompact(item);
  const text = message?.trim() || event;
  const persona = thread.personaId ? personaOf(thread.personaId) : undefined;
  // A persona thread has one voice (plus yours) and the system thread has no
  // author worth naming, so only team threads, and your own last word
  // anywhere, carry an author prefix.
  const mine = item.kind === 'directive';
  const author =
    !mine && thread.kind === 'team'
      ? cleanName(authorName(item, item.personaId ? personaOf(item.personaId) : undefined)) || null
      : null;
  return {
    id: thread.key,
    tone: isError ? 'danger' : alert ? 'warning' : 'neutral',
    code: 'THR',
    kind: event,
    icon: thread.kind === 'system' ? Activity : thread.kind === 'team' ? Users : MessageSquare,
    title: thread.name,
    // The room the latest line was said in. Not painted by the thread row;
    // carried for scoping and assistive tech.
    source: cleanName(team.teamName) || null,
    at: item.at,
    body: preview(text, author, mine),
    accent: thread.kind === 'team' ? team.teamColor : null,
    persona: persona ? { icon: persona.icon, color: persona.color } : null,
    unread: thread.unread > 0,
    unreadCount: thread.unread,
    selectable: false,
    decidable: false,
    groupHeader: null,
    showTime: true,
    tracksRead: true,
    showKind: false,
  };
}

// ---------------------------------------------------------------------------
// Tone → class. The deck's maps, re-exported rather than re-picked, so the two
// surfaces cannot disagree about what `danger` looks like.
// ---------------------------------------------------------------------------

export { TONE_TEXT, TONE_FILL, TONE_BORDER } from '@/features/agents/quick-answer/triage/deck/DeckChips';
