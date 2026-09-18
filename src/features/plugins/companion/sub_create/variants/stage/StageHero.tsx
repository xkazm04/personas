import { AthenaAvatar } from '@/features/plugins/companion/AthenaAvatar';
import { AthenaWaveform } from '../../shared/AthenaWaveform';

/**
 * The Stage's one memorable element: Athena's presence on the rail — a soft
 * orb (radial gradient off the theme primary) holding her avatar, drifting
 * very slowly, with her live waveform as a band underneath.
 *
 * The drift is a CSS loop on purpose: `<MotionConfig reducedMotion>` snaps
 * every framer animation, so an ambient loop lives in CSS and turns itself
 * off under both reduced-motion signals (OS media query and the in-app
 * `html[data-motion="reduce"]` toggle). Amplitude ≤3px / opacity Δ ≤0.08 —
 * a breath, not a bounce.
 */
const ORB_STYLE = `
@keyframes create-stage-orb-drift {
  0%, 100% { transform: translate(0, 0); opacity: 0.92; }
  50% { transform: translate(2px, -3px); opacity: 1; }
}
.create-stage-orb { animation: create-stage-orb-drift 5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .create-stage-orb { animation: none; } }
html[data-motion="reduce"] .create-stage-orb { animation: none; }
`;

const ORB_GRADIENT =
  'radial-gradient(circle at 38% 30%, color-mix(in srgb, var(--color-primary) 60%, transparent) 0%, color-mix(in srgb, var(--color-primary) 22%, transparent) 52%, transparent 74%)';

export interface StageHeroProps {
  speaking: boolean;
}

export function StageHero({ speaking }: StageHeroProps) {
  return (
    <div className="flex flex-col items-center pt-6 pb-4" data-testid="create-athena-stage-hero">
      <style>{ORB_STYLE}</style>
      <div
        className={`create-stage-orb relative w-[120px] h-[120px] rounded-pill transition-shadow duration-slow motion-reduce:transition-none ${
          speaking ? 'shadow-[0_0_48px_-8px_var(--color-primary)]' : 'shadow-elevation-2'
        }`}
        style={{ background: ORB_GRADIENT }}
        data-speaking={speaking ? 'true' : 'false'}
      >
        <div className="absolute inset-[16px] rounded-pill overflow-hidden bg-secondary/40">
          <AthenaAvatar fill state={speaking ? 'speaking' : 'idle'} />
        </div>
      </div>
      <AthenaWaveform active={speaking} bars={24} className="mt-4" />
    </div>
  );
}
