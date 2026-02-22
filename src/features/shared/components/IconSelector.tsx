import { X } from 'lucide-react';
import type { ConnectorDefinition } from '@/lib/types/types';

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
  const connectorsWithIcon = connectors.filter((c) => c.icon_url);

  return (
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
            <img src={c.icon_url!} alt={c.label} className={s.img} />
          </button>
        );
      })}
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
          className={`${s.btn} rounded-lg border border-dashed border-primary/20 flex items-center justify-center text-muted-foreground/80 hover:text-muted-foreground hover:border-primary/30 transition-all`}
          title="Clear icon"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
