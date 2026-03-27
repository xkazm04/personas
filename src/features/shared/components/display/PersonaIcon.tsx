import { Bot } from 'lucide-react';

interface PersonaIconProps {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: string;
  className?: string;
}

/**
 * Universal persona icon renderer.
 * - If icon is an emoji or text: renders it as a span
 * - Otherwise: renders a Bot lucide icon with the persona's color
 */
export function PersonaIcon({ icon, color, size = 'w-4 h-4', className = '' }: PersonaIconProps) {
  const style = { color: color ?? 'var(--primary)' };

  // Render emoji/text icon if set and non-empty
  if (icon && icon.trim()) {
    return (
      <span
        className={`flex items-center justify-center flex-shrink-0 leading-none ${size} ${className}`}
        style={style}
        role="img"
        aria-label="agent icon"
      >
        {icon}
      </span>
    );
  }

  // Fallback to Bot icon
  return <Bot className={`${size} flex-shrink-0 ${className}`} style={style} />;
}
