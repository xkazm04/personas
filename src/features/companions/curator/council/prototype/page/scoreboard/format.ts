// PROTOTYPE ROUND (spark council-readout). The Scoreboard's small readers - a
// deliberate copy of dossier/format.ts, so either direction consolidates alone:
// locale-bound number and date formatters, and the few shapes the contract
// leaves as prose or as a payload field the `Seat` does not carry.
import { useCallback } from 'react';

import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { formatCount } from '@/lib/utils/formatters';

import type { Finding } from '../../../table/runModel';

/** A 0..1 score as the council writes it: two decimals, in the reader's locale. */
export function useScore(): (value: number) => string {
  const { language } = useTranslation();
  return useCallback((value: number) => formatCount(value, { language, precision: 2 }), [language]);
}

export function useDate(): (iso: string) => string {
  const { language } = useTranslation();
  return useCallback(
    (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    },
    [language],
  );
}

export function memberName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const RANK: Record<Finding['severity'], number> = { high: 3, med: 2, low: 1 };

/** Severest first, then the ones the council keeps seeing. */
export function bySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.recurrence - a.recurrence);
}

/**
 * Why a member was not measured, from its payload. `parsePayload` drops this
 * field (the `Seat` has no slot for it), and a hatched bar with no reason is
 * exactly the "is it zero?" question the page must not leave open.
 */
export function unmeasuredReasons(detail: CouncilRunDetail | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of detail?.verdicts ?? []) {
    try {
      const root: unknown = JSON.parse(v.payloadJson);
      const reason = root && typeof root === 'object' ? (root as Record<string, unknown>).unmeasuredReason : null;
      if (typeof reason === 'string' && reason.trim()) out[v.dimension] = reason.trim();
    } catch (err) {
      // An unreadable payload has no reason to show; the bar still says NOT MEASURED.
      silentCatch('council:proto-unmeasured-reason')(err);
    }
  }
  return out;
}

export interface SummaryPart {
  member: string | null;
  text: string;
}

/**
 * The summary is one dense paragraph that walks the members in turn
 * ("... Value 0.45 (med): ... Craft 0.45 ..."). Breaking it where a member's
 * name opens a sentence turns 2,000 characters into paragraphs a reader can
 * skip between. A summary that never names a member stays one paragraph.
 */
export function splitSummary(summary: string, members: string[]): SummaryPart[] {
  if (!members.length) return [{ member: null, text: summary }];
  const names = members.map((m) => memberName(m)).join('|');
  const re = new RegExp(`(?<=[.;]\\s)(?=(${names})\\b)`, 'g');
  return summary
    .split(re)
    .filter((part) => part && !new RegExp(`^(${names})$`).test(part))
    .map((text) => {
      const m = new RegExp(`^(${names})\\b`).exec(text);
      return { member: m?.[1] ? m[1].toLowerCase() : null, text: text.trim() };
    });
}
