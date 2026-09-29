/** useVaultConnectorTiles - every connector the user has a credential for, one
 *  tile per service, with its health. `useHealthyConnectors` (the picker's
 *  source) drops anything that has not passed a check; the quick setup shows
 *  those too, marked and sorted last, so a broken credential is visible
 *  instead of silently missing. Usable = the same rule useHealthyConnectors
 *  applies (verified, unverifiable, or a zero-config built-in). */
import { useEffect, useMemo } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import { readCredentialHealthState, type HealthState } from "@/lib/credentials/healthState";
import type { HealthyConnector } from "@/features/agents/shared/quickConfig/useHealthyConnectors";

export interface VaultTile extends HealthyConnector {
  health: HealthState;
  usable: boolean;
}

const RANK: Record<HealthState, number> = { verified: 0, unverifiable: 1, untested: 2, unreachable: 3, failed: 4 };

export function useVaultConnectorTiles(): VaultTile[] {
  const credentials = useVaultStore((s) => s.credentials);
  const definitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const fetchDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);

  useEffect(() => {
    if (!credentials.length) void fetchCredentials();
    if (!definitions.length) void fetchDefinitions();
  }, [credentials.length, definitions.length, fetchCredentials, fetchDefinitions]);

  return useMemo(() => {
    const best = new Map<string, VaultTile>();
    for (const cred of credentials) {
      const def = definitions.find((d) => d.name === cred.service_type);
      if (!def) continue;
      const health = readCredentialHealthState(cred);
      const usable = health === "verified" || health === "unverifiable" || def.is_builtin;
      const tile: VaultTile = {
        name: def.name, meta: getConnectorMeta(def.name), credentialId: cred.id, category: def.category,
        health: usable && health !== "verified" ? "unverifiable" : health, usable,
      };
      const prev = best.get(def.name);
      // Keep the healthiest credential of a service.
      if (!prev || (tile.usable && !prev.usable) || (tile.usable === prev.usable && RANK[tile.health] < RANK[prev.health])) {
        best.set(def.name, tile);
      }
    }
    return Array.from(best.values()).sort((a, b) =>
      Number(b.usable) - Number(a.usable) || a.meta.label.localeCompare(b.meta.label));
  }, [credentials, definitions]);
}
