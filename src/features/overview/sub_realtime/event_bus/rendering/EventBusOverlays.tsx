import { motion, AnimatePresence } from 'framer-motion';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_LABELS } from '../../libs/visualizationHelpers';

// -- HTML overlays rendered on top of the SVG ---------------------

interface OverlaysProps {
  seenTypes: string[];
  droppedCount: number;
  isEmpty: boolean;
}

export function EventBusOverlays({ seenTypes, droppedCount, isEmpty }: OverlaysProps) {
  return (
    <>
      {/* Legend (only when traffic flowing) */}
      {seenTypes.length > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm border border-primary/10 rounded-xl px-3 py-2 flex items-center gap-3">
          <AnimatePresence initial={false}>
            {seenTypes.slice(0, 6).map((type) => (
              <motion.div
                key={type}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: EVENT_TYPE_HEX_COLORS[type] ?? '#818cf8' }}
                />
                <span className="text-sm font-mono text-muted-foreground/80">
                  {EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Dropped events indicator */}
      {droppedCount > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 flex-shrink-0" />
            <span className="text-xs font-mono text-amber-300/80">
              {droppedCount.toLocaleString()} earlier event{droppedCount !== 1 ? 's' : ''} not shown
            </span>
          </div>
        </div>
      )}

      {/* Idle empty state */}
      {isEmpty && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-background/60 backdrop-blur-sm border border-primary/10 rounded-xl px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan/40" />
            <span className="text-sm text-muted-foreground/60">
              Idle -- click <span className="font-medium text-purple-300/80">Test Flow</span> to simulate traffic
            </span>
          </div>
        </div>
      )}
    </>
  );
}
