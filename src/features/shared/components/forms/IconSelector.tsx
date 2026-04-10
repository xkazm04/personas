import { X } from 'lucide-react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { AGENT_ICONS, toAgentIconValue, resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';

export const EMOJI_PRESETS = ['\u{1F916}', '\u{1F9E0}', '\u{26A1}', '\u{1F527}', '\u{1F4E7}', '\u{1F4CA}', '\u{1F6E1}\u{FE0F}', '\u{1F50D}'];

const SIZE_STYLES = {
  sm: { btn: 'w-9 h-9', emoji: 'text-base', img: 'w-4.5 h-4.5', gap: 'gap-1.5', bg: 'bg-background/50' },
  md: { btn: 'w-10 h-10', emoji: 'text-lg', img: 'w-5 h-5', gap: 'gap-2', bg: 'bg-secondary/40' },
};

interface IconSelectorProps {
  value: string;
  onChange: (icon: string) => void;
  connectors?: ConnectorDefinition[];
  size?: 'sm' | 'md';
}

export function IconSelector({ value, onChange, connectors = [], size = 'md' }: IconSelectorProps) {
  const s = SIZE_STYLES[size];
  const isDark = useIsDarkTheme();
  const connectorsWithIcon = connectors.filter((c) => c.icon_url);

  return (
    <div className="space-y-3">
      {/* Agent Icons */}
      <div>
        <div className="text-[10px] font-semibold text-foreground uppercase tracking-wider mb-1.5">Agent Icons</div>
        <div className={`flex flex-wrap ${s.gap}`}>
          {AGENT_ICONS.map((entry) => {
            const iconValue = toAgentIconValue(entry.id);
            const isSelected = value === iconValue;
            const src = resolveAgentIconSrc(iconValue, isDark);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onChange(iconValue)}
                className={`${s.btn} rounded-lg border flex items-center justify-center transition-all ${
                  isSelected
                    ? 'border-primary ring-2 ring-primary/30 scale-110 bg-primary/10'
                    : `border-primary/15 ${s.bg} hover:bg-secondary/60 hover:border-primary/30`
                }`}
                title={entry.label}
              >
                <img src={src} alt={entry.label} className="w-[75%] h-[75%] object-contain" loading="lazy" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Connector Icons */}
      {connectorsWithIcon.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-foreground uppercase tracking-wider mb-1.5">Connectors</div>
          <div className={`flex flex-wrap ${s.gap}`}>
            {connectorsWithIcon.map((c) => {
              const isSelected = value === c.icon_url;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange(c.icon_url!)}
                  className={`${s.btn} rounded-lg border flex items-center justify-center transition-all ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/30 scale-110 bg-primary/10'
                      : `border-primary/15 ${s.bg} hover:bg-secondary/60 hover:border-primary/30`
                  }`}
                  title={c.label}
                >
                  <ThemedConnectorIcon url={c.icon_url!} label={c.label} color={c.color} size={s.img} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Emoji Presets */}
      <div>
        <div className="text-[10px] font-semibold text-foreground uppercase tracking-wider mb-1.5">Emoji</div>
        <div className={`flex flex-wrap ${s.gap}`}>
          {EMOJI_PRESETS.map((emoji) => {
            const isSelected = value === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onChange(emoji)}
                className={`${s.btn} rounded-lg border flex items-center justify-center ${s.emoji} transition-all ${
                  isSelected
                    ? 'border-primary ring-2 ring-primary/30 scale-110 bg-primary/10'
                    : `border-primary/15 ${s.bg} hover:bg-secondary/60 hover:border-primary/30`
                }`}
              >
                {emoji}
              </button>
            );
          })}
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className={`${s.btn} rounded-lg border border-dashed border-primary/20 flex items-center justify-center text-foreground hover:text-foreground hover:border-primary/30 transition-all`}
              title="Clear icon"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
