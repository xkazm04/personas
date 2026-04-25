/**
 * App-root host for the resource picker modal.
 *
 * Mounted once near the top of the React tree (in App.tsx), this component
 * subscribes to the global picker store and renders `<ResourcePicker>` when
 * any caller dispatches `prompt`. Because it's mounted globally, the picker
 * survives parent-level unmounts (Catalog GO_LIST, autopilot reset, edit
 * form close, etc.).
 */
import { useShallow } from 'zustand/react/shallow';

import { useResourcePickerStore } from './resourcePickerStore';
import { ResourcePicker } from './ResourcePicker';

export function ResourcePickerHost() {
  const { active, close } = useResourcePickerStore(
    useShallow((s) => ({ active: s.active, close: s.close })),
  );
  if (!active) return null;
  return (
    <ResourcePicker
      credentialId={active.credentialId}
      connectorLabel={active.connectorLabel}
      specs={active.specs}
      onClose={close}
    />
  );
}
