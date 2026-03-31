import { Bot } from 'lucide-react';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { isAgentIcon, resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CONFIG = {
  sm: { img: 'w-6 h-6 rounded', emoji: 'text-2xl leading-none', fallback: 'w-10 h-10 rounded-xl typo-heading', iconSize: 'w-4 h-4' },
  md: { img: 'w-8 h-8', emoji: 'text-2xl leading-8 w-8 h-8 flex items-center justify-center', fallback: 'w-8 h-8 rounded-lg', iconSize: 'w-4 h-4' },
  lg: { img: 'w-12 h-12 rounded-xl opacity-60', emoji: 'text-4xl leading-none opacity-60', fallback: 'w-12 h-12 rounded-xl typo-heading-lg opacity-50', iconSize: 'w-5 h-5' },
} as const;

interface PersonaAvatarProps {
  icon?: string | null;
  name: string;
  color?: string | null;
  size?: AvatarSize;
  /** 'initial' renders the first letter of name; 'bot' renders Bot icon */
  fallbackStyle?: 'initial' | 'bot';
  className?: string;
}

export function PersonaAvatar({
  icon,
  name,
  color,
  size = 'md',
  fallbackStyle = 'initial',
  className = '',
}: PersonaAvatarProps) {
  const isDark = useIsDarkTheme();
  const cfg = SIZE_CONFIG[size];
  const defaultColor = fallbackStyle === 'bot' ? '#8b5cf6' : '#6B7280';
  const resolvedColor = color || defaultColor;

  if (icon) {
    // Agent icon PNGs (theme-aware)
    if (isAgentIcon(icon)) {
      const src = resolveAgentIconSrc(icon, isDark);
      return (
        <img
          src={src}
          alt=""
          className={`${cfg.img} ${className}`}
          loading="lazy"
        />
      );
    }

    const safeUrl = sanitizeIconUrl(icon);
    if (safeUrl) {
      return (
        <img
          src={safeUrl}
          alt=""
          className={`${cfg.img} ${className}`}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
        />
      );
    }
    if (!isIconUrl(icon)) {
      return <span className={`${cfg.emoji} ${className}`}>{icon}</span>;
    }
    return null;
  }

  if (fallbackStyle === 'bot') {
    return (
      <div
        className={`${cfg.fallback} flex items-center justify-center ${className}`}
        style={{ backgroundColor: colorWithAlpha(resolvedColor, 0.13) }}
      >
        <Bot className={cfg.iconSize} style={{ color: resolvedColor }} />
      </div>
    );
  }

  return (
    <div
      className={`${cfg.fallback} flex items-center justify-center ${className}`}
      style={{
        backgroundColor: `${resolvedColor}20`,
        border: `1px solid ${resolvedColor}40`,
        color: resolvedColor,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
