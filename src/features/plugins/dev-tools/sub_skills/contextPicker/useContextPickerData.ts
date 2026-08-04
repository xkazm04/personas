// Data spine for the full-page context picker (skill dispatch).
//
// One bounded fetch per open: context groups + contexts + THIS skill's
// per-context coverage (memory-ledger freshNodes/latestAt). Lens bundles are
// derived client-side from the generated match rules — no extra IPC.
import { useEffect, useMemo, useState } from 'react';

import {
  listContextGroups,
  listContexts,
  memorySkillContexts,
  type DevContextGroup,
} from '@/api/devTools/devTools';
import type { DevContext } from '@/lib/bindings/DevContext';
import { silentCatch } from '@/lib/silentCatch';

import { matchAgentsToContext } from '../../constants/presetSkills';

export interface PickerRow {
  id: string;
  name: string;
  /** Matched lens keys for this context (agent keys, best first). */
  lensKeys: string[];
  /** Fresh (30d) memory nodes this skill wrote for this context. */
  freshNodes: number;
  latestAt: string | null;
}

export interface PickerGroup {
  id: string;
  name: string;
  color: string;
  rows: PickerRow[];
}

export function useContextPickerData(projectId: string, skillName: string): {
  groups: PickerGroup[];
  loading: boolean;
  totalContexts: number;
} {
  const [groups, setGroups] = useState<DevContextGroup[]>([]);
  const [contexts, setContexts] = useState<DevContext[]>([]);
  const [coverage, setCoverage] = useState<Map<string, { freshNodes: number; latestAt: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      listContextGroups(projectId),
      listContexts(projectId),
      memorySkillContexts(projectId, skillName).catch((e) => {
        silentCatch('contextPicker coverage')(e);
        return [];
      }),
    ]).then(([g, ctx, cov]) => {
      if (!alive) return;
      setGroups(g);
      setContexts(ctx);
      setCoverage(new Map(cov.map((r) => [r.contextId, { freshNodes: r.freshNodes, latestAt: r.latestAt }])));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, skillName]);

  const pickerGroups = useMemo((): PickerGroup[] => {
    const toRow = (c: DevContext): PickerRow => ({
      id: c.id,
      name: c.name,
      lensKeys: matchAgentsToContext(c),
      freshNodes: coverage.get(c.id)?.freshNodes ?? 0,
      latestAt: coverage.get(c.id)?.latestAt ?? null,
    });
    const byGroup = new Map<string, PickerRow[]>();
    const orphans: PickerRow[] = [];
    for (const c of contexts) {
      const row = toRow(c);
      if (c.group_id) {
        const list = byGroup.get(c.group_id);
        if (list) list.push(row);
        else byGroup.set(c.group_id, [row]);
      } else {
        orphans.push(row);
      }
    }
    const out: PickerGroup[] = groups
      .filter((g) => (byGroup.get(g.id)?.length ?? 0) > 0)
      .map((g) => ({ id: g.id, name: g.name, color: g.color ?? 'amber', rows: byGroup.get(g.id)! }));
    if (orphans.length > 0) out.push({ id: '__ungrouped', name: '—', color: 'amber', rows: orphans });
    return out;
  }, [groups, contexts, coverage]);

  return { groups: pickerGroups, loading, totalContexts: contexts.length };
}

/** Query filter shared by both variants — name match, group survives if any row matches. */
export function filterPickerGroups(groups: PickerGroup[], query: string): PickerGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.name.toLowerCase().includes(q)) }))
    .filter((g) => g.rows.length > 0);
}
