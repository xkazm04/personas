import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Star, AlertTriangle } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveEffectiveModel } from '@/features/agents/sub_use_cases/libs/useCaseDetailHelpers';
import { ALL_MODELS } from '@/lib/models/modelCatalog';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BaseModal } from '@/lib/ui/BaseModal';
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { ArenaPanel } from '../arena/ArenaPanel';
import { useSeedAthenaComposer } from '@/features/plugins/companion/useSeedAthenaComposer';
import { buildVersionRows, type VersionRow } from '../../libs/versionMatrixRows';
import { VersionStatusBadge } from './VersionStatusBadge';
import { VersionRatingCell } from './VersionRatingCell';
import { VersionRowActions, type RowActionHandlers } from './VersionRowActions';

/** Regression flag threshold — a drop of this many composite points vs baseline. */
const REGRESSION_DROP = 5;

const modelLabel = (modelId: string | null): string =>
  modelId ? (ALL_MODELS.find((m) => m.id === modelId || m.model === modelId)?.label ?? modelId) : '—';

/**
 * Consolidated Lab surface: one table of every (prompt version × model) the
 * persona has been measured on, with the live config marked, a regression
 * delta vs the pinned baseline, and per-row actions (activate / measure /
 * diff / pin-baseline / archive). Replaces the old 7-tab Lab switcher.
 */
export function LabVersionsTable() {
  const { t, tx } = useTranslation();
  const lab = t.agents.lab;

  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const versionRatings = useAgentStore((s) => s.versionRatings);
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const fetchVersionRatings = useAgentStore((s) => s.fetchVersionRatings);
  const loadBaseline = useAgentStore((s) => s.loadBaseline);
  const activateVersion = useAgentStore((s) => s.activateVersion);
  const tagVersion = useAgentStore((s) => s.tagVersion);
  const pinBaseline = useAgentStore((s) => s.pinBaseline);
  const unpinBaseline = useAgentStore((s) => s.unpinBaseline);
  const isArenaRunning = useAgentStore((s) => s.isArenaRunning);
  const seedAthena = useSeedAthenaComposer();

  const personaId = selectedPersona?.id;
  const [measuringVersionId, setMeasuringVersionId] = useState<string | null>(null);
  const [measureRow, setMeasureRow] = useState<VersionRow | null>(null);
  const [diffRow, setDiffRow] = useState<VersionRow | null>(null);

  useEffect(() => {
    if (!personaId) return;
    fetchVersions(personaId);
    fetchVersionRatings(personaId);
    loadBaseline(personaId);
  }, [personaId, fetchVersions, fetchVersionRatings, loadBaseline]);

  // Refresh ratings + clear the measuring spinner when an arena run finishes.
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !isArenaRunning) {
      if (personaId) fetchVersionRatings(personaId);
      setMeasuringVersionId(null);
    }
    prevRunning.current = isArenaRunning;
  }, [isArenaRunning, personaId, fetchVersionRatings]);

  const activeVersionId = useMemo(() => {
    const prod = promptVersions.find((v) => v.tag === 'production');
    if (prod) return prod.id;
    return promptVersions.reduce<string | null>(
      (best, v) =>
        best == null || v.version_number > (promptVersions.find((x) => x.id === best)?.version_number ?? -1)
          ? v.id
          : best,
      null,
    );
  }, [promptVersions]);

  const activeModel = useMemo(
    () => resolveEffectiveModel(undefined, selectedPersona?.model_profile),
    [selectedPersona?.model_profile],
  );
  const activeVersion = promptVersions.find((v) => v.id === activeVersionId) ?? null;

  const rows = useMemo(
    () =>
      buildVersionRows({
        versions: promptVersions,
        ratings: versionRatings,
        activeVersionId,
        activeModelId: activeModel.config?.id ?? null,
        activeProvider: activeModel.config?.provider ?? 'anthropic',
        baselineVersionId: baselinePin?.versionId ?? null,
      }),
    [promptVersions, versionRatings, activeVersionId, activeModel, baselinePin],
  );

  const handlers: RowActionHandlers = useMemo(
    () => ({
      onActivate: (row) => {
        if (!personaId || !row.modelId) return;
        activateVersion(personaId, row.versionId, row.modelId, row.provider || 'anthropic');
      },
      onMeasure: (row) => {
        // Open the Arena colosseum scoped to this version; it runs the sweep and
        // ratings refresh on completion (see the isArenaRunning effect below).
        setMeasureRow(row);
        setMeasuringVersionId(row.versionId);
      },
      onImprove: (row) => {
        if (!selectedPersona) return;
        // Seed Athena's composer with an improvement brief and wait for the user
        // to specify the focus before they send it.
        let seed: string;
        const r = row.rating;
        const metrics = r
          ? ([
              { label: lab.vr_metric_tool, v: r.toolAccuracy },
              { label: lab.vr_metric_quality, v: r.outputQuality },
              { label: lab.vr_metric_protocol, v: r.protocolCompliance },
            ].filter((m) => m.v != null) as { label: string; v: number }[])
          : [];
        if (metrics.length) {
          const weakest = metrics.reduce((a, b) => (b.v < a.v ? b : a));
          seed = tx(lab.vr_improve_seed_measured, {
            name: selectedPersona.name,
            version: row.versionNumber,
            metric: weakest.label,
            score: Math.round(weakest.v),
            model: modelLabel(row.modelId),
          });
        } else {
          seed = tx(lab.vr_improve_seed_plain, { name: selectedPersona.name, version: row.versionNumber });
        }
        seedAthena(seed);
      },
      onDiff: (row) => setDiffRow(row),
      onToggleBaseline: (row) => {
        if (!personaId) return;
        if (row.isBaseline) unpinBaseline(personaId);
        else pinBaseline(personaId, row.versionId, row.versionNumber, '');
      },
      onToggleArchive: (row) => tagVersion(row.versionId, row.isArchived ? 'experimental' : 'archived'),
    }),
    [personaId, selectedPersona, activateVersion, tx, lab, seedAthena, unpinBaseline, pinBaseline, tagVersion],
  );

  const columns: TableColumn<VersionRow>[] = useMemo(
    () => [
      {
        key: 'version',
        label: lab.vr_col_version,
        width: 'minmax(140px, 1.3fr)',
        render: (row) => (
          <Tooltip content={row.version.change_summary ?? ''}>
            <span className="inline-flex items-center gap-1.5">
              {row.isBaseline && <Star className="w-3 h-3 text-amber-300 fill-amber-300" aria-hidden />}
              <span className="font-mono typo-body text-foreground">v{row.versionNumber}</span>
            </span>
          </Tooltip>
        ),
      },
      { key: 'model', label: lab.vr_col_model, width: '150px', render: (row) => (
        <span className="typo-body text-foreground">{modelLabel(row.modelId)}</span>
      ) },
      { key: 'rating', label: lab.vr_col_rating, width: '110px', align: 'right',
        sortable: true, sortFn: (a, b) => (a.composite ?? -1) - (b.composite ?? -1),
        render: (row) => <VersionRatingCell row={row} /> },
      { key: 'delta', label: lab.vr_col_delta, width: '110px', align: 'right',
        render: (row) => <DeltaCell delta={row.deltaVsBaseline} /> },
      { key: 'cost', label: lab.vr_col_cost, width: '90px', align: 'right',
        render: (row) => (
          <span className="typo-caption text-foreground tabular-nums">
            {row.rating ? `$${row.rating.costUsd.toFixed(3)}` : '—'}
          </span>
        ) },
      { key: 'status', label: lab.vr_col_status, width: '130px', render: (row) => <VersionStatusBadge row={row} /> },
      { key: 'actions', label: lab.vr_col_actions, width: '210px', render: (row) => (
        <VersionRowActions
          row={row}
          handlers={handlers}
          measuring={measuringVersionId === row.versionId}
          hasActiveVersion={!!activeVersion}
        />
      ) },
    ],
    // handlers/activeVersion/measuring are stable enough per render; re-derive on these.
    [lab, measuringVersionId, activeVersion, handlers],
  );

  if (!personaId) {
    return <div className="typo-body text-foreground text-center py-8">{t.agents.lab.no_persona_selected}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-primary/70" />
        <div className="min-w-0">
          <h3 className="typo-section-title text-foreground">{lab.vr_title}</h3>
          <p className="typo-caption text-foreground">{lab.vr_subtitle}</p>
        </div>
      </div>

      <UnifiedTable<VersionRow>
        columns={columns}
        data={rows}
        getRowKey={(row) => row.key}
        density="compact"
        ariaLabel={lab.vr_title}
        emptyTitle={lab.vr_empty_title}
        emptyDescription={lab.vr_empty_desc}
        rowAccent={(row) => (row.isActive ? 'border-l-primary' : row.isBaseline ? 'border-l-amber-400' : undefined)}
      />

      <BaseModal isOpen={!!diffRow} onClose={() => setDiffRow(null)} titleId="vr-diff-modal" maxWidthClass="max-w-3xl">
        <div className="p-4 space-y-3">
          <h3 className="typo-section-title text-foreground">
            {diffRow ? tx(lab.vr_diff_title, { version: diffRow.versionNumber }) : ''}
          </h3>
          {diffRow && activeVersion ? (
            <DiffViewer versionA={activeVersion} versionB={diffRow.version} />
          ) : (
            <p className="typo-body text-foreground">{lab.vr_diff_no_active}</p>
          )}
        </div>
      </BaseModal>

      <BaseModal
        isOpen={!!measureRow}
        onClose={() => {
          setMeasureRow(null);
          setMeasuringVersionId(null);
        }}
        titleId="vr-measure-modal"
        maxWidthClass="max-w-5xl"
      >
        <div className="p-4 space-y-3">
          <h3 className="typo-section-title text-foreground">
            {measureRow ? tx(lab.vr_measure_modal_title, { version: measureRow.versionNumber }) : ''}
          </h3>
          {measureRow && (
            <ArenaPanel versionScope={{ versionId: measureRow.versionId, versionNumber: measureRow.versionNumber }} />
          )}
        </div>
      </BaseModal>
    </div>
  );
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="typo-caption text-foreground">—</span>;
  const rounded = Math.round(delta);
  if (rounded === 0) return <span className="typo-caption text-foreground tabular-nums">0</span>;
  const positive = rounded > 0;
  const regression = rounded <= -REGRESSION_DROP;
  return (
    <span className={`inline-flex items-center gap-1 typo-caption font-medium tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {regression && <AlertTriangle className="w-3 h-3" aria-hidden />}
      {positive ? `+${rounded}` : rounded}
    </span>
  );
}
