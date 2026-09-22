// Curator > Setup - which workspaces map a knowledge registry.
//
// The mapping is the operator's own wiring, made in Dev Tools > Workspaces, and
// it is also Curator's whole prerequisite. So this section only READS it: the
// one action it offers is the trip to where the wiring is done, because a
// second place to make the same link is a second place for it to drift.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BookOpen, Link2 } from 'lucide-react';

import { listWorkspaces } from '@/api/devTools/workspaces';
import {
  registryLinkSnapshot,
  subscribeRegistryLinks,
  type Registry,
} from '@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore';
import { arriveAtDevTools } from '@/features/plugins/pluginArrival';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import { useSystemStore } from '@/stores/systemStore';

interface MappedRow {
  workspace: DevWorkspace;
  registry: Registry;
}

/**
 * Last workspace list, kept module-scoped so a remount of this lazy route
 * paints warm instead of ghosting again. One slot, not a keyed cache: there is
 * one workspace list.
 */
let warmWorkspaces: DevWorkspace[] | null = null;

export function MappedRegistriesSection() {
  const { t, tx } = useTranslation();
  const links = useSyncExternalStore(
    subscribeRegistryLinks,
    registryLinkSnapshot,
    registryLinkSnapshot,
  );
  const [workspaces, setWorkspaces] = useState<DevWorkspace[] | null>(warmWorkspaces);
  // The trip to the wiring goes through the one arrival door that asks first,
  // and the affordance is only offered when that door would open: Dev Tools is
  // a plugin the operator can switch off, and a button into nothing is worse
  // than no button.
  const devToolsReachable = useSystemStore((s) => s.enabledPlugins.has('dev-tools'));

  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then((rows) => {
        warmWorkspaces = rows;
        if (!cancelled) setWorkspaces(rows);
      })
      .catch(silentCatch('curator_setup:listWorkspaces'));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<MappedRow[]>(() => {
    const out: MappedRow[] = [];
    for (const workspace of workspaces ?? []) {
      const registryId = links.workspaceRegistry[workspace.id];
      const registry = registryId ? links.registries[registryId] : undefined;
      if (registry) out.push({ workspace, registry });
    }
    return out;
  }, [workspaces, links]);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="typo-title">{t.companions.setup.curator_registry_title}</h3>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={t.companions.setup.curator_registry_empty}
          action={
            devToolsReachable
              ? {
                  label: t.companions.setup.curator_map_action,
                  onClick: () => {
                    arriveAtDevTools('workspaces');
                  },
                }
              : undefined
          }
        />
      ) : (
        <ul className="rounded-card border border-primary/10 divide-y divide-foreground/5">
          {rows.map(({ workspace, registry }) => (
            <li key={workspace.id} className="flex items-start gap-3 px-3 py-2.5">
              <BookOpen className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
              <div className="min-w-0">
                <div className="typo-body text-foreground truncate">
                  {tx(t.companions.setup.curator_registry_row, {
                    workspace: workspace.name,
                    registry: registry.fullName,
                  })}
                </div>
                <div className="typo-caption truncate">
                  <span className="opacity-80">{t.companions.setup.curator_registry_path}</span>
                  <span className="ml-1.5">{registry.clonePath}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
