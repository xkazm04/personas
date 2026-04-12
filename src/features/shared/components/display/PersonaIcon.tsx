import { Bot } from 'lucide-react';
import { isAgentIcon, resolveAgentIconSrc } from '@/lib/icons/agentIconCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

type FrameSize = 'xs' | 'sm' | 'md' | 'lg';

const FRAME_SIZE_CLASS: Record<FrameSize, string> = {
  xs: 'icon-frame-xs',
  sm: 'icon-frame-sm',
  md: 'icon-frame-md',
  lg: 'icon-frame-lg',
};

interface PersonaIconProps {
  icon: string | null | undefined;
  color: string | null | undefined;

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
 * ```tsx
 * // Simple — 3× expanded icon with 32px anchor:
 * <PersonaIcon icon={p.icon} color={p.color} display="pop" />
 *
 * // With custom frame background:
 * <PersonaIcon icon={p.icon} color={p.color} display="pop"
 *   frameClass="border border-primary/15"
 *   frameStyle={{ backgroundColor: `${p.color}15` }} />
 *
 * // Small frame (24px anchor, 72px rendered):
 * <PersonaIcon icon={p.icon} color={p.color} display="pop" frameSize="sm" />
 * ```
 */
export function PersonaIcon({
  icon,
  color,
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

  // Backwards compat: framed without display → treat as "framed"
  const resolvedDisplay = display ?? (framed ? 'framed' : undefined);

  // Determine if we're in wrapped mode
  const isWrapped = resolvedDisplay === 'framed' || resolvedDisplay === 'pop';

  // Build the inner element — no size classes when wrapped (CSS handles it)
  let inner: React.ReactNode;

  // Detect emoji-like icons: short strings (≤8 chars) that aren't plain ASCII identifiers.
  // Anything longer or ASCII-only (like "persona:Foo") is not a valid icon → fall back to Bot.
  const isEmoji = typeof icon === 'string' && icon.trim().length > 0
    && icon.trim().length <= 8 && !/^[a-zA-Z0-9_:.\-/]+$/.test(icon.trim());

  if (isAgentIcon(icon)) {
    inner = (
      <img
        src={resolveAgentIconSrc(icon!, isDark)}
        alt=""
        className={isWrapped ? undefined : `${size} flex-shrink-0 object-contain ${className}`.trim()}
        loading="lazy"
      />
    );
  } else if (isEmoji) {
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
        {icon}
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
