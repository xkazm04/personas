// Shared L3 chrome: breadcrumb + group header (+ optional context filter chip) +
// the KpiTable. Variants reuse this and only vary the table's bar/density, so
// the "aggregate a group's KPIs in a table" behaviour stays identical.
import { useState } from 'react';
import { Plus } from 'lucide-react';

import { DOMAIN_LABEL, type MockGroup, type MockProject, type MockKpi } from './factoryMock';
import { Breadcrumb } from './factoryPrimitives';
import { KpiTable } from './KpiTable';
import { AddKpiModal } from './AddKpiModal';

export function GroupKpiLayer({
  project,
  group,
  ed,
  contextFilter,
  setContextFilter,
  onOpenKpi,
  onToProjects,
  onToGroups,
  bar = 'bar',
  density = 'comfortable',
}: {
  project: MockProject;
  group: MockGroup;
  ed: (k: MockKpi) => MockKpi;
  contextFilter: string | null;
  setContextFilter: (id: string | null) => void;
  onOpenKpi: (id: string) => void;
  onToProjects: () => void;
  onToGroups: () => void;
  bar?: 'bar' | 'segments' | 'meter';
  density?: 'compact' | 'comfortable' | 'spacious';
}) {
  const [showAdd, setShowAdd] = useState(false);
  const rows = group.contexts
    .filter((c) => !contextFilter || c.id === contextFilter)
    .flatMap((c) => c.kpis.map((k) => ({ kpi: ed(k), contextName: c.name })));
  const fc = contextFilter ? group.contexts.find((c) => c.id === contextFilter) : null;

  // Synthetic group/context rows (project-level, ungrouped, group-level) carry
  // "__" composite ids that aren't real FKs — don't scope a new KPI to those.
  const realGroupId = group.id.includes('__') ? undefined : group.id;
  const realContextId = contextFilter && !contextFilter.includes('__') ? contextFilter : undefined;
  const scopeLabel = fc ? (realContextId ? fc.name : group.name) : group.name;

  return (
    <>
      <Breadcrumb trail={[
        { label: 'Projects', onClick: onToProjects },
        { label: project.name, onClick: onToGroups },
        { label: group.name },
      ]} />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="w-3 h-3 rounded-full" style={{ background: group.color }} />
        <h2 className="typo-section-title">{group.name}</h2>
        <span className="typo-caption">{DOMAIN_LABEL[group.domain]} · {rows.length} KPIs</span>
        {fc && (
          <button type="button" onClick={() => setContextFilter(null)} className="typo-caption rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-foreground hover:bg-primary/20">
            {fc.name} ✕
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 typo-caption rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/20" data-testid="factory-add-kpi-btn">
          <Plus className="w-3.5 h-3.5" /> Add KPI
        </button>
      </div>
      <KpiTable kpis={rows} bar={bar} density={density} onOpen={onOpenKpi} />

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
