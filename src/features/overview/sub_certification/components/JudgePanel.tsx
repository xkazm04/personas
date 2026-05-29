import { useTranslation } from '@/i18n/useTranslation';
import { Gavel } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Badge } from '@/features/shared/components/display/Badge';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import type { Judge } from '@/lib/bindings/Judge';
import type { JudgePersona } from '@/lib/bindings/JudgePersona';

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-card bg-secondary/30 border border-primary/10">
      <span className="typo-caption text-foreground/60">{label}</span>
      {value == null ? (
        <span className="typo-heading text-foreground/50">—</span>
      ) : (
        <Numeric value={value} unit="plain" className="typo-heading text-foreground/90" />
      )}
    </div>
  );
}

function PersonaRow({ persona }: { persona: JudgePersona }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const d = persona.dims;
  const dimEntries: Array<[string, number | null]> = [
    [c.dim_correctness, d.correctness],
    [c.dim_actionability, d.actionability],
    [c.dim_specificity, d.specificity],
    [c.dim_role_fidelity, d.roleFidelity],
  ];
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center flex-wrap gap-2">
        <span className="typo-heading text-foreground/90">{persona.role ?? '—'}</span>
        {persona.workLabels.map((l) => (
          <Badge key={l} variant="neutral" size="sm">
            {l}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {dimEntries.map(([label, val]) => (
          <span key={label} className="typo-caption text-foreground/70">
            {label}: {val == null ? '—' : <Numeric value={val} unit="plain" className="text-foreground/90" />}
          </span>
        ))}
      </div>
      {persona.evidence.length > 0 && (
        <ul className="list-disc pl-4 space-y-1">
          {persona.evidence.map((e, i) => (
            <li key={i} className="typo-caption text-foreground/70">
              {e}
            </li>
          ))}
        </ul>
      )}
      {persona.note && <p className="typo-caption text-foreground/55 italic">{persona.note}</p>}
    </div>
  );
}

/** The LLM-judge panel — aggregate scores, portfolio balance, per-persona grades. */
export function JudgePanel({ judge }: { judge: Judge }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const pb = judge.portfolioBalance;
  const histogram = Object.entries(pb.labelsHistogram)
    .map(([label, n]) => [label, n ?? 0] as [string, number])
    .filter(([, n]) => n > 0);

  return (
    <SectionCard title={c.judge_title} size="md" status="info">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Stat label={c.judge_mean} value={judge.dims.meanJudge} />
          <Stat label={c.judge_min} value={judge.dims.minPersonaOutput} />
          <Stat label={c.judge_balance} value={judge.dims.portfolioBalance} />
        </div>

        {(histogram.length > 0 || pb.note) && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {histogram.map(([label, n]) => (
                <Badge key={label} variant="violet" size="sm">
                  {label} · {n}
                </Badge>
              ))}
            </div>
            {pb.note && <p className="typo-caption text-foreground/60 italic">{pb.note}</p>}
          </div>
        )}

        {judge.personas.length > 0 && (
          <div className="space-y-2">
            {judge.personas.map((p) => (
              <PersonaRow key={p.personaId ?? p.role ?? Math.random()} persona={p} />
            ))}
          </div>
        )}

        {judge.judgeNotes && (
          <div className="flex gap-2 rounded-card border border-primary/10 bg-secondary/20 p-3">
            <Gavel className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="typo-caption text-foreground/75">{judge.judgeNotes}</p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
