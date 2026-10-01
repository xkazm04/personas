/**
 * One plate of the exploded stack. Three nested boxes, each owning one motion:
 * the lane breathes (a CSS loop, stage only), the lift wrapper carries the
 * one-shot delta lift (framer, skipped under reduced motion), and the plate
 * itself travels between the stack, the lead (L2, face-on) and the rail by CSS
 * transitions on the geometry its lane's `data-role` names in strata.css.
 */
import { useEffect, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { motion, useAnimationControls } from 'framer-motion';

import type { SectionId } from '../../blueprintContract';

export type PlateRole = 'stack' | 'lead' | 'rail';

interface StrataPlateProps {
  section: SectionId;
  index: number;
  role: PlateRole;
  /** Position among the rail plates (focus layout only). */
  railIndex: number;
  coverage: number | null;
  /** Rendered as a button (overview + rail); inert in stage and as the lead. */
  label: string | null;
  describedBy?: string;
  hot: boolean;
  /** Changes once per delta to replay the lift; `null` = no lift. */
  liftKey: string | null;
  breathe: boolean;
  reduced: boolean;
  onActivate: (section: SectionId) => void;
  onHot: (section: SectionId | null) => void;
  /** The flat chip that lands on the plate (stage delta). */
  chip?: ReactNode;
  children: ReactNode;
}

const LIFT = { y: [0, -18, -18, 0], transition: { duration: 2.4, times: [0, 0.14, 0.8, 1], ease: 'easeInOut' as const } };

export function StrataPlate(props: StrataPlateProps) {
  const { section, index, role, railIndex, coverage, label, describedBy, hot, liftKey, breathe, reduced } = props;
  const controls = useAnimationControls();

  useEffect(() => {
    if (!liftKey || reduced) return;
    void controls.start(LIFT);
  }, [liftKey, reduced, controls]);

  const interactive = label !== null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onActivate(section);
    }
  };

  const laneStyle = { '--i': index, '--k': railIndex, '--cov': coverage ?? 0 } as CSSProperties;
  const measured = coverage !== null;

  return (
    <div
      className="strata-lane"
      data-role={role}
      data-section={section}
      data-breathe={breathe && !reduced ? 'on' : undefined}
      data-loop={breathe && !reduced ? 'breathe' : undefined}
      style={laneStyle}
    >
      <motion.div className="strata-lift" animate={controls}>
        <div
          className="strata-plate focus-ring"
          data-testid={`strata-plate-${section}`}
          data-hot={hot ? 'true' : undefined}
          data-measured={measured ? 'true' : 'false'}
          data-coverage={measured ? String(Math.round(coverage * 1000) / 1000) : 'none'}
          data-travel={reduced ? 'off' : 'on'}
          role={interactive ? 'button' : undefined}
          tabIndex={interactive ? 0 : -1}
          aria-label={label ?? undefined}
          aria-describedby={interactive ? describedBy : undefined}
          aria-hidden={interactive ? undefined : true}
          onClick={interactive ? () => props.onActivate(section) : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
          onPointerEnter={interactive ? () => props.onHot(section) : undefined}
          onPointerLeave={interactive ? () => props.onHot(null) : undefined}
          onFocus={interactive ? () => props.onHot(section) : undefined}
          onBlur={interactive ? () => props.onHot(null) : undefined}
        >
          <span className="strata-edge strata-edge--left" aria-hidden />
          <span className="strata-edge strata-edge--bottom" aria-hidden />
          <div className="strata-face">
            <div className="strata-fill" />
            {!measured && <div className="strata-hatch" data-measured="false" />}
            <div className="strata-chart">{props.children}</div>
          </div>
        </div>
        {props.chip}
      </motion.div>
    </div>
  );
}
