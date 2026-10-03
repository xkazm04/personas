/**
 * The System Check model, shared by all three 2-layer prototypes (kit batch home-3).
 *
 * Status becomes a kit `Tone x Glyph` by MEANING, never by hue: the panel used to colour each
 * SECTION by a hardcoded palette step (`healthPanelConstants.ts` violet / sky / amber), which said
 * nothing about whether anything was wrong. A check's status is the only thing worth colouring, so
 * it is the only thing coloured, and the mapping is closed:
 *
 *   ok        success + solid    it works
 *   warn      warning + solid    it works, but not for long
 *   error     error   + solid    it does not work
 *   inactive  info    + hollow   nothing is there yet and that is YOUR move (Gate 5: setup and
 *                                "waiting on you" read info-blue, never a role colour); hollow,
 *                                because an unconfigured thing is an outline, not a filled one
 *   info      neutral + soft     a fact, with nothing to do about it
 *
 * The section rolls up to its worst, and the machine rolls up to four figures. `attention` is the
 * one predicate the surfaces filter on: error, warn and inactive are the operator's work; `ok` and
 * `info` are not.
 */
import type { HealthCheckItem } from '@/api/system/system';
import type { Glyph, Tone } from '@/features/shared/components/kit';
import type { Translations } from '@/i18n/generated/types';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

/** The six environments the panel checks, in the order the operator reads them. */
export const HEALTH_SECTION_IDS = ['local', 'environment', 'agents', 'cloud', 'account', 'subscriptions'] as const;
export type HealthSectionId = (typeof HEALTH_SECTION_IDS)[number];

export interface HealthMark {
  tone: Tone;
  glyph: Glyph;
  label: string;
}

const MARKS: Record<HealthCheckStatus, { tone: Tone; glyph: Glyph }> = {
  ok: { tone: 'success', glyph: 'solid' },
  warn: { tone: 'warning', glyph: 'solid' },
  error: { tone: 'error', glyph: 'solid' },
  inactive: { tone: 'info', glyph: 'hollow' },
  info: { tone: 'neutral', glyph: 'soft' },
};

/** What a status is called where a reader needs the word (a Mark's accessible name, a cell). */
export function statusWord(t: Translations, status: HealthCheckStatus): string {
  const s = t.system_health;
  switch (status) {
    case 'ok': return s.status_ok;
    case 'warn': return s.status_warn;
    case 'error': return s.status_error;
    case 'inactive': return s.status_inactive;
    default: return s.status_info;
  }
}

/** A check's status as the kit's Mark: tone and glyph by meaning, the word as its name. */
export function statusMark(t: Translations, status: HealthCheckStatus): HealthMark {
  return { ...MARKS[status], label: statusWord(t, status) };
}

/** Error first, then warning, then "your move", then a bare fact, then passing. */
const SEVERITY: Record<HealthCheckStatus, number> = { error: 4, warn: 3, inactive: 2, info: 1, ok: 0 };

/** True when this check is the operator's work: it is broken, ageing, or not set up yet. */
export function needsAttention(item: HealthCheckItem): boolean {
  return item.status === 'error' || item.status === 'warn' || item.status === 'inactive';
}

/** The worst status in a set; an empty set has nothing to say, so it reads as a fact. */
export function worstStatus(items: readonly HealthCheckItem[]): HealthCheckStatus {
  let worst: HealthCheckStatus = items.length ? 'ok' : 'info';
  for (const item of items) if (SEVERITY[item.status] > SEVERITY[worst]) worst = item.status;
  return worst;
}

/** Checks sorted worst-first, so a list truncated anywhere still shows the work. */
export function bySeverity(items: readonly HealthCheckItem[]): HealthCheckItem[] {
  return [...items].sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]);
}

export interface HealthTally {
  ok: number;
  warn: number;
  error: number;
  inactive: number;
  info: number;
  total: number;
  attention: number;
}

/** The machine as four figures plus the facts; the surfaces draw whichever they need. */
export function tally(items: readonly HealthCheckItem[]): HealthTally {
  const out: HealthTally = { ok: 0, warn: 0, error: 0, inactive: 0, info: 0, total: items.length, attention: 0 };
  for (const item of items) {
    out[item.status] += 1;
    if (needsAttention(item)) out.attention += 1;
  }
  return out;
}

/**
 * One unit per check, grouped by status so the strip reads worst-first. The quantum is always ONE
 * check (the counts here are tens, never thousands), so no `legend` is needed and nothing is drawn
 * for one (grow-2: "Hover only").
 */
export function statusSegments(items: readonly HealthCheckItem[]): Array<{ n: number; tone: Tone; glyph: Glyph }> {
  const t = tally(items);
  return ([
    ['error', t.error], ['warn', t.warn], ['inactive', t.inactive], ['info', t.info], ['ok', t.ok],
  ] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => ({ n, ...MARKS[status] }));
}

/** The six section names, from the catalog and never from the backend's English `label`. */
export function sectionLabel(t: Translations, id: string): string {
  const s = t.system_health;
  switch (id) {
    case 'local': return s.category_local;
    case 'environment': return s.category_environment;
    case 'agents': return s.category_agents;
    case 'cloud': return s.category_cloud;
    case 'account': return s.category_account;
    case 'subscriptions': return s.category_subscriptions;
    default: return id;
  }
}
