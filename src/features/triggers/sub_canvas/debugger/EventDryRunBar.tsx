import { useState } from 'react';
import { Play, SkipForward, Square, ChevronDown } from 'lucide-react';
import type { DryRunState } from '../hooks/useEventCanvasState';

interface Props {
  dryRunState: DryRunState;
  availableEventTypes: string[];
  onStart: (eventType: string) => void;
  onStep: () => void;
  onStop: () => void;
}

export function EventDryRunBar({ dryRunState, availableEventTypes, onStart, onStep, onStop }: Props) {
  const [selectedEvent, setSelectedEvent] = useState(dryRunState.eventType || availableEventTypes[0] || '');
  const isActive = dryRunState.active;
  const isDone = dryRunState.currentStep >= dryRunState.totalSteps && dryRunState.totalSteps > 0;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2.5 bg-card border border-primary/15 rounded-xl shadow-xl">
      {/* Event selector */}
      <div className="relative">
        <select
          value={selectedEvent}
          onChange={e => setSelectedEvent(e.target.value)}
          disabled={isActive}
          className="appearance-none pl-2.5 pr-7 py-1 text-[11px] font-medium rounded-md bg-secondary/50 border border-primary/10 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
        >
          {availableEventTypes.map(et => (
            <option key={et} value={et}>{et}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50 pointer-events-none" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {!isActive ? (
          <button
            onClick={() => onStart(selectedEvent)}
            disabled={!selectedEvent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
          >
            <Play className="w-3 h-3" />
            Start
          </button>
        ) : (
          <>
            <button
              onClick={onStep}
              disabled={isDone}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-40 transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              Step
            </button>
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          </>
        )}
      </div>

      {/* Step counter */}
      {isActive && (
        <div className="flex items-center gap-2 pl-2 border-l border-primary/10">
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {Math.max(0, dryRunState.currentStep + 1)} / {dryRunState.totalSteps}
          </span>
          {isDone && (
            <span className="text-[10px] text-emerald-400 font-medium">Complete</span>
          )}
        </div>
      )}
    </div>
  );
}
