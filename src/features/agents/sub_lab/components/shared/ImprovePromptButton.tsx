import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';

interface ImprovePromptButtonProps {
  personaId: string;
  runId: string;
  mode: 'arena' | 'ab' | 'eval' | 'matrix';
  disabled?: boolean;
}

/**
 * Button that triggers a Matrix run to improve the persona's prompt
 * based on the results of the current lab run.
 */
export function ImprovePromptButton({ personaId, runId, mode, disabled }: ImprovePromptButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startMatrix = useAgentStore((s) => s.startMatrix);
  const addToast = useToastStore((s) => s.addToast);

  const handleClick = async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      const instruction = `Improve the prompt based on the ${mode} test results from run ${runId}. ` +
        `Analyze weaknesses and low-scoring scenarios, then generate an improved version ` +
        `that addresses the identified issues while preserving existing strengths.`;

      const newRunId = await startMatrix(personaId, instruction, []);
      if (newRunId) {
        setState('success');
        addToast('Improvement run started! Check the Matrix tab for results.', 'success');
      } else {
        setState('error');
        setErrorMsg('Failed to start improvement run');
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (state === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Improvement run started
      </span>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {errorMsg || 'Failed'}
        </span>
        <button
          onClick={handleClick}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled || state === 'loading'}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {state === 'loading' ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Generating improvements...
        </>
      ) : (
        <>
          <Wand2 className="w-3.5 h-3.5" />
          Improve Prompt from Results
        </>
      )}
    </button>
  );
}
