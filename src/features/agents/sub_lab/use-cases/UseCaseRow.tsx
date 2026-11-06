import type { ReactNode } from 'react';
import { Play, Clock, Info, Settings2, Cpu, Bell, FlaskConical, Power, PowerOff } from 'lucide-react';
import type { UseCaseItem } from './UseCasesList';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';


const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-status-error/10 border-status-error/15',   text: 'text-status-error' },
  'data-sync':    { bg: 'bg-role-external/10 border-role-external/15',   text: 'text-role-external' },
  monitoring:     { bg: 'bg-status-warning/10 border-status-warning/15', text: 'text-status-warning' },
  automation:     { bg: 'bg-role-agent/10 border-role-agent/15', text: 'text-role-agent' },
  communication:  { bg: 'bg-status-info/10 border-status-info/15',   text: 'text-status-info' },
  reporting:      { bg: 'bg-status-success/10 border-status-success/15', text: 'text-status-success' },
};

const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  e2e:            { label: 'E2E',  bg: 'bg-status-success/10 border-status-success/20', text: 'text-status-success' },
  mock:           { label: 'MOCK', bg: 'bg-status-warning/10 border-status-warning/20',   text: 'text-status-warning' },
  non_executable: { label: 'INFO', bg: 'bg-surface-2 border-hair',     text: 'text-ink-1' },
};

interface UseCaseRowProps {
  useCase: UseCaseItem;
  index: number;
  isExecuting: boolean;
  isActive: boolean;
  onExecute: (useCaseId: string, sampleInput?: Record<string, unknown>) => void;
  onToggleHistory: (useCaseId: string) => void;
  historyExpanded: boolean;
  historyContent?: ReactNode;
  onToggleConfig?: (useCaseId: string) => void;
  configExpanded?: boolean;
  configContent?: ReactNode;
  /** Phase C3 — flip the capability's `enabled` flag (cascades to triggers/subs). */
  onToggleEnabled?: (useCaseId: string, enabled: boolean) => void;
  /** Phase C3 — run the capability as a simulation (no real notifications). */
  onSimulate?: (useCaseId: string) => void;
  /** Set true while a toggle IPC is in flight to prevent double-clicks. */
  toggling?: boolean;
}

export function UseCaseRow({
  useCase,
  index,
  isExecuting,
  isActive,
  onExecute,
  onToggleHistory,
  historyExpanded,
  historyContent,
  onToggleConfig,
  configExpanded,
  configContent,
  onToggleEnabled,
  onSimulate,
  toggling,
}: UseCaseRowProps) {
  const { t } = useTranslation();
  const mode = useCase.execution_mode ?? 'e2e';
  const modeBadge = (MODE_BADGE[mode] ?? MODE_BADGE.e2e)!;
  const catStyle = useCase.category ? CATEGORY_STYLES[useCase.category] : null;

  // Phase C3: a capability is active unless `enabled === false`. Disabled
  // capabilities grey out and block Run (but not Simulate).
  const isEnabled = useCase.enabled !== false;
  const isRunnable = mode !== 'non_executable' && isEnabled;
  const playDisabled = !isRunnable || (isExecuting && !isActive);
  const simulateDisabled = mode === 'non_executable' || (isExecuting && !isActive);

  const hasModelOverride = !!useCase.model_override;
  const hasNotifications = (useCase.notification_channels?.length ?? 0) > 0;
  const hasAnyConfig = hasModelOverride || hasNotifications;

  const summary = useCase.capability_summary ?? useCase.description;

  return (
    <div
      className={`rounded-card border overflow-hidden transition-opacity ${
        isEnabled
          ? 'border-hair bg-surface-1'
          : 'border-hair bg-surface-1 opacity-60'
      }`}
      data-use-case-id={useCase.id}
      data-enabled={isEnabled}
    >
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          {/* Index number */}
          <span className="typo-heading text-ink-1 mt-0.5 w-5 text-right flex-shrink-0">
            {index + 1}.
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="typo-heading text-ink-1">{useCase.title}</p>
              {useCase.category && catStyle && (
                <span className={`px-1.5 py-0.5 typo-label rounded-interactive border ${catStyle.bg} ${catStyle.text}`}>
                  {useCase.category.replace('-', ' ')}
                </span>
              )}
              <span className={`px-1.5 py-0.5 typo-label rounded-interactive border ${modeBadge.bg} ${modeBadge.text}`}>
                {modeBadge.label}
              </span>
              {!isEnabled && (
                <span className="inline-flex items-center typo-label text-ink-1">
                  PAUSED
                </span>
              )}
            </div>
            <p className="typo-body text-ink-2 mt-1">{summary}</p>
            {/* Override indicators */}
            {hasAnyConfig && (
              <div className="flex items-center gap-2 mt-1.5">
                {hasModelOverride && (
                  <span className="flex items-center gap-1 typo-caption text-primary/60">
                    <Cpu className="w-2.5 h-2.5" /> {t.shared.use_cases_extra.custom_model}
                  </span>
                )}
                {hasNotifications && (
                  <span className="flex items-center gap-1 typo-caption text-status-warning">
                    <Bell className="w-2.5 h-2.5" /> Notifications
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Enable/disable toggle (Phase C3) */}
            {onToggleEnabled && (
              <button
                type="button"
                onClick={() => onToggleEnabled(useCase.id, !isEnabled)}
                disabled={toggling}
                data-testid={`use-case-toggle-${useCase.id}`}
                className={`p-1.5 rounded-card border transition-colors ${
                  isEnabled
                    ? 'bg-status-success/10 border-status-success/20 text-status-success hover:bg-status-success/20'
                    : 'bg-surface-2 border-hair text-ink-1 hover:text-ink-1 hover:border-primary/25'
                } ${toggling ? 'opacity-50 cursor-wait' : ''}`}
                title={
                  isEnabled
                    ? 'Pause this capability (stops triggers + subscriptions)'
                    : 'Activate this capability'
                }
                aria-label={isEnabled ? 'Pause capability' : 'Activate capability'}
              >
                {isEnabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
              </button>
            )}

            {/* Play button */}
            <button
              type="button"
              onClick={() => onExecute(useCase.id, useCase.sample_input ?? undefined)}
              disabled={playDisabled}
              data-testid={`use-case-run-${useCase.id}`}
              className={`p-1.5 rounded-card border transition-colors ${
                isActive
                  ? 'bg-primary/20 border-primary/30 text-primary'
                  : playDisabled
                    ? 'bg-surface-1 border-hair text-ink-1 cursor-not-allowed'
                    : 'bg-surface-2 border-hair text-ink-1 hover:bg-surface-2 hover:text-primary hover:border-primary/25'
              }`}
              title={
                mode === 'non_executable'
                  ? 'This use case is informational only'
                  : !isEnabled
                    ? 'Capability is paused — activate it to run'
                    : isExecuting && !isActive
                      ? 'Another use case is executing'
                      : `Run ${useCase.title}`
              }
            >
              {isActive ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-40" />
                  <span className="relative rounded-full h-2 w-2 bg-primary" />
                </span>
              ) : mode === 'non_executable' ? (
                <Info className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Simulate button (Phase C3) — bypasses enable gate, suppresses notifications */}
            {onSimulate && (
              <button
                type="button"
                onClick={() => onSimulate(useCase.id)}
                disabled={simulateDisabled}
                data-testid={`use-case-simulate-${useCase.id}`}
                className={`p-1.5 rounded-card border transition-colors ${
                  simulateDisabled
                    ? 'bg-surface-1 border-hair text-ink-1 cursor-not-allowed'
                    : 'bg-status-warning/10 border-status-warning/20 text-status-warning hover:bg-status-warning/20 hover:text-status-warning'
                }`}
                title={
                  simulateDisabled
                    ? 'Simulation unavailable while another execution is running'
                    : 'Simulate — real API calls, no notifications delivered'
                }
                aria-label={debtText("auto_simulate_capability_3ddcb2d1")}
              >
                <FlaskConical className="w-3.5 h-3.5" />
              </button>
            )}

            {/* History toggle */}
            <button
              type="button"
              onClick={() => onToggleHistory(useCase.id)}
              className={`p-1.5 rounded-card border transition-colors ${
                historyExpanded
                  ? 'bg-primary/10 border-hair text-primary/80'
                  : 'bg-surface-2 border-hair text-ink-1 hover:text-ink-2 hover:border-primary/25'
              }`}
              title={t.shared.use_cases_extra.toggle_history}
            >
              <Clock className="w-3.5 h-3.5" />
            </button>

            {/* Config toggle */}
            {onToggleConfig && (
              <button
                type="button"
                onClick={() => onToggleConfig(useCase.id)}
                className={`p-1.5 rounded-card border transition-colors ${
                  configExpanded
                    ? 'bg-role-agent/15 border-role-agent/25 text-role-agent'
                    : hasAnyConfig
                      ? 'bg-surface-2 border-hair text-role-agent hover:text-role-agent hover:border-role-agent/25'
                      : 'bg-surface-2 border-hair text-ink-1 hover:text-ink-2 hover:border-primary/25'
                }`}
                title={t.shared.use_cases_extra.configure_model}
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline history slot */}
      {historyExpanded && historyContent && (
        <div className="border-t border-hair bg-background/30">
          {historyContent}
        </div>
      )}

      {/* Inline config slot */}
      {configExpanded && configContent && (
        <div className="border-t border-role-agent/15 bg-role-agent/3 p-3.5">
          {configContent}
        </div>
      )}
    </div>
  );
}
