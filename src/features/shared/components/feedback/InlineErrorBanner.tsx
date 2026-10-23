import { type ReactNode } from 'react';
import { Banner, type BannerSeverity } from './Banner';

export type { BannerSeverity };

interface InlineErrorBannerProps {
  severity?: BannerSeverity;
  title?: string;
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Extra content rendered in the action slot (after retry/dismiss buttons). */
  actions?: ReactNode;
  /** Use tighter padding for inline/embedded contexts. */
  compact?: boolean;
  className?: string;
}

/**
 * @catalog Inline error/warning/info banner with optional title, retry, dismiss and an actions slot; a thin wrapper over `Banner`.
 *
 * Renders `Banner` with the same props: the two
 * used to carry identical per-severity config maps side by side, and only
 * one of them would have been updated next time a tone changed.
 */
export function InlineErrorBanner(props: InlineErrorBannerProps) {
  return <Banner {...props} />;
}
