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
import { OptionRow } from '@/features/shared/components/forms/OptionRow';
import { useState } from 'react';
import { Check, ChevronDown, Send } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { errMsg } from '@/stores/storeTypes';
import { createLogger } from '@/lib/log';
import Button from '@/features/shared/components/buttons/Button';

const logger = createLogger('remote-instruction-composer');

/** `peerId` pins the target (the device drawer): the device picker is hidden. */
export function RemoteInstructionComposer({ peerId: fixedPeerId }: { peerId?: string } = {}) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const addToast = useToastStore((s) => s.addToast);
  const devices = useSystemStore((s) => s.ownedDevices);
  const sendRemoteInstruction = useSystemStore((s) => s.sendRemoteInstruction);

  const [pickedPeerId, setPeerId] = useState<string | null>(null);
  const peerId = fixedPeerId ?? pickedPeerId;
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
      <p className="typo-caption text-foreground">
        {fixedPeerId ? st.send_instruction_hint_fixed : st.send_instruction_hint}
      </p>

      <div className="flex flex-wrap items-start gap-2">
        {!fixedPeerId && (
          <Listbox
            ariaLabel={st.send_instruction_device_label}
            className="min-w-[170px]"
            renderTrigger={({ isOpen, toggle }) => (
              <Button
                type="button"
                onClick={toggle}
                aria-expanded={isOpen}
                data-testid="remote-instruction-device"
                variant="secondary"
                size="sm"
                className="w-full"
                iconRight={<ChevronDown
                  className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />}
              >
                <span className="flex-1 text-left truncate">
                  {target ? target.displayName : st.send_instruction_pick_device}
                </span>
              </Button>
            )}
          >
            {({ close }) => (
              <div className="py-1">
                {devices.map((device) => (
                  <OptionRow key={device.peerId} role="option" selected={device.peerId === peerId} data-testid={`remote-instruction-device-${device.peerId}`} onSelect={() => { setPeerId(device.peerId); close(); }}>
                    <span className="flex-1 text-left truncate">{device.displayName}</span>
                    {device.peerId === peerId && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                  </OptionRow>
                ))}
              </div>
            )}
          </Listbox>
        )}

        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={st.send_instruction_placeholder}
          aria-label={st.send_instruction_title}
          data-testid="remote-instruction-input"
          className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-input typo-caption border border-hair bg-surface-2 text-foreground placeholder:text-ink-3 focus-ring"
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
