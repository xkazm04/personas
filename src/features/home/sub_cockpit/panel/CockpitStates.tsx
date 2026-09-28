import { MessageCircle, RotateCcw } from 'lucide-react';

import { KitButton, KitHost, Tile, Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The loading ghost: the starter cockpit's own geometry (fleet vitals, needs
 * attention, the roster) as kit Tiles in their loading state, so the swap to
 * content moves nothing. Invisible for its first ~150ms (`animate-fade-in` with
 * a delay and `fill-mode: both`), so a fast fetch never paints it.
 */
export function CockpitGhost() {
  const { t } = useTranslation();
  return (
    <KitHost compact>
      <div className="animate-fade-in" style={{ animationDelay: '150ms' }} aria-hidden="true">
        <Tiles label={t.overview.cockpit.title_default}>
          <Tile state="loading" ghostRows={1} />
          <Tile state="loading" ghostRows={4} />
          <Tile state="loading" ghostRows={6} />
        </Tiles>
      </div>
    </KitHost>
  );
}

/** A failed fetch or a spec that will not parse: the kit's error band, its action the retry. */
export function CockpitError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  return (
    <KitHost compact>
      <Tiles label={c.title_default}>
        <Tile error={{
          title: c.error_title,
          action: <KitButton icon={<RotateCcw />} onClick={onRetry}>{c.error_retry}</KitButton>,
        }} />
      </Tiles>
    </KitHost>
  );
}

/**
 * Never composed and no fleet to start from: Athena's portrait as the
 * atmosphere (a gradient keeps the copy legible in every theme) and the one
 * call to action, which seeds her with a compose request.
 */
export function CockpitEmpty({ onTalk }: { onTalk: () => void }) {
  const { t, tx } = useTranslation();
  const c = t.overview.cockpit;
  return (
    <KitHost>
      <div
        data-testid="cockpit-empty-state"
        className="relative overflow-hidden rounded-modal border border-primary/10 min-h-[440px] flex flex-col items-center justify-end text-center"
      >
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img src="/athena/athena_baseline.jpg" alt="" aria-hidden="true" className="w-full h-full object-cover object-top opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 pb-10 max-w-md">
          <div className="typo-heading text-foreground">{c.empty_title}</div>
          <div className="typo-body text-foreground">
            {tx(c.empty_hint, { personas: c.empty_example_personas, attention: c.empty_example_attention })}
          </div>
          <KitButton tone="primary" icon={<MessageCircle />} onClick={onTalk} testId="cockpit-empty-talk-to-athena">
            {c.talk_to_athena}
          </KitButton>
        </div>
      </div>
    </KitHost>
  );
}
