/**
 * DecisionBody - one waiting item as the decision sheet's content, driven by
 * the product's own card models (`../c/bodies/model.ts`: `useDecisionCard`,
 * `useApprovalCard`, `useMcpRequestCard`), so every verb, the recommendation
 * and the parameter detail are the product's. Kinds without a native body
 * (plans, nudges, assignments) render the product's own card (`WorkItemBody`).
 *
 * The native format: the question large; the choices as big keyed tiles
 * (1-9), each with its consequence small at its foot; her pick lit in place
 * with her one-line why right under the tiles. A decision's pick is revealed
 * only when you ask (0), exactly as the product does.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect } from 'react';
import type { PendingApproval } from '@/api/companion';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import type { McpPendingRequest } from '@/features/companions/athena/mcp/mcpRequestStore';
import { WorkItemBody } from '../../../WorkItemBody';
import type { WorkItem } from '../../../useWorkforce';
import {
  hasNativeBody,
  useApprovalItem,
  useApprovalModel,
  useDecisionModel,
  useMcpItem,
  useMcpModel,
  type CardModel,
} from '../c/bodies/model';
import { DecisionTiles, inline, Verdict } from './DecisionTiles';
import { KindIcon } from './kindIcon';
import { splitLead } from './plainWords';
import { useDecisionKeys } from './useDecisionKeys';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ISLAND_COPY as I } from './copy';

function Sheet({ model, item, color }: { model: CardModel; item: WorkItem; color: string }) {
  useDecisionKeys(model);
  const announce = useAnnounce();
  const rec = model.recommendation;
  const spoken = rec?.revealed && rec.text ? rec.text : (rec?.composing ?? '');
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken, announce]);
  const { lead, rest } = splitLead(model.question);
  const field = model.field;

  return (
    <div className="r5a-sheet-inner" style={{ ['--c' as string]: color }} data-testid="companion-r5a-decision">
      <p className="r5a-eyebrow typo-eyebrow">
        <KindIcon kind={item.kind} />
        {model.eyebrow}
      </p>
      <h2 className="r5a-q typo-heading-lg">{inline(lead)}</h2>
      {rest && <p className="r5a-ctx typo-body-lg">{inline(rest)}</p>}
      {model.context && <p className="r5a-ctx typo-body">{inline(model.context)}</p>}

      {model.choices.length > 0 && <DecisionTiles model={model} />}
      {rec && <Verdict model={model} />}

      {field && (
        <label className="mt-5 flex flex-col gap-2">
          <span className="typo-label text-foreground">{field.label}</span>
          <textarea
            className={`${INPUT_FIELD} typo-body`}
            rows={field.multiline ? 3 : 1}
            value={field.value}
            placeholder={field.placeholder}
            disabled={field.disabled}
            onChange={(e) => field.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && field.submit?.enabled) {
                e.preventDefault();
                void field.submit.run();
              }
            }}
          />
          {field.submit && (
            <span className="flex justify-end">
              <Button variant="primary" size="sm" loading={field.submit.busy} disabled={!field.submit.enabled} onClick={() => void field.submit!.run()}>
                {field.submit.label}
              </Button>
            </span>
          )}
        </label>
      )}

      {model.details && (
        <details className="r5a-details">
          <summary className="typo-body cursor-pointer">{I.details}</summary>
          <pre className="typo-code">{model.details.code}</pre>
        </details>
      )}
      {model.error && <p className="r5a-problem typo-body" role="alert">{model.error}</p>}
      {model.warning && <p className="r5a-problem is-warn typo-body" role="alert">{model.warning}</p>}

      {model.deferrals.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {model.deferrals.map((d) => (
            <Tooltip key={d.key} content={d.hint}>
              <Button variant="ghost" size="sm" onClick={d.run}>
                {d.label}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionSheetBody({ item, color }: { item: WorkItem; color: string }) {
  const model = useDecisionModel();
  return model ? <Sheet model={model} item={item} color={color} /> : null;
}
function ApprovalInner({ item, color, approval }: { item: WorkItem; color: string; approval: PendingApproval }) {
  return <Sheet model={useApprovalModel(approval)} item={item} color={color} />;
}
function ApprovalBody({ item, color }: { item: WorkItem; color: string }) {
  const approval = useApprovalItem(item);
  return approval ? <ApprovalInner item={item} color={color} approval={approval} /> : null;
}
function McpInner({ item, color, request }: { item: WorkItem; color: string; request: McpPendingRequest }) {
  return <Sheet model={useMcpModel(request)} item={item} color={color} />;
}
function McpBody({ item, color }: { item: WorkItem; color: string }) {
  const request = useMcpItem(item);
  return request ? <McpInner key={request.requestId} item={item} color={color} request={request} /> : null;
}

export function DecisionBody({ item, color, onSend }: { item: WorkItem; color: string; onSend: (text: string) => void }) {
  if (hasNativeBody(item.kind)) {
    if (item.kind === 'decision') return <DecisionSheetBody item={item} color={color} />;
    if (item.kind === 'approval') return <ApprovalBody item={item} color={color} />;
    return <McpBody item={item} color={color} />;
  }
  return (
    <div className="r5a-sheet-inner" style={{ ['--c' as string]: color }} data-testid="companion-r5a-decision">
      <p className="r5a-eyebrow typo-eyebrow mb-3">
        <KindIcon kind={item.kind} />
        {I.noun[item.kind]}
      </p>
      <WorkItemBody item={item} onSend={onSend} />
    </div>
  );
}
