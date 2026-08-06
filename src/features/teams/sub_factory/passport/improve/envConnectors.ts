// Per-environment connector bindings — the frontend half of the
// `dev_project_env_connectors` table.
//
// The four singular `dev_projects` credential slots answer "which connector
// does this project use for X". The env-split dimensions need a different
// question answered: "which connector backs THIS dimension in THIS
// environment" — SQLite locally, a branch database in test, a managed one in
// production. This hook is that lookup, plus assign/unassign.
//
// Written so the Monitoring dimension can reuse it verbatim: `dimension` is a
// free-form key, and the capability rows pass a suffixed one
// ('monitoring.logs'), which needs no schema or hook change.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { listEnvConnectors, setEnvConnector, type DevProjectEnvConnector } from '@/api/devTools/devTools';
import { healthcheckCredential, listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { silentCatch } from '@/lib/silentCatch';
import type { EnvKey } from '../passportModel';

/**
 * Vault service types that can back a database slot. Drawn from the builtin
 * connector catalog's `database` + `cache` categories, minus the app's own
 * internal stores (`personas_database`, `personas_vector_db`,
 * `operations_database`) — those are Personas' plumbing, not a managed
 * project's data tier, and offering them would be a category error.
 */
export const DATABASE_SERVICE_TYPES = [
  'postgres', 'postgresql', 'supabase', 'neon', 'planetscale', 'mongodb',
  'redis', 'upstash', 'convex', 'duckdb', 'turso', 'cockroachdb', 'clickhouse',
  'mysql', 'mariadb', 'firebase', 'snowflake',
];

/** Bindings keyed `${dimension}|${env}`. */
export type EnvBindingMap = Map<string, string>;

export const bindingKey = (dimension: string, env: EnvKey): string => `${dimension}|${env}`;

export interface EnvConnectorState {
  loading: boolean;
  /** (dimension, env) → credential id. */
  bindings: EnvBindingMap;
  /** Every vault credential, so a caller can filter by its own service types. */
  credentials: PersonaCredential[];
  /** credential id → healthcheck result; `undefined` while in flight. */
  health: Record<string, boolean | null>;
  /** The pair currently being written, so its control can disable. */
  saving: string | null;
  /** Assign, or clear when `credentialId` is null. */
  assign: (dimension: string, env: EnvKey, credentialId: string | null) => Promise<void>;
  credentialById: (id: string | undefined) => PersonaCredential | undefined;
}

export function useEnvConnectors(slug: string, serviceTypes: string[]): EnvConnectorState {
  const [rows, setRows] = useState<DevProjectEnvConnector[] | null>(null);
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [health, setHealth] = useState<Record<string, boolean | null>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // `serviceTypes` is almost always a module-level constant; keying the effect
  // on the joined string keeps a caller that builds it inline from re-fetching
  // the whole vault on every render.
  const typeKey = serviceTypes.join(',');

  useEffect(() => {
    let alive = true;
    void listEnvConnectors(slug)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { silentCatch('envConnectors list')(e); if (alive) setRows([]); });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    let alive = true;
    const accepted = new Set(typeKey.split(',').filter(Boolean));
    void listCredentials()
      .then((creds) => {
        if (!alive) return;
        const cands = creds.filter((c) => accepted.has(c.serviceType.toLowerCase()));
        setCredentials(cands);
        // Health is advisory: a candidate that fails its check is still
        // bindable (the user may be fixing it), it just renders as degraded.
        for (const c of cands) {
          healthcheckCredential(c.id)
            .then((r) => { if (alive) setHealth((h) => ({ ...h, [c.id]: r.success })); })
            .catch((e) => {
              silentCatch('envConnectors healthcheck')(e);
              if (alive) setHealth((h) => ({ ...h, [c.id]: false }));
            });
        }
      })
      .catch((e) => { silentCatch('envConnectors listCredentials')(e); if (alive) setCredentials([]); });
    return () => { alive = false; };
  }, [typeKey]);

  const bindings = useMemo<EnvBindingMap>(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(`${r.dimension}|${r.env}`, r.credential_id);
    return m;
  }, [rows]);

  const assign = useCallback(async (dimension: string, env: EnvKey, credentialId: string | null) => {
    const key = bindingKey(dimension, env);
    setSaving(key);
    try {
      await setEnvConnector(slug, dimension, env, credentialId);
      // Patch locally instead of refetching: the write is authoritative and a
      // round-trip would blank the row mid-interaction.
      setRows((prev) => {
        const rest = (prev ?? []).filter((r) => !(r.dimension === dimension && r.env === env));
        if (!credentialId) return rest;
        const now = new Date().toISOString();
        return [...rest, { project_id: slug, dimension, env, credential_id: credentialId, created_at: now, updated_at: now }];
      });
    } finally {
      setSaving(null);
    }
  }, [slug]);

  const credentialById = useCallback(
    (id: string | undefined) => (id ? credentials.find((c) => c.id === id) : undefined),
    [credentials],
  );

  return { loading: rows === null, bindings, credentials, health, saving, assign, credentialById };
}
