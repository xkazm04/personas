import { useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  HelpCircle,
  Send,
  ShieldQuestion,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  useMcpRequestStore,
  type McpApprovalPayload,
  type McpGuidancePayload,
  type McpPendingRequest,
} from './mcpRequestStore';
import { resolveMcpRequest } from './useMcpRequestBridge';

/**
 * Stack of inline cards for in-flight MCP requests. Mounted inside
 * CompanionPanel above the message list so the user sees blocking
 * questions immediately. One card per pending request; resolves are
 * one-shot — the card disappears the moment the user clicks.
 *
 * Batch approve: when 2+ `approval`-kind requests are pending from the
 * SAME fleet session, the per-session group renders a header with an
 * "Approve all" button. Common case the batch unblocks: a fleet session
 * pauses on 3-5 RPCs in a row (write file, run cmd, write file…); the
 * user trusts the session and one click resolves them all. Guidance
 * requests never batch — they need typed answers.
 */
export function McpRequestPanel() {
  const requests = useMcpRequestStore((s) => s.pendingRequests);
  // Group preserves the receivedAt order: walk pendingRequests, attach
  // each new request to its session bucket. Sessions render in
  // first-seen order so reorderings from React keys stay stable.
  const groups = useMemo(() => groupBySession(requests), [requests]);
  if (requests.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-b border-border/40 bg-secondary/20">
      {groups.map((g) => (
        <SessionGroup key={g.fleetSessionId} group={g} />
      ))}
    </div>
  );
}

interface SessionGroupShape {
  fleetSessionId: string;
  requests: McpPendingRequest[];
  approvalCount: number;
}

function groupBySession(requests: McpPendingRequest[]): SessionGroupShape[] {
  const order: string[] = [];
  const buckets = new Map<string, McpPendingRequest[]>();
  for (const r of requests) {
    const arr = buckets.get(r.fleetSessionId);
    if (arr) {
      arr.push(r);
    } else {
      buckets.set(r.fleetSessionId, [r]);
      order.push(r.fleetSessionId);
    }
  }
  return order.map((id) => {
    const arr = buckets.get(id) ?? [];
    return {
      fleetSessionId: id,
      requests: arr,
      approvalCount: arr.filter((r) => r.kind === 'approval').length,
    };
  });
}

function SessionGroup({ group }: { group: SessionGroupShape }) {
  const { t } = useTranslation();
  const [batchSending, setBatchSending] = useState(false);
  const showBatchAffordance = group.approvalCount >= 2;

  const handleBatchApprove = async () => {
    if (batchSending) return;
    setBatchSending(true);
    const approvals = group.requests.filter((r) => r.kind === 'approval');
    // Fire in parallel; each resolveMcpRequest removes its own request
    // on success and silentCatch's on failure. allSettled to keep one
    // failure from stalling the rest.
    await Promise.allSettled(
      approvals.map((r) =>
        resolveMcpRequest(r.requestId, { approved: true, note: '' }),
      ),
    );
    setBatchSending(false);
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="companion-mcp-session-group"
      data-fleet-session-id={group.fleetSessionId}
    >
      {showBatchAffordance && (
        <div className="flex items-center gap-2 rounded-card border border-primary/30 bg-primary/[0.05] px-2.5 py-1.5 typo-caption">
          <CheckCheck className="size-3.5 text-primary shrink-0" />
          <span className="flex-1 text-foreground/90">
            {t.plugins.companion.orchestration.batch_pending_label
              .replace('{count}', String(group.approvalCount))
              .replace('{session}', sessionLabel(group.fleetSessionId))}
          </span>
          <button
            type="button"
            onClick={handleBatchApprove}
            disabled={batchSending}
            className="inline-flex items-center gap-1 rounded-interactive bg-primary text-primary-foreground px-2 py-0.5 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
            data-testid="companion-mcp-batch-approve"
          >
            <Check className="size-3" />
            {batchSending
              ? t.plugins.companion.orchestration.batch_approving
              : t.plugins.companion.orchestration.batch_approve_all}
          </button>
        </div>
      )}
      {group.requests.map((r) =>
        r.kind === 'guidance' ? (
          <GuidanceCard key={r.requestId} request={r} />
        ) : (
          <ApprovalCard key={r.requestId} request={r} />
        ),
      )}
    </div>
  );
}

function GuidanceCard({ request }: { request: McpPendingRequest }) {
  const { t } = useTranslation();
  const payload = request.payload as McpGuidancePayload;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const onSubmit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await resolveMcpRequest(request.requestId, { text: text.trim() });
    if (!ok) setSending(false);
  };

  return (
    <div className="rounded-card border border-border bg-card p-3 shadow-elevation-1">
      <div className="flex items-start gap-2 mb-2">
        <HelpCircle className="size-4 text-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="typo-label text-foreground">
            {t.plugins.companion.orchestration.guidance_from} {sessionLabel(request.fleetSessionId)}
          </div>
          <div className="typo-body text-foreground mt-1">{payload.question}</div>
          {payload.context && (
            <div className="typo-caption text-foreground mt-1 whitespace-pre-wrap">
              {payload.context}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.plugins.companion.orchestration.guidance_placeholder}
          className="flex-1 rounded-input border border-border bg-background px-2 py-1.5 typo-body resize-none min-h-[2.25rem]"
          rows={2}
          disabled={sending}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!text.trim() || sending}
          className="rounded-interactive bg-primary text-primary-foreground px-3 py-1.5 typo-button disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Send className="size-3.5" />
          {t.plugins.companion.orchestration.guidance_send}
        </button>
      </div>
    </div>
  );
}

function ApprovalCard({ request }: { request: McpPendingRequest }) {
  const { t } = useTranslation();
  const payload = request.payload as McpApprovalPayload;
  const [note, setNote] = useState('');
  const [sending, setSending] = useState<'approve' | 'deny' | null>(null);

  const onApprove = async () => {
    if (sending) return;
    setSending('approve');
    const ok = await resolveMcpRequest(request.requestId, {
      approved: true,
      note: note.trim(),
    });
    if (!ok) setSending(null);
  };
  const onDeny = async () => {
    if (sending) return;
    setSending('deny');
    const ok = await resolveMcpRequest(request.requestId, {
      approved: false,
      note: note.trim(),
    });
    if (!ok) setSending(null);
  };

  return (
    <div className="rounded-card border border-border bg-card p-3 shadow-elevation-1">
      <div className="flex items-start gap-2 mb-2">
        <ShieldQuestion className="size-4 text-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="typo-label text-foreground">
            {t.plugins.companion.orchestration.approval_from} {sessionLabel(request.fleetSessionId)}
          </div>
          <div className="typo-body text-foreground mt-1">{payload.action}</div>
          {payload.rationale && (
            <div className="typo-caption text-foreground mt-1 whitespace-pre-wrap">
              {payload.rationale}
            </div>
          )}
        </div>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t.plugins.companion.orchestration.approval_note_placeholder}
        className="w-full rounded-input border border-border bg-background px-2 py-1.5 typo-body mb-2"
        disabled={sending !== null}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={sending !== null}
          className="flex-1 rounded-interactive bg-primary text-primary-foreground px-3 py-1.5 typo-button disabled:opacity-50 inline-flex items-center justify-center gap-1"
        >
          <Check className="size-3.5" />
          {t.plugins.companion.orchestration.approval_approve}
        </button>
        <button
          type="button"
          onClick={onDeny}
          disabled={sending !== null}
          className="flex-1 rounded-interactive border border-border bg-background text-foreground px-3 py-1.5 typo-button disabled:opacity-50 inline-flex items-center justify-center gap-1"
        >
          <X className="size-3.5" />
          {t.plugins.companion.orchestration.approval_deny}
        </button>
      </div>
    </div>
  );
}

function sessionLabel(fleetSessionId: string): string {
  return `\`${fleetSessionId.slice(0, 8)}\``;
}
