/**
 * The Hub route. `TwinPage` mounts this for `twinTab === 'hub'`.
 *
 * One hook loads everything the Hub shows; the shell owns the permanent
 * chrome and the prototype switcher; the variants only render.
 */

import { Brain } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { TwinEmptyState } from '../TwinEmptyState';
import { HubShell } from './HubShell';
import { useHubFeed } from './useHubFeed';

export default function HubPage() {
  const t = useTranslation().t.twin.hub;
  const feed = useHubFeed();

  if (!feed.twinId) return <TwinEmptyState icon={Brain} title={t.title} />;

  return <HubShell feed={feed} />;
}
