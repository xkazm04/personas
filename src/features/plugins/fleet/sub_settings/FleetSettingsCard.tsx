import type { ReactNode } from 'react';

interface FleetSettingsCardProps {
  /** Leading glyph for the head line. */
  icon?: ReactNode;
  title: ReactNode;
  /** One sentence under the head: what the card controls. */
  description?: ReactNode;
  /** Controls or a count chip at the right end of the head line. */
  aside?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

/**
 * One card on the Fleet Settings page: an icon and a `typo-heading` head, an
 * optional caption, then the card's controls. Every card on the page draws its
 * head from here, so the head always reads above its description instead of
 * the muted-head-over-bright-sentence order the cards had grown one by one.
 */
export function FleetSettingsCard({ icon, title, description, aside, children, 'data-testid': testId }: FleetSettingsCardProps) {
  return (
    <section className="rounded-modal border border-primary/10 bg-secondary/20 px-4 py-3" data-testid={testId}>
      <div className="flex items-center gap-2 min-h-7">
        {icon && <span className="flex shrink-0" aria-hidden="true">{icon}</span>}
        <h3 className="typo-heading text-foreground">{title}</h3>
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </div>
      {description && <p className="typo-caption mt-0.5">{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}
