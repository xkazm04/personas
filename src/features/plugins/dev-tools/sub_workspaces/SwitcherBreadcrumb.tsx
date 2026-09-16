// FOOTER SWITCHER — DIRECTION A: "Breadcrumb".
//
// ONE control, not two: the footer's right cluster already sits ~190px from an
// absolutely-centred radio/section-nav, so a second pill would collide on a
// narrow window. The control itself is the universal WorkspaceProjectSelector
// (shared with every dev-tools / teams page header); the footer only picks its
// compact trigger and an upward popover.
import { WorkspaceProjectSelector } from './WorkspaceProjectSelector';

export function SwitcherBreadcrumb() {
  return <WorkspaceProjectSelector placement="up" variant="footer" testId="footer-workspace-breadcrumb" newWorkspaceTestId="footer-workspace-new" />;
}
