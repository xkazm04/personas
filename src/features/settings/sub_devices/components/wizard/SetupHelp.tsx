/**
 * What to check when no PC turns up: discovery is mDNS on the local network,
 * so the usual causes are a different network, a Public Windows network
 * profile, and a firewall prompt that was dismissed.
 */
import { LifeBuoy } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export function SetupHelp() {
  const { t } = useTranslation();
  const st = t.sharing;
  const tips = [st.wizard_help_same_network, st.wizard_help_private, st.wizard_help_firewall, st.wizard_help_open_devices];

  return (
    <section data-testid="wizard-setup-help" className="rounded-card border border-border bg-secondary/20 p-4 space-y-2">
      <h3 className="flex items-center gap-2 typo-body text-foreground">
        <LifeBuoy className="w-4 h-4 text-primary" aria-hidden />
        {st.wizard_help_title}
      </h3>
      <ul className="list-disc pl-5 space-y-1">
        {tips.map((tip) => (
          <li key={tip} className="typo-caption text-foreground">{tip}</li>
        ))}
      </ul>
    </section>
  );
}
