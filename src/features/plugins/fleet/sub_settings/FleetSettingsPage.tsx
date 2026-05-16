import { FleetPhaseBanner } from '../FleetPage';

export default function FleetSettingsPage() {
  return (
    <FleetPhaseBanner
      phase="Settings — wiring up"
      summary="Phase 5 will install/uninstall Claude Code hooks (Stop / Notification / PreToolUse / SessionStart / SessionEnd) pointing to the in-app HTTP receiver, with an idempotent _fleet marker so user-authored hooks stay untouched."
    />
  );
}
