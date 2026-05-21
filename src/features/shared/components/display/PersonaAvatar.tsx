import { Bot } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { resolvePersonaIcon } from '@/lib/icons/resolvePersonaIcon';
import { useCustomIconSrc } from '@/lib/icons/customIconStore';
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

/**
 * Persona avatar — larger, name-aware sibling of `PersonaIcon`.
 *
 * Icon classification is delegated to `resolvePersonaIcon` so this renderer
 * and `PersonaIcon` always agree on what an `icon` string means. Unrecognised
 * values (and a custom icon whose file hasn't resolved yet) fall through to
 * the Bot / initial fallback.
 */
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

  const resolved = resolvePersonaIcon(icon);
  // Hook must run unconditionally; passes null for non-custom icons.
  const customSrc = useCustomIconSrc(resolved.kind === 'custom' ? resolved.assetId : null);

  if (resolved.kind === 'builtin') {
    return (
      <img
        src={resolveAgentIconSrc(resolved.value, isDark)}
        alt=""
        className={`${cfg.img} ${className}`}
        loading="lazy"
      />
    );
  }

  if (resolved.kind === 'custom' && customSrc) {
    return (
      <img src={customSrc} alt="" className={`${cfg.img} ${className}`} loading="lazy" />
    );
  }

  if (resolved.kind === 'url') {
    return (
      <img
        src={resolved.url}
        alt=""
        className={`${cfg.img} ${className}`}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
      />
    );
  }

  if (resolved.kind === 'emoji') {
    return <span className={`${cfg.emoji} ${className}`}>{resolved.char}</span>;
  }

  // fallback (or a custom icon still resolving)
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
