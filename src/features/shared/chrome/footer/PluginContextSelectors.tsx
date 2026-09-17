import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';
import { FooterSlot } from './FooterSlot';

// The workspace + project switcher (breadcrumb direction, chosen 2026-07-24).
const SwitcherBreadcrumb = lazyRetry(() =>
  import('@/features/plugins/dev-tools/sub_workspaces/SwitcherBreadcrumb').then((m) => ({ default: m.SwitcherBreadcrumb })),
);
// Active-twin avatar + picker.
const TwinFooterIcon = lazyRetry(() => import('@/features/plugins/twin/TwinFooterIcon'));

/**
 * The footer's global context selectors: Dev Tools project and Twin.
 *
 * Each belongs to a plugin and disappears while that plugin is switched off in
 * Plugins > Browse — a disabled plugin must not keep steering app-wide scope
 * from the chrome. Gating here (not inside each selector) also keeps a
 * disabled plugin's module graph from loading at all.
 */
export default function PluginContextSelectors() {
  const devToolsEnabled = useSystemStore((s) => s.enabledPlugins.has('dev-tools'));
  const twinEnabled = useSystemStore((s) => s.enabledPlugins.has('twin'));

  return (
    <>
      {twinEnabled && (
        <FooterSlot reserve={false}>
          <TwinFooterIcon />
        </FooterSlot>
      )}
      {devToolsEnabled && (
        <FooterSlot reserve={false}>
          <SwitcherBreadcrumb />
        </FooterSlot>
      )}
    </>
  );
}
