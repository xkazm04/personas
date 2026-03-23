import { Plus, X } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';

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
  return (
    <div className="space-y-3">
      <TriggerFieldGroup
        label="App Names"
        optional
        helpText="Leave empty to trigger on any app focus change"
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
              className="flex-1 px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus-ring transition-all"
            />
            {appNames.length > 1 && (
              <button type="button" onClick={() => setAppNames(appNames.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground/60 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setAppNames([...appNames, ''])} className="flex items-center gap-1 text-sm text-indigo-400/80 hover:text-indigo-400 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add app
        </button>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={<>Window Title Pattern <span className="text-muted-foreground/50">(optional regex)</span></>}
      >
        <input
          type="text"
          value={titlePattern}
          onChange={(e) => setTitlePattern(e.target.value)}
          placeholder="e.g. .*\\.rs$ or Project - Visual Studio"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus-ring transition-all"
        />
      </TriggerFieldGroup>
      <TriggerFieldGroup label="Poll Interval (seconds)">
        <input
          type="number"
          value={appFocusInterval}
          onChange={(e) => setAppFocusInterval(e.target.value)}
          min="2"
          className="w-24 px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm focus-ring transition-all"
        />
      </TriggerFieldGroup>
    </div>
  );
}
