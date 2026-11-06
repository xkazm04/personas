import type { ReactNode } from 'react';

import { Button, type ButtonProps } from '@/features/shared/components/buttons';

/** A keycap: mono glyph on a raised cap (a 1px floor shadow, no travel). */
export function Key({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'on-primary' }) {
  return <kbd className={`ss-key ss-key--${tone}`}>{children}</kbd>;
}

type Variant = 'quiet' | 'plain' | 'hero';

interface BtnProps extends Omit<ButtonProps, 'variant' | 'size' | 'iconRight'> {
  variant?: Variant;
  k?: string;
}

/**
 * The variant's one button: the shared Button for behaviour (loading, the
 * double-press guard, focus ring), Studio's own surface on top (studio.css is
 * unlayered, so it wins over the utility layer). quiet = borderless until
 * hover, plain = a raised neutral control, hero = the gradient go-press. The
 * keycap trails the label, so the eye reads the verb first.
 */
export function Btn({ variant = 'plain', k, className = '', children, ...rest }: BtnProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`ss-btn ss-btn--${variant} ${className}`}
      iconRight={k ? <Key tone={variant === 'hero' ? 'on-primary' : 'plain'}>{k}</Key> : undefined}
      {...rest}
    >
      {children}
    </Button>
  );
}
