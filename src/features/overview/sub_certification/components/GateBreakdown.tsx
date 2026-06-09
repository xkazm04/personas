import { useTranslation } from '@/i18n/useTranslation';
import { Check, X, Minus, GitCommit } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import type { CodeTrack } from '@/lib/bindings/CodeTrack';
import type { CodeTrackStep } from '@/lib/bindings/CodeTrackStep';
import type { DeliveredIncrement } from '@/lib/bindings/DeliveredIncrement';

function GateRow({ label, step }: { label: string; step: CodeTrackStep | null }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const status = step?.status ?? null;
  const pass = status === 'pass';
  const fail = status === 'fail';

  const Icon = pass ? Check : fail ? X : Minus;
  const iconColor = pass ? 'text-emerald-400' : fail ? 'text-rose-400' : 'text-zinc-500';
  const statusLabel = pass ? c.gate_pass : fail ? c.gate_fail : '—';

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
      <span className="typo-caption text-foreground/90 w-14">{label}</span>
      <span className={`typo-caption ${pass ? 'text-emerald-400' : fail ? 'text-rose-400' : 'text-foreground/50'}`}>
        {statusLabel}
      </span>
      {step?.tail && (
        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip content={step.tail}>
            <span className="typo-caption text-foreground underline decoration-dotted cursor-help">
              {c.gate_log}
            </span>
          </Tooltip>
          <CopyButton text={step.tail} tooltip={c.gate_copy_log} iconSize="w-3 h-3" />
        </div>
      )}
    </div>
  );
}

/** Build / lint / test gate results + the delivered increment (merged files). */
export function GateBreakdown({
  codeTrack,
  increment,
}: {
  codeTrack: CodeTrack | null;
  increment: DeliveredIncrement | null;
}) {
  const { t } = useTranslation();
  const c = t.overview.certification;

  return (
    <div className="space-y-3">
      {codeTrack && (
        <div className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-1.5 divide-y divide-primary/5">
          <GateRow label={c.gate_build} step={codeTrack.build} />
          <GateRow label={c.gate_lint} step={codeTrack.lint} />
          <GateRow label={c.gate_test} step={codeTrack.test} />
        </div>
      )}

      {increment?.delivered && (
        <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2 typo-caption text-emerald-300/90">
            <GitCommit className="w-3.5 h-3.5" />
            <span>{c.delivered}</span>
            {increment.masterHead && (
              <code className="font-data text-foreground">{increment.masterHead.slice(0, 10)}</code>
            )}
          </div>
          {increment.sourceFiles.length > 0 && (
            <ul className="pl-5 space-y-0.5">
              {increment.sourceFiles.map((f) => (
                <li key={f} className="typo-caption font-data text-foreground">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
