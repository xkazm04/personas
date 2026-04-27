/**
 * Variant — "Lab Bench"
 *
 * Metaphor: a horizontal specimen rail at the top displays every prompt
 * version as a card with metadata visible at-a-glance — no dropdown drill-down.
 * Click a rail card to dock it as A (blue) or B (violet) into the comparator
 * rig in the middle. The rig holds the diff and the workbench tools
 * (models, use case, custom input) inline; Run lives at the bottom.
 *
 * Why different from baseline: baseline hides versions behind a Listbox so
 * the user only sees one at a time. Bench surfaces all candidates as
 * touchable specimens with their tag + age, mirroring how a wet lab pulls
 * samples from a rack before running a comparison.
 */
import { useMemo, useState } from 'react';
import { Beaker, GitBranch, ArrowDownToLine, X, FlaskConical, Wand2 } from 'lucide-react';
import { useAbPanelState } from './useAbPanelState';
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { AbHistory } from './AbHistory';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';

type DockTarget = 'A' | 'B';

function SpecimenCard({
  version,
  dockedAs,
  onDock,
  onClear,
}: {
  version: { id: string; version_number: number; tag: string };
  dockedAs: DockTarget | null;
  onDock: (target: DockTarget) => void;
  onClear: () => void;
}) {
  const accent = dockedAs === 'A'
    ? { border: 'border-blue-500/40', bg: 'bg-blue-500/[0.06]', text: 'text-blue-300', chip: 'bg-blue-500/15 text-blue-300 border-blue-500/30' }
    : dockedAs === 'B'
      ? { border: 'border-violet-500/40', bg: 'bg-violet-500/[0.06]', text: 'text-violet-300', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30' }
      : { border: 'border-primary/15', bg: 'bg-secondary/15', text: 'text-foreground', chip: '' };

  return (
    <div className={`shrink-0 w-44 rounded-card border ${accent.border} ${accent.bg} px-3 py-2.5 flex flex-col gap-2 transition-colors`}>
      <div className="flex items-center justify-between">
        <span className={`typo-data-lg ${accent.text} leading-none`}>v{version.version_number}</span>
        {dockedAs && (
          <button
            onClick={onClear}
            className={`px-1.5 py-0.5 rounded-pill typo-label border ${accent.chip} flex items-center gap-1 hover:opacity-80 focus-ring`}
            aria-label={`Clear corner ${dockedAs}`}
          >
            {dockedAs} <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <span className="typo-caption text-foreground/70 capitalize">{version.tag}</span>
      <div className="mt-auto flex gap-1">
        <button
          onClick={() => onDock('A')}
          disabled={dockedAs === 'A'}
          className={`flex-1 px-2 py-1 typo-caption rounded-interactive transition-colors border focus-ring disabled:opacity-50 ${
            dockedAs === 'A' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-background/40 text-foreground border-primary/15 hover:border-blue-500/30'
          }`}
        >
          → A
        </button>
        <button
          onClick={() => onDock('B')}
          disabled={dockedAs === 'B'}
          className={`flex-1 px-2 py-1 typo-caption rounded-interactive transition-colors border focus-ring disabled:opacity-50 ${
            dockedAs === 'B' ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'bg-background/40 text-foreground border-primary/15 hover:border-violet-500/30'
          }`}
        >
          → B
        </button>
      </div>
    </div>
  );
}

function DockSlot({ side, version, onClear }: { side: DockTarget; version: { id: string; version_number: number; tag: string } | null; onClear: () => void }) {
  const accent = side === 'A'
    ? { border: 'border-blue-500/40', bg: 'bg-blue-500/[0.05]', text: 'text-blue-300', label: 'corner A' }
    : { border: 'border-violet-500/40', bg: 'bg-violet-500/[0.05]', text: 'text-violet-300', label: 'corner B' };

  return (
    <div className={`rounded-card border ${accent.border} ${accent.bg} px-4 py-3`}>
      <div className="flex items-center justify-between">
        <span className={`typo-label ${accent.text}`}>{accent.label}</span>
        {version && (
          <button onClick={onClear} className="text-foreground/50 hover:text-foreground/80 focus-ring rounded-interactive" aria-label={`Clear ${accent.label}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {version ? (
        <>
          <div className={`typo-hero ${accent.text} leading-none mt-1`}>v{version.version_number}</div>
          <div className="typo-caption text-foreground/70 capitalize mt-1">{version.tag}</div>
        </>
      ) : (
        <div className="typo-body text-foreground/50 flex items-center gap-2 mt-1">
          <ArrowDownToLine className="w-4 h-4" />
          dock a specimen above
        </div>
      )}
    </div>
  );
}

export function AbPanelBench() {
  const { t } = useTranslation();
  const s = useAbPanelState();
  const [filter, setFilter] = useState<'all' | 'production' | 'staging'>('all');

  const visibleVersions = useMemo(() => {
    return s.promptVersions
      .filter((v) => v.tag !== 'archived')
      .filter((v) => filter === 'all' ? true : v.tag === filter);
  }, [s.promptVersions, filter]);

  const dockTo = (versionId: string) => (target: DockTarget) => {
    if (target === 'A') {
      // If versionId currently in B, swap
      if (s.versionBId === versionId) s.setVersionBId(s.versionAId ?? '');
      s.setVersionAId(versionId);
    } else {
      if (s.versionAId === versionId) s.setVersionAId(s.versionBId ?? '');
      s.setVersionBId(versionId);
    }
  };

  const clearVersion = (versionId: string) => () => {
    if (s.versionAId === versionId) s.setVersionAId('');
    if (s.versionBId === versionId) s.setVersionBId('');
  };

  const dockedAs = (id: string): DockTarget | null => (s.versionAId === id ? 'A' : s.versionBId === id ? 'B' : null);

  const filterChip = (id: 'all' | 'production' | 'staging', label: string) => (
    <button
      onClick={() => setFilter(id)}
      className={`px-2.5 py-1 rounded-pill typo-caption border focus-ring transition-colors ${
        filter === id ? 'bg-primary/20 text-primary border-primary/30' : 'bg-background/30 text-foreground border-primary/12 hover:border-primary/25'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <LabPanelShell
        isRunning={s.isLabRunning}
        onStart={() => void s.handleStart()}
        onCancel={() => void s.handleCancel()}
        disabled={!s.versionAId || !s.versionBId || s.selectedModels.size === 0}
        disabledReason={!s.versionAId ? t.agents.lab.select_version_a : !s.versionBId ? t.agents.lab.select_version_b : s.selectedModels.size === 0 ? t.agents.lab.select_model : ''}
        runLabel={t.agents.lab.run_ab_test}
        cancelLabel={t.agents.lab.cancel_ab_test}
        cancelTestId="ab-cancel-btn"
        runTestId="ab-run-btn"
      >
        {/* Specimen rail */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-foreground/70" />
            <span className="typo-label text-foreground/70">specimen rail</span>
            <span className="flex-1" />
            {filterChip('all', 'All')}
            {filterChip('production', 'Production')}
            {filterChip('staging', 'Staging')}
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-2 min-w-max">
              {visibleVersions.length === 0 ? (
                <div className="px-3 py-4 typo-caption text-foreground/60">
                  No versions match this filter.
                </div>
              ) : (
                visibleVersions.map((v) => (
                  <SpecimenCard
                    key={v.id}
                    version={v}
                    dockedAs={dockedAs(v.id)}
                    onDock={(target) => dockTo(v.id)(target)}
                    onClear={clearVersion(v.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Comparator rig */}
        <div className="rounded-modal border border-primary/15 bg-secondary/15 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Beaker className="w-4 h-4 text-foreground/70" />
            <span className="typo-label text-foreground/70">comparator rig</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DockSlot side="A" version={s.versionA} onClear={() => s.setVersionAId('')} />
            <DockSlot side="B" version={s.versionB} onClear={() => s.setVersionBId('')} />
          </div>

          {s.versionA && s.versionB ? (
            <div className="rounded-card border border-primary/12 bg-background/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch className="w-3.5 h-3.5 text-foreground/60" />
                <span className="typo-label text-foreground/70">prompt diff</span>
              </div>
              <DiffViewer versionA={s.versionA} versionB={s.versionB} />
            </div>
          ) : (
            <div className="rounded-card border border-dashed border-primary/15 bg-background/20 px-3 py-6 text-center typo-caption text-foreground/60">
              Diff appears once both A and B are docked.
            </div>
          )}

          {/* Workbench tools */}
          <div className="space-y-3 pt-2 border-t border-primary/10">
            <div className="flex items-center gap-2">
              <Wand2 className="w-3.5 h-3.5 text-foreground/60" />
              <span className="typo-label text-foreground/70">workbench tools</span>
            </div>
            <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
            <UseCaseFilterPicker selectedUseCaseId={s.selectedUseCaseId} setSelectedUseCaseId={s.setSelectedUseCaseId} />
            <div className="space-y-1">
              <label className="typo-body text-foreground">{t.agents.lab.test_input_label}</label>
              <textarea
                value={s.testInput}
                onChange={(e) => s.setTestInput(e.target.value)}
                placeholder='{"task": "Summarize the latest sales report"}'
                className="w-full h-20 px-3 py-2 typo-code bg-background/50 border border-primary/20 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono"
              />
            </div>
          </div>
        </div>
      </LabPanelShell>

      <AbHistory runs={s.abRuns} resultsMap={s.abResultsMap} expandedRunId={s.expandedRunId} onToggleExpand={s.setExpandedRunId} onDelete={(id) => void s.deleteAbRun(id)} />
    </div>
  );
}
