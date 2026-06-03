import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { severityRank } from './incidentTaxonomy';

/** Incidents for a single agent (or the no-agent bucket), with rollup metadata. */
export interface IncidentGroup {
  /** Stable key: `personaId` or the `__none__` sentinel for agent-less incidents. */
  key: string;
  personaName: string | null;
  incidents: AuditIncident[];
  /** Highest severity present in the group — drives header shape + sort order. */
  worstSeverity: string;
  count: number;
}

const NO_AGENT_KEY = '__none__';

/**
 * Group incidents by the agent they belong to so the inbox answers "which of my
 * agents needs me?" at a glance. Groups are ordered worst-severity-first, then
 * by volume, then name; the agent-less bucket always sorts last. Incident order
 * within a group is preserved (the backend already returns newest-first).
 */
export function groupIncidentsByAgent(
  incidents: AuditIncident[],
  oldestFirst = false,
): IncidentGroup[] {
  const map = new Map<string, IncidentGroup>();
  for (const inc of incidents) {
    const key = inc.personaId ?? NO_AGENT_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        personaName: inc.personaName ?? null,
        incidents: [],
        worstSeverity: inc.severity,
        count: 0,
      };
      map.set(key, group);
    }
    group.incidents.push(inc);
    group.count += 1;
    if (severityRank(inc.severity) > severityRank(group.worstSeverity)) {
      group.worstSeverity = inc.severity;
    }
  }

  // Order incidents within each group by recency (or oldest-first, to surface
  // incidents that have been waiting the longest).
  for (const group of map.values()) {
    group.incidents.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return oldestFirst ? da - db : db - da;
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.key === NO_AGENT_KEY) return 1;
    if (b.key === NO_AGENT_KEY) return -1;
    const bySeverity = severityRank(b.worstSeverity) - severityRank(a.worstSeverity);
    if (bySeverity !== 0) return bySeverity;
    if (b.count !== a.count) return b.count - a.count;
    return (a.personaName ?? '').localeCompare(b.personaName ?? '');
  });
}
