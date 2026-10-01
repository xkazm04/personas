/**
 * The exploded stack itself: the floor footprint, the two assembly lines that
 * run through the plates' side corners, the four plates (base first, so the top
 * plate paints over the ones below it) and, while the engine works, the scan
 * line that passes down through them. Geometry lives in strata.css, keyed by
 * the scene's `data-layout` and each lane's `data-role`.
 */
import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { DeltaChip } from './DeltaChip';
import { IdentityFace } from './faces/IdentityFace';
import { KnowledgeFace } from './faces/KnowledgeFace';
import { TrainingFace } from './faces/TrainingFace';
import { VoiceFace } from './faces/VoiceFace';
import { StrataPlate, type PlateRole } from './StrataPlate';
import { PLATE_ORDER } from './strataModel';

export type StrataLayout = 'overview' | 'focus' | 'stage';

interface StrataStackProps {
  layout: StrataLayout;
  model: TwinBlueprintModel;
  coverage: Record<SectionId, number | null>;
  focus: SectionId | null;
  hot: SectionId | null;
  labels: Record<SectionId, string>;
  uid: string;
  delta: BlueprintDelta | null;
  deltaSection: SectionId | null;
  working: boolean;
  reduced: boolean;
  onActivate: (section: SectionId) => void;
  onHot: (section: SectionId | null) => void;
}

export function StrataStack(props: StrataStackProps) {
  const { layout, model, coverage, focus, hot, labels, uid, delta, deltaSection, working, reduced } = props;
  const rail = PLATE_ORDER.filter((s) => s !== focus);
  const liftKey = delta ? `${delta.answeredStepId}:${delta.phase}` : null;

  const face = (section: SectionId) => {
    const hatch = `${uid}-hatch-${section}`;
    if (section === 'identity') return <IdentityFace model={model} hatch={hatch} />;
    if (section === 'voice') return <VoiceFace model={model} hatch={hatch} hot={delta?.channel ?? null} />;
    if (section === 'knowledge') return <KnowledgeFace model={model} hatch={hatch} />;
    return <TrainingFace model={model} hatch={hatch} hot={delta?.topicId ?? null} />;
  };

  const roleOf = (section: SectionId): PlateRole => {
    if (layout !== 'focus') return 'stack';
    return section === focus ? 'lead' : 'rail';
  };

  return (
    <>
      <div className="strata-floor" aria-hidden />
      <span className="strata-axis strata-axis--left" aria-hidden />
      <span className="strata-axis strata-axis--right" aria-hidden />
      {[...PLATE_ORDER].reverse().map((section) => {
        const index = PLATE_ORDER.indexOf(section);
        const role = roleOf(section);
        const isDelta = layout === 'stage' && deltaSection === section;
        const interactive = layout !== 'stage' && role !== 'lead';
        return (
          <StrataPlate
            key={section}
            section={section}
            index={index}
            role={role}
            railIndex={Math.max(0, rail.indexOf(section))}
            coverage={coverage[section]}
            label={interactive ? labels[section] : null}
            describedBy={layout === 'overview' ? `${uid}-callout-${section}` : undefined}
            hot={hot === section || isDelta}
            liftKey={isDelta ? liftKey : null}
            breathe={layout === 'stage'}
            reduced={reduced}
            onActivate={props.onActivate}
            onHot={props.onHot}
            chip={isDelta && delta ? <DeltaChip delta={delta} reduced={reduced} /> : undefined}
          >
            {face(section)}
          </StrataPlate>
        );
      })}
      {layout === 'stage' && working && !reduced && <span className="strata-scan" data-loop="scan" aria-hidden />}
    </>
  );
}
