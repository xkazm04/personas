/**
 * The one way into the Companions section.
 *
 * Every inbound navigator (Athena's own routes, her client actions, the
 * decisions footer, power moves, the Features board's council links, the
 * guided tours) goes through this helper, so the section and the page always
 * move together and a future page rename has one call site to change.
 *
 * WP0 CONTRACT STUB: the signature is frozen here; WP2 implements the body
 * once the `companions` section and the `companionsPage` field exist.
 */
import type { CompanionsPage } from "./types";

export function navigateToCompanions(page: CompanionsPage): void {
  // WP2 replaces this body with the atomic section + page set.
  void page;
}
