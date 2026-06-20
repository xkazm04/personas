import { Download, Brain, KeyRound, Info, Lock, ShieldOff, Target, type LucideIcon } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExportPicker } from './types';

// ---------------------------------------------------------------------------
// One category line in the live manifest summary.
// ---------------------------------------------------------------------------

export function CategoryCountRow({
  icon: Icon,
  label,
  selected,
  total,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  selected: number;
  total: number;
  accent: string;
}) {
  const dimmed = selected === 0;
  return (
    <div className={`flex items-center gap-2.5 ${dimmed ? 'opacity-45' : ''}`}>
      <span className={`w-7 h-7 rounded-card flex items-center justify-center flex-shrink-0 ${accent}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="typo-body text-foreground flex-1 min-w-0 truncate">{label}</span>
      <span className="typo-data-lg font-semibold text-foreground tabular-nums">{selected}</span>
      <span className="typo-caption text-foreground tabular-nums">/ {total}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI setup — all-or-none, tied to the team selection.
// ---------------------------------------------------------------------------

export function KpiSetupCard({ picker }: { picker: ExportPicker }) {
  const { t, tx } = useTranslation();
  const p = t.settings.portability.proto;
  const eligible = picker.inv.eligibleKpiCount;
  const noKpis = eligible === 0;
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/5 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-card flex items-center justify-center bg-rose-500/10 text-rose-300 flex-shrink-0">
          <Target className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="typo-body font-medium text-foreground">{p.kpi_setup_title}</div>
          <p className="typo-caption text-foreground leading-snug">{p.kpi_setup_hint}</p>
        </div>
        <AccessibleToggle
          checked={picker.includeKpiSetup}
          onChange={() => picker.setIncludeKpiSetup(!picker.includeKpiSetup)}
          disabled={noKpis}
          label={p.kpi_setup_title}
          data-testid="export-include-kpis-toggle"
        />
      </div>
      <p className="typo-caption text-foreground mt-2 pl-11">
        {noKpis
          ? p.kpi_setup_none
          : picker.includeKpiSetup
            ? tx(p.kpi_setup_ship, { count: picker.kpiShipCount })
            : p.kpi_setup_off}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memories toggle + passphrase (security block).
// ---------------------------------------------------------------------------

export function SecuritySection({ picker }: { picker: ExportPicker }) {
  const { t } = useTranslation();
  const s = t.settings.portability;
  const p = s.proto;
  const valid = picker.passphraseValid;
  return (
    <div className="space-y-3">
      {/* Memories */}
      <div className="flex items-center gap-3 rounded-card border border-primary/10 bg-secondary/5 px-3.5 py-3">
        <span className="w-8 h-8 rounded-card flex items-center justify-center bg-fuchsia-500/10 text-fuchsia-300 flex-shrink-0">
          <Brain className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="typo-body font-medium text-foreground">{p.memories_title}</div>
          <p className="typo-caption text-foreground leading-snug">{p.memories_hint}</p>
        </div>
        <AccessibleToggle
          checked={picker.includeMemories}
          onChange={() => picker.setIncludeMemories(!picker.includeMemories)}
          label={p.memories_title}
          data-testid="export-include-memories-toggle"
        />
      </div>

      {/* Passphrase */}
      <div className="rounded-card border border-primary/10 bg-secondary/5 px-3.5 py-3 space-y-2">
        <label className="flex items-center gap-2 typo-body font-medium text-foreground">
          <KeyRound className="w-4 h-4 text-amber-300" />
          {p.encryption_title}
        </label>
        <PasswordToggleField
          placeholder={s.passphrase_placeholder}
          value={picker.passphrase}
          onChange={(e) => picker.setPassphrase(e.target.value)}
          hasError={!valid}
          inputClassName={`w-full px-3 py-2 rounded-card border bg-secondary/20 typo-body text-foreground placeholder:text-foreground/40 outline-none ${
            !valid ? 'border-red-500/30 focus-visible:border-red-500/50' : 'border-primary/10 focus-visible:border-amber-500/30'
          }`}
        />
        {!valid ? (
          <p className="typo-caption text-red-400">{s.passphrase_too_short}</p>
        ) : (
          <p className="typo-caption text-foreground leading-snug">{p.encryption_hint}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secrets status line ("encrypted" vs "excluded").
// ---------------------------------------------------------------------------

export function SecretsStatus({ picker }: { picker: ExportPicker }) {
  const { t } = useTranslation();
  const p = t.settings.portability.proto;
  const encrypted = picker.passphrase.length >= 8;
  return (
    <div className={`flex items-center gap-2 typo-caption ${encrypted ? 'text-emerald-300' : 'text-foreground'}`}>
      {encrypted ? <Lock className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
      {encrypted ? p.secrets_encrypted : p.secrets_excluded}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependency note (auto-included rollup).
// ---------------------------------------------------------------------------

export function DependencyNotes() {
  const { t } = useTranslation();
  const p = t.settings.portability.proto;
  return (
    <div className="flex items-start gap-2 rounded-card bg-blue-500/5 border border-blue-500/10 px-3 py-2.5">
      <Info className="w-4 h-4 text-blue-300 mt-0.5 flex-shrink-0" />
      <p className="typo-caption text-foreground leading-relaxed">{p.dependency_note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export CTA — shared label logic.
// ---------------------------------------------------------------------------

export function ExportButton({
  picker,
  exporting,
  onClick,
  className,
}: {
  picker: ExportPicker;
  exporting: boolean;
  onClick: () => void;
  className?: string;
}) {
  const { t, tx } = useTranslation();
  const s = t.settings.portability;
  const disabled = exporting || picker.totalSelected === 0 || !picker.passphraseValid;
  const label = exporting
    ? s.exporting
    : picker.isFullExport
      ? s.export_all
      : tx(picker.totalSelected !== 1 ? s.export_items_plural : s.export_items, {
          count: picker.totalSelected,
        });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="export-confirm-button"
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-modal typo-body font-semibold
        bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/20
        transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className ?? ''}`}
    >
      {exporting ? <LoadingSpinner /> : <Download className="w-4 h-4" />}
      {label}
    </button>
  );
}
