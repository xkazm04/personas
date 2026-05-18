import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import {
  useMcpRequestStore,
  type McpApprovalPayload,
  type McpGuidancePayload,
  type McpPendingRequest,
  type McpRequestKind,
} from './mcpRequestStore';

/**
 * Backend → frontend bridge for MCP pending requests.
 *
 * Subscribes to the two `athena://mcp/*-request` events emitted by the
 * MCP handlers when a fleet session calls `athena.request_guidance` or
 * `athena.request_approval`. On mount, also fetches the initial
 * snapshot so a hard reload doesn't strand pending requests off-screen.
 *
 * Mount once near the top of the app — same site as
 * `useFleetCompanionBridge`.
 */
export function useMcpRequestBridge(): void {
  useEffect(() => {
    const add = useMcpRequestStore.getState().addRequest;

    // Initial snapshot for the hard-reload case. The live event listener
    // covers anything that arrives later. The snapshot returns the
    // (id, kind, fleet_session_id) tuples only — we don't have payload
    // backfill, so on a reload the strip shows the request as "pending
    // (reloaded)" and prompts the user to resolve it conservatively.
    void invoke<PendingSnapshotEntry[]>('companion_mcp_pending_snapshot', {})
      .then((rows) => {
        for (const r of rows ?? []) {
          add({
            requestId: r.requestId,
            fleetSessionId: r.fleetSessionId,
            kind: r.kind,
            payload: stubPayload(r.kind),
            receivedAt: Date.now(),
          });
        }
      })
      .catch(silentCatch('useMcpRequestBridge:snapshot'));

    const unGuidance = listen<RawRequestNotice>('athena://mcp/guidance-request', (event) => {
      add(toPendingRequest(event.payload));
    });
    const unApproval = listen<RawRequestNotice>('athena://mcp/approval-request', (event) => {
      add(toPendingRequest(event.payload));
    });
    return () => {
      unGuidance.then((fn) => fn());
      unApproval.then((fn) => fn());
    };
  }, []);
}

interface RawRequestNotice {
  requestId: string;
  fleetSessionId: string;
  kind: McpRequestKind;
  payload: unknown;
}

interface PendingSnapshotEntry {
  requestId: string;
  fleetSessionId: string;
  kind: McpRequestKind;
}

function toPendingRequest(raw: RawRequestNotice): McpPendingRequest {
  return {
    requestId: raw.requestId,
    fleetSessionId: raw.fleetSessionId,
    kind: raw.kind,
    payload:
      raw.kind === 'guidance'
        ? coerceGuidance(raw.payload)
        : coerceApproval(raw.payload),
    receivedAt: Date.now(),
  };
}

function coerceGuidance(payload: unknown): McpGuidancePayload {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    return {
      question: typeof p.question === 'string' ? p.question : '',
      context: typeof p.context === 'string' ? p.context : null,
    };
  }
  return { question: '', context: null };
}

function coerceApproval(payload: unknown): McpApprovalPayload {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    return {
      action: typeof p.action === 'string' ? p.action : '',
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      details: p.details,
    };
  }
  return { action: '', rationale: '', details: null };
}

function stubPayload(kind: McpRequestKind): McpGuidancePayload | McpApprovalPayload {
  if (kind === 'guidance') {
    return { question: '(restored after reload — original question lost)', context: null };
  }
  return {
    action: '(restored after reload)',
    rationale: 'original details lost; approve conservatively',
    details: null,
  };
}

/**
 * Resolve a pending request — sends the response payload back to the
 * MCP handler so the blocking RPC unblocks the claude session.
 * Removes the request from local state on success.
 */
export async function resolveMcpRequest(
  requestId: string,
  response: Record<string, unknown>,
): Promise<boolean> {
  const ok = await invoke<boolean>('companion_mcp_resolve_request', {
    requestId,
    response,
  }).catch((e) => {
    silentCatch('resolveMcpRequest')(e);
    return false;
  });
  if (ok) {
    useMcpRequestStore.getState().removeRequest(requestId);
  }
  return ok;
}
