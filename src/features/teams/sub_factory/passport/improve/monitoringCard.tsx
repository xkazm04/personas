// The pieces every Monitoring variant is built from. The variants differ in
// GRID SHAPE and how much room each capability gets; these are the parts they
// arrange.
//
// TYPOGRAPHY — two corrections, in order of how badly they read.
//
// 1. No caps-lock for descriptive information. `typo-label` is 12px/700
//    UPPERCASE with 0.15em tracking; Design.md scopes it to badges and
//    dividers. Using it for every field label ("IN THE CODEBASE", "BOUND
//    CONNECTOR", "IN YOUR VAULT") turned each card into a wall of shouting
//    abbreviations. Descriptive labels are now sentence-case `typo-caption` at
//    reduced opacity — quiet because of colour, not because of case.
// 2. Neutral surfaces, one accent. Tinting a card's border, background AND a
//    header band with one of four state colours made four boxes compete; the
//    state now travels as one dot-and-word and nothing else is tinted.
//
// The resulting ladder, which is SkillsWorkbench's:
//    title  typo-body font-semibold text-foreground
//    label  typo-caption text-foreground/45          (sentence case)
//    value  typo-caption text-foreground  + fontWeight 400
import type { LucideIcon } from 'lucide-react';
import { Check, Plug, Rocket, X } from 'lucide-react';

import { getConnectorMeta, ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

import { STATE_INK, type MonitoringState } from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';

/** Neutral surface + faint watermark — a SkillsWorkbench choice card. */
export function CapabilityCard({ icon: Icon, watermark = true, children, testId }: {
  icon: LucideIcon;
  /** Off for dense layouts where an oversized glyph would sit under text. */
  watermark?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="group relative overflow-hidden flex flex-col rounded-card border border-primary/12 bg-secondary/[0.15] hover:border-primary/25 transition-colors"
      data-testid={testId}
    >
      {watermark && (
        <Icon
          className="pointer-events-none absolute -right-4 -bottom-5 w-28 h-28 text-primary/[0.06] group-hover:text-primary/[0.09] transition-colors"
          strokeWidth={1.25}
          aria-hidden
        />
      )}
      {children}
    </section>
  );
}

/** Capability name + the state, as one quiet dot-and-word. */
export function CapabilityHead({ icon: Icon, label, state, children }: {
  icon: LucideIcon;
  label: string;
  state: MonitoringState;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-2 px-3 py-2.5">
      <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
      <span className="typo-body font-semibold text-foreground truncate flex-1 min-w-0">{label}</span>
      {children}
      <StateMark state={state} />
    </div>
  );
}

/** The state, in the state ink. Sentence case — it is a reading, not a badge. */
export function StateMark({ state }: { state: MonitoringState }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const ink = STATE_INK[state];
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ink }} aria-hidden />
      <span className="typo-caption font-medium" style={{ color: ink }}>{d[`monitoring_state_${state}`]}</span>
    </span>
  );
}

/** A labelled fact. Sentence-case label, full-contrast value. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="typo-caption text-foreground/45 mb-0.5" style={{ fontWeight: 400 }}>{label}</p>
      {children}
    </div>
  );
}

/** The absent form — an em-dash, never an invented value. */
export function Absent() {
  const { t } = useTranslation();
  return <span className="typo-caption text-foreground/35" style={{ fontWeight: 400 }}>{t.plugins.dev_tools.monitoring_none_dash}</span>;
}

/** Health as a dot. Colour is the whole signal; the label is for screen readers
 *  and the title, so a healthy connector adds no visual noise. */
export function HealthDot({ healthy }: { healthy: boolean | null | undefined }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const label = healthy === false ? d.envslot_unhealthy : healthy === true ? d.monitoring_health_ok : d.monitoring_health_unknown;
  return (
    <span
      className="w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: healthy === true ? 'var(--status-success)' : healthy === false ? 'var(--status-error)' : 'var(--status-neutral)' }}
      title={label}
      aria-label={label}
    />
  );
}

/** The bound credential: brand mark, name, health, unbind. */
export function BoundConnector({ credential, healthy, busy, onUnbind }: {
  credential: PersonaCredential;
  healthy: boolean | null | undefined;
  busy: boolean;
  onUnbind: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <ConnectorGlyph serviceType={credential.serviceType} size="w-3.5 h-3.5" />
      <span className="typo-caption text-foreground truncate min-w-0" style={{ fontWeight: 400 }}>{credential.name}</span>
      <HealthDot healthy={healthy} />
      <button
        type="button"
        disabled={busy}
        onClick={onUnbind}
        aria-label={d.envslot_unassign}
        title={d.envslot_unassign}
        className="ml-auto p-0.5 rounded-interactive text-foreground/35 hover:text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40 shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** The capability's action: bind/rebind, or — for the one state where the
 *  operator declared intent and the codebase owes the work — the integration
 *  deploy. */
export function CardAction({ row, busy, deploying, onPick, onDeploy, compact = false }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onPick: () => void;
  onDeploy: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const isDeploy = row.state === 'not_implemented';
  return (
    <button
      type="button"
      disabled={isDeploy ? deploying : busy}
      onClick={isDeploy ? onDeploy : onPick}
      className={`relative inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-40 ${compact ? 'shrink-0' : 'w-full'}`}
    >
      {isDeploy
        ? <><Rocket className="w-3 h-3" aria-hidden />{deploying ? d.monitoring_deploying : d.monitoring_deploy}</>
        : <><Plug className="w-3 h-3" aria-hidden />{row.bound ? d.envslot_reassign : d.envslot_assign}</>}
    </button>
  );
}

/** One selectable credential. */
export function CandidateRow({ credential, healthy, selected, busy, onClick }: {
  credential: PersonaCredential;
  healthy: boolean | null | undefined;
  selected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring disabled:opacity-40"
    >
      <ConnectorGlyph serviceType={credential.serviceType} size="w-3.5 h-3.5" />
      <span className="typo-caption text-foreground truncate flex-1 min-w-0 text-left" style={{ fontWeight: 400 }}>{credential.name}</span>
      <HealthDot healthy={healthy} />
      {selected && <Check className="w-3 h-3 text-primary shrink-0" aria-hidden />}
    </button>
  );
}

/** Scrolling candidate list + a way back. Used by the variants that HIDE the
 *  facts to show candidates; the master–detail variant shows both at once. */
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
          <p className="typo-caption text-foreground/45 px-1 py-1" style={{ fontWeight: 400 }}>{d.envslot_no_candidates}</p>
        )}
        {row.candidates.map((c) => (
          <CandidateRow
            key={c.id}
            credential={c}
            healthy={row.health[c.id]}
            selected={row.bound?.id === c.id}
            busy={busy}
            onClick={() => onAssign(c.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 border-t border-primary/10 typo-caption text-foreground/45 hover:text-foreground transition-colors text-left"
        style={{ fontWeight: 400 }}
      >
        {t.common.cancel}
      </button>
    </div>
  );
}

/** The explanation the `not_implemented` state carries — the operator has done
 *  their half, so say what is missing rather than just colouring it. */
export function DeployNote() {
  const { t } = useTranslation();
  return (
    <p className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>
      {t.plugins.dev_tools.monitoring_deploy_blurb}
    </p>
  );
}

export function ConnectorGlyph({ serviceType, size }: { serviceType: string; size: string }) {
  const meta = getConnectorMeta(serviceType);
  return <ThemedConnectorIcon url={meta.iconUrl ?? ''} label={meta.label} color={meta.color} size={size} />;
}
