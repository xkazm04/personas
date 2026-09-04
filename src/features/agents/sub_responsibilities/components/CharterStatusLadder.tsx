import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { toastCatch } from '@/lib/silentCatch';
import { STATUS_VARIANT } from '../libs/charterMeta';

/** The DB CHECK-enforced status vocabulary, in lifecycle order. */
export const CHARTER_STATUSES = ['draft', 'active', 'suspended', 'retired'] as const;
export type CharterStatus = (typeof CHARTER_STATUSES)[number];

interface CharterStatusLadderProps {
  status: string;
  onRetire: () => Promise<void>;
  onSetStatus: (status: CharterStatus) => Promise<void>;
}

/**
 * The charter lifecycle, shown as the whole ladder rather than a single badge —
 * `draft` and `suspended` existed in the schema from WP1 but nothing rendered
 * them, so the states read as unreachable even where they were not.
 *
 * Every rung is reachable. `draft` is where an agent-proposed charter lands on
 * approval (`growth::apply_responsibility_draft` forces it), so an activation
 * path is what closes the propose-adopt loop rather than leaving every proposed
 * charter inert — that is why `set_persona_responsibility_status` exists beside
 * the narrower `retire_persona_responsibility`.
 */
export function CharterStatusLadder({
  status,
  onRetire,
  onSetStatus,
}: CharterStatusLadderProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const life = t.agents.life;
  const [confirmRetire, setConfirmRetire] = useState(false);

  const labels: Record<string, string> = {
    draft: life.resp_status_draft,
    active: t.common.active,
    suspended: life.resp_status_suspended,
    retired: life.resp_status_retired,
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="resp-status-ladder">
      {CHARTER_STATUSES.map((s) => {
        const current = s === status;
        return (
          <StatusBadge
            key={s}
            size="sm"
            variant={current ? STATUS_VARIANT[s] ?? 'neutral' : 'neutral'}
            className={current ? '' : 'opacity-40'}
          >
            <span data-testid={`resp-status-${s}`}>{labels[s] ?? s}</span>
          </StatusBadge>
        );
      })}

      <div className="flex-1" />

      {status !== 'retired' ? (
        <AsyncButton
          size="xs"
          variant="danger"
          onClick={async () => setConfirmRetire(true)}
          data-testid="resp-retire"
        >
          {life.resp_retire}
        </AsyncButton>
      ) : null}

      {status === 'draft' || status === 'suspended' ? (
        <AsyncButton
          size="xs"
          variant="secondary"
          onClick={() => onSetStatus('active')}
          data-testid="resp-activate"
        >
          {c.activate}
        </AsyncButton>
      ) : null}

      {status === 'active' ? (
        <AsyncButton
          size="xs"
          variant="secondary"
          onClick={() => onSetStatus('suspended')}
          data-testid="resp-suspend"
        >
          {c.suspend}
        </AsyncButton>
      ) : null}

      {confirmRetire && (
        <ConfirmDialog
          title={life.resp_retire_confirm_title}
          body={life.resp_retire_confirm_body}
          danger
          confirmLabel={life.resp_retire}
          onConfirm={async () => {
            try {
              await onRetire();
              setConfirmRetire(false);
            } catch (err) {
              toastCatch('responsibilities:retire', life.save_failed)(err);
            }
          }}
          onCancel={() => setConfirmRetire(false)}
        />
      )}
    </div>
  );
}
