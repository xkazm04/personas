/**
 * Variant — "Studio (Tale of the Tape)"
 *
 * Metaphor: a boxing-match staging surface. Two "fighter cards" in opposing
 * corners (blue / violet) carry the version's identifying facts; the centre
 * "ring" holds the contested test (models, use case, custom input). Once both
 * fighters are picked the diff slides in as a Round Card and the Run CTA
 * doubles as the bell.
 *
 * Why different from baseline: baseline reduces version selection to two
 * dropdowns and stacks the diff afterwards. This variant promotes the
 * versions themselves (with metadata) to the visual pillars of the screen.
 */
import { useMemo } from 'react';
import { ChevronDown, Swords, Tag, Calendar, Trophy } from 'lucide-react';
import { useAbPanelState } from './useAbPanelState';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { DiffViewer } from '@/features/agents/sub_lab/shared';
import { AbHistory } from './AbHistory';
import { ModelToggleGrid, UseCaseFilterPicker, LabPanelShell } from '../../shared';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText, debtText } from '@/i18n/DebtText';


interface FighterCardProps {
  side: 'A' | 'B';
  versionId: string | null;
  setVersionId: (id: string) => void;
  options: Array<{ value: string; label: string; tag: string; versionNumber: number }>;
  testIdPrefix: string;
}

function FighterCard({ side, versionId, setVersionId, options, testIdPrefix }: FighterCardProps) {
  const { t } = useTranslation();
  const isA = side === 'A';
  const accent = isA
    ? { ring: 'ring-blue-500/30', border: 'border-blue-500/30', text: 'text-blue-300', bg: 'bg-blue-500/[0.04]', chip: 'bg-blue-500/15 text-blue-300', listOpen: 'bg-blue-500/10 border-blue-500/30' }
    : { ring: 'ring-violet-500/30', border: 'border-violet-500/30', text: 'text-violet-300', bg: 'bg-violet-500/[0.04]', chip: 'bg-violet-500/15 text-violet-300', listOpen: 'bg-violet-500/10 border-violet-500/30' };

  const selected = options.find((o) => o.value === versionId);

  return (
    <div className={`rounded-modal border ${accent.border} ${accent.bg} px-4 py-4 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className={`px-2 py-0.5 typo-label rounded-pill ${accent.chip}`}>Corner {side}</span>
        {selected && <Trophy className="w-4 h-4 text-foreground" aria-hidden />}
      </div>

      {/* Fighter identity */}
      <div className="space-y-1">
        {selected ? (
          <>
            <div className={`typo-hero font-bold ${accent.text} leading-none`}>v{selected.versionNumber}</div>
            <div className="flex items-center gap-1.5 typo-caption text-foreground">
              <Tag className="w-3 h-3" /> {selected.tag}
            </div>
          </>
        ) : (
          <div className="typo-body text-foreground"><DebtText k="auto_no_fighter_selected_11363653" /></div>
        )}
      </div>

      {/* Listbox picker — keeps interaction model identical to baseline */}
      <Listbox
        itemCount={options.length}
        onSelectFocused={(idx) => { const opt = options[idx]; if (opt) setVersionId(opt.value); }}
        ariaLabel={`Select Version ${side}`}
        renderTrigger={({ isOpen, toggle }) => (
          <button
            onClick={toggle}
            data-testid={`${testIdPrefix}-trigger`}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-modal typo-caption border transition-all focus-ring ${
              isOpen ? accent.listOpen : 'bg-background/30 border-primary/10 hover:border-primary/20'
            }`}
          >
            <span className="text-foreground">{selected?.label ?? t.agents.lab.select_version}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      >
        {({ close, focusIndex }) => (
          <div className="py-1 bg-background border border-primary/20 rounded-card shadow-elevation-3 mt-1 max-h-48 overflow-y-auto">
            {options.map((opt, i) => (
              <button
                key={opt.value}
                data-testid={`ab-version-opt-${opt.label.replace(/\s+/g, '-').toLowerCase()}`}
                onClick={() => { setVersionId(opt.value); close(); }}
                className={`w-full text-left px-3 py-1.5 typo-body transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${
                  versionId === opt.value ? `${accent.text} font-medium` : 'text-foreground hover:bg-secondary/30'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </Listbox>

      {/* Tale-of-the-tape stats */}
      {selected && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-primary/10">
          <div>
            <div className="typo-label text-foreground">version</div>
            <div className="typo-data text-foreground">v{selected.versionNumber}</div>
          </div>
          <div>
            <div className="typo-label text-foreground">stage</div>
            <div className="typo-data text-foreground capitalize">{selected.tag}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AbPanelStudio() {
  const { t } = useTranslation();
  const s = useAbPanelState();

  const versionOptions = useMemo(
    () => s.promptVersions.map((v) => ({ value: v.id, label: `v${v.version_number} -- ${v.tag}`, tag: v.tag, versionNumber: v.version_number })),
    [s.promptVersions],
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
        {/* Tale of the Tape: 2 corners + a centre ring */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
          <FighterCard
            side="A"
            versionId={s.versionAId}
            setVersionId={s.setVersionAId}
            options={versionOptions}
            testIdPrefix="ab-version-a"
          />

          <div className="flex flex-col items-center justify-center gap-1 px-2">
            <div className="w-12 h-12 rounded-full border border-primary/20 bg-secondary/30 flex items-center justify-center">
              <Swords className="w-5 h-5 text-foreground" />
            </div>
            <span className="typo-label text-foreground">vs</span>
            {s.versionA && s.versionB && (
              <span className="typo-caption text-emerald-400 flex items-center gap-1 mt-1">
                <Calendar className="w-3 h-3" /> <DebtText k="auto_match_set_142b1767" />
              </span>
            )}
          </div>

          <FighterCard
            side="B"
            versionId={s.versionBId}
            setVersionId={s.setVersionBId}
            options={versionOptions}
            testIdPrefix="ab-version-b"
          />
        </div>

        {/* Round card — Diff appears once both fighters are in */}
        {s.versionA && s.versionB && (
          <div className="rounded-card border border-primary/15 bg-background/30 px-4 py-3 animate-fade-slide-in">
            <div className="flex items-center gap-2 mb-2">
              <span className="typo-label text-foreground"><DebtText k="auto_round_card_055138e8" /></span>
              <span className="flex-1 h-px bg-primary/10" />
              <span className="typo-caption text-foreground"><DebtText k="auto_diff_preview_abf5e471" /></span>
            </div>
            <DiffViewer versionA={s.versionA} versionB={s.versionB} />
          </div>
        )}

        {/* Contested params */}
        <div className="space-y-3 rounded-card border border-primary/10 bg-secondary/15 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="typo-label text-foreground"><DebtText k="auto_contested_test_cedfc67f" /></span>
            <span className="flex-1 h-px bg-primary/10" />
          </div>
          <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
          <UseCaseFilterPicker selectedUseCaseId={s.selectedUseCaseId} setSelectedUseCaseId={s.setSelectedUseCaseId} />
          <div className="space-y-1">
            <label className="typo-body text-foreground">{t.agents.lab.test_input_label}</label>
            <textarea
              value={s.testInput}
              onChange={(e) => s.setTestInput(e.target.value)}
              placeholder={debtText("auto_task_summarize_the_latest_sales_report_6c4a91ed")}
              className="w-full h-20 px-3 py-2 typo-code bg-background/50 border border-primary/20 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring resize-none font-mono"
            />
          </div>
        </div>
      </LabPanelShell>

      <AbHistory runs={s.abRuns} resultsMap={s.abResultsMap} expandedRunId={s.expandedRunId} onToggleExpand={s.setExpandedRunId} onDelete={(id) => void s.deleteAbRun(id)} />
    </div>
  );
}
