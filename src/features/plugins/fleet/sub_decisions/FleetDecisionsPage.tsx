import { FleetPhaseBanner } from '../FleetPage';

export default function FleetDecisionsPage() {
  return (
    <FleetPhaseBanner
      phase="Decision broadcast — wiring up"
      summary="Phase 8 will let you compose a prompt once and push it to any subset of sessions (or all sessions currently awaiting input) by writing directly to each PTY's stdin."
    />
  );
}
