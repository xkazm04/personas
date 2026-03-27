import { useMemo } from "react";
import { useVaultStore } from "../vaultStore";
import type { RotationOverviewItem } from "../slices/vault/rotationSlice";

function deriveOverviewList(
  statuses: Record<string, import("@/api/vault/rotation").RotationStatus>,
  credentials: { id: string; name: string; service_type: string }[],
): RotationOverviewItem[] {
  const items: RotationOverviewItem[] = [];
  for (const cred of credentials) {
    const status = statuses[cred.id];
    if (!status) continue;
    if (!status.has_policy && !status.anomaly_detected) continue;
    items.push({
      credentialId: cred.id,
      credentialName: cred.name,
      serviceType: cred.service_type,
      status,
    });
  }
  items.sort((a, b) => {
    if (a.status.anomaly_detected !== b.status.anomaly_detected) {
      return a.status.anomaly_detected ? -1 : 1;
    }
    const aNext = a.status.next_rotation_at ?? "9999";
    const bNext = b.status.next_rotation_at ?? "9999";
    return aNext.localeCompare(bNext);
  });
  return items;
}

/** Derives rotationOverviewList lazily at read time instead of recomputing on every status write. */
export function useRotationOverviewList(): RotationOverviewItem[] {
  const rotationStatuses = useVaultStore((s) => s.rotationStatuses);
  const credentials = useVaultStore((s) => s.credentials);
  return useMemo(
    () => deriveOverviewList(rotationStatuses, credentials),
    [rotationStatuses, credentials],
  );
}
