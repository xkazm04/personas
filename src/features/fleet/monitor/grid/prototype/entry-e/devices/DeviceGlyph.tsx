// DeviceGlyph - "this line lives on another device", the mark every peer line
// and every remote session line wears: a laptop, a house on the operator's home
// device, and the device's name in the tooltip. PersonaResource / SessionResource
// - the resource glyph a line drops in without knowing where its reading comes from.

import { memo } from 'react';
import { House, Laptop } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { ResourceGlyph } from './ResourceGlyph';
import { shareOf, usePersonaDominant, usePersonaSample, useSessionResource } from './useResourceSamples';

export const DeviceGlyph = memo(function DeviceGlyph({ peerId, name }: { peerId: string; name: string }) {
  const { t, tx } = useTranslation();
  const home = useSystemStore((s) => s.meshDevices.some((d) => d.peerId === peerId && d.isHome));
  const label = tx(t.monitor.remote_on_device, { device: name }) + (home ? ` · ${t.monitor.mesh_home}` : '');
  const Icon = home ? House : Laptop;
  return (
    <Tooltip content={label} delay={300}>
      <span role="img" aria-label={label} className="inline-flex flex-shrink-0" data-testid="mesh-device-glyph">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Tooltip>
  );
});

/** A local persona: its running execution's live sample, else this device's snapshot axis. */
export function PersonaResource({ personaId }: { personaId: string }) {
  const sample = usePersonaSample(personaId);
  const dominant = usePersonaDominant(personaId);
  if (sample) return <ResourceGlyph axis={sample.dominant} share={shareOf(sample)} />;
  return <ResourceGlyph axis={dominant} />;
}

/** A local fleet session's live sample. */
export function SessionResource({ sessionId }: { sessionId: string }) {
  const sample = useSessionResource(sessionId);
  return sample ? <ResourceGlyph axis={sample.dominant} share={shareOf(sample)} /> : null;
}

