import { Play, Wand2, Save, Check, Shield, ShieldOff, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
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
      <span className="typo-heading text-foreground flex-1 truncate">{selectedTitle}</span>
      <span className="typo-eyebrow text-foreground px-2 py-0.5 rounded-card bg-surface-2 border border-primary/8">
        {language}
      </span>
      <ConnectorCapabilityNote serviceType={serviceType} />

      {/* Busy state belongs to the control the user pressed: Button renders a REAL
          spinner and sets aria-busy. feedback/LoadingSpinner renders null, so the
          old ternary deleted the Save icon and left the button blank mid-save. */}
      <Button
        variant={saveState === 'saved' ? 'accent' : 'ghost'}
        tone={saveState === 'saved' ? 'success' : undefined}
        size="sm"
        onClick={onSave}
        loading={saveState === 'saving'}
        loadingLabel={db.saving}
        icon={saveState === 'saved' ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
        className="rounded-modal typo-body duration-300"
      >
        {saveState === 'saved' ? db.saved : db.save}
      </Button>

      {/* Run/Cancel were the last hand-rolled pair in a toolbar whose other two
          controls are already the shared primitive. The swap was total — the
          pressed control VANISHED and a Cancel button took its place, so Run
          never carried a spinner and never set aria-busy. This is the shape
          ConsoleTab already proved: Run stays mounted and shows its own busy
          state, and Cancel joins it as a separate affordance while in flight. */}
      <Button
        variant="accent"
        tone="success"
        size="md"
        onClick={onExecute}
        disabled={!editorValue.trim()}
        loading={executing}
        loadingLabel={db.running}
        icon={<Play className="w-3 h-3" />}
        className="rounded-modal typo-body"
      >
        {db.run}
      </Button>
      {executing && (
        <Button
          variant="accent"
          tone="error"
          size="md"
          onClick={onCancel}
          icon={<X className="w-3 h-3" />}
          className="rounded-modal typo-body"
        >
          {t.common.cancel}
        </Button>
      )}

      {/* Same reason as Save above: the AI-run icon used to vanish for the whole
          debug round-trip, which is the longest wait in this toolbar. */}
      <Button
        variant="accent"
        tone="agent"
        size="sm"
        onClick={onAiRun}
        disabled={!editorValue.trim()}
        loading={isAiRunning}
        loadingLabel={db.debugging}
        icon={<Wand2 className="w-3 h-3" />}
        className="rounded-modal typo-body px-3.5 py-1.5 shadow-elevation-1"
      >
        {db.ai_run}
      </Button>

      <Tooltip content={safeMode ? db.safe_mode_on : db.safe_mode_off}>
        <Button
          type="button"
          onClick={onToggleSafeMode}
          variant={safeMode ? 'accent' : 'accent'}
          tone={safeMode ? 'success' : 'warning'}
          size="sm"
          icon={safeMode ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        >
          {safeMode ? db.safe : db.write}
        </Button>
      </Tooltip>
    </div>
  );
}
