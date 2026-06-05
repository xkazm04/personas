import type { ReactNode } from 'react';
import { Power, FlaskConical, GitCompareArrows, Sparkles, Target, Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { VersionRow } from '../../libs/versionMatrixRows';

export interface RowActionHandlers {
  onActivate: (row: VersionRow) => void;
  onMeasure: (row: VersionRow) => void;
  /** Optional — when omitted the Improve icon is hidden (wired in a later phase). */
  onImprove?: (row: VersionRow) => void;
  onDiff: (row: VersionRow) => void;
  onToggleBaseline: (row: VersionRow) => void;
  onToggleArchive: (row: VersionRow) => void;
}

function IconBtn({
  label, onClick, disabled, active, danger, children, testid,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        data-testid={testid}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`p-1.5 rounded-input transition-colors focus-ring disabled:opacity-30 disabled:cursor-not-allowed ${
          active
            ? 'text-primary bg-primary/10'
            : danger
              ? 'text-foreground hover:text-red-400 hover:bg-red-500/10'
              : 'text-foreground hover:text-primary hover:bg-secondary/40'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Action-icon cluster for one (version, model) row: Activate · Measure(Arena) ·
 * Improve(Athena) · Diff · Pin-baseline · Archive.
 */
export function VersionRowActions({
  row, handlers, measuring, hasActiveVersion,
}: {
  row: VersionRow;
  handlers: RowActionHandlers;
  /** This version currently has an in-flight measurement. */
  measuring: boolean;
  /** There is an active version to diff against. */
  hasActiveVersion: boolean;
}) {
  const { t } = useTranslation();
  const lab = t.agents.lab;

  return (
    <div className="flex items-center gap-0.5">
      <IconBtn
        label={row.isActive ? lab.vr_action_active : lab.vr_action_activate}
        testid={`vr-activate-${row.key}`}
        onClick={() => handlers.onActivate(row)}
        disabled={row.isActive || !row.modelId}
        active={row.isActive}
      >
        <Power className="w-3.5 h-3.5" />
      </IconBtn>

      <IconBtn
        label={measuring ? lab.vr_action_measuring : lab.vr_action_measure}
        testid={`vr-measure-${row.key}`}
        onClick={() => handlers.onMeasure(row)}
        disabled={measuring}
      >
        {measuring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
      </IconBtn>

      {handlers.onImprove && (
        <IconBtn
          label={lab.vr_action_improve}
          testid={`vr-improve-${row.key}`}
          onClick={() => handlers.onImprove?.(row)}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </IconBtn>
      )}

      <IconBtn
        label={lab.vr_action_diff}
        testid={`vr-diff-${row.key}`}
        onClick={() => handlers.onDiff(row)}
        disabled={!hasActiveVersion || row.isActive}
      >
        <GitCompareArrows className="w-3.5 h-3.5" />
      </IconBtn>

      <IconBtn
        label={row.isBaseline ? lab.vr_action_unpin_baseline : lab.vr_action_pin_baseline}
        testid={`vr-baseline-${row.key}`}
        onClick={() => handlers.onToggleBaseline(row)}
        active={row.isBaseline}
      >
        <Target className="w-3.5 h-3.5" />
      </IconBtn>

      <IconBtn
        label={row.isArchived ? lab.vr_action_unarchive : lab.vr_action_archive}
        testid={`vr-archive-${row.key}`}
        onClick={() => handlers.onToggleArchive(row)}
        danger={!row.isArchived}
        disabled={row.isActive}
      >
        {row.isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
      </IconBtn>
    </div>
  );
}
