import { create } from 'zustand';

/**
 * MCP pending-request store — guidance / approval prompts emitted by
 * `athena.request_guidance` / `athena.request_approval` from inside
 * fleet sessions (Direction 3).
 *
 * Lifecycle:
 *   1. Fleet session calls a blocking MCP tool.
 *   2. Backend emits `athena://mcp/{guidance,approval}-request` with a
 *      request_id; `useMcpRequestBridge` listens and stuffs the
 *      payload into [pendingRequests].
 *   3. The chat panel renders [McpRequestPanel] above the message
 *      stream — one card per pending request.
 *   4. User responds → frontend calls `companion_mcp_resolve_request`
 *      → backend posts the response to the oneshot → the MCP RPC
 *      returns → claude session unblocks.
 *
 * Separate from the main companion store on purpose: MCP requests are
 * orthogonal to chat state (they can arrive when no chat turn is in
 * flight) and have their own UI affordance. Mixing them into
 * companionStore.ts would just bloat that already-large surface.
 */

export type McpRequestKind = 'guidance' | 'approval';

export interface McpGuidancePayload {
  question: string;
  context: string | null;
}

export interface McpApprovalPayload {
  action: string;
  rationale: string;
  details: unknown;
}

export interface McpPendingRequest {
  requestId: string;
  fleetSessionId: string;
  kind: McpRequestKind;
  payload: McpGuidancePayload | McpApprovalPayload;
  receivedAt: number;
}

interface McpRequestStore {
  pendingRequests: McpPendingRequest[];
  /** Idempotent — duplicate request_ids are deduped so a hard reload's
   *  snapshot-fetch can coexist with the live event listener. */
  addRequest: (req: McpPendingRequest) => void;
  removeRequest: (requestId: string) => void;
  clear: () => void;
}

export const useMcpRequestStore = create<McpRequestStore>((set) => ({
  pendingRequests: [],
  addRequest: (req) =>
    set((s) => {
      if (s.pendingRequests.some((r) => r.requestId === req.requestId)) {
        return s;
      }
      return { pendingRequests: [...s.pendingRequests, req] };
    }),
  removeRequest: (requestId) =>
    set((s) => ({
      pendingRequests: s.pendingRequests.filter((r) => r.requestId !== requestId),
    })),
  clear: () => set({ pendingRequests: [] }),
}));
