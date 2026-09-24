import { useCallback, useState } from 'react';
import type { McpApprovalPayload, McpGuidancePayload, McpPendingRequest } from './mcpRequestStore';
import { resolveMcpRequest } from './useMcpRequestBridge';

/**
 * useMcpRequestCard - the logic behind one blocking request from a fleet
 * session (`athena.request_guidance` / `athena.request_approval`), without the
 * look. `McpRequestPanel` renders it as the product's own cards; card-native
 * surfaces render the same approve / deny / answer verbs their own way.
 *
 * Resolves are one-shot: on success the bridge removes the request (the card
 * disappears); on failure the in-flight flag drops so the operator can retry.
 */
export interface McpRequestCardModel {
  kind: McpPendingRequest['kind'];
  /** The approval payload, when `kind === 'approval'`. */
  approval: McpApprovalPayload | null;
  /** The guidance payload, when `kind === 'guidance'`. */
  guidance: McpGuidancePayload | null;
  /** The short session id the request came from (first 8 chars). */
  sessionShort: string;
  sending: 'approve' | 'deny' | 'answer' | null;
  /** Optional note sent with approve / deny. */
  note: string;
  setNote: (v: string) => void;
  /** The typed answer to a guidance request. */
  answer: string;
  setAnswer: (v: string) => void;
  canAnswer: boolean;
  approve: () => Promise<void>;
  deny: () => Promise<void>;
  sendAnswer: () => Promise<void>;
}

export function useMcpRequestCard(request: McpPendingRequest): McpRequestCardModel {
  const [note, setNote] = useState('');
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState<McpRequestCardModel['sending']>(null);

  const decide = useCallback(
    async (approved: boolean) => {
      if (sending) return;
      setSending(approved ? 'approve' : 'deny');
      const ok = await resolveMcpRequest(request.requestId, { approved, note: note.trim() });
      if (!ok) setSending(null);
    },
    [sending, request.requestId, note],
  );
  const approve = useCallback(() => decide(true), [decide]);
  const deny = useCallback(() => decide(false), [decide]);

  const sendAnswer = useCallback(async () => {
    if (!answer.trim() || sending) return;
    setSending('answer');
    const ok = await resolveMcpRequest(request.requestId, { text: answer.trim() });
    if (!ok) setSending(null);
  }, [answer, sending, request.requestId]);

  // Invariant: the bridge builds `payload` from the event that named `kind`
  // (guidance-request -> McpGuidancePayload, approval-request -> McpApprovalPayload).
  return {
    kind: request.kind,
    approval: request.kind === 'approval' ? (request.payload as McpApprovalPayload) : null,
    guidance: request.kind === 'guidance' ? (request.payload as McpGuidancePayload) : null,
    sessionShort: request.fleetSessionId.slice(0, 8),
    sending,
    note,
    setNote,
    answer,
    setAnswer,
    canAnswer: answer.trim().length > 0 && sending === null,
    approve,
    deny,
    sendAnswer,
  };
}
