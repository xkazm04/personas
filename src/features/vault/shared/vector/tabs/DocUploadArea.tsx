import type { ReactNode } from 'react';
import { RefreshCw, Type, FileSearch, FolderOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface DocToolbarProps {
  documentCount: number;
  /**
   * True while an ingestion job owns the tab's single job slot. Every start
   * control is inert while it is set: DocumentsTab tracks ONE activeJobId, so a
   * second start overwrites the first and that job's completion event then
   * reaches no listener — its documents never trigger a refresh, and the
   * progress bar disappears while the first job may still be running.
   */
  ingestBusy: boolean;
  onRefresh: () => void;
  onShowTextModal: () => void;
  onBrowseFiles: () => void;
  onShowDirPicker: () => void;
}

/**
 * A start control that explains itself while it is inert. A disabled button
 * with no reason attached is the same dead end as no button at all, so the
 * busy arm wraps it in a focusable Tooltip (the button cannot receive hover or
 * focus once disabled — hence `pointer-events-none` + `triggerFocusable`).
 */
function StartControl({
  busy,
  busyHint,
  onClick,
  icon,
  label,
}: {
  busy: boolean;
  busyHint: string;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card bg-secondary/40 hover:bg-secondary/60 text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed${busy ? ' pointer-events-none' : ''}`}
    >
      {icon}
      {label}
    </button>
  );

  if (!busy) return button;
  return (
    <Tooltip content={busyHint} triggerFocusable>
      {button}
    </Tooltip>
  );
}

export function DocToolbar({
  documentCount,
  ingestBusy,
  onRefresh,
  onShowTextModal,
  onBrowseFiles,
  onShowDirPicker,
}: DocToolbarProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b border-primary/10 shrink-0">
      <h3 className="typo-body font-medium text-foreground flex-1">
        {/*
          English pluralization used to be baked into the JSX here, which no
          catalog could reach — and which is wrong anyway for the Slavic and
          Arabic locales. The two-form choice lives in the catalog now.
        */}
        {tx(documentCount === 1 ? sh.documents_count_one : sh.documents_count_other, { count: documentCount })}
      </h3>
      {/* Refresh stays live while a job runs — it starts nothing. */}
      <button
        type="button"
        onClick={onRefresh}
        className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
        title={t.vault.databases.refresh}
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
      <StartControl
        busy={ingestBusy}
        busyHint={sh.ingest_in_progress}
        onClick={onShowTextModal}
        icon={<Type className="w-3 h-3" />}
        label={sh.paste_text}
      />
      <StartControl
        busy={ingestBusy}
        busyHint={sh.ingest_in_progress}
        onClick={onBrowseFiles}
        icon={<FileSearch className="w-3 h-3" />}
        label={sh.browse_files}
      />
      <StartControl
        busy={ingestBusy}
        busyHint={sh.ingest_in_progress}
        onClick={onShowDirPicker}
        icon={<FolderOpen className="w-3 h-3" />}
        label={sh.directory}
      />
    </div>
  );
}
