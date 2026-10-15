// Where a mirrored mandate lives (WP9). A mandate this device only mirrors
// wears the mark every remote line on the board wears (`DeviceGlyph`: a
// laptop, a house on the operator's home device), so it reads like a peer's
// agent or a remote session: shown here, decided here, kept there. The mark
// sits after a name in a row; the chip stands beside the state chip in the
// mandate's title row and names the device. Nothing renders on the home device
// (`mirror` is null there).

import { House, Laptop } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateMirror } from '@/lib/bindings/MandateMirror';
import { useSystemStore } from '@/stores/systemStore';

function useMirrorIcon(mirror: MandateMirror) {
  const home = useSystemStore((s) => s.meshDevices.some((d) => d.peerId === mirror.homePeerId && d.isHome));
  return home ? House : Laptop;
}

/** The device mark after a mirrored mandate's name; nothing for a mandate that lives here. */
export function MirrorMark({ mirror }: { mirror: MandateMirror | null | undefined }) {
  if (!mirror) return null;
  return <MirrorIcon mirror={mirror} />;
}

function MirrorIcon({ mirror }: { mirror: MandateMirror }) {
  const { t, tx } = useTranslation();
  const Icon = useMirrorIcon(mirror);
  const label = tx(t.monitor.remote_on_device, { device: mirror.homeName });
  return (
    <span role="img" aria-label={label} className="inline-flex flex-shrink-0 text-foreground" data-testid="mandate-mirror-mark" data-home={mirror.homePeerId}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

/** The title row's second window: the device mark and "On <device>". */
export function MirrorChip({ mirror }: { mirror: MandateMirror | null | undefined }) {
  if (!mirror) return null;
  return <MirrorChipBody mirror={mirror} />;
}

function MirrorChipBody({ mirror }: { mirror: MandateMirror }) {
  const { t, tx } = useTranslation();
  const Icon = useMirrorIcon(mirror);
  return (
    <span className="ae-win inline-flex flex-shrink-0 items-center gap-2 rounded-input px-2.5 py-0.5" data-testid="mandate-mirror" data-home={mirror.homePeerId}>
      <Icon className="h-3.5 w-3.5 text-foreground" aria-hidden />
      <span className="typo-caption text-foreground">{tx(t.monitor.remote_on_device, { device: mirror.homeName })}</span>
    </span>
  );
}
