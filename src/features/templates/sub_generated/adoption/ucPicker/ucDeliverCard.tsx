// Delivery destinations card (view mode). Renders a 2-column grid of
// dominant glyph tiles — no card wrappers, glyph fills the cell. Labels
// are hidden by default and fade in on hover (reserved 16 px slot so
// the layout doesn't shift). Active tiles render in primary cyan; the
// pulse halo animates during test firing.

import { motion } from 'framer-motion';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { Panel } from './ucPanel';
import type { Destination, DestId } from './ucPickerTypes';

export function DeliverCard({
  destinations,
  active,
  firing,
}: {
  destinations: Destination[];
  active: Set<DestId>;
  firing: boolean;
}) {
  return (
    <Panel ariaLabel="Delivery channels" square>
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-3 w-full px-1">
          {destinations.map((dest, i) => (
            <IconTile
              key={dest.id}
              destination={dest}
              active={active.has(dest.id)}
              firing={firing && active.has(dest.id)}
              delay={i * 0.08}
            />
          ))}
          {destinations.length === 0 && (
            <span className="col-span-2 text-sm text-foreground/55 italic text-center">
              No channels
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function IconTile({
  destination,
  active,
  firing,
  delay,
}: {
  destination: Destination;
  active: boolean;
  firing: boolean;
  delay: number;
}) {
  return (
    <motion.span
      title={destination.label}
      className={`group relative flex flex-col items-center justify-start cursor-default transition-[filter,color] duration-200 hover:brightness-125 ${
        active ? 'text-primary' : 'text-foreground/35 hover:text-foreground/60'
      }`}
      animate={
        firing
          ? {
              filter: [
                'drop-shadow(0 0 0 transparent)',
                'drop-shadow(0 0 10px color-mix(in srgb, var(--color-primary) 55%, transparent))',
                'drop-shadow(0 0 0 transparent)',
              ],
            }
          : {}
      }
      transition={firing ? { duration: 1.1, delay, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <span className="relative aspect-square w-full flex items-center justify-center">
        {destination.kind === 'channel' && destination.meta ? (
          <ConnectorIcon meta={destination.meta} size="w-full h-full" />
        ) : destination.icon ? (
          <destination.icon className="w-full h-full" />
        ) : null}
      </span>
      <span
        className={`h-4 mt-1 leading-none font-medium tracking-tight text-[11px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 truncate max-w-full ${
          active ? 'text-primary' : 'text-primary/80'
        }`}
      >
        {destination.shortLabel}
      </span>
    </motion.span>
  );
}
