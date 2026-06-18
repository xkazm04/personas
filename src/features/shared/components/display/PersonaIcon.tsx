import { Bot } from 'lucide-react';
import { resolveAgentIconSprite, resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { resolvePersonaIcon, type ResolvedIcon } from '@/lib/icons/resolvePersonaIcon';
import { personaInitials } from '@/lib/icons/personaInitials';
import { useCustomIconSrc } from '@/lib/icons/customIconStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

type FrameSize = 'xs' | 'sm' | 'md' | 'lg';

const FRAME_SIZE_CLASS: Record<FrameSize, string> = {
  xs: 'icon-frame-xs',
  sm: 'icon-frame-sm',
  md: 'icon-frame-md',
  lg: 'icon-frame-lg',
};

// Font size for the initials fallback, tuned per frame tier (xs 20px → lg 44px)
// so two uppercase letters fill the frame without clipping.
const FRAME_INITIALS_CLASS: Record<FrameSize, string> = {
  xs: 'text-[9px]',
  sm: 'text-[11px]',
  md: 'text-[15px]',
  lg: 'text-[18px]',
};

interface PersonaIconProps {
  icon: string | null | undefined;
  color: string | null | undefined;

  /**
   * Persona display name. When provided and the persona has no assigned icon,
   * the fallback renders the persona's initials (first letters of the first
   * two words) tinted with `color` instead of the generic Bot — so unkeyed
   * personas stay visually distinguishable. Omit it to keep the Bot fallback.
   */
  name?: string | null;

  /**
   * Render mode:
   *   - undefined / false → bare icon (backwards-compatible, sized by `size` prop)
   *   - "framed"          → wrapped in .icon-frame (image fills frame)
   *   - "pop"             → wrapped in .icon-frame + .icon-frame-pop (3× expansion)
   */
  display?: 'framed' | 'pop';

  /** Frame size tier. Only used when display is "framed" or "pop".
   *  Defaults to no suffix (32px base). */
  frameSize?: FrameSize;

  /** Extra classes on the frame wrapper (background, border, etc.) */
  frameClass?: string;
  /** Inline style on the frame wrapper */
  frameStyle?: React.CSSProperties;

  /** Tailwind size for bare mode (no display prop). Default "w-4 h-4". */
  size?: string;
  className?: string;

  /** @deprecated Use display="framed" or display="pop" instead. */
  framed?: boolean;
}

/**
 * Universal persona icon renderer.
 *
 * **Bare mode** (default): outputs a single element (img/svg/span) sized by `size` prop.
 * **Framed mode** (`display="framed"`): wraps in .icon-frame div, image fills the frame.
 * **Pop mode** (`display="pop"`): wraps in .icon-frame.icon-frame-pop — icon renders
 *   at 3× the frame via absolute positioning, bursting beyond the wrapper.
 *
 * Pop mode is the recommended default for all agent display contexts.
 *
 * Icon classification is delegated entirely to `resolvePersonaIcon` so this
 * renderer and `PersonaAvatar` always agree on what a given `icon` string means.
 *
 * ```tsx
 * // Simple — 3× expanded icon with 32px anchor:
 * <PersonaIcon icon={p.icon} color={p.color} display="pop" />
 *
 * // With custom frame background:
 * <PersonaIcon icon={p.icon} color={p.color} display="pop"
 *   frameClass="border border-primary/15"
 *   frameStyle={{ backgroundColor: `${p.color}15` }} />
 * ```
 */
export function PersonaIcon({
  icon,
  color,
  name,
  display,
  frameSize = 'lg',
  frameClass = '',
  frameStyle,
  size = 'w-4 h-4',
  className = '',
  framed,
}: PersonaIconProps) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const style = { color: color ?? 'var(--primary)' };

  const resolved = resolvePersonaIcon(icon);
  // Hook must run unconditionally; passes null for non-custom icons.
  const customSrc = useCustomIconSrc(resolved.kind === 'custom' ? resolved.assetId : null);

  // A custom icon whose file URL hasn't resolved yet renders as the fallback
  // until it's ready (the app-data dir is warmed at startup, so this is rare).
  const effectiveKind: ResolvedIcon['kind'] =
    resolved.kind === 'custom' && !customSrc ? 'fallback' : resolved.kind;

  // Backwards compat: framed without display → treat as "framed"
  const requestedDisplay = display ?? (framed ? 'framed' : undefined);

  // The "pop" variant intentionally bursts the icon ~3× past its frame. That
  // suits the curated agent art (transparent margins) and emoji, but not the
  // generic Bot fallback or a full-bleed user upload / remote image — at 3×
  // those become oversized blobs that bleed into adjacent text. Downgrade
  // those kinds to "framed" so they stay contained within the chip.
  const willNotPop =
    effectiveKind === 'fallback' || effectiveKind === 'custom' || effectiveKind === 'url';
  const resolvedDisplay =
    requestedDisplay === 'pop' && willNotPop ? 'framed' : requestedDisplay;

  // Determine if we're in wrapped mode
  const isWrapped = resolvedDisplay === 'framed' || resolvedDisplay === 'pop';

  // Build the inner element — no size classes when wrapped (CSS handles it)
  let inner: React.ReactNode;

  if (effectiveKind === 'builtin') {
    const value = (resolved as Extract<ResolvedIcon, { kind: 'builtin' }>).value;
    const sprite = resolveAgentIconSprite(value, isDark);
    inner = sprite ? (
      <div
        aria-hidden="true"
        className={isWrapped ? 'agent-icon-sprite' : `agent-icon-sprite ${size} flex-shrink-0 ${className}`.trim()}
        style={{
          backgroundImage: `url(${sprite.src})`,
          backgroundSize: `${sprite.columns * 100}% 100%`,
          backgroundPosition: `${sprite.columns <= 1 ? 0 : (sprite.index / (sprite.columns - 1)) * 100}% 0%`,
        }}
      />
    ) : (
      <img
        src={resolveAgentIconSrc(value, isDark)}
        alt=""
        className={isWrapped ? undefined : `${size} flex-shrink-0 object-contain ${className}`.trim()}
        loading="lazy"
      />
    );
  } else if (effectiveKind === 'custom') {
    inner = (
      <img
        src={customSrc!}
        alt=""
        className={isWrapped ? undefined : `${size} flex-shrink-0 object-contain ${className}`.trim()}
        loading="lazy"
      />
    );
  } else if (effectiveKind === 'url') {
    const url = (resolved as Extract<ResolvedIcon, { kind: 'url' }>).url;
    inner = (
      <img
        src={url}
        alt=""
        className={isWrapped ? undefined : `${size} flex-shrink-0 object-contain ${className}`.trim()}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        loading="lazy"
      />
    );
  } else if (effectiveKind === 'emoji') {
    const char = (resolved as Extract<ResolvedIcon, { kind: 'emoji' }>).char;
    inner = (
      <span
        className={isWrapped
          ? 'flex items-center justify-center leading-none'
          : `flex items-center justify-center flex-shrink-0 leading-none ${size} ${className}`.trim()
        }
        style={style}
        role="img"
        aria-label={t.shared.agent_icon_label}
      >
        {char}
      </span>
    );
  } else if (name && name.trim()) {
    // No assigned icon, but the persona's name is known → render its initials
    // (first letters of the first two words) tinted with `color`, so unkeyed
    // personas stay distinguishable instead of all collapsing to one Bot.
    inner = (
      <span
        aria-hidden="true"
        className={isWrapped
          ? `flex items-center justify-center leading-none font-semibold ${FRAME_INITIALS_CLASS[frameSize]}`
          : `flex items-center justify-center flex-shrink-0 leading-none font-semibold text-[0.7em] ${size} ${className}`.trim()
        }
        style={style}
      >
        {personaInitials(name)}
      </span>
    );
  } else {
    inner = (
      <Bot
        className={isWrapped ? undefined : `${size} flex-shrink-0 ${className}`.trim()}
        style={style}
      />
    );
  }

  // Bare mode — return the element directly
  if (!isWrapped) return <>{inner}</>;

  // Wrapped mode — build the frame div
  const frameSizeClass = frameSize ? FRAME_SIZE_CLASS[frameSize] : '';
  const popClass = resolvedDisplay === 'pop' ? 'icon-frame-pop' : '';
  const wrapperClassName = `icon-frame ${frameSizeClass} ${popClass} flex-shrink-0 ${frameClass}`.replace(/\s+/g, ' ').trim();

  return (
    <div className={wrapperClassName} style={frameStyle}>
      {inner}
    </div>
  );
}
