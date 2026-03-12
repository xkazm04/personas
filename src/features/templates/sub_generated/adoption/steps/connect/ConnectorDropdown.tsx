/**
 * ConnectorDropdown -- dropdown for selecting alternative connectors within a role.
 *
 * Uses ThemedSelect (filterable) for consistent theming across the app.
 */
import { useMemo, useCallback } from 'react';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { CredentialMetadata } from '@/lib/types/types';

const BUILTIN_CONNECTORS = new Set(['personas_messages', 'personas_database']);

export function ConnectorDropdown({
  members,
  activeName,
  recommendedName,
  onSelect,
  credentials,
}: {
  members: string[];
  activeName: string;
  recommendedName: string;
  onSelect: (name: string) => void;
  credentials: CredentialMetadata[];
}) {
  // Filter to only connectors user has credentials for (+ always keep active + built-in), sorted by name
  const options = useMemo(() => {
    const credServiceTypes = new Set(credentials.map((c) => c.service_type));
    const filtered = members.filter(
      (m) => m === activeName || credServiceTypes.has(m) || BUILTIN_CONNECTORS.has(m),
    );
    return filtered
      .sort((a, b) => getConnectorMeta(a).label.toLowerCase().localeCompare(getConnectorMeta(b).label.toLowerCase()))
      .map((m) => {
        const meta = getConnectorMeta(m);
        const suffix = m === recommendedName ? ' (original)' : '';
        return { value: m, label: `${meta.label}${suffix}` };
      });
  }, [members, activeName, credentials, recommendedName]);

  const handleSelect = useCallback(
    (val: string) => { if (val && val !== activeName) onSelect(val); },
    [activeName, onSelect],
  );

  return (
    <ThemedSelect
      filterable
      value={activeName}
      onValueChange={handleSelect}
      options={options}
      placeholder="Select connector..."
      className="!py-1.5 !px-2.5 !text-sm !rounded-lg"
    />
  );
}
