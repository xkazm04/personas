// RemoteSteerRow — the three verbs a remote session accepts from here:
// send one line of input, wake it, kill it. A closed grammar on the wire
// (`RemoteSessionCommand`); there is no keystroke stream, by design.
//
// Each control is an `AsyncButton`, so the pressed one carries a real spinner
// while the peer acknowledges (up to `REMOTE_SESSION_ACK_TIMEOUT_MS`). Kill asks
// first. A refusal or an unreachable peer is toasted through `toastCatch`,
// which the error registry turns into "the other device is not reachable" /
// "refused that command" copy. Nothing here ever cancels on close.

import { useState } from 'react';
import { Send, Square, Sunrise } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { RemoteSessionState } from '@/lib/bindings/RemoteSessionState';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { isRemoteSessionSettled } from '@/lib/network/remoteSessionModel';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

export function RemoteSteerRow({ view, state, device }: {
  view: RemoteSessionView;
  state: RemoteSessionState;
  device: string;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const command = useSystemStore((s) => s.sendRemoteSessionCommand);
  const [text, setText] = useState('');
  const [confirmKill, setConfirmKill] = useState(false);
  const ended = isRemoteSessionSettled(view);
  const waiting = state === 'queued';
  const disabled = ended || waiting;

  const sendInput = () =>
    command(view.jobId, 'send_input', text)
      .then(() => setText(''))
      .catch(toastCatch('RemoteSteerRow:send_input'));
  const wake = () => command(view.jobId, 'wake').catch(toastCatch('RemoteSteerRow:wake'));
  const kill = () =>
    command(view.jobId, 'kill')
      .catch(toastCatch('RemoteSteerRow:kill'))
      .finally(() => setConfirmKill(false));

  return (
    <section aria-label={m.remote_steer_title} data-testid="remote-steer">
      <h4 className="typo-label text-primary">{m.remote_steer_title}</h4>
      {disabled && (
        <p className="mt-1 typo-caption text-foreground" data-testid="remote-steer-disabled">
          {ended ? m.remote_steer_ended : tx(m.remote_steer_queued, { device })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          placeholder={m.remote_input_placeholder}
          aria-label={m.remote_input_aria}
          className={`${INPUT_FIELD} min-w-0 flex-1 basis-60`}
          data-testid="remote-steer-input"
        />
        <AsyncButton
          size="sm"
          variant="primary"
          disabled={disabled || text.trim().length === 0}
          onClick={() => sendInput()}
          icon={<Send className="h-3.5 w-3.5" aria-hidden />}
          data-testid="remote-steer-send"
        >
          {m.remote_send_input}
        </AsyncButton>
        <AsyncButton
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => wake()}
          icon={<Sunrise className="h-3.5 w-3.5" aria-hidden />}
          data-testid="remote-steer-wake"
        >
          {m.remote_wake}
        </AsyncButton>
        <AsyncButton
          size="sm"
          variant="danger"
          disabled={disabled}
          onClick={() => setConfirmKill(true)}
          icon={<Square className="h-3.5 w-3.5" aria-hidden />}
          data-testid="remote-steer-kill"
        >
          {m.remote_kill}
        </AsyncButton>
      </div>
      {confirmKill && (
        <ConfirmDialog
          danger
          title={tx(m.remote_kill_confirm_title, { device })}
          body={tx(m.remote_kill_confirm_body, { device })}
          confirmLabel={m.remote_kill}
          onConfirm={() => kill()}
          onCancel={() => setConfirmKill(false)}
        />
      )}
    </section>
  );
}

export default RemoteSteerRow;
