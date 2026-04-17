import { Plus, X } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';

export interface AppFocusConfigProps {
  appNames: string[];
  setAppNames: (v: string[]) => void;
  titlePattern: string;
  setTitlePattern: (v: string) => void;
  appFocusInterval: string;
  setAppFocusInterval: (v: string) => void;
}

export function AppFocusConfig({
  appNames, setAppNames, titlePattern, setTitlePattern,
  appFocusInterval, setAppFocusInterval,
}: AppFocusConfigProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <TriggerFieldGroup
        label={t.triggers.app_focus.app_names_label}
        optional
        helpText={t.triggers.app_names_help}
      >
        {appNames.map((name, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                const updated = [...appNames];
                updated[i] = e.target.value;
                setAppNames(updated);
              }}
              placeholder="e.g. Code.exe, chrome.exe, Figma.exe"
              className="flex-1 px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code placeholder-muted-foreground/30 focus-ring transition-all"
            />
            {appNames.length > 1 && (
              <button type="button" onClick={() => setAppNames(appNames.filter((_, j) => j !== i))} className="p-1.5 text-foreground hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setAppNames([...appNames, ''])} className="flex items-center gap-1 typo-body text-indigo-400/80 hover:text-indigo-400 transition-colors">
          <Plus className="w-3.5 h-3.5" /> {t.triggers.app_focus.add_app}
        </button>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={<>{t.triggers.window_title_pattern_label} <span className="text-foreground">{t.triggers.optional_regex_label}</span></>}
      >
        <input
          type="text"
          value={titlePattern}
          onChange={(e) => setTitlePattern(e.target.value)}
          placeholder="e.g. .*\\.rs$ or Project - Visual Studio"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code placeholder-muted-foreground/30 focus-ring transition-all"
        />
      </TriggerFieldGroup>
      <TriggerFieldGroup label={t.triggers.poll_interval_label}>
        <input
          type="number"
          value={appFocusInterval}
          onChange={(e) => setAppFocusInterval(e.target.value)}
          min="2"
          className="w-24 px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground font-mono typo-code focus-ring transition-all"
        />
      </TriggerFieldGroup>
    </div>
  );
}
