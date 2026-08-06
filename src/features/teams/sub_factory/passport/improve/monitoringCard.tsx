// The shared shell every Monitoring variant draws its capability on, plus the
// pieces all three fill it with. Hoisted the moment a second variant needed the
// same structure — the variants differ in the INFORMATION DESIGN inside the
// card, never in the card.
//
// Typography and surface follow SkillsWorkbench exactly, because the first pass
// did not and it showed. The rule there: NEUTRAL surfaces
// (`rounded-card border-primary/12 bg-secondary/[0.15]`), a single primary
// accent, an oversized faint watermark of the subject's own icon, and a strict
// three-tier text ladder —
//
//   title  typo-body font-semibold text-foreground
//   body   typo-caption text-foreground/60  + fontWeight 400
//   meta   typo-label text-foreground/40
//
// The first pass instead tinted the border, the background AND a header band
// with one of four state colours per card, and used `typo-title` for a card
// heading. Four differently-coloured boxes shouting at once is not a status
// reading, it is noise. State now travels as ONE small dot-and-word; the card
// itself stays quiet.
import type { LucideIcon } from 'lucide-react';
import { Check, Plug, Rocket, X } from 'lucide-react';

import { getConnectorMeta, ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

import { STATE_INK, type MonitoringState } from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';

/** Neutral card + faint watermark. Same surface as a SkillsWorkbench choice
 *  card, including the hover treatment. */
export function CapabilityCard({ icon: Icon, children, testId }: {
  icon: LucideIcon;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="group relative overflow-hidden flex flex-col rounded-card border border-primary/12 bg-secondary/[0.15] hover:border-primary/25 transition-colors"
      data-testid={testId}
    >
      <Icon
        className="pointer-events-none absolute -right-4 -bottom-5 w-28 h-28 text-primary/[0.06] group-hover:text-primary/[0.09] transition-colors"
        strokeWidth={1.25}
        aria-hidden
      />
      {children}
    </section>
  );
}

/** The card's heading row: subject icon, name, and the state as one quiet
 *  dot-and-word at the end. */
export function CapabilityHead({ icon: Icon, label, state }: {
  icon: LucideIcon;
  label: string;
  state: MonitoringState;
}) {
  return (
    <div className="relative flex items-center gap-2 px-3 py-2.5">
      <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
      <span className="typo-body font-semibold text-foreground truncate flex-1 min-w-0">{label}</span>
      <StateMark state={state} />
    </div>
  );
}

/** State as a dot + word. The ONLY tinted thing on a card. */
export function StateMark({ state }: { state: MonitoringState }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const ink = STATE_INK[state];
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ink }} aria-hidden />
      <span className="typo-label" style={{ color: ink }}>{d[`monitoring_state_${state}`]}</span>
    </span>
  );
}

/** A labelled fact. `meta` tier for the label, `body` tier for the value. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="typo-label text-foreground/40 mb-0.5">{label}</p>
      {children}
    </div>
  );
}

/** Value text at the body tier, or the absent form when there is nothing. */
export function FactValue({ value }: { value: string | null }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return value
    ? <p className="typo-caption text-foreground/60 truncate" style={{ fontWeight: 400 }}>{value}</p>
    : <p className="typo-caption text-foreground/35" style={{ fontWeight: 400 }}>{d.monitoring_none_dash}</p>;
}

/** The bound credential with its brand mark + an unbind affordance. */
export function BoundConnector({ credential, busy, onUnbind }: {
  credential: PersonaCredential;
  busy: boolean;
  onUnbind: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <ConnectorGlyph serviceType={credential.serviceType} size="w-3.5 h-3.5" />
      <span className="typo-caption text-foreground/60 truncate flex-1 min-w-0" style={{ fontWeight: 400 }}>{credential.name}</span>
      <button
        type="button"
        disabled={busy}
        onClick={onUnbind}
        aria-label={d.envslot_unassign}
        title={d.envslot_unassign}
        className="p-0.5 rounded-interactive text-foreground/35 hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** The card's single action. Assign/reassign for three states; the Claude
 *  integration deploy for `not_implemented`, which is the one corner where the
 *  operator has declared intent and the codebase owes the work. */
export function CardAction({ row, busy, deploying, onPick, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onPick: () => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const isDeploy = row.state === 'not_implemented';
  return (
    <button
      type="button"
      disabled={isDeploy ? deploying : busy}
      onClick={isDeploy ? onDeploy : onPick}
      className="relative w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-40"
    >
      {isDeploy
        ? <><Rocket className="w-3 h-3" aria-hidden />{deploying ? d.monitoring_deploying : d.monitoring_deploy}</>
        : <><Plug className="w-3 h-3" aria-hidden />{row.bound ? d.envslot_reassign : d.envslot_assign}</>}
    </button>
  );
}

/** The in-card candidate list every variant flips into. */
export function CandidateList({ row, busy, onAssign, onCancel }: {
  row: MonitoringRow;
  busy: boolean;
  onAssign: (credentialId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-1 space-y-0.5">
        {row.candidates.length === 0 && (
          <p className="typo-caption text-foreground/35 px-1 py-1" style={{ fontWeight: 400 }}>{d.envslot_no_candidates}</p>
        )}
        {row.candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => onAssign(c.id)}
            className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring disabled:opacity-40"
          >
            <ConnectorGlyph serviceType={c.serviceType} size="w-3.5 h-3.5" />
            <span className="typo-caption text-foreground/60 truncate flex-1 min-w-0 text-left" style={{ fontWeight: 400 }}>{c.name}</span>
            {row.health[c.id] === false && <span className="typo-label text-foreground/40 shrink-0">{d.envslot_unhealthy}</span>}
            {row.bound?.id === c.id && <Check className="w-3 h-3 text-primary shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 border-t border-primary/10 typo-label text-foreground/40 hover:text-foreground transition-colors text-left"
      >
        {t.common.cancel}
      </button>
    </div>
  );
}

export function ConnectorGlyph({ serviceType, size }: { serviceType: string; size: string }) {
  const meta = getConnectorMeta(serviceType);
  return <ThemedConnectorIcon url={meta.iconUrl ?? ''} label={meta.label} color={meta.color} size={size} />;
}
