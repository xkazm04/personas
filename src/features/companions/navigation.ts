/**
 * The one way into the Companions section.
 *
 * Every inbound navigator (Athena's own routes, her client actions, the
 * decisions footer, power moves, the Features board's council links, the
 * guided tours) goes through this helper, so the section and the page always
 * move together and a future page rename has one call site to change.
 *
 * The page is written FIRST and the section second. `setSidebarSection` is the
 * state change that makes `CompanionsPage` mount, so landing the page before
 * it means the router's very first render already reads the right destination
 * — there is no frame in which the section is Companions and the page is still
 * whatever the operator last looked at.
 */
import { useSystemStore } from '@/stores/systemStore';

import type { CompanionsPage } from './types';

export function navigateToCompanions(page: CompanionsPage): void {
  const sys = useSystemStore.getState();
  sys.setCompanionsPage(page);
  sys.setSidebarSection('companions');
}
