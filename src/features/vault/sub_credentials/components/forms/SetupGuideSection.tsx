import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface SetupGuideSectionProps {
  guide: string;
  connectorLabel: string;
}

export function SetupGuideSection({ guide, connectorLabel }: SetupGuideSectionProps) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const steps = guide.split('\n').filter(Boolean);

  return (
    <div className="border border-hair rounded-modal overflow-hidden">
      <PressSurface onPress={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center gap-2 px-3.5 py-2.5">
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        )}
        <span className="typo-body text-foreground">
          {tx(t.vault.forms.how_to_get_connector, { connectorLabel })}
        </span>
      </PressSurface>
      {open && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3.5 pb-3 space-y-2">
              {steps.map((line, i) => {
                const stripped = line.replace(/^\d+\.\s*/, '');
                return (
                  <div key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-hair flex items-center justify-center typo-heading text-primary/70">
                      {i + 1}
                    </span>
                    <p className="typo-body text-foreground pt-0.5">{stripped}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}
