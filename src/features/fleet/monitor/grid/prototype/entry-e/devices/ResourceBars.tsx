// The three-bar grammar the mesh draws load with: CPU, RAM and GPU as thin
// bars against their own track, each a share of ONE device's capacity. The
// bars ARE the numbers; the shares in words live in the tooltip. An axis with
// no reading (a null GPU, a charter not measured yet) draws NO bar at all, not
// an empty one: an empty track would claim a zero that was never measured.
//
// Used by the device strip's plates and by the charter card's measured row, so
// it carries Tailwind tokens only and none of the Annunciator's `ae-*` skin.

import type { LucideIcon } from 'lucide-react';
import { Cpu, Gpu, MemoryStick } from 'lucide-react';
import type { ResourceAxis } from '@/lib/bindings/ResourceAxis';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatNumeric } from '@/lib/utils/formatters';

export const AXIS_ICON: Record<ResourceAxis, LucideIcon> = { cpu: Cpu, ram: MemoryStick, gpu: Gpu };

/** Fill colour by how much of the device the axis holds. */
export function loadFill(share: number): string {
  if (share >= 0.85) return 'bg-status-error';
  if (share >= 0.6) return 'bg-status-warning';
  return 'bg-primary';
}

/** The axis names, for tooltips and accessible labels. */
export function useAxisLabels(): Record<ResourceAxis, string> {
  const m = useTranslation().t.monitor;
  return { cpu: m.mesh_axis_cpu, ram: m.mesh_axis_ram, gpu: m.mesh_axis_gpu };
}

/** "CPU 42% · RAM 63%" - every axis that has a reading. */
export function useLoadSentence() {
  const { language } = useTranslation();
  const labels = useAxisLabels();
  return (shares: Partial<Record<ResourceAxis, number | null>>): string =>
    (['cpu', 'ram', 'gpu'] as const)
      .filter((a) => shares[a] != null)
      .map((a) => `${labels[a]} ${formatNumeric(shares[a] ?? 0, 'ratio', { language })}`)
      .join(' · ');
}

export function ResourceBars({
  cpu, ram, gpu, dominant = null, className = '', testId,
}: {
  cpu: number | null;
  ram: number | null;
  gpu: number | null;
  /** Ringed, so the axis that decides the profile reads first. */
  dominant?: ResourceAxis | null;
  className?: string;
  testId?: string;
}) {
  const sentence = useLoadSentence()({ cpu, ram, gpu });
  const rows = ([['cpu', cpu], ['ram', ram], ['gpu', gpu]] as const).filter(([, v]) => v != null);
  if (rows.length === 0) return null;
  return (
    <Tooltip content={sentence} delay={300}>
      <span role="img" aria-label={sentence} className={`flex min-w-0 flex-col gap-1 ${className}`} data-testid={testId}>
        {rows.map(([axis, share]) => {
          const Icon = AXIS_ICON[axis];
          const v = Math.max(0, Math.min(1, share ?? 0));
          return (
            <span key={axis} className="flex min-w-0 items-center gap-1.5" data-axis={axis}>
              <Icon className={`h-3 w-3 flex-shrink-0 ${dominant === axis ? 'text-primary' : 'text-foreground'}`} aria-hidden />
              <span className={`relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10 ${dominant === axis ? 'ring-1 ring-primary/50' : ''}`}>
                <span className={`absolute inset-y-0 left-0 rounded-full ${loadFill(v)}`} style={{ width: `${Math.max(2, v * 100)}%` }} />
              </span>
            </span>
          );
        })}
      </span>
    </Tooltip>
  );
}
