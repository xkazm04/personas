// The three scaffold labels, and the honest note about where they come from.
//
// NO NEW STRINGS WERE MINTED. A variant switcher is scaffold: the operator
// picks one reading and the other two are deleted with the switch, so adding
// three keys (plus an aria label) to `en.json` and then to the other thirteen
// locales would be fourteen files of churn for a control that is meant to go
// away. Each label is therefore an EXISTING translated key whose English value
// is exactly the word this reading wants:
//
//   console — `vault.databases.tab_console`   "Console"
//   queue   — `monitor.triage_focus_queue`    "Queue"
//   brief   — `companions.process.phase_brief` "Brief"
//
// Two of the three reach outside the `monitor` section, which is a smell and
// is recorded as one. If a winner is kept rather than deleted, give it a
// `monitor.*` key of its own in the same change that removes the switch.

import { useTranslation } from '@/i18n/useTranslation';
import type { DrawerVariant } from './drawerVariant';

export function useVariantLabels(): Record<DrawerVariant, string> {
  const { t } = useTranslation();
  return {
    console: t.vault.databases.tab_console,
    queue: t.monitor.triage_focus_queue,
    brief: t.companions.process.phase_brief,
  };
}
