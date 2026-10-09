// PROTOTYPE ROUND (spark council-readout). The ONE contract every panel and
// page variant draws from, so the variants differ in how they read and never
// in what they read.
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { decidable } from '../councilRules';
import { READ_FAILED } from './protoStore';
import { queueGroups } from '../bench/queueModel';
import { resolveRubric, type Rubric } from '../table/rubrics';
import { seatsOf, type Seat } from '../table/runModel';

/** The panel's three views of one list: waiting on you, passed by the machine, decided. */
export type QueueFilter = 'waiting' | 'machine' | 'decided';

const GROUP_OF: Record<QueueFilter, 'yours' | 'machine' | 'decided'> = {
  waiting: 'yours',
  machine: 'machine',
  decided: 'decided',
};

export interface PanelRow {
  subject: CouncilSubjectState;
  rubric: Rubric;
  /** Members in rubric order. Null while the latest round is still being read. */
  seats: Seat[] | null;
  /** Only lite rounds exist: readable, never decidable until a full council runs. */
  liteOnly: boolean;
  decidable: boolean;
  /** Items the council says must be addressed. Null while loading or when the read failed. */
  mustAddress: number | null;
  /** The latest round could not be read: `seats` and `mustAddress` stay null, never empty. */
  readFailed: boolean;
}

export function filterCounts(subjects: CouncilSubjectState[]): Record<QueueFilter, number> {
  const size = (key: string) => queueGroups(subjects).find((g) => g.key === key)?.rows.length ?? 0;
  return { waiting: size('yours'), machine: size('machine'), decided: size('decided') };
}

/**
 * The rows of one filter, in the bench's own order (hard failures, floor
 * hits, thinnest coverage, latest round, title), with each row's members
 * from the cached latest round.
 */
export function panelRows(
  subjects: CouncilSubjectState[],
  details: Record<string, CouncilRunDetail | typeof READ_FAILED>,
  filter: QueueFilter,
): PanelRow[] {
  const group = queueGroups(subjects).find((g) => g.key === GROUP_OF[filter]);
  return (group?.rows ?? []).map((subject) => {
    const entry = subject.latestRunId ? details[subject.latestRunId] : undefined;
    const readFailed = entry === READ_FAILED;
    // No run at all is a round with nothing in it; a failed read is NOT.
    const detail = entry === READ_FAILED ? undefined : entry;
    const settled = !subject.latestRunId || detail !== undefined;
    const { rubric } = resolveRubric(detail?.run.rubricVersion ?? null, subject.kind);
    return {
      subject,
      rubric,
      seats: settled ? seatsOf(detail?.run ?? null, subject.kind, detail?.verdicts ?? []) : null,
      liteOnly: subject.mode === 'lite',
      decidable: decidable(subject),
      mustAddress: detail ? parseMustAddress(detail.run.mustAddressJson).length : settled ? 0 : null,
      readFailed,
    };
  });
}

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

export interface HardFailure {
  code: string;
  detail: string;
}

export function parseHardFailures(json: string): HardFailure[] {
  return parseArray(json).flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    return [{ code: String(r.code ?? ''), detail: String(r.detail ?? '') }];
  });
}

export function parseSpannedPaths(json: string): string[] {
  return parseArray(json).filter((x): x is string => typeof x === 'string');
}

/** Where `scripts/council/render-report.mjs` writes the browser report of a run. */
export function reportHtmlPath(runDir: string): string {
  const sep = runDir.includes('\\') ? '\\' : '/';
  return `${runDir.replace(/[\\/]+$/, '')}${sep}report.html`;
}
