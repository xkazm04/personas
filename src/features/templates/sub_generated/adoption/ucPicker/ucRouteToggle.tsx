// Per-event × per-destination routing toggle used inside the Forge
// editor (edit mode). Small circular chip with the destination's icon;
// pulses primary when active during a test firing.

import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { Destination } from './ucPickerTypes';
import Button from '@/features/shared/components/buttons/Button';

export function RouteToggle({
  destination,
  active,
  firing,
  delay,
  onToggle,
  onRemove,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  delay: number;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative group">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`focus-ring w-8 h-8 rounded-full flex items-center justify-center transition-all ${
          active
            ? 'bg-primary/15 ring-2 ring-primary/55 text-primary shadow-elevation-1'
            : 'bg-foreground/[0.04] ring-1 ring-border text-foreground hover:text-foreground hover:ring-foreground/40'
        }`}
        animate={
          firing
            ? {
                boxShadow: [
                  '0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)',
                  '0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent)',
                ],
              }
            : {}
        }
        transition={firing ? { duration: 0.9, delay, repeat: Infinity, ease: 'easeOut' } : undefined}
      >
        {destination.kind === 'channel' && destination.meta ? (
          <ConnectorIcon meta={destination.meta} size="w-4 h-4" />
        ) : destination.icon ? (
          <destination.icon className="w-4 h-4" />
        ) : null}
      </motion.button>
      {onRemove && (
        <Button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          variant="danger"
          size="icon-sm"
          className="absolute opacity-0 group-hover:opacity-100"
        >
          <X className="w-2.5 h-2.5" strokeWidth={3} />
        </Button>
      )}
    </div>
  );
}
