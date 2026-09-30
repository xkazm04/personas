import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { primaryAction } from './tableKeys';

/**
 * The dock under the thread: the keys for this moment, never more. Enter is
 * the primary (start, continue, open our chat); B goes back, S skips. The
 * full list is one `?` away.
 */
function Act({ k, label, onPress, primary, disabled, testId }: {
  k: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <Button
      variant="ghost"
      className={`tb-act ${primary ? 'primary' : ''}`}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={disabled ? undefined : onPress}
      data-testid={testId}
    >
      <kbd>{k}</kbd>
      <span className="typo-body">{label}</span>
    </Button>
  );
}

export function TableDock({ engine, lineDone }: { engine: CreateAthenaEngine; lineDone: boolean }) {
  const { t } = useTranslation();
  const c = t.athena;
  const { card, actions, canBack } = engine;
  const primary = primaryAction(engine);
  const terminal = card.kind === 'intro' || card.kind === 'handoff';
  const primaryLabel =
    card.kind === 'intro'
      ? card.mode === 'resume' ? c.create_resume : c.create_start
      : card.kind === 'handoff'
        ? c.create_handoff_open
        : card.kind === 'voice_pick'
          ? c.create_voice_choose
          : card.kind === 'install' && card.state.phase === 'idle'
            ? c.create_install_start
            : c.create_next;

  return (
    <footer className="tb-dock" data-testid="create-athena-table-dock">
      <div className="tb-dock-inner">
        {canBack && <Act k="B" label={c.create_back} onPress={actions.back} testId="create-athena-back" />}
        {card.kind === 'intro' && card.mode === 'done' && (
          <Act k="Esc" label={c.create_skip_all} onPress={actions.finish} testId="create-athena-skip-all" />
        )}
        <span className="tb-dock-sp" />
        {!terminal && <Act k="S" label={c.create_skip} onPress={actions.skip} testId="create-athena-skip" />}
        <Act
          k="Enter"
          label={primaryLabel}
          onPress={() => primary?.()}
          primary
          disabled={!primary || !lineDone}
          testId={card.kind === 'intro' ? 'create-athena-start' : card.kind === 'handoff' ? 'create-athena-handoff-open' : 'create-athena-next'}
        />
      </div>
    </footer>
  );
}
