import { useState, useEffect } from 'react';
import { Network } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { updatePersona, buildUpdateInput } from '@/api/agents/personas';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { toastCatch } from '@/lib/silentCatch';
import type { CliCapabilities } from '@/lib/bindings/CliCapabilities';

type Param = { key?: string; value?: unknown; type?: string };

function readDeepFanout(parametersJson: string | null | undefined): boolean {
  if (!parametersJson) return false;
  try {
    const arr = JSON.parse(parametersJson) as Param[];
    const p = arr.find((x) => x?.key === 'deep_fanout');
    return p?.value === true || p?.value === 'true';
  } catch {
    return false;
  }
}

function writeDeepFanout(parametersJson: string | null | undefined, on: boolean): string {
  let arr: Param[];
  try {
    arr = parametersJson ? (JSON.parse(parametersJson) as Param[]) : [];
  } catch {
    arr = [];
  }
  arr = arr.filter((x) => x?.key !== 'deep_fanout');
  if (on) arr.push({ key: 'deep_fanout', type: 'boolean', value: true });
  return JSON.stringify(arr);
}

/**
 * Persona-wide "deep fan-out" capability toggle (P4). Writes the `deep_fanout`
 * boolean parameter that `assemble_prompt` reads to inject the parallel-delegation
 * directive. Gated on `probe_cli_capabilities` — disabled with a hint on plans
 * that don't expose the Workflow/Task tools.
 */
export function DeepFanoutToggle({
  personaId,
  parameters,
}: {
  personaId: string;
  parameters: string | null;
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [on, setOn] = useState(() => readDeepFanout(parameters));
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setOn(readDeepFanout(parameters));
  }, [parameters]);

  useEffect(() => {
    let cancelled = false;
    invokeWithTimeout<CliCapabilities>('probe_cli_capabilities', {})
      .then((c) => {
        if (!cancelled) setAvailable(c.deepFanoutAvailable);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    updatePersona(personaId, buildUpdateInput({ parameters: writeDeepFanout(parameters, next) })).catch(
      (err: unknown) => {
        setOn(!next);
        toastCatch('Deep fan-out toggle')(err);
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-primary/20 bg-secondary/40 px-3 py-2">
      <div className="space-y-0.5 min-w-0">
        <div className="typo-body text-foreground flex items-center gap-1.5">
          <Network className="w-3.5 h-3.5 shrink-0" />
          {e.deep_fanout}
        </div>
        <div className="typo-caption text-foreground/90">
          {available === false ? e.deep_fanout_unavailable : e.deep_fanout_hint}
        </div>
      </div>
      <AccessibleToggle
        checked={on}
        onChange={toggle}
        label={e.deep_fanout}
        disabled={available === false}
      />
    </div>
  );
}
