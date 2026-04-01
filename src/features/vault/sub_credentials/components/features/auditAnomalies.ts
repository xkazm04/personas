import type { CredentialAuditEntry } from '@/lib/bindings/CredentialAuditEntry';

export type AnomalyType = 'burst' | 'off_hours' | 'new_persona' | 'rapid_decrypt';

export interface AnomalyFlag {
  type: AnomalyType;
  label: string;
}

export interface TimelineEntry extends CredentialAuditEntry {
  anomalies: AnomalyFlag[];
}

export function detectAnomalies(entries: CredentialAuditEntry[]): TimelineEntry[] {
  if (entries.length === 0) return [];

  // Track known personas (those seen in the first 80% of history)
  const historyEnd = Math.floor(entries.length * 0.8);
  const historicPersonas = new Set<string>();
  for (let i = historyEnd; i < entries.length; i++) {
    const e = entries[i];
    if (e && e.persona_id) historicPersonas.add(e.persona_id);
  }

  return entries.map((entry, idx) => {
    const anomalies: AnomalyFlag[] = [];
    const entryTime = new Date(entry.created_at);
    const hour = entryTime.getUTCHours();

    // Off-hours access (midnight-5am UTC)
    if (hour >= 0 && hour < 5) {
      anomalies.push({ type: 'off_hours', label: 'Off-hours access' });
    }

    // New persona (not seen in historical entries)
    if (
      entry.persona_id &&
      historicPersonas.size > 0 &&
      !historicPersonas.has(entry.persona_id) &&
      idx < historyEnd
    ) {
      anomalies.push({ type: 'new_persona', label: 'First access by this persona' });
    }

    // Burst detection: 5+ accesses in a 60-second window
    if (idx < entries.length - 1) {
      let windowCount = 1;
      for (let j = idx + 1; j < entries.length; j++) {
        const diff = entryTime.getTime() - new Date(entries[j]!.created_at).getTime();
        if (diff <= 60_000) windowCount++;
        else break;
      }
      if (windowCount >= 5) {
        anomalies.push({ type: 'burst', label: `${windowCount} accesses in <1 min` });
      }
    }

    // Rapid decrypt: decrypt operations within 5s of each other from different callers
    if (entry.operation === 'decrypt' && idx < entries.length - 1) {
      const next = entries[idx + 1]!;
      if (next.operation === 'decrypt') {
        const gap = entryTime.getTime() - new Date(next.created_at).getTime();
        if (gap < 5000 && gap >= 0 && entry.detail !== next.detail) {
          anomalies.push({ type: 'rapid_decrypt', label: 'Rapid decrypt from different source' });
        }
      }
    }

    return { ...entry, anomalies };
  });
}
