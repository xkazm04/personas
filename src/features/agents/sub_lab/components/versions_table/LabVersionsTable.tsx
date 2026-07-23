import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Star, AlertTriangle, FileDown, ClipboardCopy, Check } from 'lucide-react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  versionComparisonHtml,
  versionComparisonMarkdown,
  downloadHtmlReport,
} from '../../libs/reportGenerator';
import { useAgentStore } from '@/stores/agentStore';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveEffectiveModel, profileToLabel } from '@/features/agents/sub_use_cases/libs/useCaseDetailHelpers';
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
import { PostActivationReconcileDialog, type OverrideConflict } from './PostActivationReconcileDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';

/** Regression flag threshold — a drop of this many composite points vs baseline. */
const REGRESSION_DROP = 5;

/**
 * Friendly versioned display names for the Anthropic tier (the catalog labels
 * are intentionally bare — "Haiku" — for the Arena roster cards, so the version
 * suffix is added here, table-local). Update when the model family rolls.
 */
const MODEL_VERSION_LABEL: Record<string, string> = {
  haiku: 'Haiku 4.5',
  sonnet: 'Sonnet 4.6',
  opus: 'Opus 4.8',
};

/** Mean prompt + completion tokens for a measured row; 0 when never measured. */
const totalTokens = (row: VersionRow): number =>
  row.rating ? row.rating.inputTokens + row.rating.outputTokens : 0;

const modelLabel = (modelId: string | null): string => {
  if (!modelId) return '—';
  const versioned = Object.entries(MODEL_VERSION_LABEL).find(([k]) => modelId === k || modelId.includes(k));
  if (versioned) return versioned[1];
  return ALL_MODELS.find((m) => m.id === modelId || m.model === modelId)?.label ?? modelId;
};

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
  const useCases = useSelectedUseCases();

  const personaId = selectedPersona?.id;
  const [measuringVersionId, setMeasuringVersionId] = useState<string | null>(null);
  const [measureRow, setMeasureRow] = useState<VersionRow | null>(null);
  const [diffRow, setDiffRow] = useState<VersionRow | null>(null);
  const [reconcile, setReconcile] = useState<{ conflicts: OverrideConflict[]; promotedLabel: string } | null>(null);
  const [reportCopied, setReportCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!personaId) return;
    setLoading(true);
    loadBaseline(personaId);
    void Promise.all([fetchVersions(personaId), fetchVersionRatings(personaId)])
      .finally(() => setLoading(false));
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
      onActivate: async (row) => {
        if (!personaId || !row.modelId) return;
        const promotedProvider = row.provider || 'anthropic';
        const ok = await activateVersion(personaId, row.versionId, row.modelId, promotedProvider);
        // Activation failed (error already reported/toasted by the slice) —
        // nothing was promoted, so there is nothing to reconcile.
        if (!ok) return;
        // After the persona default flips, surface any use case whose
        // model_override still pins a DIFFERENT model — otherwise that use case
        // silently keeps executing on its old pin. Let the user reconcile.
        const conflicts: OverrideConflict[] = useCases
          .filter((uc) => {
            const o = uc.model_override;
            if (!o) return false;
            const oProvider = o.provider || 'anthropic';
            return !(oProvider === promotedProvider && o.model === row.modelId);
          })
          .map((uc) => ({
            useCaseId: uc.id,
            title: uc.title,
            pinnedLabel: profileToLabel(uc.model_override),
          }));
        if (conflicts.length > 0) {
          setReconcile({ conflicts, promotedLabel: modelLabel(row.modelId) });
        }
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
    [personaId, selectedPersona, activateVersion, tx, lab, seedAthena, unpinBaseline, pinBaseline, tagVersion, useCases],
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
            {!row.rating ? '—' : row.rating.costUnknown ? (
              // Ollama et al. report a hardcoded $0 — surface "not tracked" rather
              // than a misleading $0.000 that reads as "free".
              <Tooltip content={lab.vr_cost_unknown_tooltip}>
                <span className="text-foreground/70">{lab.vr_cost_unknown}</span>
              </Tooltip>
            ) : (
              <>$<Numeric value={row.rating.costUsd} precision={3} /></>
            )}
          </span>
        ) },
      // Cost is price-weighted, so it hides which pair is actually token-hungry —
      // a cheaper model can still be the heaviest reader. Both axes, side by side.
      { key: 'tokens', label: lab.vr_col_tokens, width: '90px', align: 'right',
        sortable: true,
        sortFn: (a, b) => totalTokens(a) - totalTokens(b),
        render: (row) => (
          <span className="typo-caption text-foreground tabular-nums">
            {row.rating ? (
              <Tooltip
                content={tx(lab.vr_tokens_tooltip, {
                  input: Math.round(row.rating.inputTokens),
                  output: Math.round(row.rating.outputTokens),
                })}
              >
                <span><Numeric value={totalTokens(row)} unit="count" precision={0} /></span>
              </Tooltip>
            ) : '—'}
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
    [lab, tx, measuringVersionId, activeVersion, handlers],
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
        {/* Export a client-presentable "v3 vs v4" comparison from the measured
            ratings — the billable artifact (UAT 2026-07-20, FA-AGY-LAB-03).
            Built from data already in the table; no fresh run needed. */}
        {versionRatings.some((r) => r.compositeScore != null) && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              data-testid="vr-export-comparison-html"
              onClick={() => {
                const name = selectedPersona?.name ?? 'Agent';
                const html = versionComparisonHtml(name, versionRatings, new Date().toLocaleDateString());
                const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
                downloadHtmlReport(html, `${safe}-version-comparison.html`);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium text-foreground bg-secondary/60 hover:bg-secondary/80 border border-primary/10 transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" />
              {t.agent_lab.export_download_html}
            </button>
            <button
              type="button"
              data-testid="vr-export-comparison-md"
              onClick={async () => {
                const name = selectedPersona?.name ?? 'Agent';
                await copyText(versionComparisonMarkdown(name, versionRatings, new Date().toLocaleDateString()));
                setReportCopied(true);
                setTimeout(() => setReportCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium text-foreground bg-secondary/60 hover:bg-secondary/80 border border-primary/10 transition-colors"
            >
              {reportCopied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              {reportCopied ? t.agent_lab.export_copied : t.agent_lab.export_copy_markdown}
            </button>
          </div>
        )}
      </div>

      <UnifiedTable<VersionRow>
        columns={columns}
        data={rows}
        getRowKey={(row) => row.key}
        density="compact"
        isLoading={loading && rows.length === 0}
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

      {reconcile && (
        <PostActivationReconcileDialog
          isOpen={!!reconcile}
          onClose={() => setReconcile(null)}
          conflicts={reconcile.conflicts}
          promotedLabel={reconcile.promotedLabel}
        />
      )}
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
