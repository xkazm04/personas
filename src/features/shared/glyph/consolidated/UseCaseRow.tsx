import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Power, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CONNECTOR_META, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { MiniSigil } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/MiniSigil';
import {
  getHealthMeta,
  STATE_HEX,
  type DisplayUseCase,
} from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

const RUN_LOCK_MS = 60_000;
const SIGIL_SIZE = 72;

interface UseCaseRowProps {
  uc: DisplayUseCase;
  isPendingToggle: boolean;
  onOpen: () => void;
  onToggle: () => void;
  /** Optional — when omitted the run button is hidden (adoption / scratch
   *  pre-build don't have a runnable persona yet). */
  onRun?: () => void;
  /** Optional inline policy controls (memory / review / events / ...).
   *  Rendered between the title block and the run / power buttons.
   *  Caller-owned so each consolidated mode supplies its own affordances:
   *    - view mode → TilePolicyToggles
   *    - adoption / scratch → mode-specific equivalents (later commits) */
  policySlot?: React.ReactNode;
}

/**
 * Horizontal row rendering of a single capability for the Consolidated
 * layout. Sigil on the left anchors the row to the persona-level hero
 * above; title + trigger summary in the middle; run / power on the
 * right. Whole row is clickable to open the detail view; trailing
 * buttons stop propagation so they act independently.
 *
 * Per-petal interactivity (click trigger → schedule picker, etc.) is
 * not yet wired here — added in commit B once shared with hero scope.
 */
export function UseCaseRow({
  uc,
  isPendingToggle,
  onOpen,
  onToggle,
  onRun,
  policySlot,
}: UseCaseRowProps) {
  const { t, tx } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const isRunning = runStartedAt !== null;

  useEffect(() => {
    if (runStartedAt === null) return;
    const id = window.setTimeout(() => setRunStartedAt(null), RUN_LOCK_MS);
    return () => window.clearTimeout(id);
  }, [runStartedAt]);

  const health = getHealthMeta(t)[uc.health];
  const isDisabled = uc.health === 'disabled';
  const isAttention = uc.health === 'needs-attention';
  const stateHex = STATE_HEX[uc.health];
  const connectorMeta = uc.connectorKey ? CONNECTOR_META[uc.connectorKey] : null;

  const handleRunClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRun || isRunning || isDisabled) return;
    setRunStartedAt(Date.now());
    onRun();
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPendingToggle) return;
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative w-full text-left rounded-card border bg-secondary/25 hover:bg-secondary/40 transition-all cursor-pointer overflow-hidden ${
        isAttention
          ? 'border-status-warning/40 hover:border-status-warning/65'
          : isDisabled
            ? 'border-border/30 hover:border-border/55'
            : 'border-card-border hover:border-primary/45'
      }`}
      style={{
        boxShadow: hovered
          ? `0 0 0 1px ${
              isAttention ? '#fbbf24' : isDisabled ? 'rgba(148,163,184,0.4)' : 'rgb(var(--primary))'
            }2e inset`
          : undefined,
      }}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="relative shrink-0">
          <MiniSigil uc={uc} size={SIGIL_SIZE} isHovered={hovered} petalStyle="wedge" />
          <AnimatePresence>
            {isRunning && (
              <motion.span
                key="run-halo"
                aria-hidden
                className="absolute inset-0 m-auto rounded-full pointer-events-none"
                style={{ width: SIGIL_SIZE, height: SIGIL_SIZE }}
                initial={{ opacity: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.25 } }}
                animate={{
                  opacity: [0.85, 0],
                  boxShadow: [
                    `0 0 0 2px ${stateHex}77`,
                    `0 0 0 14px ${stateHex}00`,
                  ],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: [0.32, 0.72, 0, 1],
                }}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {connectorMeta && (
              <span
                className="shrink-0 inline-flex items-center justify-center rounded"
                style={{
                  width: 18,
                  height: 18,
                  background: isDisabled
                    ? 'rgba(148,163,184,0.16)'
                    : `${connectorMeta.color}1f`,
                  border: `1px solid ${
                    isDisabled ? 'rgba(148,163,184,0.32)' : connectorMeta.color + '4d'
                  }`,
                  opacity: isDisabled ? 0.7 : 1,
                }}
                title={uc.connector}
              >
                <ConnectorIcon meta={connectorMeta} size="w-3 h-3" />
              </span>
            )}
            <div
              className="typo-heading font-semibold leading-tight truncate"
              style={{
                color: isDisabled
                  ? 'rgb(var(--foreground) / 0.55)'
                  : 'rgb(var(--foreground) / 0.95)',
              }}
            >
              {uc.title}
            </div>
            {isAttention && (
              <span className="shrink-0 typo-label inline-flex items-center gap-1 text-status-warning">
                <AlertTriangle className="w-2.5 h-2.5" />
                {health.label}
              </span>
            )}
          </div>
          <div className="mt-1 typo-caption text-foreground/60 truncate">
            {uc.triggerLabel}
          </div>
        </div>

        {policySlot && (
          <div className="shrink-0 hidden md:flex items-center" onClick={(e) => e.stopPropagation()}>
            {policySlot}
          </div>
        )}

        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {onRun && (
            <button
              type="button"
              onClick={handleRunClick}
              disabled={isDisabled || isRunning}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                isRunning
                  ? 'border-status-info/45 bg-status-info/15 text-status-info'
                  : 'border-card-border bg-secondary/70 text-foreground/85 hover:text-status-info hover:border-status-info/45 hover:bg-status-info/10 disabled:opacity-40'
              }`}
              title={
                isRunning
                  ? t.agents.use_cases.running_label
                  : tx(t.agents.use_cases.run_title, { title: uc.title })
              }
            >
              {isRunning ? (
                <span
                  className="relative flex h-3.5 w-3.5 items-center justify-center"
                  aria-hidden
                >
                  <span className="animate-ping absolute h-full w-full rounded-full bg-status-info opacity-50" />
                  <span className="relative rounded-full h-2 w-2 bg-status-info" />
                </span>
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleClick}
            disabled={isPendingToggle}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
              isDisabled
                ? 'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20'
                : 'border-card-border bg-secondary/80 text-foreground/80 hover:text-foreground hover:border-primary/40'
            }`}
            title={
              isDisabled
                ? t.agents.use_cases.activate_capability
                : t.agents.use_cases.pause_capability
            }
          >
            <Power className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </button>
  );
}
