import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { severityRank } from './incidentTaxonomy';

/** Which dimension the inbox is currently grouped by. */
export type IncidentGroupMode = 'agent' | 'severity' | 'source' | 'none';

/** Incidents for a single group (agent / severity / source bucket), with rollup metadata. */
export interface IncidentGroup {
  /** Stable key: `personaId`/severity/sourceTable, or a sentinel for the no-agent / flat bucket. */
  key: string;
  /** Which dimension this group represents — lets the header pick the right label resolver. */
  mode: IncidentGroupMode;
  /** Persona name when grouping by agent; null for the no-agent bucket and non-agent modes. */
  personaName: string | null;
  /** Severity/source token resolved to a label in the header; null for agent/none modes. */
  labelToken: string | null;
  incidents: AuditIncident[];
  /** Highest severity present in the group — drives header shape + sort order. */
  worstSeverity: string;
  count: number;
}

const NO_AGENT_KEY = '__none__';
const FLAT_KEY = '__all__';

function bySort(oldestFirst: boolean) {
  return (a: AuditIncident, b: AuditIncident) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return oldestFirst ? da - db : db - da;
  };
}

function worstSeverityOf(incidents: AuditIncident[]): string {
  let worst = incidents[0]?.severity ?? 'low';
  for (const inc of incidents) {
    if (severityRank(inc.severity) > severityRank(worst)) worst = inc.severity;
  }
  return worst;
}

/** Resolve the (key, personaName, labelToken) tuple for an incident under a mode. */
function bucketFor(
  mode: Exclude<IncidentGroupMode, 'none'>,
  inc: AuditIncident,
): { key: string; personaName: string | null; labelToken: string | null } {
  switch (mode) {
    case 'agent':
      return { key: inc.personaId ?? NO_AGENT_KEY, personaName: inc.personaName ?? null, labelToken: null };
    case 'severity':
      return { key: inc.severity, personaName: null, labelToken: inc.severity };
    case 'source':
      return { key: inc.sourceTable, personaName: null, labelToken: inc.sourceTable };
  }
}

/**
 * Group incidents by the chosen dimension so the inbox can answer different
 * questions over the same data: "which agent needs me?" (agent), "what's most
 * urgent?" (severity), "what kind of thing is failing?" (source), or just a flat
 * recency list (none). Groups order worst-severity-first, then by volume; the
 * agent-less bucket always sorts last. Incident order within a group follows the
 * newest/oldest toggle.
 */
export function groupIncidents(
  incidents: AuditIncident[],
  mode: IncidentGroupMode = 'agent',
  oldestFirst = false,
): IncidentGroup[] {
  const sort = bySort(oldestFirst);

  // Flat mode: a single headerless group preserving the global recency order.
  if (mode === 'none') {
    if (incidents.length === 0) return [];
    const sorted = [...incidents].sort(sort);
    return [
      {
        key: FLAT_KEY,
        mode,
        personaName: null,
        labelToken: null,
        incidents: sorted,
        worstSeverity: worstSeverityOf(sorted),
        count: sorted.length,
      },
    ];
  }

  const map = new Map<string, IncidentGroup>();
  for (const inc of incidents) {
    const { key, personaName, labelToken } = bucketFor(mode, inc);
    let group = map.get(key);
    if (!group) {
      group = { key, mode, personaName, labelToken, incidents: [], worstSeverity: inc.severity, count: 0 };
      map.set(key, group);
    }
    group.incidents.push(inc);
    group.count += 1;
    if (severityRank(inc.severity) > severityRank(group.worstSeverity)) {
      group.worstSeverity = inc.severity;
    }
  }

  for (const group of map.values()) {
    group.incidents.sort(sort);
  }

  return Array.from(map.values()).sort((a, b) => {
    // The no-agent bucket always sinks to the bottom (agent mode only).
    if (a.key === NO_AGENT_KEY) return 1;
    if (b.key === NO_AGENT_KEY) return -1;
    const bySeverity = severityRank(b.worstSeverity) - severityRank(a.worstSeverity);
    if (bySeverity !== 0) return bySeverity;
    if (b.count !== a.count) return b.count - a.count;
    return (a.personaName ?? a.labelToken ?? '').localeCompare(b.personaName ?? b.labelToken ?? '');
  });
}

/** Back-compat wrapper for callers that only ever group by agent. */
export function groupIncidentsByAgent(incidents: AuditIncident[], oldestFirst = false): IncidentGroup[] {
  return groupIncidents(incidents, 'agent', oldestFirst);
}
