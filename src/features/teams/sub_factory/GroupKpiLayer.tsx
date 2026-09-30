// L3, composed from the kit: the group as a level-1 Section (FactoryHead: the
// Crumbs above it, doors back to the project and the portfolio, Add KPI),
// an active context filter as a pressable chip (press clears it), and the
// group's KPIs in the kit table. Variants no longer vary the table's bar or
// density: the kit row family has one of each.
import { useState } from 'react';

import { ChipRow, KitButton } from '@/features/shared/components/kit';
import { DOMAIN_LABEL, type MockGroup, type MockProject, type MockKpi } from './factoryModel';
import { FactoryHead } from './FactoryHead';
import { KpiTable } from './KpiTable';
import { AddKpiModal } from './AddKpiModal';
import { useFactoryWords } from './useFactoryWords';

export function GroupKpiLayer({ project, group, ed, contextFilter, setContextFilter, onOpenKpi, onToProjects, onToGroups }: {
  project: MockProject;
  group: MockGroup;
  ed: (k: MockKpi) => MockKpi;
  contextFilter: string | null;
  setContextFilter: (id: string | null) => void;
  onOpenKpi: (id: string) => void;
  onToProjects: () => void;
  onToGroups: () => void;
}) {
  const w = useFactoryWords();
  const [showAdd, setShowAdd] = useState(false);
  const rows = group.contexts
    .filter((c) => !contextFilter || c.id === contextFilter)
    .flatMap((c) => c.kpis.map((k) => ({ kpi: ed(k), contextName: c.name })));
  const fc = contextFilter ? group.contexts.find((c) => c.id === contextFilter) : null;

  // Synthetic group/context rows (project-level, ungrouped, group-level) carry
  // "__" composite ids that aren't real FKs; don't scope a new KPI to those.
  const realGroupId = group.id.includes('__') ? undefined : group.id;
  const realContextId = contextFilter && !contextFilter.includes('__') ? contextFilter : undefined;
  const scopeLabel = fc ? (realContextId ? fc.name : group.name) : group.name;

  return (
    <>
      <FactoryHead
        id="s-fac-group"
        trail={[{ label: w.factory }, { label: w.projects, onClick: onToProjects }, { label: project.name, onClick: onToGroups }]}
        title={group.name}
        count={rows.length}
        meta={DOMAIN_LABEL[group.domain]}
        extra={<KitButton onClick={() => setShowAdd(true)} testId="factory-add-kpi-btn">{w.t.kpis.add_kpi_for_context}</KitButton>}
      >
        {fc && (
          <ChipRow
            label={w.context}
            emptyLabel=""
            chips={[{ id: fc.id, label: fc.name, state: 'selected', onPress: () => setContextFilter(null) }]}
          />
        )}
        <KpiTable kpis={rows} onOpen={onOpenKpi} w={w} />
      </FactoryHead>

      {showAdd && (
        <AddKpiModal
          projectId={project.id}
          projectName={project.name}
          contextGroupId={realGroupId}
          contextId={realContextId ?? undefined}
          scopeLabel={scopeLabel}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  );
}
