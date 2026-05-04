import { useEffect, useState } from 'react';
import { Bot, Volume2, Wrench } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { companionBetaFlags } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Companion plugin — Setup tab.
 *
 * Three settings:
 *   1. Footer icon — show/hide the bot button in DesktopFooter
 *   2. Sound chime — play subtle Web Audio chime when a reply finishes
 *   3. Self-improve loop — read-only display of the backend beta flag
 *      (toggle would require a build flip; surfacing it here lets the user
 *      know whether the feature is currently active without them having
 *      to dig through dev logs).
 */
export default function SetupPanel() {
  const { t } = useTranslation();
  const footerEnabled = useSystemStore((s) => s.companionFooterEnabled);
  const setFooterEnabled = useSystemStore((s) => s.setCompanionFooterEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const setSoundEnabled = useSystemStore((s) => s.setCompanionSoundEnabled);

  const [selfImprove, setSelfImprove] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    companionBetaFlags()
      .then((flags) => {
        if (!cancelled) setSelfImprove(flags.selfImproveEnabled);
      })
      .catch(silentCatch('companion_beta_flags'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4 max-w-2xl">
      <SectionCard
        title={t.plugins.companion.setup_chrome_title}
        subtitle={t.plugins.companion.setup_chrome_desc}
      >
        <ToggleRow
          icon={<Bot className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_footer_label}
          description={t.plugins.companion.setup_footer_desc}
          checked={footerEnabled}
          onChange={() => setFooterEnabled(!footerEnabled)}
        />
        <ToggleRow
          icon={<Volume2 className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_sound_label}
          description={t.plugins.companion.setup_sound_desc}
          checked={soundEnabled}
          onChange={() => setSoundEnabled(!soundEnabled)}
        />
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.setup_beta_title}
        subtitle={t.plugins.companion.setup_beta_desc}
      >
        <div className="flex items-start gap-3 px-1 py-2">
          <Wrench
            className={`w-4 h-4 mt-0.5 ${selfImprove ? 'text-emerald-400' : 'text-foreground/40'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.setup_self_improve_label}
            </div>
            <div className="typo-caption text-foreground/60 mt-0.5">
              {selfImprove === null
                ? t.plugins.companion.loading
                : selfImprove
                  ? t.plugins.companion.setup_self_improve_on
                  : t.plugins.companion.setup_self_improve_off}
            </div>
          </div>
          <span
            className={`shrink-0 typo-caption font-medium px-2 py-0.5 rounded-full border ${
              selfImprove
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-foreground/10 bg-foreground/5 text-foreground/60'
            }`}
          >
            {selfImprove === null
              ? '…'
              : selfImprove
                ? t.plugins.companion.setup_self_improve_active
                : t.plugins.companion.setup_self_improve_inactive}
          </span>
        </div>
      </SectionCard>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-1 py-2 border-b border-foreground/5 last:border-b-0">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="typo-body font-medium">{label}</div>
        <div className="typo-caption text-foreground/60 mt-0.5">
          {description}
        </div>
      </div>
      <div className="shrink-0">
        <AccessibleToggle checked={checked} onChange={onChange} label={label} />
      </div>
    </div>
  );
}
