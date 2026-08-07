/**
 * The operator's own door into `send_remote_instruction`: pick a paired device,
 * describe the errand, send.
 *
 * Athena can dispatch these herself (WP3), but without this the command has no
 * hands-on path, and "ask my other machine to do a thing" is exactly the kind of
 * one-off an operator wants to type rather than negotiate through a chat turn.
 *
 * Failure is shown IN PLACE rather than as a toast: the backend refuses typed
 * and early when the device is not paired or not reachable, and that answer
 * belongs next to the device the operator picked.
 */
import { useState } from 'react';
import { Check, ChevronDown, Send } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { errMsg } from '@/stores/storeTypes';
import { createLogger } from '@/lib/log';

const logger = createLogger('remote-instruction-composer');

export function RemoteInstructionComposer() {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const addToast = useToastStore((s) => s.addToast);
  const devices = useSystemStore((s) => s.ownedDevices);
  const sendRemoteInstruction = useSystemStore((s) => s.sendRemoteInstruction);

  const [peerId, setPeerId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (devices.length === 0) {
    return (
      <p data-testid="remote-instruction-no-devices" className="typo-caption text-foreground">
        {st.send_instruction_no_devices}
      </p>
    );
  }

  const target = devices.find((d) => d.peerId === peerId) ?? null;
  const canSend = target !== null && instruction.trim().length > 0;

  const send = async () => {
    if (!target) return;
    setError(null);
    try {
      await sendRemoteInstruction(target.peerId, instruction.trim());
      setInstruction('');
      addToast(tx(st.send_instruction_sent, { device: target.displayName }), 'success');
    } catch (err) {
      logger.warn('Remote instruction refused', { peerId: target.peerId, error: err });
      setError(errMsg(err, st.send_instruction_failed));
    }
  };

  return (
    <div data-testid="remote-instruction-composer" className="space-y-2">
      <p className="typo-caption text-foreground leading-relaxed">{st.send_instruction_hint}</p>

      <div className="flex flex-wrap items-start gap-2">
        <Listbox
          ariaLabel={st.send_instruction_device_label}
          className="min-w-[170px]"
          renderTrigger={({ isOpen, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={isOpen}
              data-testid="remote-instruction-device"
              className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-input typo-caption border border-primary/15 bg-secondary/40 text-foreground hover:border-primary/30 transition-colors"
            >
              <span className="flex-1 text-left truncate">
                {target ? target.displayName : st.send_instruction_pick_device}
              </span>
              <ChevronDown
                className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
          )}
        >
          {({ close }) => (
            <div className="py-1">
              {devices.map((device) => (
                <button
                  key={device.peerId}
                  type="button"
                  role="option"
                  aria-selected={device.peerId === peerId}
                  data-testid={`remote-instruction-device-${device.peerId}`}
                  onClick={() => {
                    setPeerId(device.peerId);
                    close();
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 typo-caption transition-colors hover:bg-secondary/40 ${
                    device.peerId === peerId ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  <span className="flex-1 text-left truncate">{device.displayName}</span>
                  {device.peerId === peerId && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </Listbox>

        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={st.send_instruction_placeholder}
          aria-label={st.send_instruction_title}
          data-testid="remote-instruction-input"
          className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-input typo-caption border border-primary/15 bg-secondary/40 text-foreground placeholder:text-foreground/50 focus-ring"
        />

        <AsyncButton
          size="sm"
          icon={<Send className="w-3.5 h-3.5" />}
          disabled={!canSend}
          onClick={send}
          loadingText={st.send_instruction_sending}
          data-testid="remote-instruction-send"
        >
          {st.send_instruction_submit}
        </AsyncButton>
      </div>

      {error && (
        <p role="alert" data-testid="remote-instruction-error" className="typo-caption text-status-warning">
          {error}
        </p>
      )}
    </div>
  );
}
