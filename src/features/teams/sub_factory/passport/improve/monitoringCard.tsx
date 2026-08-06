// The pieces the Console variants are built from.
//
// ICONS CARRY THE READING. A capability is two facts — what the codebase has,
// what the vault has — and both are brands. A brand is recognised faster as its
// mark than as its name, so each side is a GLYPH first and a name second, and
// the side's meaning is itself a small icon (a code bracket, a plug) rather
// than a caption. Text is left only where it is the payload: the tool's name,
// and the capability's.
//
// THE SPLIT COLLAPSES WHEN THE TWO SIDES AGREE. Sentry-in-the-code beside
// Sentry-in-the-vault drawn as two halves says "these are two things"; they are
// one thing, seen twice. When the detected tool and the bound connector are the
// same tool the divider goes away and the card shows one mark with its name —
// which is also the only visual state that means "this capability is done".
//
// TYPOGRAPHY. `typo-label` is 12px/700 UPPERCASE with 0.15em tracking, scoped by
// Design.md to badges and dividers; it is used for NOTHING descriptive here.
// Sentence-case `typo-caption` held back by opacity does that job:
//    title  typo-body font-semibold text-foreground
//    label  typo-caption text-foreground/45
//    value  typo-caption text-foreground  + fontWeight 400
import type { LucideIcon } from 'lucide-react';
import { Check, Code2, Plug, Rocket, Unplug, X } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { getConnectorMeta, ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

import { resolveTechIcon } from '../techIcons';
import { STATE_INK, type MonitoringState } from './monitoringModel';
import type { MonitoringRow } from './monitoringTypes';

/**
 * Do both sides name the same tool?
 *
 * The codebase side is a free-text label from the evidence probe ("Sentry",
 * "Sentry 8.2"); the vault side is a credential with a `serviceType`
 * ("sentry"). Compare on letters+digits only, and accept containment either way
 * so a version suffix or a `_` in the service type does not read as a different
 * product. Deliberately conservative: a false NEGATIVE just keeps the split,
 * while a false positive would claim a capability is covered when it is not.
 */
export function sameTool(detected: string | null, bound: PersonaCredential | undefined): boolean {
  if (!detected || !bound) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = norm(detected);
  const b = norm(bound.serviceType);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Neutral surface + faint watermark — a SkillsWorkbench choice card. */
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

/** Capability name + the state, as one quiet dot-and-word. */
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

/** The state, in the state ink. Sentence case — a reading, not a badge. */
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

// ── the two sides ───────────────────────────────────────────────────────────

/** A tool's own mark at display size: the brand glyph when we recognise it,
 *  else a neutral tile carrying its initial so an unknown tool still reads as a
 *  thing rather than as an error. */
export function ToolMark({ label, serviceType, size = 64 }: {
  label: string;
  /** Set for a vault credential; the connector catalog has its icon. */
  serviceType?: string;
  size?: number;
}) {
  const brand = serviceType ? null : resolveTechIcon(label);
  if (serviceType) {
    const meta = getConnectorMeta(serviceType);
    if (meta.iconUrl) {
      // ThemedConnectorIcon sizes by class; a sized wrapper + w-full/h-full
      // lets the mark scale to whatever the layout gives it.
      return (
        <span className="inline-flex shrink-0" style={{ width: size, height: size }}>
          <ThemedConnectorIcon url={meta.iconUrl} label={label} color={meta.color} size="w-full h-full" />
        </span>
      );
    }
  }
  if (brand) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={brand.icon.color ?? 'currentColor'} aria-label={label} role="img" className="shrink-0">
        <path d={brand.icon.path} />
      </svg>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-interactive bg-primary/10 border border-primary/20 text-primary shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label={label}
      role="img"
    >
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** The absent mark: a dashed tile with the side's own icon, ghosted. Reads as
 *  "this slot exists and is empty" — not as a missing image. */
function EmptyMark({ icon: Icon, size = 64 }: { icon: LucideIcon; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-interactive border border-dashed border-primary/20 text-foreground/25 shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.45, height: size * 0.45 }} strokeWidth={1.5} />
    </span>
  );
}

/** One half of a split card. The side's meaning is the small marker icon; the
 *  payload is the tool mark and its name. */
export function SideHalf({ side, toolLabel, serviceType, children }: {
  side: 'code' | 'vault';
  /** Tool name, or null when the side is empty. */
  toolLabel: string | null;
  serviceType?: string;
  /** Trailing controls (unbind, pick). */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const SideIcon = side === 'code' ? Code2 : Plug;
  const sideName = side === 'code' ? d.envslot_detected : d.envslot_connector;

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-2 px-2 py-2.5 text-center">
      <Tooltip content={sideName} placement="top">
        <span className="inline-flex items-center text-foreground/35" aria-label={sideName}>
          <SideIcon className="w-3.5 h-3.5" />
        </span>
      </Tooltip>
      {toolLabel
        ? <ToolMark label={toolLabel} serviceType={serviceType} />
        : <EmptyMark icon={side === 'code' ? Code2 : Unplug} />}
      <span className="typo-caption text-foreground truncate max-w-full" style={{ fontWeight: 400 }}>
        {toolLabel ?? <span className="text-foreground/35">{d.monitoring_none_dash}</span>}
      </span>
      {children}
    </div>
  );
}

/** Both sides name the same tool, so there is nothing to compare: one mark, one
 *  name, and a marker saying the code and the vault agree. */
export function MergedTool({ label, serviceType, children }: {
  label: string;
  serviceType: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-2 px-3 py-3 text-center">
      <Tooltip content={d.monitoring_merged_hint} placement="top">
        <span className="inline-flex items-center gap-1 text-foreground/35" aria-label={d.monitoring_merged_hint}>
          <Code2 className="w-3 h-3" />
          <Check className="w-3 h-3" style={{ color: STATE_INK.ok }} />
          <Plug className="w-3 h-3" />
        </span>
      </Tooltip>
      <ToolMark label={label} serviceType={serviceType} size={88} />
      <span className="typo-body font-semibold text-foreground truncate max-w-full">{label}</span>
      {children}
    </div>
  );
}

// ── controls ────────────────────────────────────────────────────────────────

/** Unbind, as an icon. */
export function UnbindButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <Tooltip content={d.envslot_unassign} placement="top">
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        aria-label={d.envslot_unassign}
        className="p-0.5 rounded-interactive text-foreground/30 hover:text-[var(--status-error)] hover:bg-[var(--status-error)]/10 transition-colors disabled:opacity-40"
      >
        <X className="w-3 h-3" />
      </button>
    </Tooltip>
  );
}

/** The capability's action: bind/rebind, or — for the one state where the
 *  operator declared intent and the codebase owes the work — the deploy. */
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
      className="relative w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-40"
    >
      {isDeploy
        ? <><Rocket className="w-3 h-3" aria-hidden />{deploying ? d.monitoring_deploying : d.monitoring_deploy}</>
        : <><Plug className="w-3 h-3" aria-hidden />{row.bound ? d.envslot_reassign : d.envslot_assign}</>}
    </button>
  );
}

/** One selectable credential — mark first, name second. */
export function CandidateRow({ credential, healthy, selected, busy, onClick }: {
  credential: PersonaCredential;
  healthy: boolean | null | undefined;
  selected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const label = healthy === false ? d.envslot_unhealthy : healthy === true ? d.monitoring_health_ok : d.monitoring_health_unknown;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring disabled:opacity-40"
    >
      <ToolMark label={credential.name} serviceType={credential.serviceType} size={18} />
      <span className="typo-caption text-foreground truncate flex-1 min-w-0 text-left" style={{ fontWeight: 400 }}>{credential.name}</span>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: healthy === true ? 'var(--status-success)' : healthy === false ? 'var(--status-error)' : 'var(--status-neutral)' }}
        title={label}
        aria-label={label}
      />
      {selected && <Check className="w-3 h-3 text-primary shrink-0" aria-hidden />}
    </button>
  );
}

/** Scrolling candidate list + a way back. */
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

/** The explanation the `not_implemented` state carries. */
export function DeployNote() {
  const { t } = useTranslation();
  return (
    <p className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>
      {t.plugins.dev_tools.monitoring_deploy_blurb}
    </p>
  );
}
