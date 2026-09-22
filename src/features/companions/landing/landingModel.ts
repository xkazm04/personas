// Heartlight - what one companion column says, derived once from its status.
//
// Every word here comes from `companions.*`; every number comes from
// `CompanionDetailDto`, which OMITS a field it does not know, so a missing
// count is never drawn as 0. The four states come from `landingStateOf` and
// the destination from `landingTarget` - this file invents neither.
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';

import { landingStateOf } from '../status/landingState';
import { landingTarget } from '../status/landingTarget';
import type { CompanionId, CompanionStatusDto, CompanionsPage, LandingState } from '../types';

type CompanionStrings = Translations['companions'];

/**
 * The ring around a portrait's own light: what the companion HOLDS.
 * `ticks` is one mark per agent (lit ones are starred), `circle` is the
 * companion herself, `broken` is a prerequisite that is missing and `drawing`
 * is a companion who has not been met yet.
 */
export type RingSpec =
  | { kind: 'drawing' }
  | { kind: 'broken'; ticks: number; missing: 'star' | 'page' }
  | { kind: 'ticks'; total: number; lit: number }
  | { kind: 'circle' };

export interface CompanionColumnView {
  id: CompanionId;
  /** 1, 2, 3 - the key that focuses this column. */
  index: number;
  name: string;
  title: string;
  tagline: string;
  state: LandingState;
  stateWord: string;
  /** The one line that would wake a sleeping companion. Null while active. */
  blockerLine: string | null;
  /** A live fact about this companion, when the DTO carries one. */
  fact: string | null;
  openLine: string;
  /** The drawn quantity beside the ring. Null when nothing is known. */
  count: { value: string; label: string } | null;
  ring: RingSpec;
  /** Beads on the orbit: what waits for you. */
  beads: number;
  /** A slow turn means its loop is running. */
  working: boolean;
  portraitSrc: string;
  target: CompanionsPage;
  ariaLabel: string;
}

const NAME_KEY = { athena: 'group_athena', overseer: 'group_overseer', curator: 'group_curator' } as const;
const TITLE_KEY = { athena: 'athena_title', overseer: 'overseer_title', curator: 'curator_title' } as const;
const TAGLINE_KEY = { athena: 'athena_tagline', overseer: 'overseer_tagline', curator: 'curator_tagline' } as const;

/** The page a destination names, for the "Open X > Y" line. */
function pageLabel(page: CompanionsPage, c: CompanionStrings): string {
  if (page.endsWith(':setup')) return c.nav.page_setup;
  if (page === 'athena:create-athena') return c.nav.page_athena;
  if (page === 'overseer:reviews') return c.nav.page_overseer;
  return c.nav.page_council;
}

/**
 * The wake line: what a non-active companion is waiting for, in the chip's own
 * voice. `landing.wake_*` are short imperatives sized for the chip; the longer
 * `blocker.*` sentences belong to the Setup pages, where there is room to
 * explain rather than to point.
 */
function blockerOf(status: CompanionStatusDto, state: LandingState, c: CompanionStrings): string | null {
  if (state === 'active') return null;
  if (state === 'off') return c.landing.wake_off;
  if (state === 'needs_onboarding') return c.landing.wake_not_onboarded;
  if (status.blocker === 'no_starred_personas') return c.landing.wake_no_starred_personas;
  if (status.blocker === 'no_registry') return c.landing.wake_no_registry;
  return c.landing.wake_not_onboarded;
}

/**
 * The prose line above the action. Only Curator has one today: the DTO carries
 * a registry NAME and nothing else a sentence could be built from.
 */
function factOf(status: CompanionStatusDto, c: CompanionStrings): string | null {
  const name = status.detail.registryName;
  return name === undefined ? null : interpolate(c.landing.registry_fact, { name });
}

/**
 * The quantity beside the ring, and the sentence a screen reader hears for it.
 * Drawn only from fields the DTO actually carries: Athena's pending decisions
 * and Overseer's starred-of-total. Curator carries a registry NAME and no
 * count, so Curator draws none rather than inventing a zero.
 */
function countOf(
  status: CompanionStatusDto,
  c: CompanionStrings,
): { count: { value: string; label: string } | null; sentence: string } {
  const d = status.detail;
  if (status.id === 'athena' && d.pendingDecisions !== undefined) {
    return {
      count: { value: String(d.pendingDecisions), label: c.landing.decisions_label },
      sentence: interpolate(c.landing.decisions_waiting, { count: d.pendingDecisions }),
    };
  }
  // `agentsTotal` of 0 is a real reading, but "0/0 agents" says nothing: on a
  // fresh install there is no fleet to count yet, and the wake line already
  // says so. The prototype guards the same way.
  if (status.id === 'overseer' && d.starredCount !== undefined && (d.agentsTotal ?? 0) > 0) {
    return {
      count: { value: `${d.starredCount}/${d.agentsTotal}`, label: c.landing.agents_label },
      sentence: interpolate(c.landing.agents_watched, { count: d.starredCount }),
    };
  }
  return { count: null, sentence: '' };
}

/** The ring body: one tick per agent for Overseer, a circle for the rest. */
function ringOf(status: CompanionStatusDto, state: LandingState): RingSpec {
  const total = status.detail.agentsTotal;
  if (state === 'needs_onboarding') return { kind: 'drawing' };
  if (state === 'blocked') {
    return {
      kind: 'broken',
      ticks: status.id === 'overseer' && total !== undefined ? total : 0,
      missing: status.blocker === 'no_starred_personas' ? 'star' : 'page',
    };
  }
  if (status.id === 'overseer' && total !== undefined && total > 0) {
    return { kind: 'ticks', total, lit: status.detail.starredCount ?? 0 };
  }
  return { kind: 'circle' };
}

/** One column, fully worded. */
export function columnOf(status: CompanionStatusDto, index: number, c: CompanionStrings): CompanionColumnView {
  const state = landingStateOf(status);
  const name = c.nav[NAME_KEY[status.id]];
  const title = c.identity[TITLE_KEY[status.id]];
  const target = landingTarget(status);
  const openLine = `${interpolate(c.landing.open_hint, { name })} › ${pageLabel(target, c)}`;
  const blockerLine = blockerOf(status, state, c);
  const fact = factOf(status, c);
  const { count, sentence } = countOf(status, c);
  const stateWord = c.state[state];

  return {
    id: status.id,
    index: index + 1,
    name,
    title,
    tagline: c.identity[TAGLINE_KEY[status.id]],
    state,
    stateWord,
    blockerLine,
    fact,
    openLine,
    count,
    ring: ringOf(status, state),
    beads: state === 'active' && status.id === 'athena' ? (status.detail.pendingDecisions ?? 0) : 0,
    working: state === 'active',
    portraitSrc: `/companions/${status.id}/portrait.webp`,
    target,
    ariaLabel: [`${name}, ${title}.`, `${stateWord}.`, sentence, fact, blockerLine ?? openLine]
      .filter(Boolean)
      .join(' '),
  };
}

/** The three columns, in the category's order. */
export function columnsOf(companions: CompanionStatusDto[], c: CompanionStrings): CompanionColumnView[] {
  return companions.map((status, i) => columnOf(status, i, c));
}
