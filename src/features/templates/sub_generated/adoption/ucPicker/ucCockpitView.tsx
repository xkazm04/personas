// View-mode layout for a single UC card. Three-card row:
//   • TimeCard  — square, 220×220
//   • subtitle  — middle, fills remaining width
//   • DeliverCard — square, 220×220
// Bottom-right has a "Configure" button that flips into edit mode.

import { Pencil } from 'lucide-react';
import type { TriggerSelection } from '../useCasePickerShared';
import { parseTriggerDisplay } from './ucPickerHelpers';
import type { Destination, DestId } from './ucPickerTypes';
import { TimeCard } from './ucTimeCard';
import { DeliverCard } from './ucDeliverCard';
import { Panel } from './ucPanel';

interface Props {
  code: string;
  subtitle: string;
  trigger: TriggerSelection;
  destinations: Destination[];
  activeDestinations: Set<DestId>;
  firing: boolean;
  onEdit: () => void;
}

export function CockpitView({
  subtitle,
  trigger,
  destinations,
  activeDestinations,
  firing,
  onEdit,
}: Props) {
  const display = parseTriggerDisplay(trigger);
  return (
    <div
      className="relative px-5 py-6 bg-gradient-to-b from-foreground/[0.03] to-foreground/[0.06]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--color-primary) 5%, transparent) 0%, transparent 50%), radial-gradient(circle at 80% 100%, color-mix(in srgb, var(--color-status-warning) 4%, transparent) 0%, transparent 50%)',
      }}
    >
      <div className="grid grid-cols-[220px_minmax(0,1fr)_220px] gap-8 max-w-[980px] mx-auto">
        <TimeCard display={display} trigger={trigger} firing={firing} />
        <CapabilityCard subtitle={subtitle} />
        <DeliverCard destinations={destinations} active={activeDestinations} firing={firing} />
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="focus-ring absolute bottom-3 right-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-caption uppercase tracking-wider font-semibold text-foreground/55 hover:text-primary hover:bg-primary/[0.08] transition-colors"
      >
        <Pencil className="w-3 h-3" />
        Configure
      </button>
    </div>
  );
}

// ─── Capability card — middle column; subtitle is the hero content ───────

function CapabilityCard({ subtitle }: { subtitle: string }) {
  return (
    <Panel ariaLabel="Capability">
      <div className="flex-1 flex items-center">
        <p className="text-xl font-medium text-foreground/95 leading-snug">{subtitle}</p>
      </div>
    </Panel>
  );
}
