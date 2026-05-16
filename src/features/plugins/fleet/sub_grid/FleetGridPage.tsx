import { FleetPhaseBanner } from '../FleetPage';

export default function FleetGridPage() {
  return (
    <FleetPhaseBanner
      phase="Sessions grid — wiring up"
      summary="Phase 7 will render the project-grouped session grid with live state badges (running / awaiting input / idle / stale). The grid reads from the Rust FleetRegistry seeded by Claude Code hooks (Phase 4-5) and PTY-owned sessions (Phase 2)."
    />
  );
}
