import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import { useDebugger } from '../libs/useDebugger';
import type { DryRunState } from '../libs/debuggerTypes';
import DebuggerVariables from './DebuggerVariables';
import DebuggerControls from './DebuggerControls';
import DebuggerStepView from './DebuggerStepView';

export type { DryRunState, DryRunNodeData } from '../libs/debuggerTypes';

interface DryRunDebuggerProps {
  members: PersonaTeamMember[];
  connections: PersonaTeamConnection[];
  agentNames: Record<string, string>;
  agentRoles: Record<string, string>;
  onStateChange: (state: DryRunState) => void;
  onClose: () => void;
}

export default function DryRunDebugger({
  members,
  connections,
  agentNames,
  agentRoles,
  onStateChange,
  onClose,
}: DryRunDebuggerProps) {
  const dbg = useDebugger(members, connections, agentNames, agentRoles, onStateChange, onClose);

  const agentNameForInspected = useMemo(
    () => dbg.inspectedData ? (agentNames[dbg.inspectedData.memberId] || 'Agent') : '',
    [dbg.inspectedData, agentNames],
  );

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {/* Data Inspector Panel */}
      <AnimatePresence>
        {dbg.inspectedData && !dbg.panelCollapsed && (
          <DebuggerVariables
            inspectedData={dbg.inspectedData}
            agentName={agentNameForInspected}
            onCollapse={() => dbg.setPanelCollapsed(true)}
            onClose={() => dbg.setInspectedNode(null)}
          />
        )}
      </AnimatePresence>

      {/* Cycle Warning Banner */}
      {dbg.cycleNodeIds.size > 0 && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-300">
            <span className="font-semibold">Cycle detected</span>
            <span className="text-amber-300/80">
              {' — '}Execution order is arbitrary for:{' '}
              {Array.from(dbg.cycleNodeIds).map((id) => agentNames[id] || id).join(', ')}
              . Consider removing circular connections or marking them as feedback edges.
            </span>
          </div>
        </div>
      )}

      {/* Debugger Controls Bar */}
      <div className="bg-secondary/95 backdrop-blur-md border-t border-border/30 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <DebuggerControls
            paused={dbg.paused}
            isFinished={dbg.isFinished}
            isStarted={dbg.isStarted}
            stepIndex={dbg.stepIndex}
            totalSteps={dbg.executionOrder.length}
            breakpointCount={dbg.breakpoints.size}
            inspectedNode={dbg.inspectedNode}
            panelCollapsed={dbg.panelCollapsed}
            onPlay={dbg.handlePlay}
            onPause={dbg.handlePause}
            onStepForward={dbg.handleStepForward}
            onStop={dbg.handleStop}
            onExpandInspector={() => dbg.setPanelCollapsed(false)}
          />

          {/* Execution timeline dots */}
          <DebuggerStepView
            timeline={dbg.timeline}
            cycleNodeIds={dbg.cycleNodeIds}
            onToggleBreakpoint={dbg.toggleBreakpoint}
            onInspect={(id) => { dbg.setInspectedNode(id); dbg.setPanelCollapsed(false); }}
          />

          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
