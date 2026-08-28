import { Play, Wand2, Save, Check, Shield, ShieldOff, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { ConnectorCapabilityNote } from './ConnectorCapabilityNote';

interface QueryToolbarProps {
  selectedTitle: string;
  language: string;
  serviceType: string;
  saveState: 'idle' | 'saving' | 'saved';
  executing: boolean;
  editorValue: string;
  isAiRunning: boolean;
  safeMode: boolean;
  onSave: () => void;
  onExecute: () => void;
  onCancel: () => void;
  onAiRun: () => void;
  onToggleSafeMode: () => void;
}

export function QueryToolbar({
  selectedTitle,
  language,
  serviceType,
  saveState,
  executing,
  editorValue,
  isAiRunning,
  safeMode,
  onSave,
  onExecute,
  onCancel,
  onAiRun,
  onToggleSafeMode,
}: QueryToolbarProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/8 bg-secondary/5 shrink-0">
      <span className="typo-heading font-semibold text-foreground flex-1 truncate">{selectedTitle}</span>
      <span className="typo-body uppercase tracking-wider text-foreground px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/8 font-medium">
        {language}
      </span>
      <ConnectorCapabilityNote serviceType={serviceType} />

      {/* Busy state belongs to the control the user pressed: Button renders a REAL
          spinner and sets aria-busy. feedback/LoadingSpinner renders null, so the
          old ternary deleted the Save icon and left the button blank mid-save. */}
      <Button
        variant={saveState === 'saved' ? 'accent' : 'ghost'}
        accentColor={saveState === 'saved' ? 'emerald' : undefined}
        size="sm"
        onClick={onSave}
        loading={saveState === 'saving'}
        loadingLabel={db.saving}
        icon={saveState === 'saved' ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
        className="rounded-modal typo-body duration-300"
      >
        {saveState === 'saved' ? db.saved : db.save}
      </Button>

      {executing ? (
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-modal typo-body font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/30 transition-all"
        >
          <X className="w-3 h-3" />
          {t.common.cancel}
        </button>
      ) : (
        <button
          type="button"
          onClick={onExecute}
          disabled={!editorValue.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-modal typo-body font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <Play className="w-3 h-3" />
          {db.run}
        </button>
      )}

      {/* Same reason as Save above: the AI-run icon used to vanish for the whole
          debug round-trip, which is the longest wait in this toolbar. */}
      <Button
        variant="accent"
        accentColor="violet"
        size="sm"
        onClick={onAiRun}
        disabled={!editorValue.trim()}
        loading={isAiRunning}
        loadingLabel={db.debugging}
        icon={<Wand2 className="w-3 h-3" />}
        className="rounded-modal typo-body px-3.5 py-1.5 shadow-elevation-1 shadow-violet-500/5"
      >
        {db.ai_run}
      </Button>

      <button
        type="button"
        onClick={onToggleSafeMode}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal typo-body font-medium border transition-all ${
          safeMode
            ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
            : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
        }`}
        title={safeMode ? db.safe_mode_on : db.safe_mode_off}
      >
        {safeMode ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        {safeMode ? db.safe : db.write}
      </button>
    </div>
  );
}
