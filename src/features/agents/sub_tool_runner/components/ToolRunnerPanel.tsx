import { Wrench } from 'lucide-react';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import { ToolInvocationCard } from './ToolInvocationCard';
import { useToolRunner } from '../libs/useToolRunner';
import { useTranslation } from '@/i18n/useTranslation';

interface ToolRunnerPanelProps {
  tools: PersonaToolDefinition[];
  personaId: string | undefined;
}

export function ToolRunnerPanel({ tools, personaId }: ToolRunnerPanelProps) {
  const { t } = useTranslation();
  const { getState, runTool } = useToolRunner(personaId);

  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-foreground">
        <Wrench className="w-6 h-6 mb-2" />
        <p className="text-sm">{t.agents.tool_runner.no_tools}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tools.map((tool) => {
        const state = getState(tool.id);
        return (
          <ToolInvocationCard
            key={tool.id}
            tool={tool}
            isRunning={state.isRunning}
            result={state.result}
            error={state.error}
            onRun={(inputJson) => runTool(tool.id, inputJson)}
          />
        );
      })}
    </div>
  );
}
