import { useMemo } from 'react';
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

  // One stable onRun per tool: the cards are memoised, so a fresh arrow per
  // render would repaint every card each time any one tool starts or settles.
  // runTool changes only with the persona, which also resets the card states.
  const runHandlers = useMemo(
    () => new Map(tools.map((tool) => [tool.id, (inputJson: string) => { void runTool(tool.id, inputJson); }])),
    [tools, runTool],
  );

  if (tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-foreground">
        <Wrench className="w-6 h-6 mb-2" />
        <p className="typo-body">{t.agents.tool_runner.no_tools}</p>
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
            onRun={runHandlers.get(tool.id)!}
          />
        );
      })}
    </div>
  );
}
