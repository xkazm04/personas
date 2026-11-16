/**
 * The collapsed "Technical details" of a paired PC: its peer id and the public
 * key it proved at pairing time. Kept out of sight because nobody needs them
 * to use the PC, and someone debugging a pairing does.
 */
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { KeyValueGrid } from '@/features/shared/components/kit';
import { Button, CopyButton } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { useTranslation } from '@/i18n/useTranslation';
import type { OwnedDevice } from '@/api/network/devices';

export function DeviceTechnicalDetails({ device }: { device: OwnedDevice }) {
  const { t } = useTranslation();
  const st = t.sharing;
  const [open, setOpen] = useState(false);
  const regionId = useId();

  return (
    <div data-testid="device-technical-details">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        iconRight={<ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />}
        data-testid="device-technical-toggle"
      >
        {st.technical_details}
      </Button>
      <Collapse open={open} unmountWhenClosed>
        <div id={regionId} className="pt-2">
          <KeyValueGrid
            min="100%"
            items={[
              { k: st.peer_id_label, v: <UuidLabel value={device.peerId} /> },
              {
                k: st.public_key_label,
                v: device.publicKey ? (
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <span className="typo-code break-all">{device.publicKey}</span>
                    <CopyButton text={device.publicKey} />
                  </span>
                ) : null,
                none: st.public_key_none,
              },
            ]}
          />
        </div>
      </Collapse>
    </div>
  );
}
