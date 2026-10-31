import { useState, useEffect } from 'react';
import { Network } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { probeCliCapabilities } from '@/api/agents/evolution';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';

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

/** Returns the new parameters JSON, or null when the stored blob is not a
 *  parseable array. Falling back to [] here persisted a one-entry array over
 *  whatever the blob held, erasing every other persona parameter. */
function writeDeepFanout(parametersJson: string | null | undefined, on: boolean): string | null {
  let parsed: unknown;
  try {
    parsed = parametersJson ? JSON.parse(parametersJson) : [];
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  // A JSON array of parameter entries; each entry is read defensively below.
  let arr = parsed as Param[];
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
  // A failed probe is its own state, not a "no" answer: it must not tell a Max
  // user their plan lacks the capability.
  const [probeFailed, setProbeFailed] = useState(false);

  useEffect(() => {
    setOn(readDeepFanout(parameters));
  }, [parameters]);

  useEffect(() => {
    let cancelled = false;
    probeCliCapabilities()
      .then((c) => {
        if (!cancelled) setAvailable(c.deepFanoutAvailable);
      })
      .catch((err) => {
        silentCatch('DeepFanoutToggle:probeCliCapabilities')(err);
        if (!cancelled) setProbeFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePersona = useAgentStore((s) => s.updatePersona);

  const toggle = async () => {
    const next = !on;
    const written = writeDeepFanout(parameters, next);
    if (written === null) {
      // Leave the unreadable blob as it is - it may still be recoverable.
      toastCatch('DeepFanoutToggle:corruptParameters', t.agents.life.save_failed)(
        new Error('persona parameters are not a JSON array'),
      );
      return;
    }
    setOn(next);
    // Through the store, not the raw IPC wrapper: the raw write left the
    // store's persona row (the `parameters` prop this reads) on the old value,
    // so leaving and re-opening the Settings tab re-read it and showed the
    // switch OFF while the persisted flag was ON - and the next write built
    // its JSON from that stale copy. The store action also reports a failure
    // (Sentry + toast), so this catch rolls the optimistic switch back and
    // leaves only a breadcrumb.
    try {
      await updatePersona(personaId, { parameters: written });
    } catch (err) {
      setOn(!next);
      silentCatch('DeepFanoutToggle:updatePersona')(err);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-primary/20 bg-secondary/40 px-3 py-2">
      <div className="space-y-0.5 min-w-0">
        <div className="typo-body text-foreground flex items-center gap-1.5">
          <Network className="w-3.5 h-3.5 shrink-0" />
          {e.deep_fanout}
        </div>
        <div className="typo-caption text-foreground/90">
          {probeFailed
            ? e.deep_fanout_probe_failed
            : available === false ? e.deep_fanout_unavailable : e.deep_fanout_hint}
        </div>
      </div>
      <AccessibleToggle
        checked={on}
        onChange={toggle}
        label={e.deep_fanout}
        // Held only when it would turn the flag ON: switching a capability OFF
        // never needs the capability, so a persona already fanning out can
        // always be switched back (probe failure or a plan downgrade).
        disabled={(available === false || probeFailed) && !on}
      />
    </div>
  );
}
